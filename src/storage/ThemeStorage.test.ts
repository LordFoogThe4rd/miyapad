import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThemeStorage } from './ThemeStorage';
import { defaultThemes } from '../defaults/themes';

const DB = 'db' as unknown as DbConnection;
const defaults = defaultThemes as Record<string, ThemeData>;
const [firstDefault, secondDefault] = Object.keys(defaults);

const adapter = {
	openDatabase: vi.fn(),
	loadFromDatabase: vi.fn(),
	loadAllFromDatabase: vi.fn(),
	loadSessionInfoFromDatabase: vi.fn(),
	saveToDatabase: vi.fn(),
	renameSessionInDatabase: vi.fn(),
	deleteFromDatabase: vi.fn(),
} satisfies DatabaseAdapter;

function savedKeys() {
	return adapter.saveToDatabase.mock.calls.map(([, , key]) => key);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	adapter.openDatabase.mockResolvedValue(DB);
	adapter.saveToDatabase.mockResolvedValue(undefined);
	adapter.deleteFromDatabase.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('ThemeStorage.init', () => {
	it('fills an empty database with the default themes', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue({});
		const storage = new ThemeStorage(adapter);

		await storage.init();

		expect(storage.getStorageData()).toEqual(defaults);
		expect(savedKeys()).toEqual(Object.keys(defaults));
	});

	it('writes nothing when every default theme is already there and current', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue(structuredClone(defaults));

		await new ThemeStorage(adapter).init();

		expect(adapter.saveToDatabase).not.toHaveBeenCalled();
	});

	it('adds a default theme that is new since the last visit, keeping custom ones', async () => {
		const stored = structuredClone(defaults);
		delete stored[secondDefault];
		const custom = { order: 50, isDefault: false, className: 'mine', css: '.mine {}' };
		adapter.loadAllFromDatabase.mockResolvedValue({ ...stored, Mine: custom });
		const storage = new ThemeStorage(adapter);

		await storage.init();

		expect(savedKeys()).toEqual([secondDefault]);
		expect(storage.getStorageData().Mine).toEqual(custom);
	});

	it('updates a default theme whose CSS changed in the code', async () => {
		const stored = structuredClone(defaults);
		stored[firstDefault].css = '/* old */';
		adapter.loadAllFromDatabase.mockResolvedValue(stored);
		const storage = new ThemeStorage(adapter);

		await storage.init();

		expect(savedKeys()).toEqual([firstDefault]);
		expect(storage.getStorageData()[firstDefault].css).toBe(defaults[firstDefault].css);
	});

	it('leaves alone a theme with a default name that is no longer marked as a default', async () => {
		const stored = structuredClone(defaults);
		stored[firstDefault] = { ...stored[firstDefault], isDefault: false, css: '/* edited */' };
		adapter.loadAllFromDatabase.mockResolvedValue(stored);
		const storage = new ThemeStorage(adapter);

		await storage.init();

		expect(adapter.saveToDatabase).not.toHaveBeenCalled();
		expect(storage.getStorageData()[firstDefault].css).toBe('/* edited */');
	});

	it('fills in a missing order and default flag, and deletes an entry that is not a theme', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue({ ...structuredClone(defaults), Bare: { className: 'bare', css: '' }, Broken: { css: 1 } });
		const storage = new ThemeStorage(adapter);

		await storage.init();

		expect(storage.getStorageData().Bare).toEqual({ order: 999, isDefault: false, className: 'bare', css: '' });
		expect(storage.getStorageData()).not.toHaveProperty('Broken');
		expect(adapter.deleteFromDatabase).toHaveBeenCalledExactlyOnceWith(DB, 'Themes', 'Broken');
	});
});

describe('ThemeStorage.performFullSave', () => {
	it('carries on saving when a stale theme cannot be deleted', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue(structuredClone(defaults));
		const storage = new ThemeStorage(adapter);
		await storage.init();
		adapter.deleteFromDatabase.mockRejectedValue(new Error('locked'));
		const next = { [firstDefault]: defaults[firstDefault], New: { order: 9, isDefault: false, className: 'n', css: '' } };

		await storage.performFullSave(next);

		expect(savedKeys()).toEqual(['New']);
		expect(storage.getStorageData()).toBe(next);
	});

	it('reports and rethrows a failed save', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue(structuredClone(defaults));
		const storage = new ThemeStorage(adapter);
		await storage.init();
		adapter.saveToDatabase.mockRejectedValue(new Error('quota'));
		const onError = vi.fn();
		storage.addEventListener('error', onError);

		await expect(storage.performFullSave({ New: { order: 9, isDefault: false, className: 'n', css: '' } })).rejects.toThrow('quota');
		expect(onError).toHaveBeenCalled();
	});
});
