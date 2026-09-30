import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBAdapter } from './IndexedDBAdapter';

let adapter: IndexedDBAdapter;
let db: IDBDatabase;

beforeEach(async () => {
	vi.stubGlobal('indexedDB', new IDBFactory());
	adapter = new IndexedDBAdapter();
	db = await adapter.openDatabase();
});

afterEach(() => {
	db.close();
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('IndexedDBAdapter', () => {
	it('creates every store on a fresh database', () => {
		expect([...db.objectStoreNames].sort()).toEqual(
			['Connections', 'Names', 'SamplerPresets', 'SessionHistory', 'Sessions', 'Templates', 'Themes']);
	});

	it('saves, loads and lists records', async () => {
		await adapter.saveToDatabase(db, 'Templates', 'a', { x: 1 });
		await adapter.saveToDatabase(db, 'Templates', 'b', { x: 2 });
		expect(await adapter.loadFromDatabase(db, 'Templates', 'a')).toEqual({ x: 1 });
		expect(await adapter.loadFromDatabase(db, 'Templates', 'missing')).toBeUndefined();
		expect(await adapter.loadAllFromDatabase(db, 'Templates')).toEqual({ a: { x: 1 }, b: { x: 2 } });
	});

	it('lists session info without the id counters, and a string-keyed leftover never hides the real record', async () => {
		await adapter.saveToDatabase(db, 'Names', 1, { name: 'real', pinned: true });
		await adapter.saveToDatabase(db, 'Names', '1', { name: 'leftover' });
		await adapter.saveToDatabase(db, 'Names', 'nextSessionId', 2);
		await adapter.saveToDatabase(db, 'Names', 'selectedSessionId', 1);
		expect(await adapter.loadSessionInfoFromDatabase(db, 'Names')).toEqual({ 1: { name: 'real', pinned: true } });
	});

	it('rename keeps the rest of the record and bumps modified', async () => {
		await adapter.saveToDatabase(db, 'Names', 1, { name: 'old', created: 5, modified: 6, pinned: true, tags: ['a'] });
		await adapter.renameSessionInDatabase(db, 'Names', 1, 'new');
		const renamed = await adapter.loadFromDatabase(db, 'Names', 1);
		expect(renamed).toMatchObject({ name: 'new', created: 5, pinned: true, tags: ['a'] });
		expect(renamed.modified).toBeGreaterThan(6);
	});

	it('rename of a legacy string name or a missing record writes a fresh one', async () => {
		await adapter.saveToDatabase(db, 'Names', 1, 'legacy');
		await adapter.renameSessionInDatabase(db, 'Names', 1, 'new');
		await adapter.renameSessionInDatabase(db, 'Names', 2, 'other');
		expect(await adapter.loadFromDatabase(db, 'Names', 1)).toMatchObject({ name: 'new', created: null });
		expect(await adapter.loadFromDatabase(db, 'Names', 2)).toMatchObject({ name: 'other', created: null });
	});

	it('deleting a session also removes its string-keyed leftover, but other stores keep both key types', async () => {
		for (const store of ['Sessions', 'Templates']) {
			await adapter.saveToDatabase(db, store, 1, 'number');
			await adapter.saveToDatabase(db, store, '1', 'string');
			await adapter.deleteFromDatabase(db, store, 1);
		}
		expect(await adapter.loadAllFromDatabase(db, 'Sessions')).toEqual({});
		expect(await adapter.loadAllFromDatabase(db, 'Templates')).toEqual({ 1: 'string' });
	});

	it('applies a batch of saves and deletes', async () => {
		await adapter.saveToDatabase(db, 'Themes', 'gone', 1);
		await adapter.batchMutation(db, 'Themes', [
			{ type: 'save', key: 'a', data: 'A' },
			{ type: 'delete', key: 'gone' },
		]);
		expect(await adapter.loadAllFromDatabase(db, 'Themes')).toEqual({ a: 'A' });
	});

	it('exports every store and imports it back, replacing only the stores in the file', async () => {
		await adapter.saveToDatabase(db, 'Sessions', 1, { prompt: 'hi' });
		await adapter.saveToDatabase(db, 'Themes', 't', 'theme');
		const exported = await adapter.exportDatabase();
		expect(exported.Sessions).toEqual([{ key: 1, value: { prompt: 'hi' } }]);

		await adapter.saveToDatabase(db, 'Sessions', 2, 'extra');
		await adapter.saveToDatabase(db, 'Themes', 'u', 'kept');
		await adapter.importDatabase({ Sessions: exported.Sessions });
		expect(await adapter.loadAllFromDatabase(db, 'Sessions')).toEqual({ 1: { prompt: 'hi' } });
		expect(await adapter.loadAllFromDatabase(db, 'Themes')).toEqual({ t: 'theme', u: 'kept' });
	});
});

describe('IndexedDBAdapter upgrade from version 2', () => {
	it('moves session names into the Names store', async () => {
		db.close();
		vi.stubGlobal('indexedDB', new IDBFactory());
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open('MiyaPad', 2);
			req.onupgradeneeded = () => {
				const store = req.result.createObjectStore('Sessions');
				store.put({ name: 'Story', prompt: 'x' }, 1);
				store.put({ prompt: 'no name' }, 2);
			};
			req.onsuccess = () => { req.result.close(); resolve(); };
			req.onerror = () => reject(req.error);
		});

		db = await adapter.openDatabase();
		expect(await adapter.loadFromDatabase(db, 'Names', 1)).toBe('Story');
		expect(await adapter.loadFromDatabase(db, 'Sessions', 1)).toEqual({ prompt: 'x' });
		expect(await adapter.loadFromDatabase(db, 'Names', 2)).toBeUndefined();
		expect(await adapter.loadFromDatabase(db, 'Sessions', 2)).toEqual({ prompt: 'no name' });
	});
});

describe('IndexedDBAdapter.init', () => {
	function stubStorage(persisted: boolean, persist: boolean) {
		vi.stubGlobal('navigator', { ...navigator, storage: { persisted: async () => persisted, persist: async () => persist } });
		const alert = vi.fn();
		vi.stubGlobal('alert', alert);
		return alert;
	}

	it('warns once when the browser refuses persistent storage', async () => {
		const alert = stubStorage(false, false);
		await adapter.init();
		await adapter.init();
		expect(alert).toHaveBeenCalledTimes(1);
		expect(alert.mock.calls[0][0]).toMatch(/automatically denied/);
	});

	it('says nothing when storage is already persistent or gets granted', async () => {
		const alreadyPersistent = stubStorage(true, false);
		await adapter.init();
		const granted = stubStorage(false, true);
		await adapter.init();
		expect(alreadyPersistent).not.toHaveBeenCalled();
		expect(granted).not.toHaveBeenCalled();
	});

	it('survives a browser without the storage API', async () => {
		vi.stubGlobal('navigator', { ...navigator, storage: undefined });
		await expect(adapter.init()).resolves.toBeUndefined();
	});
});
