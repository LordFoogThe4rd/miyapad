import { AbstractStorage } from './AbstractStorage';

/** What a plugin gets as `miyapad.storage`. Every key is kept under the plugin's own name. */
export interface PluginStorageApi {
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	keys(): Promise<string[]>;
}

/**
 * Data that plugins save. Key `<name>` holds the list of that plugin's keys, and key
 * `<name>/<key>` holds one value. Plugin names can't contain `/`, so no two plugins share a key.
 */
export class PluginData extends AbstractStorage {
	#queue: Promise<unknown> = Promise.resolve();

	constructor(dbAdapter: DatabaseAdapter) {
		super('PluginData', dbAdapter);
	}

	/** One operation at a time, so two writes can't both update the same stale key list. */
	#enqueue<T>(work: () => Promise<T>): Promise<T> {
		const run = this.#queue.then(work, work);
		this.#queue = run.catch(() => {});
		return run;
	}

	async #keys(db: DbConnection, name: string): Promise<string[]> {
		const keys = await this.loadFromDatabase(db, name);
		return Array.isArray(keys) ? keys : [];
	}

	storageFor(name: string): PluginStorageApi {
		// Plugins are plain JS, so a number key has to land on the same entry as its string.
		return {
			get: key => this.#enqueue(async () => this.loadFromDatabase(await this.openDatabase(), `${name}/${key}`)),
			// async, so a value JSON can't take (a BigInt, a cycle) rejects instead of throwing. The
			// value is still converted before the first await, so the plugin can change it afterwards.
			set: async (rawKey, value) => {
				const key = String(rawKey);
				// The server only stores JSON. Converting here too means a Date or a Map comes back
				// the same way in both modes, instead of working only in the browser's IndexedDB.
				const json = JSON.stringify(value);
				if (json === undefined) throw new TypeError(`miyapad.storage.set: the value for "${key}" can't be converted to JSON`);
				const data = JSON.parse(json);
				return this.#enqueue(async () => {
					const db = await this.openDatabase();
					const keys = await this.#keys(db, name);
					await this.batchMutation(db, [
						{ type: 'save', key: `${name}/${key}`, data },
						...(keys.includes(key) ? [] : [{ type: 'save' as const, key: name, data: [...keys, key] }]),
					]);
				});
			},
			delete: rawKey => this.#enqueue(async () => {
				const key = String(rawKey);
				const db = await this.openDatabase();
				const keys = await this.#keys(db, name);
				if (!keys.includes(key)) return;
				await this.batchMutation(db, [
					{ type: 'delete', key: `${name}/${key}` },
					{ type: 'save', key: name, data: keys.filter(k => k !== key) },
				]);
			}),
			keys: () => this.#enqueue(async () => this.#keys(await this.openDatabase(), name)),
		};
	}

	/** Removes every value the plugin saved, and its key list, in one transaction. */
	deleteAll(name: string): Promise<void> {
		return this.#enqueue(async () => {
			const db = await this.openDatabase();
			const keys = await this.#keys(db, name);
			await this.batchMutation(db, [
				...keys.map(key => ({ type: 'delete' as const, key: `${name}/${key}` })),
				{ type: 'delete', key: name },
			]);
		});
	}
}
