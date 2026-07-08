import { describe, it, expect } from 'vitest';
import { joinPrompt, replaceNewlines, replaceUnprintableBytes } from './strings';

describe('joinPrompt', () => {
	it('concatenates prompt segment contents', () => {
		expect(joinPrompt([{ content: 'a' }, { content: 'b' }, { content: 'c' }])).toBe('abc');
	});
});

describe('replaceUnprintableBytes', () => {
	it('leaves printable ASCII and common Unicode untouched', () => {
		expect(replaceUnprintableBytes('Hello, world!')).toBe('Hello, world!');
		expect(replaceUnprintableBytes('cafe--japanese')).toBe('cafe--japanese');
	});

	it('replaces control bytes with <0xXX> escape', () => {
		expect(replaceUnprintableBytes('a' + String.fromCharCode(0) + 'b')).toBe('a<0x00>b');
		expect(replaceUnprintableBytes('x' + String.fromCharCode(0x1f) + 'y')).toBe('x<0x1F>y');
	});
});

describe('replaceNewlines', () => {
	it('converts literal backslash-n sequences to real newlines in string values', () => {
		const result = replaceNewlines({ sys: 'line1\\nline2', num: 5, flag: true });
		expect(result).toEqual({ sys: 'line1\nline2', num: 5, flag: true });
	});

	it('leaves non-string values unchanged', () => {
		const input = { a: 1, b: null, c: { d: 'x\\ny' } };
		expect(replaceNewlines(input)).toEqual(input);
	});
});
