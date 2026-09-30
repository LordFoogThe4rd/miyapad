import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionStorage, folderName, sanitizeStats } from './SessionStorage';

function storageWith(data: Record<string, unknown>) {
	const storage = new SessionStorage({} as DatabaseAdapter);
	storage.sessions = { 0: { name: 'Story', modified: 1, ...data } as SessionData };
	storage.selectedSession = 0;
	return storage;
}

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
	};
	return { adapter, store };
}

/** Keys of different types stay apart, the way IndexedDB's do. */
function typedKeyAdapter() {
	const stores = new Map<string, Map<string, unknown>>();
	const store = (name: string) => stores.get(name) ?? stores.set(name, new Map()).get(name)!;
	const id = (key: string | number) => `${typeof key}:${key}`;
	const copy = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
	const adapter: DatabaseAdapter = {
		openDatabase: async () => async () => undefined,
		loadFromDatabase: async (_db, name, key) => copy(store(name).get(id(key))),
		loadAllFromDatabase: async (_db, name) => Object.fromEntries(store(name)),
		loadSessionInfoFromDatabase: async () => Object.fromEntries([...store('Names')].map(([k, v]) => [k.slice(k.indexOf(':') + 1), v])),
		saveToDatabase: async (_db, name, key, data) => { store(name).set(id(key), copy(data)); },
		// Both real adapters keep the rest of the record; this one has to as well or the
		// test below could not tell a lost field from a lost record.
		renameSessionInDatabase: async (_db, _name, key, newName) => {
			const current = store('Names').get(id(key)) as Record<string, unknown> | undefined;
			store('Names').set(id(key), { ...current, name: newName, modified: Date.now() });
		},
		deleteFromDatabase: async (_db, name, key) => { store(name).delete(id(key)); },
	};
	return { adapter, store };
}

describe('SessionStorage.setProperty', () => {
	it('leaves modified alone when re-applying values the session already has', () => {
		const storage = storageWith({ temperature: 0.7, enabledSamplers: ['top_k', 'min_p'] });

		storage.setProperty('temperature', 0.7);
		storage.setProperty('enabledSamplers', ['top_k', 'min_p']);

		expect(storage.sessions[0]!.modified).toBe(1);
	});

	it('bumps modified when a value actually changes', () => {
		const storage = storageWith({ temperature: 0.7, enabledSamplers: ['top_k', 'min_p'] });

		storage.setProperty('enabledSamplers', ['top_k']);

		expect(storage.sessions[0]!.modified).toBeGreaterThan(1);
		expect(storage.sessions[0]!.enabledSamplers).toEqual(['top_k']);
	});
});

describe('SessionStorage pins and tags on sessions that are not open', () => {
	async function open(adapter: DatabaseAdapter) {
		const storage = new SessionStorage(adapter);
		await storage.init();
		clearInterval(storage.saveTimer);
		return storage;
	}

	async function withStory() {
		const { adapter, store } = memoryAdapter();
		const first = await open(adapter);
		const story = await first.createSession('Story');
		await first.switchSession(story);
		first.setProperty('prompt', [{ type: 'user', content: 'keep me' }]);
		return { adapter, store, first, story, key: String(story) };
	}

	it('keeps the content of a session not opened since the page loaded', async () => {
		const { adapter, store, first, key } = await withStory();
		await first.switchSession(0);
		const storage = await open(adapter);

		await storage.togglePinSession(key);
		storage.setTags(key, 'draft');
		await storage.saveTimerHandler(id => storage.saveSessionToDB(id));

		expect(store('Sessions').get(key)).toMatchObject({ prompt: [{ content: 'keep me' }] });
		expect(store('Names').get(key)).toMatchObject({ name: 'Story', pinned: true, tags: ['draft'] });
	});

	it('saves them for a session that was opened and left', async () => {
		const { store, first, key } = await withStory();
		await first.switchSession(0);

		await first.togglePinSession(key);
		await first.saveTimerHandler(id => first.saveSessionToDB(id));

		expect(store('Names').get(key)).toMatchObject({ pinned: true });
		expect(store('Sessions').get(key)).toMatchObject({ prompt: [{ content: 'keep me' }] });
	});

	it('pins several sessions at once and saves every one', async () => {
		const { adapter, store, first, story, key } = await withStory();
		await first.switchSession(0);

		await first.setPinned([key, 0], true);

		const reloaded = await open(adapter);
		expect(reloaded.sessions[story].pinned).toBe(true);
		expect(reloaded.sessions[0].pinned).toBe(true);
		expect(store('Sessions').get(key)).toMatchObject({ prompt: [{ content: 'keep me' }] });

		await reloaded.setPinned([key], false);
		expect((await open(adapter)).sessions[story].pinned).toBe(false);
	});

	it('keeps folders as metadata, open or not, and a blank name takes a session out', async () => {
		const { adapter, store, first, story, key } = await withStory();
		await first.switchSession(0);
		const modified = first.sessions[story].modified;

		await first.setFolder([key, 0], '  Old   drafts ');

		expect(store('Sessions').get(key)).toMatchObject({ prompt: [{ content: 'keep me' }] });
		expect(store('Sessions').get('0')).not.toHaveProperty('folder');
		expect(first.sessions[story].modified).toBe(modified);

		const reloaded = await open(adapter);
		expect(reloaded.sessions[story].folder).toBe('Old drafts');
		expect(reloaded.sessions[0].folder).toBe('Old drafts');

		await reloaded.setFolder([key], ' ');
		expect((store('Names').get(key) as SessionData).folder).toBeUndefined();
		expect(store('Sessions').get(key)).toMatchObject({ prompt: [{ content: 'keep me' }] });

		// A session already where it is asked to go is not written again.
		store('Names').delete(key);
		await reloaded.setFolder([key], '');
		expect(store('Names').get(key)).toBeUndefined();
	});
});

describe('SessionStorage statistics', () => {
	async function open(adapter: DatabaseAdapter) {
		const storage = new SessionStorage(adapter);
		await storage.init();
		clearInterval(storage.saveTimer);
		return storage;
	}

	it('keeps the counters with the metadata, so they survive a switch and a reload', async () => {
		const { adapter, store } = memoryAdapter();
		const first = await open(adapter);
		const story = await first.createSession('Story');
		await first.switchSession(story);
		const key = String(story);

		first.addStats({ generations: 1, genTokens: 40, typedChars: 12 });
		first.addStats({ generations: 1, genTokens: 2, deletedChars: 3 });
		await first.saveTimerHandler(id => first.saveSessionToDB(id));

		// In the metadata record rather than the session body: that is what puts every
		// session's counters in reach without loading any of their content.
		expect(store('Names').get(key)).toMatchObject({
			stats: { generations: 2, genTokens: 42, typedChars: 12, deletedChars: 3 },
		});
		expect(store('Sessions').get(key)).not.toHaveProperty('stats');

		const reloaded = await open(adapter);
		expect(reloaded.sessions[key]!.stats).toMatchObject({ generations: 2, genTokens: 42 });
	});

	it('does not count as an edit', () => {
		const storage = storageWith({});

		storage.addStats({ typedChars: 5 });

		expect(storage.sessions[0]!.modified).toBe(1);
		expect(storage.sessions[0]!.stats).toMatchObject({ typedChars: 5 });
	});

	it('starts a cloned, restored or imported session on its own counters', async () => {
		const { adapter } = memoryAdapter();
		const storage = new SessionStorage(adapter);
		await storage.init();
		clearInterval(storage.saveTimer);
		const story = await storage.createSession('Story');
		await storage.switchSession(story);
		storage.addStats({ generations: 4, typedChars: 80 });

		// The same shape the sessions modal builds to clone or export a session.
		const source = Object.fromEntries(
			Object.entries(storage.sessions[story]!).map(([k, v]) => [k, JSON.stringify(v)]),
		) as Record<string, string>;
		const copy = await storage.createSessionFromObject(source, true);

		expect(storage.sessions[copy]!.stats).toMatchObject({ generations: 0, typedChars: 0 });
		expect(storage.sessions[story]!.stats).toMatchObject({ generations: 4, typedChars: 80 });
	});

	it('clears every session at once, not just the last one queued', async () => {
		const { adapter, store } = memoryAdapter();
		const storage = await open(adapter);
		const first = await storage.createSession('First');
		await storage.switchSession(first);
		storage.addStats({ generations: 3 });
		const second = await storage.createSession('Second');
		await storage.switchSession(second);
		storage.addStats({ generations: 7 });

		await storage.resetStats();

		expect(storage.sessions[first]!.stats!.generations).toBe(0);
		expect(storage.sessions[second]!.stats!.generations).toBe(0);
		expect(store('Names').get(String(first))).toMatchObject({ stats: { generations: 0 } });
		expect(store('Names').get(String(second))).toMatchObject({ stats: { generations: 0 } });
	});
});

describe('SessionStorage session keys', () => {
	it('writes one record per session however the modal passes its id', async () => {
		const { adapter, store } = typedKeyAdapter();
		const storage = new SessionStorage(adapter);
		await storage.init();
		clearInterval(storage.saveTimer);
		const story = await storage.createSession('Story');
		await storage.switchSession(story);
		storage.addStats({ typedChars: 9 });
		await storage.saveTimerHandler(id => storage.saveSessionToDB(id));

		// The sessions modal hands ids back as strings.
		await storage.togglePinSession(String(story));
		await storage.saveTimerHandler(id => storage.saveSessionToDB(id));
		await storage.renameSession(String(story), 'Renamed');

		expect([...store('Names').keys()].filter(k => k.endsWith(`:${story}`))).toEqual([`number:${story}`]);
		expect(store('Names').get(`number:${story}`)).toMatchObject({
			name: 'Renamed',
			pinned: true,
			stats: { typedChars: 9 },
		});
	});
});

describe('folderName', () => {
	it('trims the name and collapses runs of whitespace', () => {
		expect(folderName('  Old \t  drafts ')).toBe('Old drafts');
	});

	it('is no folder for a blank name or one that is not text', () => {
		for (const raw of ['', '   ', undefined, null, 3, {}]) expect(folderName(raw)).toBeUndefined();
	});
});

describe('sanitizeStats', () => {
	it('fills in every counter as zero when there are none', () => {
		expect(sanitizeStats(undefined)).toEqual({ generations: 0, genTokens: 0, genChars: 0, genMs: 0, typedChars: 0, deletedChars: 0 });
	});

	it('keeps only positive finite counts and drops unknown keys', () => {
		expect(sanitizeStats({ generations: 3, genTokens: -1, genChars: NaN, genMs: Infinity, typedChars: '5', deletedChars: 2, extra: 9 }))
			.toEqual({ generations: 3, genTokens: 0, genChars: 0, genMs: 0, typedChars: 0, deletedChars: 2 });
	});
});

describe('SessionStorage loading', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	async function open(adapter: DatabaseAdapter) {
		const storage = new SessionStorage(adapter);
		await storage.init();
		clearInterval(storage.saveTimer);
		return storage;
	}

	it('hands out consecutive ids and stores the next one', async () => {
		const { adapter, store } = memoryAdapter();
		const storage = await open(adapter);
		const first = await storage.getNewId();

		expect(await storage.getNewId()).toBe(first + 1);
		expect(store('Sessions').get('nextSessionId')).toBe(first + 2);
	});

	it('starts an empty database with one session and opens it', async () => {
		const { adapter } = memoryAdapter();
		const storage = await open(adapter);

		expect(Object.values(storage.sessions).map(s => s.name)).toEqual(['MiyaPad #1']);
		expect(storage.getProperty('name')).toBe('MiyaPad #1');
	});

	it('puts trashed sessions in the trash and reopens the one last selected', async () => {
		const { adapter, store } = memoryAdapter();
		store('Names').set('0', { name: 'A' });
		store('Names').set('1', { name: 'B', trashed: 123 });
		store('Names').set('2', { name: 'C' });
		store('Sessions').set('2', { prompt: [{ type: 'user', content: 'from C' }] });
		store('Sessions').set('selectedSessionId', 2);
		store('Sessions').set('nextSessionId', 3);

		const storage = await open(adapter);

		expect(Object.keys(storage.sessions)).toEqual(['0', '2']);
		expect(Object.keys(storage.trash)).toEqual(['1']);
		expect(storage.selectedSession).toBe(2);
		expect(storage.getProperty('prompt')).toEqual([{ type: 'user', content: 'from C' }]);
	});

	it('opens the first session when the one last selected went to the trash', async () => {
		const { adapter, store } = memoryAdapter();
		store('Names').set('0', { name: 'A' });
		store('Names').set('1', { name: 'B', trashed: 123 });
		store('Sessions').set('selectedSessionId', 1);
		store('Sessions').set('nextSessionId', 2);

		const storage = await open(adapter);

		expect(storage.selectedSession).toBe(0);
	});

	it('starts a new session, without migrating, when every session is in the trash', async () => {
		const { adapter, store } = memoryAdapter();
		store('Names').set('0', { name: 'A', trashed: 123 });
		store('Sessions').set('nextSessionId', 1);
		vi.stubGlobal('localStorage', legacyLocalStorage({ nextSessionId: '5', '4/name': '"Old"' }));

		const storage = await open(adapter);

		expect(Object.values(storage.sessions).map(s => s.name)).toEqual(['MiyaPad #1']);
		expect(storage.selectedSession).toBe(1);
	});

	/** Stored keys are own enumerable properties, the way Object.keys sees a browser's localStorage. */
	function legacyLocalStorage(items: Record<string, string>) {
		const proto = { getItem(this: Record<string, string>, key: string) { return Object.hasOwn(this, key) ? this[key] : null; } };
		return Object.assign(Object.create(proto), items);
	}

	it('moves sessions an older version kept in localStorage into an empty database', async () => {
		const { adapter, store } = memoryAdapter();
		vi.stubGlobal('localStorage', legacyLocalStorage({
			nextSessionId: '2',
			selectedSessionId: '1',
			'0/name': '"Old"',
			'0/prompt': '[{"type":"user","content":"kept"}]',
			'1/name': '"Other"',
			'1/temperature': '0.5',
			'1/broken': '{not json',
			'1/nothing': 'null',
			unrelated: 'x',
		}));

		const storage = await open(adapter);

		expect(Object.values(storage.sessions).map(s => s.name)).toEqual(['Old', 'Other']);
		expect(storage.selectedSession).toBe(1);
		expect(storage.getProperty('temperature')).toBe(0.5);
		expect(storage.getProperty('broken')).toBeUndefined();
		expect(store('Sessions').get('0')).toMatchObject({ prompt: [{ type: 'user', content: 'kept' }] });
		expect(store('Names').get('0')).toMatchObject({ name: 'Old' });
		expect(store('Sessions').get('nextSessionId')).toBe(2);
	});
});

describe('SessionStorage legacy names', () => {
	it('loads names an older version stored as plain text, and names a broken one after its id', async () => {
		const { adapter, store } = memoryAdapter();
		store('Names').set('0', 'Old name');
		store('Names').set('1', '[object Object]');
		store('Sessions').set('0', { prompt: [{ type: 'user', content: 'from 0' }] });
		store('Sessions').set('1', { prompt: [{ type: 'user', content: 'from 1' }] });
		store('Sessions').set('selectedSessionId', 1);
		store('Sessions').set('nextSessionId', 2);

		const storage = new SessionStorage(adapter);
		await storage.init();
		clearInterval(storage.saveTimer);

		expect(storage.sessions[0]).toMatchObject({ name: 'Old name', pinned: false, tags: [] });
		expect(storage.getProperty('name')).toBe('Session #1');
		expect(storage.getProperty('prompt')).toEqual([{ type: 'user', content: 'from 1' }]);

		await storage.switchSession(0);

		expect(storage.getProperty('name')).toBe('Old name');
		expect(storage.getProperty('prompt')).toEqual([{ type: 'user', content: 'from 0' }]);
		expect(store('Names').get('0')).toMatchObject({ name: 'Old name' });
	});
});

describe('SessionStorage trash when saving fails', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	async function withTwo() {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve()));
		const { adapter, store } = memoryAdapter();
		const storage = new SessionStorage(adapter);
		await storage.init();
		clearInterval(storage.saveTimer);
		await storage.createSession('Two');
		const save = adapter.saveToDatabase;
		const failOn = (storeName: string, key: string) => {
			adapter.saveToDatabase = async (db, name, k, data) => {
				if (name === storeName && String(k) === key) throw new Error('disk full');
				return save(db, name, k, data);
			};
		};
		return { storage, store, failOn };
	}

	it('puts a session back in the list, out of the trash, and rethrows when its save fails', async () => {
		const { storage, store, failOn } = await withTwo();
		failOn('Names', '1');

		await expect(storage.trashSessions(['1'])).rejects.toThrow('disk full');

		expect(storage.sessions[1]).toMatchObject({ name: 'Two', trashed: undefined });
		expect(storage.trash[1]).toBeUndefined();
		expect(store('Names').get('1')).not.toMatchObject({ trashed: expect.anything() });
	});

	it('leaves the open session open and untrashed when its edits cannot be saved before switching away', async () => {
		const { storage, store, failOn } = await withTwo();
		storage.setProperty('prompt', [{ type: 'user', content: 'unsaved' }]);
		failOn('Sessions', '0');

		await storage.trashSessions(['0']);

		expect(storage.selectedSession).toBe(0);
		expect(storage.sessions[0]).toMatchObject({ prompt: [{ type: 'user', content: 'unsaved' }] });
		expect(storage.sessions[0].trashed).toBeUndefined();
		expect(storage.trash).toEqual({});
		expect(store('Names').get('0')).not.toMatchObject({ trashed: expect.anything() });
	});
});
