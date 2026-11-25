import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginIdMismatchError, PluginStorage } from './PluginStorage';

const DB = 'db' as unknown as DbConnection;

function makeManifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
	return { id, name: id, version: '1.0.0', order: 0, api: 1, ...overrides };
}

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

const containers = {
	deleteContainer: vi.fn(),
};

async function storageWith(records: Record<string, unknown>) {
	adapter.loadAllFromDatabase.mockResolvedValue(records);
	const storage = new PluginStorage(adapter, containers);
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
	containers.deleteContainer.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('PluginStorage', () => {
	it('deletes legacy flat records and invalid records along with their containers on load', async () => {
		const storage = await storageWith({
			good: { code: 'x', enabled: true, manifest: makeManifest('good', { minMiyapad: '2.9.0' }), extra: 1 },
			legacy: { code: 'x', enabled: true, min: '2.9.0' },
			noCode: { enabled: true },
			notRecord: 'x',
		});

		expect(storage.registryError).toBeNull();
		expect(storage.plugins).toEqual({
			good: {
				code: 'x',
				enabled: true,
				manifest: makeManifest('good', { minMiyapad: '2.9.0' }),
			},
		});
		expect(containers.deleteContainer.mock.calls.map(([id]) => id).sort()).toEqual(['legacy', 'noCode', 'notRecord']);
		expect(adapter.deleteFromDatabase.mock.calls.map(([, , key]) => key).sort()).toEqual(['legacy', 'noCode', 'notRecord']);
	});

	it('records registryError and deletes nothing when the Plugins registry cannot be read', async () => {
		adapter.loadAllFromDatabase.mockRejectedValueOnce(new Error('corrupt registry'));
		const storage = new PluginStorage(adapter, containers);
		await storage.init();

		expect(storage.registryError).toBe('corrupt registry');
		expect(storage.plugins).toEqual({});
		expect(containers.deleteContainer).not.toHaveBeenCalled();
		expect(adapter.deleteFromDatabase).not.toHaveBeenCalled();
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
			good: { code: 'x', enabled: true, manifest: { ...makeManifest('good'), startTimeout: 12, hookTimeout: 30 } },
			zero: { code: 'x', enabled: true, manifest: { ...makeManifest('zero'), startTimeout: 0 } },
			negative: { code: 'x', enabled: true, manifest: { ...makeManifest('negative'), hookTimeout: -1 } },
			'not-number': { code: 'x', enabled: true, manifest: { ...makeManifest('not-number'), startTimeout: '5' } },
			infinite: { code: 'x', enabled: true, manifest: { ...makeManifest('infinite'), hookTimeout: Infinity } },
		});

		expect(storage.plugins.good.manifest).toEqual(makeManifest('good', { startTimeout: 12, hookTimeout: 30 }));
		for (const name of ['zero', 'negative', 'not-number', 'infinite']) {
			expect(storage.plugins[name].manifest).toEqual(makeManifest(name));
		}
	});

	it('settles pending only after the save has reached the adapter', async () => {
		const storage = await storageWith({ p: { code: 'x', enabled: false, manifest: makeManifest('p') } });
		let finish!: () => void;
		adapter.saveToDatabase.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));

		const save = storage.setEnabled('p', true);
		let settled = false;
		storage.pending.then(() => { settled = true; });
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(adapter.saveToDatabase).toHaveBeenCalledWith(DB, 'Plugins', 'p', {
			code: 'x',
			enabled: true,
			manifest: makeManifest('p'),
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
		const storage = await storageWith({ p: { code: 'x', enabled: false, manifest: makeManifest('p') } });
		adapter.saveToDatabase.mockRejectedValueOnce(new Error('disk full'));

		await expect(storage.setEnabled('p', true)).rejects.toThrow('disk full');
		await storage.pending;
		expect(storage.plugins.p.enabled).toBe(false);
	});

	it('records the version a mismatched plugin was switched on for', async () => {
		const storage = await storageWith({ p: { code: 'x', enabled: false, manifest: makeManifest('p', { maxMiyapad: '1.0' }) } });
		await storage.setEnabled('p', true, '2.9.0');
		expect(storage.plugins.p.allowedVersion).toBe('2.9.0');
		expect(storage.plugins.p.enabled).toBe(true);
	});

	it('imports with manifest, changelog and source switched off, dropping allowedVersion and keeping container data', async () => {
		const storage = await storageWith({ p: { code: 'old', enabled: true, allowedVersion: '2.9.0', manifest: makeManifest('p', { minMiyapad: '1.0' }) } });
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
		expect(containers.deleteContainer).not.toHaveBeenCalled();
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
		expect(containers.deleteContainer).not.toHaveBeenCalled();
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

	it('clears a plugin\'s container data while keeping its registry record', async () => {
		const storage = await storageWith({ p: { code: 'x', enabled: true, manifest: makeManifest('p') } });

		await storage.clearData('p');

		expect(containers.deleteContainer).toHaveBeenCalledWith('p');
		expect(adapter.deleteFromDatabase).not.toHaveBeenCalled();
		expect(storage.plugins.p).toBeDefined();
		await expect(storage.clearData('missing')).rejects.toThrow('No plugin "missing"');
	});

	it('removes the container before the registry entry by default, and keeps container data when keepData is true', async () => {
		const storage = await storageWith({
			a: { code: 'x', enabled: true, manifest: makeManifest('a') },
			b: { code: 'y', enabled: false, manifest: makeManifest('b') },
		});

		await storage.remove('a');
		expect(containers.deleteContainer).toHaveBeenCalledWith('a');
		expect(adapter.deleteFromDatabase).toHaveBeenCalledWith(DB, 'Plugins', 'a');
		expect(containers.deleteContainer.mock.invocationCallOrder[0]).toBeLessThan(adapter.deleteFromDatabase.mock.invocationCallOrder[0]);
		expect(storage.plugins.a).toBeUndefined();

		containers.deleteContainer.mockClear();
		adapter.deleteFromDatabase.mockClear();

		await storage.remove('b', { keepData: true });
		expect(containers.deleteContainer).not.toHaveBeenCalled();
		expect(adapter.deleteFromDatabase).toHaveBeenCalledWith(DB, 'Plugins', 'b');
		expect(storage.plugins).toEqual({});
	});
});
