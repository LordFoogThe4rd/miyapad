import { AbstractStorage } from './AbstractStorage';
import { coercePluginRecord } from './validators';
import type { PluginData } from './PluginData';

/**
 * The `Plugins` store: each plugin's code and whether it's switched on, under the plugin's name.
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
		for (const [name, value] of Object.entries(raw)) {
			const record = coercePluginRecord(value);
			if (record) {
				this.plugins[name] = record;
			} else {
				console.warn(`[PluginStorage] Removing invalid entry: ${name}`);
				await this.deleteFromDatabase(db, name).catch(e => console.warn(`[PluginStorage] Failed to delete invalid entry: ${name}`, e));
			}
		}
	}

	#enqueue(work: () => Promise<void>): Promise<void> {
		const run = this.pending.then(work);
		this.pending = run.catch(() => {});
		return run;
	}

	/** `this.plugins` only changes once the database has the change, so it never shows a save that failed. */
	#save(name: string, record: (current: PluginRecord | undefined) => PluginRecord): Promise<void> {
		return this.#enqueue(async () => {
			const next = record(this.plugins[name]);
			await this.saveToDatabase(await this.openDatabase(), name, next);
			this.plugins = { ...this.plugins, [name]: next };
		});
	}

	/** Pass `allowedVersion` when switching on a plugin that isn't declared for this version. */
	setEnabled(name: string, enabled: boolean, allowedVersion?: string): Promise<void> {
		return this.#save(name, current => {
			if (!current) throw new Error(`No plugin named "${name}"`);
			return { ...current, enabled, ...(allowedVersion !== undefined ? { allowedVersion } : {}) };
		});
	}

	/**
	 * The name of the plugin this one would replace: names that differ only in case are the same
	 * plugin, so `Foo.js` replaces `foo` and its saved data is kept.
	 */
	resolveName(name: string): string {
		const lower = name.toLowerCase();
		return Object.keys(this.plugins).find(key => key.toLowerCase() === lower) ?? name;
	}

	/** Saves the plugin switched off. Replacing one keeps its saved data and drops its `allowedVersion`. */
	importPlugin(name: string, code: string, { min, max, startTimeout, hookTimeout }: { min?: string; max?: string; startTimeout?: number; hookTimeout?: number }): Promise<void> {
		return this.#save(this.resolveName(name), () => ({
			code,
			enabled: false,
			...(min !== undefined ? { min } : {}),
			...(max !== undefined ? { max } : {}),
			...(startTimeout !== undefined ? { startTimeout } : {}),
			...(hookTimeout !== undefined ? { hookTimeout } : {}),
		}));
	}

	/**
	 * Deletes the plugin's data, then the plugin. They're two stores, so the two steps aren't
	 * atomic. If the second fails, the plugin is left with no data and can be deleted again.
	 */
	remove(name: string): Promise<void> {
		return this.#enqueue(async () => {
			await this.data.deleteAll(name);
			await this.deleteFromDatabase(await this.openDatabase(), name);
			const { [name]: _, ...rest } = this.plugins;
			this.plugins = rest;
		});
	}
}
