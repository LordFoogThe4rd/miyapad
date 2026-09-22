import { describe, expect, it } from 'vitest';
import { tagSuggestions, typeAheadMatch } from './SessionsModal';

describe('tagSuggestions', () => {
	const tags = ['wip', 'archived', 'draft'];

	it('offers every tag for an empty box or the first tag', () => {
		expect(tagSuggestions('', tags)).toEqual(tags);
		expect(tagSuggestions('ar', tags)).toEqual(tags);
	});

	it('prefixes each suggestion with the tags typed so far, keeping the spacing', () => {
		expect(tagSuggestions('wip, ar', tags)).toEqual(['wip, archived', 'wip, draft']);
		expect(tagSuggestions('wip,', tags)).toEqual(['wip,archived', 'wip,draft']);
	});

	it('leaves out tags already typed, whatever their case', () => {
		expect(tagSuggestions('Draft , wip, ', tags)).toEqual(['Draft , wip, archived']);
	});
});

describe('typeAheadMatch', () => {
	const names: Record<string, string> = { a: 'Alpha', b: 'Beta', c: 'alps', d: 'Delta' };
	const ids = Object.keys(names);
	const nameOf = (id: string) => names[id]!;

	it('steps to the next match below the row for a single letter, wrapping round, whatever the case', () => {
		expect(typeAheadMatch(ids, nameOf, 0, 'a')).toBe('c');
		expect(typeAheadMatch(ids, nameOf, 2, 'a')).toBe('a');
	});

	it('stays on the row while it still matches the longer text', () => {
		expect(typeAheadMatch(ids, nameOf, 0, 'alp')).toBe('a');
		expect(typeAheadMatch(ids, nameOf, 0, 'alps')).toBe('c');
	});

	it('finds nothing when no name starts with the text', () => {
		expect(typeAheadMatch(ids, nameOf, 1, 'z')).toBeUndefined();
	});
});
