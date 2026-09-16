import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AbstractStorage } from './AbstractStorage';

const adapter = {
	openDatabase: vi.fn(),
	loadFromDatabase: vi.fn(),
	loadAllFromDatabase: vi.fn(),
	loadSessionInfoFromDatabase: vi.fn(),
	saveToDatabase: vi.fn(),
	renameSessionInDatabase: vi.fn(),
	deleteFromDatabase: vi.fn(),
} satisfies DatabaseAdapter;

let storage: AbstractStorage;

beforeEach(() => {
	vi.clearAllMocks();
	// dispatchErrorEvent posts to /log and logs; neither is the behavior under test.
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	vi.spyOn(console, 'error').mockImplementation(() => {});
	storage = new AbstractStorage('Test', adapter);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('saveTimerHandler', () => {
	it('does nothing when no save is pending', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		await storage.saveTimerHandler(save);
		expect(save).not.toHaveBeenCalled();
	});

	it('saves the pending key and clears it', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		storage.enqueueSave('session-1');
		await storage.saveTimerHandler(save);

		expect(save).toHaveBeenCalledExactlyOnceWith('session-1');
		expect(storage.pendingSaveKey).toBeNull();
	});

	it('saves a key of 0 rather than treating it as absent', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		storage.enqueueSave(0);
		await storage.saveTimerHandler(save);

		expect(save).toHaveBeenCalledExactlyOnceWith(0);
	});

	it('only saves once for repeated enqueues of the same key', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		storage.enqueueSave('session-1');
		storage.enqueueSave('session-1');
		await storage.saveTimerHandler(save);
		await storage.saveTimerHandler(save);

		expect(save).toHaveBeenCalledTimes(1);
	});

	it('requeues the key and rethrows when the save fails', async () => {
		const save = vi.fn().mockRejectedValue(new Error('disk full'));
		storage.enqueueSave('session-1');

		await expect(storage.saveTimerHandler(save)).rejects.toThrow('disk full');
		expect(storage.pendingSaveKey).toBe('session-1');
	});

	it('emits an error event when the save fails', async () => {
		const save = vi.fn().mockRejectedValue(new Error('disk full'));
		const onError = vi.fn();
		storage.addEventListener('error', onError);
		storage.enqueueSave('session-1');

		await expect(storage.saveTimerHandler(save)).rejects.toThrow();
		expect(onError).toHaveBeenCalledOnce();
		expect((onError.mock.calls[0][0] as CustomEvent).detail).toBeInstanceOf(Error);
	});

	it('retries the failed key on the next tick', async () => {
		const save = vi.fn()
			.mockRejectedValueOnce(new Error('transient'))
			.mockResolvedValueOnce(undefined);
		storage.enqueueSave('session-1');

		await expect(storage.saveTimerHandler(save)).rejects.toThrow();
		await storage.saveTimerHandler(save);

		expect(save).toHaveBeenCalledTimes(2);
		expect(save).toHaveBeenLastCalledWith('session-1');
		expect(storage.pendingSaveKey).toBeNull();
	});

	it('does not clobber a newer key enqueued while the failing save was in flight', async () => {
		const save = vi.fn().mockImplementation(async () => {
			storage.enqueueSave('session-2');
			throw new Error('disk full');
		});
		storage.enqueueSave('session-1');

		await expect(storage.saveTimerHandler(save)).rejects.toThrow();
		expect(storage.pendingSaveKey).toBe('session-2');
	});
});

describe('adapter delegation', () => {
	it('passes its own store name through to the adapter', async () => {
		adapter.saveToDatabase.mockResolvedValue(undefined);
		await storage.saveToDatabase('db' as unknown as DbConnection, 'key', { a: 1 });

		expect(adapter.saveToDatabase).toHaveBeenCalledExactlyOnceWith('db', 'Test', 'key', { a: 1 });
	});

	it('emits an error event and rethrows when the adapter rejects', async () => {
		adapter.loadAllFromDatabase.mockRejectedValue(new Error('closed'));
		const onError = vi.fn();
		storage.addEventListener('error', onError);

		await expect(storage.loadAllFromDatabase('db' as unknown as DbConnection)).rejects.toThrow('closed');
		expect(onError).toHaveBeenCalledOnce();
	});

	it('throws from batchMutation when the adapter does not implement it', async () => {
		await expect(storage.batchMutation('db' as unknown as DbConnection, [])).rejects.toThrow();
	});
});

describe('base class contract', () => {
	it('refuses to perform a full save without a subclass implementation', async () => {
		await expect(storage.performFullSave({})).rejects.toThrow('Not Implemented');
	});

	it('refuses to return storage data without a subclass implementation', () => {
		expect(() => storage.getStorageData()).toThrow('Not Implemented');
	});
});
