import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionStorage } from './ConnectionStorage';

const DB = 'db' as unknown as DbConnection;

function makeConnection(id: string): ConnectionData {
	return { id, name: id, enabled: true, api: 0, endpoint: `http://localhost/${id}` };
}

const adapter = {
	openDatabase: vi.fn(),
	loadFromDatabase: vi.fn(),
	loadAllFromDatabase: vi.fn(),
	loadSessionInfoFromDatabase: vi.fn(),
	saveToDatabase: vi.fn(),
	renameSessionInDatabase: vi.fn(),
	deleteFromDatabase: vi.fn(),
} satisfies DatabaseAdapter;

let storage: ConnectionStorage;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	adapter.openDatabase.mockResolvedValue(DB);
	adapter.saveToDatabase.mockResolvedValue(undefined);
	adapter.deleteFromDatabase.mockResolvedValue(undefined);
	storage = new ConnectionStorage(adapter);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('loadConnections', () => {
	it('keeps every valid entry', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue({ a: makeConnection('a'), b: makeConnection('b') });
		await storage.init();

		expect(Object.keys(storage.connections)).toEqual(['a', 'b']);
		expect(adapter.deleteFromDatabase).not.toHaveBeenCalled();
	});

	it('drops an invalid entry and deletes it from the database', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue({ good: makeConnection('good'), bad: { id: 'bad' } });
		await storage.init();

		expect(Object.keys(storage.connections)).toEqual(['good']);
		expect(adapter.deleteFromDatabase).toHaveBeenCalledExactlyOnceWith(DB, 'Connections', 'bad');
	});

	it('still drops an invalid entry when deleting it fails', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue({ bad: null });
		adapter.deleteFromDatabase.mockRejectedValue(new Error('read-only'));

		await expect(storage.init()).resolves.toBeUndefined();
		expect(storage.connections).toEqual({});
	});

	it('replaces any previously loaded state rather than merging into it', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue({ a: makeConnection('a') });
		await storage.init();
		adapter.loadAllFromDatabase.mockResolvedValue({ b: makeConnection('b') });
		await storage.loadConnections(DB);

		expect(Object.keys(storage.connections)).toEqual(['b']);
	});

	it('leaves the connections empty when the store is empty', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue({});
		await storage.init();

		expect(storage.connections).toEqual({});
		expect(storage.getStorageData()).toEqual({});
	});
});

describe('performFullSave', () => {
	beforeEach(async () => {
		adapter.loadAllFromDatabase.mockResolvedValue({ a: makeConnection('a'), b: makeConnection('b') });
		await storage.init();
		vi.clearAllMocks();
		adapter.openDatabase.mockResolvedValue(DB);
		adapter.saveToDatabase.mockResolvedValue(undefined);
		adapter.deleteFromDatabase.mockResolvedValue(undefined);
	});

	it('writes only the entries whose contents changed', async () => {
		await storage.performFullSave({ a: makeConnection('a'), b: { ...makeConnection('b'), name: 'renamed' } });

		expect(adapter.saveToDatabase).toHaveBeenCalledOnce();
		expect(adapter.saveToDatabase.mock.calls[0][2]).toBe('b');
	});

	it('deletes the entries that are gone from the new set', async () => {
		await storage.performFullSave({ a: makeConnection('a') });

		expect(adapter.deleteFromDatabase).toHaveBeenCalledExactlyOnceWith(DB, 'Connections', 'b');
	});

	it('writes a newly added entry', async () => {
		await storage.performFullSave({ a: makeConnection('a'), b: makeConnection('b'), c: makeConnection('c') });

		expect(adapter.saveToDatabase).toHaveBeenCalledExactlyOnceWith(DB, 'Connections', 'c', makeConnection('c'));
	});

	it('announces the new state with a change event', async () => {
		const onChange = vi.fn();
		storage.addEventListener('change', onChange);
		await storage.performFullSave({ a: makeConnection('a') });

		expect(onChange).toHaveBeenCalledOnce();
		expect(storage.getStorageData()).toEqual({ a: makeConnection('a') });
	});

	it('keeps the old state and reports the failure when a write fails', async () => {
		adapter.saveToDatabase.mockRejectedValue(new Error('quota'));
		const onError = vi.fn();
		storage.addEventListener('error', onError);

		await expect(storage.performFullSave({ a: makeConnection('a'), c: makeConnection('c') })).rejects.toThrow('quota');
		expect(Object.keys(storage.connections)).toEqual(['a', 'b']);
		expect(onError).toHaveBeenCalled();
	});
});
