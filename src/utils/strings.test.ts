import { describe, it, expect } from 'vitest';
import { insertedLength, joinPrompt, replaceNewlines, replaceUnprintableBytes } from './strings';

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

	it('passes valid astral characters (surrogate pairs) through unchanged', () => {
		expect(replaceUnprintableBytes('😀')).toBe('😀');
		expect(replaceUnprintableBytes('a😀b')).toBe('a😀b');
	});

	it('escapes lone high surrogates', () => {
		expect(replaceUnprintableBytes(String.fromCharCode(0xd83d))).toBe('<0xD83D>');
	});

	it('escapes lone low surrogates', () => {
		expect(replaceUnprintableBytes(String.fromCharCode(0xde00))).toBe('<0xDE00>');
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

describe('insertedLength', () => {
	it('counts what was added and ignores the ends the two strings share', () => {
		expect(insertedLength('hello', 'hello!')).toBe(1);
		expect(insertedLength('', 'typed')).toBe(5);
		// A replacement counts only the new text, not the text it stood in for.
		expect(insertedLength('hello', 'heLLLLo')).toBe(4);
		expect(insertedLength('hello', 'hello')).toBe(0);
		expect(insertedLength('hello world', 'hello')).toBe(0);
	});
});
