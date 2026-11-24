import { unzipSync } from 'fflate';
import { ManifestValidationError, parseManifest, type ParsedPluginManifest } from './manifest';

export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

const ALLOWED_ENTRIES = new Set(['manifest.json', 'main.js', 'CHANGELOG.md']);
const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

export type PluginArchiveErrorKind =
	| 'archive-too-large'
	| 'decompressed-too-large'
	| 'entry-too-large'
	| 'not-zip'
	| 'missing-manifest'
	| 'bad-manifest-json'
	| 'invalid-manifest'
	| 'missing-main'
	| 'unbundled-esm'
	| 'syntax-error';

export class PluginArchiveError extends Error {
	readonly kind: PluginArchiveErrorKind;

	constructor(kind: PluginArchiveErrorKind, message: string) {
		super(message);
		this.name = 'PluginArchiveError';
		this.kind = kind;
	}
}

export interface ParsedPluginArchive {
	manifest: ParsedPluginManifest;
	code: string;
	changelog?: string;
}

/** Checks the PKZIP local-file or empty-archive magic bytes (`PK\x03\x04` or `PK\x05\x06`). */
export function isZipBytes(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		((bytes[2] === 0x03 && bytes[3] === 0x04) ||
			(bytes[2] === 0x05 && bytes[3] === 0x06) ||
			(bytes[2] === 0x07 && bytes[3] === 0x08))
	);
}

/**
 * Unpacks and validates a `.miyaplugin` zip archive without executing plugin code.
 * Only `manifest.json`, `main.js` and `CHANGELOG.md` are read; all other paths are ignored.
 */
export function parsePluginArchive(bytes: Uint8Array): ParsedPluginArchive {
	if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
		throw new PluginArchiveError('archive-too-large', 'Plugin archive exceeds the 10 MB limit');
	}
	if (!isZipBytes(bytes)) {
		throw new PluginArchiveError('not-zip', 'Not a valid .miyaplugin zip archive');
	}

	let entries: Record<string, Uint8Array>;
	let declaredTotal = 0;
	try {
		entries = unzipSync(bytes, {
			filter(file) {
				if (file.originalSize > MAX_ENTRY_BYTES) {
					throw new PluginArchiveError('entry-too-large', `Archive entry "${file.name}" exceeds the 2 MB limit`);
				}
				declaredTotal += file.originalSize;
				if (declaredTotal > MAX_DECOMPRESSED_BYTES) {
					throw new PluginArchiveError('decompressed-too-large', 'Decompressed archive exceeds the 20 MB limit');
				}
				return ALLOWED_ENTRIES.has(file.name);
			},
		});
	} catch (e) {
		if (e instanceof PluginArchiveError) throw e;
		throw new PluginArchiveError('not-zip', 'Could not read .miyaplugin zip archive');
	}

	let actualTotal = 0;
	for (const [name, data] of Object.entries(entries)) {
		if (data.byteLength > MAX_ENTRY_BYTES) {
			throw new PluginArchiveError('entry-too-large', `Archive entry "${name}" exceeds the 2 MB limit`);
		}
		actualTotal += data.byteLength;
		if (actualTotal > MAX_DECOMPRESSED_BYTES) {
			throw new PluginArchiveError('decompressed-too-large', 'Decompressed archive exceeds the 20 MB limit');
		}
	}

	const rawManifest = entries['manifest.json'];
	if (!rawManifest) {
		throw new PluginArchiveError('missing-manifest', 'Archive is missing manifest.json');
	}
	const rawMain = entries['main.js'];
	if (!rawMain) {
		throw new PluginArchiveError('missing-main', 'Archive is missing main.js');
	}

	const decoder = new TextDecoder('utf-8', { fatal: true });
	let decodedManifest: unknown;
	try {
		decodedManifest = JSON.parse(decoder.decode(rawManifest));
	} catch {
		throw new PluginArchiveError('bad-manifest-json', 'manifest.json is not valid JSON');
	}

	let manifest: ParsedPluginManifest;
	try {
		manifest = parseManifest(decodedManifest);
	} catch (e) {
		const message = e instanceof ManifestValidationError ? e.message : String(e);
		throw new PluginArchiveError('invalid-manifest', message);
	}

	let code: string;
	try {
		code = decoder.decode(rawMain);
	} catch {
		throw new PluginArchiveError('syntax-error', 'main.js is not valid UTF-8 text');
	}

	try {
		// Compile without calling: catches static import/export and syntax errors without running plugin code.
		new AsyncFunction('miyapad', code);
	} catch (e) {
		if (e instanceof SyntaxError && /\b(import|export|module)\b/i.test(e.message)) {
			throw new PluginArchiveError('unbundled-esm', 'Static import/export is not supported; bundle the plugin into main.js');
		}
		throw new PluginArchiveError('syntax-error', e instanceof Error ? e.message : String(e));
	}

	let changelog: string | undefined;
	const rawChangelog = entries['CHANGELOG.md'];
	if (rawChangelog) {
		try {
			changelog = decoder.decode(rawChangelog);
		} catch {
			// Optional file: unparsable bytes must not reject the archive.
			changelog = undefined;
		}
	}

	return {
		manifest,
		code,
		...(changelog !== undefined ? { changelog } : {}),
	};
}
