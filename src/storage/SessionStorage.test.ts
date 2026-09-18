import { describe, expect, it } from 'vitest';
import { SessionStorage } from './SessionStorage';

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
