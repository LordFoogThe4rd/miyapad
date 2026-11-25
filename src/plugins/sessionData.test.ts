import { describe, expect, it, vi } from 'vitest';
import { SessionStorage } from '../storage/SessionStorage';
import { sessionDataFor } from './sessionData';

function makeMemoryAdapter(): DatabaseAdapter {
	const stores = new Map<string, Map<string, unknown>>();
	const getStore = (name: string) => {
		let store = stores.get(name);
		if (!store) {
			store = new Map();
			stores.set(name, store);
		}
		return store;
	};
	return {
		openDatabase: async () => ({} as DbConnection),
		loadFromDatabase: async (_db, store, key) => {
			const val = getStore(store).get(String(key));
			return val === undefined ? undefined : structuredClone(val);
		},
		loadAllFromDatabase: async (_db, store) => {
			const out: Record<string, unknown> = {};
			for (const [k, v] of getStore(store).entries()) out[k] = structuredClone(v);
			return out;
		},
		loadSessionInfoFromDatabase: async (_db, _store) => {
			const out: Record<string, unknown> = {};
			for (const [k, v] of getStore('Names').entries()) out[k] = structuredClone(v);
			return out;
		},
		saveToDatabase: async (_db, store, key, data) => {
			getStore(store).set(String(key), structuredClone(data));
		},
		renameSessionInDatabase: async (_db, _store, key, newName) => {
			const names = getStore('Names');
			const prev = names.get(String(key)) as Record<string, unknown> | undefined;
			if (prev) names.set(String(key), { ...prev, name: newName });
		},
		deleteFromDatabase: async (_db, store, key) => {
			getStore(store).delete(String(key));
		},
		batchMutation: async (_db, store, ops) => {
			const s = getStore(store);
			for (const op of ops) {
				if (op.type === 'save') s.set(String(op.key), structuredClone(op.data));
				else s.delete(String(op.key));
			}
		},
	};
}

function makeFakeSessionStorage(selected: number | undefined = 1) {
	const sessions: Record<string, SessionData> = selected !== undefined
		? { [selected]: { name: 'A', modified: 1000, inactive: false } }
		: {};
	return {
		selectedSession: selected,
		sessions,
		enqueueSave: vi.fn(),
	};
}

describe('sessionDataFor', () => {
	it('gets, sets, lists keys, deletes and clears data on the active session without bumping modified', () => {
		const storage = makeFakeSessionStorage(1);
		const data = sessionDataFor('summary', storage);
		const other = sessionDataFor('other', storage);

		expect(data.sessionId).toBe(1);
		expect(data.get('notes')).toBeUndefined();
		expect(data.keys()).toEqual([]);

		expect(data.set('notes', { text: 'hello', count: 2 })).toBe(true);
		expect(other.set('flag', true)).toBe(true);

		expect(data.get('notes')).toEqual({ text: 'hello', count: 2 });
		expect(data.keys()).toEqual(['notes']);
		expect(other.get('flag')).toBe(true);
		// Does not bump modified.
		expect(storage.sessions[1].modified).toBe(1000);
		expect(storage.enqueueSave).toHaveBeenCalledWith(1);

		// Returned objects are cloned so mutating them doesn't mutate session state.
		const copy = data.get('notes') as { text: string };
		copy.text = 'mutated';
		expect(data.get('notes')).toEqual({ text: 'hello', count: 2 });

		expect(data.delete('notes')).toBe(true);
		expect(data.get('notes')).toBeUndefined();
		expect(data.keys()).toEqual([]);
		expect(other.get('flag')).toBe(true);

		expect(other.clear()).toBe(true);
		expect(other.keys()).toEqual([]);
		expect(storage.sessions[1].pluginData).toBeUndefined();
	});

	it('JSON-clones values and rejects non-JSON values like undefined and BigInt', () => {
		const storage = makeFakeSessionStorage(1);
		const data = sessionDataFor('p', storage);

		const date = new Date('2026-11-25T00:00:00.000Z');
		const input = { at: date, nested: [1, 2] };
		data.set('entry', input);
		input.nested.push(3);

		expect(data.get('entry')).toEqual({ at: '2026-11-25T00:00:00.000Z', nested: [1, 2] });
		expect(() => data.set('undef', undefined)).toThrow(TypeError);
		expect(() => data.set('big', 10n)).toThrow(TypeError);
	});

	it('switch guard refuses writes when opts.sessionId no longer matches or session is inactive', () => {
		const storage = makeFakeSessionStorage(1);
		storage.sessions[2] = { name: 'B', modified: 2000, inactive: false };
		const data = sessionDataFor('tracker', storage);

		const snapId = data.sessionId;
		expect(data.set('state', 'from-A', { sessionId: snapId })).toBe(true);

		// Simulate switching to session 2 before an async job finishes.
		storage.selectedSession = 2;
		storage.enqueueSave.mockClear();

		expect(data.set('state', 'stale-write', { sessionId: snapId })).toBe(false);
		expect(data.delete('state', { sessionId: snapId })).toBe(false);
		expect(data.clear({ sessionId: snapId })).toBe(false);
		expect(data.get('state')).toBeUndefined();
		expect(storage.enqueueSave).not.toHaveBeenCalled();

		// Inactive session also blocks reads and writes.
		storage.sessions[2].inactive = true;
		expect(data.get('state')).toBeUndefined();
		expect(data.keys()).toEqual([]);
		expect(data.set('state', 'x')).toBe(false);
	});

	it('survives session switch, single-session export/import, and is removed on purge', async () => {
		const adapter = makeMemoryAdapter();
		const sessionStorage = new SessionStorage(adapter);
		await sessionStorage.init();

		const firstId = sessionStorage.selectedSession!;
		const data = sessionDataFor('notes', sessionStorage);
		const historySnapshotSpy = vi.spyOn(sessionStorage.history, 'snapshot');

		expect(data.set('summary', 'Chapter 1 recap', { sessionId: firstId })).toBe(true);
		expect(historySnapshotSpy).not.toHaveBeenCalled();

		// Switch to a second session and back: data persists in the database.
		const secondId = await sessionStorage.createSession('Second');
		await sessionStorage.switchSession(secondId);
		expect(data.sessionId).toBe(secondId);
		expect(data.get('summary')).toBeUndefined();

		await sessionStorage.switchSession(firstId);
		expect(data.get('summary')).toBe('Chapter 1 recap');

		// Single-session export/import carries pluginData.
		const db = await sessionStorage.openDatabase();
		const exportedRecord = await sessionStorage.loadFromDatabase(db, firstId) as Record<string, unknown>;
		const stringified = Object.fromEntries(
			Object.entries(exportedRecord).map(([k, v]) => [k, JSON.stringify(v)]),
		);
		const importedId = await sessionStorage.createSessionFromObject(stringified, false);
		await sessionStorage.switchSession(importedId);
		expect(data.get('summary')).toBe('Chapter 1 recap');

		// Trashing and purging removes the session and its pluginData.
		await sessionStorage.trashSessions([firstId]);
		await sessionStorage.purgeSessions([firstId]);
		expect(await sessionStorage.loadFromDatabase(db, firstId)).toBeUndefined();
	});
});
