import { describe, expect, it } from 'vitest';
import { PluginData } from './PluginData';

function memoryAdapter() {
	const store = new Map<string, unknown>();
	const copy = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
	const adapter: DatabaseAdapter = {
		openDatabase: async () => async () => undefined,
		loadFromDatabase: async (_db, _name, key) => copy(store.get(String(key))),
		loadAllFromDatabase: async () => Object.fromEntries(store),
		loadSessionInfoFromDatabase: async () => ({}),
		saveToDatabase: async (_db, _name, key, data) => { store.set(String(key), copy(data)); },
		renameSessionInDatabase: async () => {},
		deleteFromDatabase: async (_db, _name, key) => { store.delete(String(key)); },
		batchMutation: async (_db, _name, ops) => {
			for (const op of ops) {
				if (op.type === 'save') store.set(String(op.key), copy(op.data));
				else store.delete(String(op.key));
			}
		},
	};
	return { adapter, store };
}

describe('PluginData', () => {
	it('gets, sets and deletes values, keeping the key list in step', async () => {
		const { adapter, store } = memoryAdapter();
		const storage = new PluginData(adapter).storageFor('counter');

		expect(await storage.get('count')).toBeUndefined();
		await storage.set('count', 1);
		await storage.set('count', 2);
		await storage.set('cache/x', { a: [1] });

		expect(await storage.get('count')).toBe(2);
		expect(await storage.get('cache/x')).toEqual({ a: [1] });
		expect(await storage.keys()).toEqual(['count', 'cache/x']);
		expect(store.get('counter')).toEqual(['count', 'cache/x']);

		await storage.delete('count');
		await storage.delete('never-set');
		expect(await storage.get('count')).toBeUndefined();
		expect(await storage.keys()).toEqual(['cache/x']);
		expect([...store.keys()].sort()).toEqual(['counter', 'counter/cache/x']);
	});

	it('keeps each plugin under its own name', async () => {
		const { adapter } = memoryAdapter();
		const data = new PluginData(adapter);
		await data.storageFor('a').set('k', 'from a');
		await data.storageFor('b').set('k', 'from b');

		expect(await data.storageFor('a').get('k')).toBe('from a');
		expect(await data.storageFor('b').keys()).toEqual(['k']);
	});

	it('runs writes one at a time, so concurrent sets all reach the key list', async () => {
		const { adapter } = memoryAdapter();
		const storage = new PluginData(adapter).storageFor('p');
		await Promise.all(['a', 'b', 'c'].map(key => storage.set(key, key)));
		expect(await storage.keys()).toEqual(['a', 'b', 'c']);
	});

	it('saves values as JSON, so a Date comes back as a string', async () => {
		const { adapter } = memoryAdapter();
		const storage = new PluginData(adapter).storageFor('p');
		const date = new Date(Date.UTC(2026, 0, 2));
		const value = { when: date };

		await storage.set('when', value);
		value.when = new Date(0);

		expect(await storage.get('when')).toEqual({ when: '2026-01-02T00:00:00.000Z' });
	});

	it('refuses a value JSON has no form for, and saves nothing', async () => {
		const { adapter, store } = memoryAdapter();
		const storage = new PluginData(adapter).storageFor('p');
		await expect(storage.set('x', undefined)).rejects.toThrow(TypeError);
		await expect(storage.set('x', 1n)).rejects.toThrow(TypeError);
		expect(store.size).toBe(0);
	});

	it('treats a number key as the same key as its string', async () => {
		const { adapter } = memoryAdapter();
		const storage = new PluginData(adapter).storageFor('p');
		await storage.set(1 as unknown as string, 'one');
		await storage.set('1', 'uno');
		expect(await storage.keys()).toEqual(['1']);
		expect(await storage.get(1 as unknown as string)).toBe('uno');
	});

	it('deletes every key a plugin saved, and leaves other plugins alone', async () => {
		const { adapter, store } = memoryAdapter();
		const data = new PluginData(adapter);
		await data.storageFor('gone').set('a', 1);
		await data.storageFor('gone').set('b', 2);
		await data.storageFor('kept').set('a', 3);

		await data.deleteAll('gone');

		expect([...store.keys()].sort()).toEqual(['kept', 'kept/a']);
		expect(await data.storageFor('gone').keys()).toEqual([]);
	});
});
