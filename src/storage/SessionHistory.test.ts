import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_IDLE_MS, SessionHistory, positiveCount } from './SessionHistory';
import { SessionStorage } from './SessionStorage';

function memoryAdapter() {
	const stores = new Map<string, Map<string, unknown>>();
	const store = (name: string) => stores.get(name) ?? stores.set(name, new Map()).get(name)!;
	const copy = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
	const adapter: DatabaseAdapter = {
		openDatabase: async () => async () => undefined,
		loadFromDatabase: async (_db, name, key) => copy(store(name).get(String(key))),
		loadAllFromDatabase: async (_db, name) => Object.fromEntries(store(name)),
		loadSessionInfoFromDatabase: async () => Object.fromEntries(store('Names')),
		saveToDatabase: async (_db, name, key, data) => { store(name).set(String(key), copy(data)); },
		renameSessionInDatabase: async () => {},
		deleteFromDatabase: async (_db, name, key) => { store(name).delete(String(key)); },
		batchMutation: async (_db, name, ops) => {
			for (const op of ops) {
				if (op.type === 'save') store(name).set(String(op.key), copy(op.data));
				else store(name).delete(String(op.key));
			}
		},
	};
	return { adapter, store };
}

const u = (content: string): PromptChunk => ({ type: 'user', content });

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('SessionHistory', () => {
	it('stores the content only: no token probabilities, stale token counts or settings', async () => {
		const { adapter } = memoryAdapter();
		const history = new SessionHistory(adapter);
		const session = {
			prompt: [{ content: 'hi', prob: 0.5, completion_probabilities: [{ content: 'hi', probs: [] }] }],
			memoryTokens: { contextOrder: '{prompt}', prefix: '', text: 'mem', suffix: '', tokens: 3, worldInfo: 'old wi' },
			authorNoteTokens: { prefix: '', text: 'note', suffix: '', tokens: 1 },
			worldInfo: { miyaPediaVersion: 1, entries: [], prefix: '', suffix: '' },
			endpointAPIKey: 'sk-secret',
			temperature: 0.7,
		} as unknown as SessionData;

		await history.snapshot(0, session, 'idle');
		const [entry] = await history.list(0);

		expect(await history.load(0, entry!.time)).toEqual({
			prompt: [{ content: 'hi', prob: 0.5 }],
			memoryTokens: { contextOrder: '{prompt}', prefix: '', text: 'mem', suffix: '' },
			authorNoteTokens: { prefix: '', text: 'note', suffix: '' },
			worldInfo: { miyaPediaVersion: 1, entries: [], prefix: '', suffix: '' },
		});
		expect(entry).toMatchObject({ reason: 'idle', words: 1, tail: 'hi' });
	});

	it('skips a version identical to the latest one', async () => {
		const history = new SessionHistory(memoryAdapter().adapter);

		expect(await history.snapshot(0, { prompt: [u('a')], temperature: 1 }, 'open')).toBe(true);
		expect(await history.snapshot(0, { prompt: [u('a')], temperature: 2 }, 'idle')).toBe(false);
		expect(await history.snapshot(0, { prompt: [u('ab')] }, 'idle')).toBe(true);

		expect((await history.list(0)).map(e => e.reason)).toEqual(['open', 'idle']);
	});

	it('skips a session that has no content stored yet', async () => {
		const history = new SessionHistory(memoryAdapter().adapter);

		expect(await history.snapshot(0, { name: 'New', temperature: 1 }, 'open')).toBe(false);
		expect(await history.list(0)).toEqual([]);
	});

	it('keeps the configured number of versions and deletes the older ones', async () => {
		localStorage.setItem('historyKeep', '2');
		const { adapter, store } = memoryAdapter();
		const history = new SessionHistory(adapter);

		for (const text of ['one', 'two', 'three'])
			await history.snapshot(0, { prompt: [u(text)] }, 'idle');

		const entries = await history.list(0);
		expect(entries.map(e => e.tail)).toEqual(['two', 'three']);
		expect([...store('SessionHistory').keys()].sort()).toEqual(['0', ...entries.map(e => `0/${e.time}`)].sort());
	});

	it('takes concurrent snapshots one after another without losing any', async () => {
		const history = new SessionHistory(memoryAdapter().adapter);

		await Promise.all(['a', 'b', 'c'].map(text => history.snapshot(0, { prompt: [u(text)] }, 'idle')));

		expect((await history.list(0)).map(e => e.tail)).toEqual(['a', 'b', 'c']);
	});

	it('deleteAll removes the index and every version of that session only', async () => {
		const { adapter, store } = memoryAdapter();
		const history = new SessionHistory(adapter);
		await history.snapshot(0, { prompt: [u('a')] }, 'idle');
		await history.snapshot(0, { prompt: [u('b')] }, 'idle');
		await history.snapshot(1, { prompt: [u('c')] }, 'idle');

		await history.deleteAll(0);

		expect([...store('SessionHistory').keys()].every(k => k === '1' || k.startsWith('1/'))).toBe(true);
		expect(await history.list(1)).toHaveLength(1);
	});

	it('positiveCount falls back for anything but a positive number', () => {
		expect(positiveCount(12.7, 30)).toBe(12);
		expect([null, NaN, 0, -3, '5'].map(v => positiveCount(v, 30))).toEqual([30, 30, 30, 30, 30]);
	});
});

describe('SessionStorage version history', () => {
	async function setup() {
		const { adapter, store } = memoryAdapter();
		const storage = new SessionStorage(adapter);
		await storage.init();
		clearInterval(storage.saveTimer);
		return { storage, store, adapter };
	}

	it('versions content a minute after the last content edit, ignoring settings and unchanged values', async () => {
		vi.useFakeTimers();
		const { storage } = await setup();
		await storage.flushSnapshot();
		const opened = (await storage.history.list(0)).length;

		storage.setProperty('temperature', 2);
		storage.setProperty('prompt', [u('ab')]);
		await vi.advanceTimersByTimeAsync(HISTORY_IDLE_MS / 2);
		storage.setProperty('prompt', [u('abc')]);
		await vi.advanceTimersByTimeAsync(HISTORY_IDLE_MS - 1);
		expect(await storage.history.list(0)).toHaveLength(opened);

		await vi.advanceTimersByTimeAsync(1);
		const entries = await storage.history.list(0);
		expect(entries).toHaveLength(opened + 1);
		expect(entries.at(-1)).toMatchObject({ reason: 'idle', tail: 'abc' });

		storage.setProperty('prompt', storage.getProperty('prompt'));
		await vi.advanceTimersByTimeAsync(HISTORY_IDLE_MS);
		expect(await storage.history.list(0)).toHaveLength(opened + 1);
	});

	it('switching away saves the pending version of the session being left', async () => {
		const { storage } = await setup();
		const second = await storage.createSession('Two');

		storage.setProperty('prompt', [u('draft')]);
		await storage.switchSession(second);

		expect((await storage.history.list(0)).map(e => [e.reason, e.tail])).toEqual([['idle', 'draft']]);
		expect(await storage.history.list(second)).toEqual([]);
	});

	it('opening a session versions edits that were saved but never versioned, e.g. the tab closed first', async () => {
		const { storage, adapter } = await setup();
		storage.setProperty('prompt', [u('unversioned')]);
		await storage.saveSessionToDB(0);

		const reopened = new SessionStorage(adapter);
		await reopened.init();
		clearInterval(reopened.saveTimer);

		expect((await reopened.history.list(0)).map(e => [e.reason, e.tail])).toEqual([['open', 'unversioned']]);
	});

	it('deleting the selected session removes its versions and leaves none behind', async () => {
		vi.spyOn(window, 'confirm').mockReturnValue(true);
		const { storage, store } = await setup();
		await storage.createSession('Two');
		storage.setProperty('prompt', [u('draft')]);

		await storage.deleteSession(0);
		await storage.history.list(1);

		expect([...store('SessionHistory').keys()].some(k => k === '0' || k.startsWith('0/'))).toBe(false);
		expect(store('Sessions').has('0')).toBe(false);
	});

	describe('a session save racing the delete of the selected session', () => {
		async function holdSaves() {
			const ctx = await setup();
			await ctx.storage.createSession('Two');
			ctx.storage.setProperty('prompt', [u('draft')]);
			vi.spyOn(window, 'confirm').mockReturnValue(true);
			let release!: () => void;
			const held = new Promise<void>(r => { release = r; });
			const save = ctx.adapter.saveToDatabase;
			ctx.adapter.saveToDatabase = async (...args) => { await held; return save(...args); };
			return { ...ctx, release };
		}

		it('waits for a save that was already running', async () => {
			const { storage, store, release } = await holdSaves();

			const saving = storage.saveTimerHandler(id => storage.saveSessionToDB(id));
			const deleting = storage.deleteSession('0');
			await new Promise(r => setTimeout(r));
			release();
			await Promise.all([saving, deleting]);

			expect(store('Sessions').has('0')).toBe(false);
			expect(storage.selectedSession).toBe(1);
		});

		it('skips a save the timer starts while the delete is running', async () => {
			const { storage, store, release } = await holdSaves();

			const deleting = storage.deleteSession('0');
			const saving = storage.saveTimerHandler(id => storage.saveSessionToDB(id));
			await new Promise(r => setTimeout(r));
			release();
			await Promise.all([saving, deleting]);

			expect(store('Sessions').has('0')).toBe(false);
		});
	});

	it('keeps the session when its versions cannot be deleted', async () => {
		vi.spyOn(window, 'confirm').mockReturnValue(true);
		const { storage, store } = await setup();
		await storage.createSession('Two');
		storage.setProperty('prompt', [u('unsaved')]);
		vi.spyOn(storage.history, 'deleteAll').mockRejectedValueOnce(new Error('disk full'));

		await expect(storage.deleteSession(0)).rejects.toThrow('disk full');

		expect(storage.selectedSession).toBe(0);
		await storage.saveTimerHandler(id => storage.saveSessionToDB(id));
		expect(store('Sessions').get('0')).toMatchObject({ prompt: [u('unsaved')] });
	});

	it('overwrites the current session with a version after versioning what it replaces', async () => {
		const { storage, store } = await setup();
		storage.setProperty('prompt', [u('old')]);
		storage.setProperty('memoryTokens', { contextOrder: '', prefix: '', text: 'old memory', suffix: '' });
		await storage.snapshot('idle');
		const version = (await storage.history.list(0)).at(-1)!;
		storage.setProperty('prompt', [u('new')]);
		storage.setProperty('authorNoteTokens', { prefix: '', text: 'added later', suffix: '' });
		const reloads = vi.fn();
		storage.addEventListener('sessionchange', reloads);

		expect(await storage.overwriteWithSnapshot(version.time)).toBe(true);

		expect(storage.getProperty('prompt')).toEqual([u('old')]);
		expect(storage.getProperty('authorNoteTokens')).toBeUndefined();
		expect(reloads).toHaveBeenCalledTimes(1);
		const entries = await storage.history.list(0);
		expect(entries.at(-1)).toMatchObject({ reason: 'restore', tail: 'new' });
		expect(await storage.history.load(0, entries.at(-1)!.time)).toMatchObject({ authorNoteTokens: { text: 'added later' } });
		await storage.saveTimerHandler(id => storage.saveSessionToDB(id));
		expect(store('Sessions').get('0')).toMatchObject({ prompt: [u('old')] });
	});

	it('leaves the session untouched when versioning the current content fails', async () => {
		const { storage } = await setup();
		storage.setProperty('prompt', [u('old')]);
		await storage.snapshot('idle');
		const version = (await storage.history.list(0)).at(-1)!;
		storage.setProperty('prompt', [u('new')]);
		vi.spyOn(storage.history, 'snapshot').mockRejectedValueOnce(new Error('disk full'));

		await expect(storage.overwriteWithSnapshot(version.time)).rejects.toThrow('disk full');

		expect(storage.getProperty('prompt')).toEqual([u('new')]);
	});

	it('restores a version as a new session that keeps the current settings', async () => {
		const { storage, store } = await setup();
		storage.setProperty('temperature', 0.3);
		storage.setProperty('prompt', [u('old')]);
		await storage.snapshot('idle');
		storage.setProperty('prompt', [u('new')]);
		const version = (await storage.history.list(0)).at(-1)!;

		const restoredId = await storage.restoreSnapshot(version.time, 'Restored');

		expect(storage.sessions[restoredId!]!.name).toBe('Restored');
		expect(store('Sessions').get(String(restoredId))).toMatchObject({ prompt: [u('old')], temperature: 0.3 });
		expect(storage.getProperty('prompt')).toEqual([u('new')]);
	});
});
