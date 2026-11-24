const PLUGIN_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const PLUGIN_VERSION_REGEX = /^\d+(\.\d+)*$/;
export const SUPPORTED_PLUGIN_API = 1;

export class ManifestValidationError extends Error {
	readonly field: string;

	constructor(field: string, message: string) {
		super(message);
		this.name = 'ManifestValidationError';
		this.field = field;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

export function isValidPluginId(id: unknown): id is string {
	return typeof id === 'string' && PLUGIN_ID_REGEX.test(id);
}

export function isValidPluginVersion(version: unknown): version is string {
	return typeof version === 'string' && PLUGIN_VERSION_REGEX.test(version);
}

export interface ParsedPluginManifest extends PluginManifest {
	version: string;
}

/**
 * Strictly validates a decoded `manifest.json` object from a `.miyaplugin` archive.
 * Unknown fields are ignored so newer archives still import on older Miyapad builds.
 */
export function parseManifest(raw: unknown): ParsedPluginManifest {
	if (!isRecord(raw)) {
		throw new ManifestValidationError('manifest', 'manifest.json must be a JSON object');
	}
	if (!isValidPluginId(raw.id)) {
		throw new ManifestValidationError('id', 'manifest.id must match ^[a-z0-9][a-z0-9_-]{0,63}$');
	}
	if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
		throw new ManifestValidationError('name', 'manifest.name must be a non-empty string');
	}
	if (!isValidPluginVersion(raw.version)) {
		throw new ManifestValidationError('version', 'manifest.version must be plain numbers like 1.0.0');
	}

	const manifest: ParsedPluginManifest = {
		id: raw.id,
		name: raw.name,
		version: raw.version,
		order: 0,
		api: 1,
	};

	for (const key of ['description', 'author'] as const) {
		const val = raw[key];
		if (val !== undefined) {
			if (typeof val !== 'string') {
				throw new ManifestValidationError(key, `manifest.${key} must be a string`);
			}
			manifest[key] = val;
		}
	}

	if (raw.homepage !== undefined) {
		if (typeof raw.homepage !== 'string' || !isHttpUrl(raw.homepage)) {
			throw new ManifestValidationError('homepage', 'manifest.homepage must be an http(s) URL');
		}
		manifest.homepage = raw.homepage;
	}

	for (const key of ['minMiyapad', 'maxMiyapad'] as const) {
		const val = raw[key];
		if (val !== undefined) {
			if (!isValidPluginVersion(val)) {
				throw new ManifestValidationError(key, `manifest.${key} must be plain numbers like 2.9.0`);
			}
			manifest[key] = val;
		}
	}

	if (raw.order !== undefined) {
		if (typeof raw.order !== 'number' || !Number.isSafeInteger(raw.order)) {
			throw new ManifestValidationError('order', 'manifest.order must be a safe integer');
		}
		manifest.order = raw.order;
	}

	for (const key of ['startTimeout', 'hookTimeout'] as const) {
		const val = raw[key];
		if (val !== undefined) {
			if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 1) {
				throw new ManifestValidationError(key, `manifest.${key} must be a whole positive number of seconds`);
			}
			manifest[key] = val;
		}
	}

	if (raw.api !== undefined) {
		if (typeof raw.api !== 'number' || !Number.isSafeInteger(raw.api) || raw.api < 1) {
			throw new ManifestValidationError('api', 'manifest.api must be a positive integer');
		}
		manifest.api = raw.api;
	}

	if (raw.requires !== undefined) {
		if (!Array.isArray(raw.requires)) {
			throw new ManifestValidationError('requires', 'manifest.requires must be an array');
		}
		const seen = new Set<PluginCapability>();
		for (const item of raw.requires) {
			if (item !== 'server') {
				throw new ManifestValidationError('requires', `Unknown capability in manifest.requires: ${String(item)}`);
			}
			seen.add(item);
		}
		if (seen.size > 0) {
			manifest.requires = [...seen];
		}
	}

	return manifest;
}

/** Builds a synthetic manifest for a legacy `.js` plugin without a `manifest.json`. */
export function legacyManifest(
	id: string,
	header: { min?: string; max?: string; startTimeout?: number; hookTimeout?: number } = {},
): PluginManifest {
	return {
		id,
		name: id,
		order: 0,
		api: 1,
		...(header.min !== undefined ? { minMiyapad: header.min } : {}),
		...(header.max !== undefined ? { maxMiyapad: header.max } : {}),
		...(header.startTimeout !== undefined ? { startTimeout: header.startTimeout } : {}),
		...(header.hookTimeout !== undefined ? { hookTimeout: header.hookTimeout } : {}),
	};
}
