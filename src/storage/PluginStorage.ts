import { AbstractStorage } from './AbstractStorage';
import { coercePluginRecord } from './validators';
import type { PluginData } from './PluginData';

export interface PluginImportInput {
	code: string;
	manifest: PluginManifest;
	changelog?: string;
	url?: string;
	source?: string;
}

export interface PluginUpdateInput {
	code: string;
	manifest: PluginManifest;
	changelog?: string;
}

export class PluginIdMismatchError extends Error {
	readonly expectedId: string;
	readonly actualId: string;

	constructor(expectedId: string, actualId: string) {
		super('This archive is for a different plugin');
		this.name = 'PluginIdMismatchError';
		this.expectedId = expectedId;
		this.actualId = actualId;
	}
}

/**
 * The `Plugins` store: each plugin's code, manifest and whether it's switched on, keyed by `id`.
 * Every change goes through one queue and returns its save, so the Plugins tab can wait for it.
 */
export class PluginStorage extends AbstractStorage {
	plugins: Record<string, PluginRecord> = {};
	/** Settles once every save started so far has finished. Reload waits on it. */
	pending: Promise<void> = Promise.resolve();
	data: PluginData;

	constructor(dbAdapter: DatabaseAdapter, data: PluginData) {
		super('Plugins', dbAdapter);
		this.data = data;
	}

	async init() {
		const db = await this.openDatabase();
		const raw = await this.loadAllFromDatabase(db);
		this.plugins = {};
		for (const [id, value] of Object.entries(raw)) {
			const record = coercePluginRecord(value, id);
			if (record) {
				this.plugins[id] = { ...record, manifest: { ...record.manifest, id } };
			} else {
				console.warn(`[PluginStorage] Removing invalid entry: ${id}`);
				await this.data.deleteAll(id).catch(e => console.warn(`[PluginStorage] Failed to delete data for invalid entry: ${id}`, e));
				await this.deleteFromDatabase(db, id).catch(e => console.warn(`[PluginStorage] Failed to delete invalid entry: ${id}`, e));
			}
		}
	}

	#enqueue(work: () => Promise<void>): Promise<void> {
		const run = this.pending.then(work);
		this.pending = run.catch(() => {});
		return run;
	}

	/** `this.plugins` only changes once the database has the change, so it never shows a save that failed. */
	#save(id: string, record: (current: PluginRecord | undefined) => PluginRecord): Promise<void> {
		return this.#enqueue(async () => {
			const next = record(this.plugins[id]);
			await this.saveToDatabase(await this.openDatabase(), id, next);
			this.plugins = { ...this.plugins, [id]: next };
		});
	}

	/** Pass `allowedVersion` when switching on a plugin that isn't declared for this version. */
	setEnabled(id: string, enabled: boolean, allowedVersion?: string): Promise<void> {
		return this.#save(id, current => {
			if (!current) throw new Error(`No plugin "${id}"`);
			return { ...current, enabled, ...(allowedVersion !== undefined ? { allowedVersion } : {}) };
		});
	}

	/** Saves the plugin switched off. Replacing one keeps its saved data and drops its `allowedVersion`. */
	importPlugin({ code, manifest, changelog, url, source }: PluginImportInput): Promise<void> {
		const id = manifest.id;
		return this.#save(id, () => ({
			code,
			enabled: false,
			manifest,
			...(changelog !== undefined ? { changelog } : {}),
			...(url !== undefined ? { url } : {}),
			...(source !== undefined ? { source } : {}),
		}));
	}

	/**
	 * Replaces a plugin's code and manifest from its saved address. It stays switched on or off
	 * as it was, keeps its saved data, and drops `allowedVersion`. An archive for a different
	 * plugin `id` is refused.
	 */
	updatePlugin(id: string, { code, manifest, changelog }: PluginUpdateInput): Promise<void> {
		return this.#save(id, current => {
			if (!current) throw new Error(`No plugin "${id}"`);
			if (manifest.id !== id) {
				throw new PluginIdMismatchError(id, manifest.id);
			}
			return {
				code,
				enabled: current.enabled,
				manifest,
				...(changelog !== undefined ? { changelog } : {}),
				...(current.url !== undefined ? { url: current.url } : {}),
				...(current.source !== undefined ? { source: current.source } : {}),
			};
		});
	}

	/**
	 * Deletes the plugin's data, then the plugin. They're two stores, so the two steps aren't
	 * atomic. If the second fails, the plugin is left with no data and can be deleted again.
	 */
	remove(id: string): Promise<void> {
		return this.#enqueue(async () => {
			await this.data.deleteAll(id);
			await this.deleteFromDatabase(await this.openDatabase(), id);
			const { [id]: _, ...rest } = this.plugins;
			this.plugins = rest;
		});
	}
}
