import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStorageState } from './useStorageState';

interface Data { value: string }

function makeStorage(initial: Data) {
	let persisted = initial;
	const performFullSave = vi.fn(async (data: Data) => { persisted = data; });
	return {
		getStorageData: () => persisted,
		performFullSave,
		get persisted() { return persisted; },
	};
}

beforeEach(() => {
	vi.stubGlobal('reportError', vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('useStorageState', () => {
	it('seeds from the storage data', () => {
		const storage = makeStorage({ value: 'stored' });
		const { result } = renderHook(() => useStorageState(storage, { value: 'fallback' }));

		expect(result.current[0]).toEqual({ value: 'stored' });
	});

	it('falls back to the initial state when the storage has nothing', () => {
		const storage = { getStorageData: () => undefined as unknown as Data, performFullSave: vi.fn() };
		const { result } = renderHook(() => useStorageState(storage, { value: 'fallback' }));

		expect(result.current[0]).toEqual({ value: 'fallback' });
	});

	it('updates the state and persists the new value', async () => {
		const storage = makeStorage({ value: 'a' });
		const { result } = renderHook(() => useStorageState(storage, { value: 'a' }));

		await act(async () => { result.current[1]({ value: 'b' }); });

		expect(result.current[0]).toEqual({ value: 'b' });
		expect(storage.performFullSave).toHaveBeenCalledExactlyOnceWith({ value: 'b' });
	});

	it('feeds a functional update the latest value, not the last rendered one', async () => {
		const storage = makeStorage({ value: 'a' });
		const { result } = renderHook(() => useStorageState(storage, { value: 'a' }));

		await act(async () => {
			result.current[1]((prev) => ({ value: prev.value + 'b' }));
			result.current[1]((prev) => ({ value: prev.value + 'c' }));
		});

		expect(result.current[0]).toEqual({ value: 'abc' });
		expect(storage.persisted).toEqual({ value: 'abc' });
	});

	it('persists sequential updates in order', async () => {
		const storage = makeStorage({ value: 'a' });
		const { result } = renderHook(() => useStorageState(storage, { value: 'a' }));

		await act(async () => {
			result.current[1]({ value: 'b' });
			result.current[1]({ value: 'c' });
		});

		expect(storage.performFullSave.mock.calls.map(([data]) => data.value)).toEqual(['b', 'c']);
		expect(storage.persisted).toEqual({ value: 'c' });
	});

	it('rolls back to the last persisted value when the save fails', async () => {
		const storage = makeStorage({ value: 'a' });
		storage.performFullSave.mockRejectedValueOnce(new Error('quota'));
		const { result } = renderHook(() => useStorageState(storage, { value: 'a' }));

		await act(async () => { result.current[1]({ value: 'b' }); });

		await waitFor(() => expect(result.current[0]).toEqual({ value: 'a' }));
		expect(globalThis.reportError).toHaveBeenCalled();
	});

	it('rolls back to the last value that actually reached storage', async () => {
		const storage = makeStorage({ value: 'a' });
		const { result } = renderHook(() => useStorageState(storage, { value: 'a' }));

		await act(async () => { result.current[1]({ value: 'b' }); });
		storage.performFullSave.mockRejectedValueOnce(new Error('quota'));
		await act(async () => { result.current[1]({ value: 'c' }); });

		await waitFor(() => expect(result.current[0]).toEqual({ value: 'b' }));
	});

	it('does not roll back over a newer update issued after the failing one', async () => {
		const storage = makeStorage({ value: 'a' });
		storage.performFullSave.mockRejectedValueOnce(new Error('quota'));
		const { result } = renderHook(() => useStorageState(storage, { value: 'a' }));

		await act(async () => {
			result.current[1]({ value: 'b' });
			result.current[1]({ value: 'c' });
		});

		expect(result.current[0]).toEqual({ value: 'c' });
	});

	it('keeps saving after a failure instead of wedging the chain', async () => {
		const storage = makeStorage({ value: 'a' });
		storage.performFullSave.mockRejectedValueOnce(new Error('transient'));
		const { result } = renderHook(() => useStorageState(storage, { value: 'a' }));

		await act(async () => { result.current[1]({ value: 'b' }); });
		await act(async () => { result.current[1]({ value: 'c' }); });

		expect(storage.performFullSave).toHaveBeenCalledTimes(2);
		expect(storage.persisted).toEqual({ value: 'c' });
		expect(result.current[0]).toEqual({ value: 'c' });
	});
});
