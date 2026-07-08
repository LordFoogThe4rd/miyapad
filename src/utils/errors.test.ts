import { describe, it, expect } from 'vitest';
import { isAbortError } from './errors';

describe('isAbortError', () => {
	it('returns true for an AbortError', () => {
		expect(isAbortError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true);
	});

	it('returns false for other Errors', () => {
		expect(isAbortError(new Error('boom'))).toBe(false);
		expect(isAbortError(new TypeError('bad'))).toBe(false);
	});

	it('returns false for non-Error values', () => {
		expect(isAbortError(null)).toBe(false);
		expect(isAbortError('AbortError')).toBe(false);
		expect(isAbortError({ name: 'AbortError' })).toBe(false);
	});
});
