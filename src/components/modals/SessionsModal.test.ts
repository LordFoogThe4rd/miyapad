import { describe, expect, it } from 'vitest';
import { tagSuggestions } from './SessionsModal';

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
