import { AbstractStorage } from './AbstractStorage';
import { coercePluginRecord } from './validators';

export interface PluginContainerStore {
	deleteContainer(id: string): Promise<void>;
}

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

export interface PluginRemoveOptions {
	keepData?: boolean;
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
	/** Non-null when the `Plugins` registry itself could not be read; nothing is run or deleted. */
	registryError: string | null = null;
	/** Settles once every save started so far has finished. Reload waits on it. */
	pending: Promise<void> = Promise.resolve();
	containers: PluginContainerStore;
	#listeners = new Set<() => void>();

	constructor(dbAdapter: DatabaseAdapter, containers: PluginContainerStore) {
		super('Plugins', dbAdapter);
		this.containers = containers;
	}

	subscribe = (listener: () => void): (() => void) => {
		this.#listeners.add(listener);
		return () => { this.#listeners.delete(listener); };
	};

	#notify(): void {
		for (const listener of this.#listeners) listener();
	}

	async init() {
		this.plugins = {};
		this.registryError = null;
		let db: DbConnection;
		let raw: Record<string, unknown>;
		try {
			db = await this.openDatabase();
			raw = await this.loadAllFromDatabase(db);
		} catch (e) {
			this.registryError = e instanceof Error ? e.message : String(e);
			console.error('[PluginStorage] Failed to read plugin registry:', e);
			return;
		}
		for (const [id, value] of Object.entries(raw)) {
			const record = coercePluginRecord(value, id);
			if (record) {
				this.plugins[id] = { ...record, manifest: { ...record.manifest, id } };
			} else {
				console.warn(`[PluginStorage] Removing invalid entry: ${id}`);
				await this.containers.deleteContainer(id).catch(e => console.warn(`[PluginStorage] Failed to delete data for invalid entry: ${id}`, e));
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
			this.#notify();
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

	/** Deletes the plugin's saved data container while leaving the plugin itself installed. */
	clearData(id: string): Promise<void> {
		return this.#enqueue(async () => {
			if (!this.plugins[id]) throw new Error(`No plugin "${id}"`);
			await this.containers.deleteContainer(id);
		});
	}

	/**
	 * Deletes the plugin's container first (unless `keepData` is set), then its registry entry.
	 * If the registry delete fails, the plugin stays listed with an empty container and can be retried.
	 */
	remove(id: string, options?: PluginRemoveOptions): Promise<void> {
		return this.#enqueue(async () => {
			if (!options?.keepData) {
				await this.containers.deleteContainer(id);
			}
			await this.deleteFromDatabase(await this.openDatabase(), id);
			const { [id]: _, ...rest } = this.plugins;
			this.plugins = rest;
			this.#notify();
		});
	}
}
