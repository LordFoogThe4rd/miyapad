import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistentState } from './usePersistentState';

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('usePersistentState', () => {
	it('falls back to the initial state when nothing is stored', () => {
		const { result } = renderHook(() => usePersistentState('missing', 'fallback'));
		expect(result.current[0]).toBe('fallback');
	});

	it('seeds from the stored value', () => {
		localStorage.setItem('theme', JSON.stringify({ name: 'dark' }));
		const { result } = renderHook(() => usePersistentState('theme', { name: 'light' }));
		expect(result.current[0]).toEqual({ name: 'dark' });
	});

	it('keeps a stored falsy value instead of replacing it with the initial state', () => {
		localStorage.setItem('collapsed', JSON.stringify(false));
		const { result } = renderHook(() => usePersistentState('collapsed', true));
		expect(result.current[0]).toBe(false);
	});

	it('treats a literal "undefined" entry as absent', () => {
		localStorage.setItem('broken', 'undefined');
		const { result } = renderHook(() => usePersistentState('broken', 'fallback'));
		expect(result.current[0]).toBe('fallback');
	});

	it('falls back to the initial state when the stored JSON is malformed', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		localStorage.setItem('corrupt', '{not json');
		const { result } = renderHook(() => usePersistentState('corrupt', 'fallback'));

		expect(result.current[0]).toBe('fallback');
		expect(warn).toHaveBeenCalled();
	});

	it('writes the new value to localStorage on update', () => {
		const { result } = renderHook(() => usePersistentState('count', 0));
		act(() => result.current[1](7));

		expect(result.current[0]).toBe(7);
		expect(localStorage.getItem('count')).toBe('7');
	});

	it('supports a functional update based on the previous value', () => {
		localStorage.setItem('count', JSON.stringify(2));
		const { result } = renderHook(() => usePersistentState('count', 0));
		act(() => result.current[1]((prev: number) => prev + 5));

		expect(result.current[0]).toBe(7);
		expect(localStorage.getItem('count')).toBe('7');
	});

	it('persists across a remount under the same key', () => {
		const first = renderHook(() => usePersistentState('note', ''));
		act(() => first.result.current[1]('saved'));
		first.unmount();

		const second = renderHook(() => usePersistentState('note', ''));
		expect(second.result.current[0]).toBe('saved');
	});

	it('keeps separate keys independent', () => {
		const a = renderHook(() => usePersistentState('a', 0));
		const b = renderHook(() => usePersistentState('b', 0));
		act(() => a.result.current[1](1));

		expect(b.result.current[0]).toBe(0);
		expect(localStorage.getItem('b')).toBeNull();
	});
});
