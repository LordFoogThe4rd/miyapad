import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginStorage } from './PluginStorage';
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
	it('drops invalid records on load', async () => {
		const storage = await storageWith({
			good: { code: 'x', enabled: true, min: '2.9.0', extra: 1 },
			noCode: { enabled: true },
			notRecord: 'x',
		});

		expect(storage.plugins).toEqual({ good: { code: 'x', enabled: true, min: '2.9.0' } });
		expect(adapter.deleteFromDatabase.mock.calls.map(([, , key]) => key).sort()).toEqual(['noCode', 'notRecord']);
	});

	it('keeps timeout fields only when they are finite and positive', async () => {
		const storage = await storageWith({
			good: { code: 'x', enabled: true, startTimeout: 12, hookTimeout: 30 },
			zero: { code: 'x', enabled: true, startTimeout: 0 },
			negative: { code: 'x', enabled: true, hookTimeout: -1 },
			notNumber: { code: 'x', enabled: true, startTimeout: '5' },
			infinite: { code: 'x', enabled: true, hookTimeout: Infinity },
		});

		expect(storage.plugins.good).toEqual({ code: 'x', enabled: true, startTimeout: 12, hookTimeout: 30 });
		for (const name of ['zero', 'negative', 'notNumber', 'infinite']) {
			expect(storage.plugins[name]).toEqual({ code: 'x', enabled: true });
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
		expect(adapter.saveToDatabase).toHaveBeenCalledWith(DB, 'Plugins', 'p', { code: 'x', enabled: true });
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
		expect(storage.plugins.p).toEqual({ code: 'x', enabled: false });
	});

	it('records the version a mismatched plugin was switched on for', async () => {
		const storage = await storageWith({ p: { code: 'x', enabled: false, max: '1.0' } });
		await storage.setEnabled('p', true, '2.9.0');
		expect(storage.plugins.p).toEqual({ code: 'x', enabled: true, max: '1.0', allowedVersion: '2.9.0' });
	});

	it('imports switched off, and replacing drops allowedVersion but not the data', async () => {
		const storage = await storageWith({ p: { code: 'old', enabled: true, min: '1.0', allowedVersion: '2.9.0' } });
		await storage.importPlugin('p', 'new', { max: '3.0' });
		expect(storage.plugins.p).toEqual({ code: 'new', enabled: false, max: '3.0' });
		expect(adapter.batchMutation).not.toHaveBeenCalled();
	});

	it('replaces a plugin whose imported name differs only in case, leaving its data alone', async () => {
		const storage = await storageWith({ foo: { code: 'old', enabled: true } });
		expect(storage.resolveName('Foo')).toBe('foo');
		expect(storage.resolveName('bar')).toBe('bar');

		await storage.importPlugin('Foo', 'new', {});

		expect(storage.plugins).toEqual({ foo: { code: 'new', enabled: false } });
		expect(adapter.batchMutation).not.toHaveBeenCalled();
	});

	it('stores the declared timeout lines', async () => {
		const storage = await storageWith({});
		await storage.importPlugin('p', 'x', { min: '1.0', startTimeout: 5, hookTimeout: 30 });
		expect(storage.plugins.p).toEqual({ code: 'x', enabled: false, min: '1.0', startTimeout: 5, hookTimeout: 30 });
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
