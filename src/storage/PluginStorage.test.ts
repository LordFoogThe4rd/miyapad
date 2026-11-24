import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyManifest } from '../plugins/manifest';
import { PluginIdMismatchError, PluginStorage } from './PluginStorage';
import { PluginData } from './PluginData';

const DB = 'db' as unknown as DbConnection;

const adapter = {
	openDatabase: vi.fn(),
	loadFromDatabase: vi.fn(),
	loadAllFromDatabase: vi.fn(),
	loadSessionInfoFromDatabase: vi.fn(),
	saveToDatabase: vi.fn(),
	renameSessionInDatabase: vi.fn(),
	deleteFromDatabase: vi.fn(),
	batchMutation: vi.fn(),
} satisfies DatabaseAdapter;

async function storageWith(records: Record<string, unknown>) {
	adapter.loadAllFromDatabase.mockResolvedValue(records);
	const storage = new PluginStorage(adapter, new PluginData(adapter));
	await storage.init();
	return storage;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	adapter.openDatabase.mockResolvedValue(DB);
	adapter.saveToDatabase.mockResolvedValue(undefined);
	adapter.deleteFromDatabase.mockResolvedValue(undefined);
	adapter.batchMutation.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('PluginStorage', () => {
	it('converts legacy flat records into synthetic manifests and drops invalid records on load', async () => {
		const storage = await storageWith({
			good: { code: 'x', enabled: true, min: '2.9.0', extra: 1 },
			noCode: { enabled: true },
			notRecord: 'x',
		});

		expect(storage.plugins).toEqual({
			good: {
				code: 'x',
				enabled: true,
				manifest: { id: 'good', name: 'good', order: 0, api: 1, minMiyapad: '2.9.0' },
			},
		});
		expect(adapter.deleteFromDatabase.mock.calls.map(([, , key]) => key).sort()).toEqual(['noCode', 'notRecord']);
	});

	it('loads manifest-based records with changelog and source', async () => {
		const storage = await storageWith({
			date: {
				code: 'x',
				enabled: true,
				url: 'https://example.com/date.miyaplugin',
				source: 'https://github.com/o/r',
				changelog: '## [1.0.0]\n- Init',
				manifest: { id: 'date', name: 'Date Plugin', version: '1.0.0', order: -5, api: 1, requires: ['server'] },
			},
		});

		expect(storage.plugins.date).toEqual({
			code: 'x',
			enabled: true,
			url: 'https://example.com/date.miyaplugin',
			source: 'https://github.com/o/r',
			changelog: '## [1.0.0]\n- Init',
			manifest: { id: 'date', name: 'Date Plugin', version: '1.0.0', order: -5, api: 1, requires: ['server'] },
		});
	});

	it('keeps timeout fields only when they are finite and positive', async () => {
		const storage = await storageWith({
			good: { code: 'x', enabled: true, startTimeout: 12, hookTimeout: 30 },
			zero: { code: 'x', enabled: true, startTimeout: 0 },
			negative: { code: 'x', enabled: true, hookTimeout: -1 },
			notNumber: { code: 'x', enabled: true, startTimeout: '5' },
			infinite: { code: 'x', enabled: true, hookTimeout: Infinity },
		});

		expect(storage.plugins.good.manifest).toEqual({ id: 'good', name: 'good', order: 0, api: 1, startTimeout: 12, hookTimeout: 30 });
		for (const name of ['zero', 'negative', 'notNumber', 'infinite']) {
			expect(storage.plugins[name].manifest).toEqual({ id: name, name, order: 0, api: 1 });
		}
	});

	it('settles pending only after the save has reached the adapter', async () => {
		const storage = await storageWith({ p: { code: 'x', enabled: false } });
		let finish!: () => void;
		adapter.saveToDatabase.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));

		const save = storage.setEnabled('p', true);
		let settled = false;
		storage.pending.then(() => { settled = true; });
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(adapter.saveToDatabase).toHaveBeenCalledWith(DB, 'Plugins', 'p', {
			code: 'x',
			enabled: true,
			manifest: { id: 'p', name: 'p', order: 0, api: 1 },
		});
		expect(settled).toBe(false);
		expect(storage.plugins.p.enabled).toBe(false);

		finish();
		await save;
		await storage.pending;
		expect(settled).toBe(true);
		expect(storage.plugins.p.enabled).toBe(true);
	});

	it('keeps the old record when a save fails, and pending still settles', async () => {
		const storage = await storageWith({ p: { code: 'x', enabled: false } });
		adapter.saveToDatabase.mockRejectedValueOnce(new Error('disk full'));

		await expect(storage.setEnabled('p', true)).rejects.toThrow('disk full');
		await storage.pending;
		expect(storage.plugins.p.enabled).toBe(false);
	});

	it('records the version a mismatched plugin was switched on for', async () => {
		const storage = await storageWith({ p: { code: 'x', enabled: false, max: '1.0' } });
		await storage.setEnabled('p', true, '2.9.0');
		expect(storage.plugins.p.allowedVersion).toBe('2.9.0');
		expect(storage.plugins.p.enabled).toBe(true);
	});

	it('imports with manifest, changelog and source switched off, dropping allowedVersion', async () => {
		const storage = await storageWith({ p: { code: 'old', enabled: true, min: '1.0', allowedVersion: '2.9.0' } });
		const manifest: PluginManifest = { id: 'p', name: 'Pretty P', version: '1.2.0', order: 2, api: 1, maxMiyapad: '3.0' };
		await storage.importPlugin({
			code: 'new',
			manifest,
			changelog: '## [1.2.0]\n- Fresh',
			url: 'https://example.com/p.miyaplugin',
			source: 'https://github.com/o/p',
		});

		expect(storage.plugins.p).toEqual({
			code: 'new',
			enabled: false,
			manifest,
			changelog: '## [1.2.0]\n- Fresh',
			url: 'https://example.com/p.miyaplugin',
			source: 'https://github.com/o/p',
		});
		expect(adapter.batchMutation).not.toHaveBeenCalled();
	});

	it('replaces a legacy plugin whose imported id differs only in case, leaving its data alone', async () => {
		const storage = await storageWith({ foo: { code: 'old', enabled: true } });
		expect(storage.resolveId('Foo')).toBe('foo');
		expect(storage.resolveId('bar')).toBe('bar');

		await storage.importPlugin({ code: 'new', manifest: legacyManifest('Foo') });

		expect(storage.plugins).toEqual({
			foo: {
				code: 'new',
				enabled: false,
				manifest: { id: 'foo', name: 'Foo', order: 0, api: 1 },
			},
		});
		expect(adapter.batchMutation).not.toHaveBeenCalled();
	});

	it('updates from the address, keeping enabled, url, source and data, and clearing allowedVersion', async () => {
		const storage = await storageWith({
			p: {
				code: 'old',
				enabled: true,
				allowedVersion: '2.9.0',
				url: 'https://example.com/p.miyaplugin',
				source: 'https://github.com/o/p',
				manifest: { id: 'p', name: 'Old Name', version: '1.0.0', order: 0, api: 1, minMiyapad: '2.8.0' },
			},
		});

		const nextManifest: PluginManifest = { id: 'p', name: 'Renamed P', version: '1.1.0', order: 3, api: 1, maxMiyapad: '3.0' };
		await storage.updatePlugin('p', { code: 'new', manifest: nextManifest, changelog: '## [1.1.0]\n- Renamed' });

		expect(storage.plugins.p).toEqual({
			code: 'new',
			enabled: true,
			url: 'https://example.com/p.miyaplugin',
			source: 'https://github.com/o/p',
			changelog: '## [1.1.0]\n- Renamed',
			manifest: nextManifest,
		});
		expect(adapter.batchMutation).not.toHaveBeenCalled();
	});

	it('refuses an update whose manifest.id is for a different plugin', async () => {
		const storage = await storageWith({
			p: {
				code: 'old',
				enabled: true,
				url: 'https://example.com/p.miyaplugin',
				manifest: { id: 'p', name: 'P', version: '1.0.0', order: 0, api: 1 },
			},
		});

		await expect(
			storage.updatePlugin('p', {
				code: 'evil',
				manifest: { id: 'other', name: 'Other', version: '1.0.0', order: 0, api: 1 },
			}),
		).rejects.toThrow(PluginIdMismatchError);
		expect(storage.plugins.p.code).toBe('old');
	});

	it('removes the plugin\'s data first, then the plugin', async () => {
		const storage = await storageWith({ p: { code: 'x', enabled: true } });
		adapter.loadFromDatabase.mockResolvedValue(['a']);

		await storage.remove('p');

		expect(adapter.batchMutation).toHaveBeenCalledWith(DB, 'PluginData', [{ type: 'delete', key: 'p/a' }, { type: 'delete', key: 'p' }]);
		expect(adapter.deleteFromDatabase).toHaveBeenCalledWith(DB, 'Plugins', 'p');
		expect(adapter.batchMutation.mock.invocationCallOrder[0]).toBeLessThan(adapter.deleteFromDatabase.mock.invocationCallOrder[0]);
		expect(storage.plugins).toEqual({});
	});
});
