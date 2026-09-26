import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSessionState } from './useSessionState';

class FakeSession extends EventTarget {
	props: Record<string, unknown>;
	constructor(props: Record<string, unknown> = {}) {
		super();
		this.props = props;
	}
	getProperty(name: string) { return this.props[name]; }
	setProperty = vi.fn((name: string, value: unknown) => { this.props[name] = value; });
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('useSessionState', () => {
	it('starts from the value the open session has', () => {
		const { result } = renderHook(() => useSessionState(new FakeSession({ temperature: 0.4 }), 'temperature', 1));
		expect(result.current[0]).toBe(0.4);
	});

	it('starts from the initial value when the session has none', () => {
		const { result } = renderHook(() => useSessionState(new FakeSession(), 'temperature', 1));
		expect(result.current[0]).toBe(1);
	});

	it('starts from the initial value when reading the session throws', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const session = new FakeSession();
		session.getProperty = () => { throw new Error('no session'); };

		const { result } = renderHook(() => useSessionState(session, 'temperature', 1));

		expect(result.current[0]).toBe(1);
	});

	it('writes each change to the session, including an updater function', () => {
		const session = new FakeSession({ n: 1 });
		const { result } = renderHook(() => useSessionState(session, 'n', 0));

		act(() => result.current[1](5));
		act(() => result.current[1](n => n + 1));

		expect(result.current[0]).toBe(6);
		expect(session.setProperty).toHaveBeenLastCalledWith('n', 6);
	});

	it('picks up the new session\'s value on a session change, or a fresh copy of the initial one', () => {
		const initial = { words: ['a'] };
		const session = new FakeSession({ list: { words: ['x'] } });
		const { result } = renderHook(() => useSessionState(session, 'list', initial));

		session.props = { list: { words: ['y'] } };
		act(() => { session.dispatchEvent(new Event('sessionchange')); });
		expect(result.current[0]).toEqual({ words: ['y'] });

		session.props = {};
		act(() => { session.dispatchEvent(new Event('sessionchange')); });
		expect(result.current[0]).toEqual(initial);
		expect(result.current[0]).not.toBe(initial);
	});
});
