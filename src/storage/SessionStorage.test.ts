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
});
