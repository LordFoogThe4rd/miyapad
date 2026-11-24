import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { MAX_ARCHIVE_BYTES, MAX_ENTRY_BYTES, parsePluginArchive, PluginArchiveError } from './archive';

const validManifest = JSON.stringify({
	id: 'date',
	name: 'Date in prompts',
	version: '1.4.0',
	minMiyapad: '2.9.0',
});

function buildZip(files: Record<string, string | Uint8Array>): Uint8Array {
	const entries: Record<string, Uint8Array> = {};
	for (const [name, content] of Object.entries(files)) {
		entries[name] = typeof content === 'string' ? strToU8(content) : content;
	}
	return zipSync(entries);
}

describe('parsePluginArchive', () => {
	it('reads manifest.json, main.js and optional CHANGELOG.md, ignoring extra entries', () => {
		const archive = buildZip({
			'manifest.json': validManifest,
			'main.js': 'const count = await miyapad.storage.get("n");',
			'CHANGELOG.md': '## [1.4.0]\n- Added date replacement',
			'README.md': 'ignored',
			'../outside.js': 'ignored',
		});

		expect(parsePluginArchive(archive)).toEqual({
			manifest: {
				id: 'date',
				name: 'Date in prompts',
				version: '1.4.0',
				minMiyapad: '2.9.0',
				order: 0,
				api: 1,
			},
			code: 'const count = await miyapad.storage.get("n");',
			changelog: '## [1.4.0]\n- Added date replacement',
		});
	});

	it('allows an archive without CHANGELOG.md or with invalid UTF-8 in CHANGELOG.md', () => {
		const noChangelog = buildZip({ 'manifest.json': validManifest, 'main.js': 'const x = 1;' });
		expect(parsePluginArchive(noChangelog).changelog).toBeUndefined();

		const badChangelog = buildZip({
			'manifest.json': validManifest,
			'main.js': 'const x = 1;',
			'CHANGELOG.md': new Uint8Array([0xff, 0xfe, 0xfd]),
		});
		expect(parsePluginArchive(badChangelog).changelog).toBeUndefined();
	});

	it('rejects missing manifest.json, missing main.js, bad JSON and invalid manifest fields', () => {
		expect(() => parsePluginArchive(buildZip({ 'main.js': '1;' }))).toThrowError(
			expect.objectContaining({ kind: 'missing-manifest' }),
		);
		expect(() => parsePluginArchive(buildZip({ 'manifest.json': validManifest }))).toThrowError(
			expect.objectContaining({ kind: 'missing-main' }),
		);
		expect(() => parsePluginArchive(buildZip({ 'manifest.json': '{bad', 'main.js': '1;' }))).toThrowError(
			expect.objectContaining({ kind: 'bad-manifest-json' }),
		);
		expect(() => parsePluginArchive(buildZip({ 'manifest.json': '{"id":"BAD"}', 'main.js': '1;' }))).toThrowError(
			expect.objectContaining({ kind: 'invalid-manifest' }),
		);
	});

	it('rejects non-zip bytes', () => {
		expect(() => parsePluginArchive(strToU8('const x = 1;'))).toThrowError(
			expect.objectContaining({ kind: 'not-zip' }),
		);
		expect(() => parsePluginArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))).toThrowError(
			expect.objectContaining({ kind: 'not-zip' }),
		);
	});

	it('enforces archive, decompressed and per-entry byte caps', () => {
		expect(() => parsePluginArchive(new Uint8Array(MAX_ARCHIVE_BYTES + 1))).toThrowError(
			expect.objectContaining({ kind: 'archive-too-large' }),
		);

		const bigEntry = buildZip({
			'manifest.json': validManifest,
			'main.js': new Uint8Array(MAX_ENTRY_BYTES + 1).fill(0x20),
		});
		expect(() => parsePluginArchive(bigEntry)).toThrowError(
			expect.objectContaining({ kind: 'entry-too-large' }),
		);

		const manyEntries: Record<string, Uint8Array> = {
			'manifest.json': strToU8(validManifest),
			'main.js': strToU8('const x = 1;'),
		};
		const chunk = new Uint8Array(1_500_000).fill(0x41);
		for (let i = 0; i < 15; i++) manyEntries[`extra-${i}.txt`] = chunk;
		expect(() => parsePluginArchive(zipSync(manyEntries))).toThrowError(
			expect.objectContaining({ kind: 'decompressed-too-large' }),
		);
	});

	it('catches static import and export in main.js with a bundle hint', () => {
		const withImport = buildZip({
			'manifest.json': validManifest,
			'main.js': 'import { helper } from "./util.js";\nhelper();',
		});
		let caught: unknown;
		try {
			parsePluginArchive(withImport);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(PluginArchiveError);
		expect((caught as PluginArchiveError).kind).toBe('unbundled-esm');
		expect((caught as PluginArchiveError).message).toMatch(/bundle the plugin into main\.js/i);

		const withExport = buildZip({
			'manifest.json': validManifest,
			'main.js': 'export const version = 1;',
		});
		expect(() => parsePluginArchive(withExport)).toThrowError(
			expect.objectContaining({ kind: 'unbundled-esm' }),
		);
	});
});
