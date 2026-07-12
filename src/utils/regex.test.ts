import { describe, it, expect, vi } from 'vitest';
import {
	escapeRegExp,
	makeWhiteSpaceLenient,
	createLenientPrefixRegex,
	createLenientRegex,
	prefixMatchLength,
	memoize,
	regexSplitString,
	regexIndexOf,
	regexLastIndexOf,
} from './regex';

describe('escapeRegExp', () => {
	it('escapes special regex characters', () => {
		expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
	});

	it('passes normal characters through unchanged', () => {
		expect(escapeRegExp('hello world 123')).toBe('hello world 123');
	});

	it('handles empty string', () => {
		expect(escapeRegExp('')).toBe('');
	});
});

describe('makeWhiteSpaceLenient', () => {
	it('strips whitespace and inserts \\s* between characters', () => {
		expect(makeWhiteSpaceLenient('abc')).toBe('\\s*a\\s*b\\s*c');
	});

	it('strips existing whitespace before inserting \\s*', () => {
		expect(makeWhiteSpaceLenient('a b\tc')).toBe('\\s*a\\s*b\\s*c');
	});

	it('preserves escaped sequences (single backslash prevents insertion)', () => {
		expect(makeWhiteSpaceLenient('\\d')).toBe('\\s*\\d');
	});

	it('handles double backslash as literal backslash', () => {
		expect(makeWhiteSpaceLenient('\\\\d')).toBe('\\\\\\s*d');
	});
});

describe('createLenientPrefixRegex', () => {
	it('creates a case-insensitive prefix regex', () => {
		const re = createLenientPrefixRegex('hello');
		expect(re.source).toBe('^\\s*h\\s*e\\s*l\\s*l\\s*o');
		expect(re.flags).toBe('i');
	});

	it('matches with whitespace between letters', () => {
		const re = createLenientPrefixRegex('abc');
		expect(re.test('a b c d')).toBe(true);
		expect(re.test('a  b  c')).toBe(true);
	});

	it('matches case-insensitively', () => {
		const re = createLenientPrefixRegex('Hello');
		expect(re.test('hello world')).toBe(true);
		expect(re.test('HELLO')).toBe(true);
	});

	it('does not match if prefix does not appear at start', () => {
		const re = createLenientPrefixRegex('abc');
		expect(re.test('xabc')).toBe(false);
	});

	it('caches results (memoized)', () => {
		const a = createLenientPrefixRegex('test');
		const b = createLenientPrefixRegex('test');
		expect(a).toBe(b);
	});
});

describe('createLenientRegex', () => {
	it('creates a case-insensitive regex', () => {
		const re = createLenientRegex('world');
		expect(re.flags).toBe('i');
	});

	it('matches suffix anywhere in text with whitespace leniency', () => {
		const re = createLenientRegex('cd');
		expect(re.test('ab c d ef')).toBe(true);
	});

	it('matches case-insensitively', () => {
		const re = createLenientRegex('World');
		expect(re.test('hello world')).toBe(true);
	});

	it('caches results (memoized)', () => {
		const a = createLenientRegex('test');
		const b = createLenientRegex('test');
		expect(a).toBe(b);
	});
});

describe('prefixMatchLength', () => {
	it('returns 0 for empty first string', () => {
		expect(prefixMatchLength('', 'abc')).toBe(0);
	});

	it('returns 0 for empty second string', () => {
		expect(prefixMatchLength('abc', '')).toBe(0);
	});

	it('returns length of the longest substring of str1 that is a prefix of str2', () => {
		expect(prefixMatchLength('abc', 'abcdef')).toBe(3);
	});

	it('finds a substring that matches prefix even if not at start of str1', () => {
		expect(prefixMatchLength('xyabc', 'abcdef')).toBe(3);
	});

	it('returns the longest match when multiple substrings match', () => {
		expect(prefixMatchLength('a ab abc', 'abcdef')).toBe(3);
	});

	it('returns 0 when no substring matches', () => {
		expect(prefixMatchLength('xyz', 'abcdef')).toBe(0);
	});
});

describe('memoize', () => {
	it('returns cached result on second call with same args', () => {
		const fn = vi.fn((x: number) => x * 2);
		const memoized = memoize(fn);

		expect(memoized(5)).toBe(10);
		expect(memoized(5)).toBe(10);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('calls original function for different args', () => {
		const fn = vi.fn((x: number) => x * 2);
		const memoized = memoize(fn);

		expect(memoized(5)).toBe(10);
		expect(memoized(7)).toBe(14);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('works with multiple arguments', () => {
		const fn = vi.fn((a: number, b: number) => a - b);
		const memoized = memoize(fn);

		expect(memoized(5, 2)).toBe(3);
		expect(memoized(5, 2)).toBe(3);
		expect(memoized(2, 5)).toBe(-3);
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe('regexSplitString', () => {
	it('splits by string separator and returns parts and separators', () => {
		const [parts, seps] = regexSplitString('a,b,c', ',');
		expect(parts).toEqual(['a', 'b', 'c']);
		expect(seps).toEqual([',', ',']);
	});

	it('splits by regex separator', () => {
		const [parts, seps] = regexSplitString('a1b23c', /\d+/);
		expect(parts).toEqual(['a', 'b', 'c']);
		expect(seps).toEqual(['1', '23']);
	});

	it('respects limit parameter', () => {
		const [parts, seps] = regexSplitString('a,b,c,d', ',', 2);
		expect(parts).toEqual(['a', 'b', 'c,d']);
		expect(seps).toEqual([',', ',']);
	});

	it('returns entire string as single part when no separator matches', () => {
		const [parts, seps] = regexSplitString('hello', ',');
		expect(parts).toEqual(['hello']);
		expect(seps).toEqual([]);
	});
});

describe('regexIndexOf', () => {
	it('returns index of first match', () => {
		expect(regexIndexOf('hello world', /world/)).toBe(6);
	});

	it('returns -1 when no match', () => {
		expect(regexIndexOf('hello world', /xyz/)).toBe(-1);
	});

	it('respects startpos', () => {
		expect(regexIndexOf('one two one', /one/, 4)).toBe(8);
	});
});

describe('regexLastIndexOf', () => {
	it('returns index of last match', () => {
		expect(regexLastIndexOf('one two one', /one/)).toBe(8);
	});

	it('returns -1 when no match', () => {
		expect(regexLastIndexOf('one two', /three/)).toBe(-1);
	});

	it('respects startpos', () => {
		expect(regexLastIndexOf('one two one three', /one/, 10)).toBe(8);
	});
});
