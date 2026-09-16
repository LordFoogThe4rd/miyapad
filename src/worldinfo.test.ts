import { describe, it, expect } from 'vitest';
import { importSillyTavernWorldInfo } from './worldinfo';

function makeWorldInfo(entries: WorldInfoEntry[] = []): WorldInfoData {
	return { miyaPediaVersion: 1, entries, prefix: '[WI]', suffix: '[/WI]' };
}

function existing(name: string): WorldInfoEntry {
	return { displayName: name, text: `${name} text`, keys: [name], search: '512' };
}

// Drives the real setState-style updater the way React would, and hands back the result.
function runImport(json: SillyTavernWorldInfo, prev: WorldInfoData, behavior: 'replace' | 'append'): WorldInfoData {
	let next = prev;
	importSillyTavernWorldInfo(json, (value) => {
		next = typeof value === 'function' ? value(prev) : value;
	}, behavior);
	return next;
}

describe('importSillyTavernWorldInfo', () => {
	it('maps SillyTavern fields onto miyapad entries', () => {
		const result = runImport({
			entries: {
				'0': { key: ['dragon', 'wyrm'], comment: 'Dragons', content: 'They breathe fire.', scanDepth: '1024' },
			},
		}, makeWorldInfo(), 'replace');

		expect(result.entries).toEqual([
			{ displayName: 'Dragons', text: 'They breathe fire.', keys: ['dragon', 'wyrm'], search: '1024' },
		]);
	});

	it('replaces the existing entries when the behavior is "replace"', () => {
		const result = runImport({
			entries: { '0': { key: ['new'], comment: 'New', content: 'New text' } },
		}, makeWorldInfo([existing('old')]), 'replace');

		expect(result.entries.map(e => e.displayName)).toEqual(['New']);
	});

	it('keeps the existing entries when the behavior is "append"', () => {
		const result = runImport({
			entries: { '0': { key: ['new'], comment: 'New', content: 'New text' } },
		}, makeWorldInfo([existing('old')]), 'append');

		expect(result.entries.map(e => e.displayName)).toEqual(['old', 'New']);
	});

	it('preserves the prefix, suffix and version alongside the imported entries', () => {
		const prev = makeWorldInfo([existing('old')]);
		const result = runImport({ entries: { '0': { key: ['a'], comment: 'A', content: 'a' } } }, prev, 'replace');

		expect(result.prefix).toBe('[WI]');
		expect(result.suffix).toBe('[/WI]');
		expect(result.miyaPediaVersion).toBe(1);
	});

	it('does not mutate the previous entries array on append', () => {
		const prev = makeWorldInfo([existing('old')]);
		const result = runImport({ entries: { '0': { key: ['a'], comment: 'A', content: 'a' } } }, prev, 'append');

		expect(prev.entries).toHaveLength(1);
		expect(result.entries).not.toBe(prev.entries);
	});

	it('copies the key array instead of aliasing the imported JSON', () => {
		const json: SillyTavernWorldInfo = { entries: { '0': { key: ['a'], comment: 'A', content: 'a' } } };
		const result = runImport(json, makeWorldInfo(), 'replace');

		expect(result.entries[0].keys).not.toBe(json.entries!['0'].key);
	});

	it('falls back to an empty search range when scanDepth is missing, null or zero', () => {
		const result = runImport({
			entries: {
				'0': { key: ['a'], comment: 'A', content: 'a' },
				'1': { key: ['b'], comment: 'B', content: 'b', scanDepth: null },
				'2': { key: ['c'], comment: 'C', content: 'c', scanDepth: '' },
			},
		}, makeWorldInfo(), 'replace');

		expect(result.entries.map(e => e.search)).toEqual(['', '', '']);
	});

	it('clears the entries when a replace import carries none', () => {
		expect(runImport({}, makeWorldInfo([existing('old')]), 'replace').entries).toEqual([]);
		expect(runImport({ entries: {} }, makeWorldInfo([existing('old')]), 'replace').entries).toEqual([]);
	});

	it('leaves the entries untouched when an append import carries none', () => {
		const result = runImport({}, makeWorldInfo([existing('old')]), 'append');
		expect(result.entries.map(e => e.displayName)).toEqual(['old']);
	});

	it('imports every entry in the record, keyed order preserved', () => {
		const result = runImport({
			entries: {
				'0': { key: ['a'], comment: 'A', content: 'a' },
				'1': { key: ['b'], comment: 'B', content: 'b' },
				'2': { key: ['c'], comment: 'C', content: 'c' },
			},
		}, makeWorldInfo(), 'replace');

		expect(result.entries.map(e => e.displayName)).toEqual(['A', 'B', 'C']);
	});
});
