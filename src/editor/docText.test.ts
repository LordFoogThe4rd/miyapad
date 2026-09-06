import { describe, it, expect } from 'vitest';
import { schema } from './schema';
import { textToDoc } from './syncReactToPM';
import { docText, flatTextLength } from './docText';

describe('docText / flatTextLength', () => {
	const cases = [
		{ name: 'empty paragraph', text: '' },
		{ name: 'single line', text: 'hello' },
		{ name: 'multi line', text: 'ab\ncd\nef' },
		{ name: 'all blank', text: '\n\n\n' },
		{ name: 'long line', text: 'x'.repeat(10000) },
	];

	for (const { name, text } of cases) {
		it(`matches textBetween for ${name}`, () => {
			const doc = textToDoc(schema, text);
			expect(docText(doc)).toBe(text);
			expect(flatTextLength(doc)).toBe(docText(doc).length);
		});
	}

	it('returns the identical string instance for the same doc node', () => {
		const doc = textToDoc(schema, 'a\nb');
		expect(docText(doc)).toBe(docText(doc));
	});

	it('does not confuse distinct docs', () => {
		const a = textToDoc(schema, 'one');
		const b = textToDoc(schema, 'two');
		expect(docText(a)).toBe('one');
		expect(docText(b)).toBe('two');
	});

	it('schema stays paragraph/text-only, keeping flatTextLength exact', () => {
		const doc = textToDoc(schema, 'a\n\nb');
		doc.forEach((para) => {
			expect(para.type.name).toBe('paragraph');
			para.forEach((inline) => expect(inline.isText).toBe(true));
		});
	});
});
