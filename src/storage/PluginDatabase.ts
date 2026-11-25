import { isValidPluginId } from '../plugins/manifest';

export const PLUGIN_DB_PREFIX = 'miyapad-plugin-';
export const PLUGIN_DB_VERSION = 1;
export const PLUGIN_KV_STORE = 'kv';

const NAMESPACE_RE = /^[a-z0-9_-]{1,32}$/;

export function isValidPluginNamespace(name: unknown): name is string {
	return typeof name === 'string' && (name === '' || NAMESPACE_RE.test(name));
}

export class PluginContainerError extends Error {
	readonly pluginId: string;

	constructor(pluginId: string, message: string) {
		super(message);
		this.name = 'PluginContainerError';
		this.pluginId = pluginId;
	}
}

export interface PluginDbNamespace {
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	keys(prefix?: string): Promise<string[]>;
	clear(): Promise<void>;
}

/** Alias kept for `miyapad.storage` (`miyapad.db('')`). */
export type PluginStorageApi = PluginDbNamespace;

export interface PluginDatabaseOptions {
	/** Defined when running against the Miyapad server; omit for standalone IndexedDB mode. */
	serverEndpoint?: string;
	/** Called when a plugin's container cannot be opened or is unreadable. */
	onContainerError?: (id: string, error: PluginContainerError) => void;
}

async function idbDatabaseExists(dbName: string): Promise<boolean> {
	if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
		return true;
	}
	try {
		const list = await indexedDB.databases();
		return list.some(info => info.name === dbName);
	} catch {
		return true;
	}
}

function openPluginIdbRaw(id: string, createIfMissing: boolean): Promise<IDBDatabase | null> {
	const dbName = `${PLUGIN_DB_PREFIX}${id}`;
	return new Promise((resolve, reject) => {
		let abortedMissing = false;
		const req = indexedDB.open(dbName, PLUGIN_DB_VERSION);
		req.onupgradeneeded = (event: IDBVersionChangeEvent) => {
			if (!createIfMissing && event.oldVersion === 0) {
				abortedMissing = true;
				req.transaction?.abort();
				return;
			}
			const db = req.result;
			if (!db.objectStoreNames.contains(PLUGIN_KV_STORE)) {
				db.createObjectStore(PLUGIN_KV_STORE);
			}
		};
		req.onsuccess = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(PLUGIN_KV_STORE)) {
				db.close();
				reject(new PluginContainerError(id, `Container "${id}" is missing the "${PLUGIN_KV_STORE}" object store`));
				return;
			}
			resolve(db);
		};
		req.onerror = () => {
			if (abortedMissing) {
				resolve(null);
				return;
			}
			reject(new PluginContainerError(id, `Container "${id}" could not be opened: ${req.error?.message ?? String(req.error)}`));
		};
	});
}

/** Exports non-empty `miyapad-plugin-<id>` IndexedDB containers as `plugin:<id>` store arrays. */
export async function exportPluginContainers(
	knownPluginIds: Iterable<string> = [],
): Promise<Record<string, { key: IDBValidKey; value: unknown }[]>> {
	const ids = new Set<string>();
	if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
		try {
			const dbs = await indexedDB.databases();
			for (const info of dbs) {
				if (info.name?.startsWith(PLUGIN_DB_PREFIX)) {
					const id = info.name.slice(PLUGIN_DB_PREFIX.length);
					if (isValidPluginId(id)) ids.add(id);
				}
			}
		} catch {
			for (const id of knownPluginIds) {
				if (isValidPluginId(id)) ids.add(id);
			}
		}
	} else {
		for (const id of knownPluginIds) {
			if (isValidPluginId(id)) ids.add(id);
		}
	}

	const exported: Record<string, { key: IDBValidKey; value: unknown }[]> = {};
	for (const id of [...ids].sort()) {
		const db = await openPluginIdbRaw(id, false);
		if (!db) continue;
		try {
			const entries = await new Promise<{ key: IDBValidKey; value: unknown }[]>((resolve, reject) => {
				const tx = db.transaction(PLUGIN_KV_STORE, 'readonly');
				const store = tx.objectStore(PLUGIN_KV_STORE);
				const items: { key: IDBValidKey; value: unknown }[] = [];
				const cursorReq = store.openCursor();
				cursorReq.onsuccess = () => {
					const cursor = cursorReq.result;
					if (cursor) {
						items.push({ key: cursor.key, value: cursor.value });
						cursor.continue();
					} else {
						resolve(items);
					}
				};
				cursorReq.onerror = () => reject(cursorReq.error);
			});
			if (entries.length > 0) {
				exported[`plugin:${id}`] = entries;
			}
		} finally {
			db.close();
		}
	}
	return exported;
}

/** Writes `plugin:<id>` entries from an export object into their `miyapad-plugin-<id>` containers. */
export async function importPluginContainers(data: Record<string, unknown>): Promise<void> {
	for (const [entryKey, rawItems] of Object.entries(data)) {
		if (!entryKey.startsWith('plugin:')) continue;
		const id = entryKey.slice('plugin:'.length);
		if (!isValidPluginId(id) || !Array.isArray(rawItems)) continue;

		const db = await openPluginIdbRaw(id, true);
		if (!db) continue;
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(PLUGIN_KV_STORE, 'readwrite');
				const store = tx.objectStore(PLUGIN_KV_STORE);
				store.clear();
				for (const item of rawItems) {
					if (item && typeof item === 'object' && Object.hasOwn(item, 'key') && Object.hasOwn(item, 'value')) {
						const record = item as { key: IDBValidKey; value: unknown };
						store.put(record.value, record.key);
					}
				}
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	}
}

/**
 * Per-plugin key-value containers (`plugins/<id>.db` on the server, `miyapad-plugin-<id>` in
 * standalone mode). Each namespace prefixes its keys with `<ns>/<key>`, so `miyapad.db('')`
 * (`miyapad.storage`, stored under `/<key>`) and `miyapad.db(name)` (`<name>/<key>`) never collide.
 */
export class PluginDatabase {
	readonly #serverEndpoint?: string;
	readonly #onContainerError?: (id: string, error: PluginContainerError) => void;
	#queues = new Map<string, Promise<unknown>>();
	#idbCache = new Map<string, IDBDatabase>();

	constructor(options: PluginDatabaseOptions = {}) {
		this.#serverEndpoint = options.serverEndpoint;
		this.#onContainerError = options.onContainerError;
	}

	#enqueue<T>(id: string, work: () => Promise<T>): Promise<T> {
		const prev = this.#queues.get(id) ?? Promise.resolve();
		const run = prev.then(work, work);
		this.#queues.set(id, run.then(() => undefined, () => undefined));
		return run;
	}

	#reportUnreadable(id: string, err: PluginContainerError): never {
		this.#onContainerError?.(id, err);
		throw err;
	}

	async #openIdb(id: string, createIfMissing: boolean): Promise<IDBDatabase | null> {
		const cached = this.#idbCache.get(id);
		if (cached) return cached;

		const dbName = `${PLUGIN_DB_PREFIX}${id}`;
		if (!createIfMissing && !(await idbDatabaseExists(dbName))) {
			return null;
		}

		try {
			const db = await openPluginIdbRaw(id, createIfMissing);
			if (!db) return null;
			db.onversionchange = () => {
				db.close();
				if (this.#idbCache.get(id) === db) {
					this.#idbCache.delete(id);
				}
			};
			this.#idbCache.set(id, db);
			return db;
		} catch (e) {
			const containerErr = e instanceof PluginContainerError
				? e
				: new PluginContainerError(id, `Container "${id}" could not be opened: ${String(e)}`);
			this.#reportUnreadable(id, containerErr);
		}
	}

	async #postServer<T>(id: string, route: string, body: Record<string, unknown>): Promise<T> {
		const url = new URL(route, this.#serverEndpoint).toString();
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		let payload: { ok?: boolean; unreadable?: boolean; message?: string } & T;
		try {
			payload = await res.json();
		} catch {
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			throw new Error('Invalid response from server');
		}
		if (!res.ok || payload.ok === false) {
			const msg = payload.message ?? `${res.status} ${res.statusText}`;
			if (payload.unreadable) {
				this.#reportUnreadable(id, new PluginContainerError(id, msg));
			}
			throw new Error(msg);
		}
		return payload;
	}

	dbFor(id: string, name: string): PluginDbNamespace {
		if (!isValidPluginId(id)) {
			throw new TypeError(`miyapad.db: invalid plugin id "${String(id)}"`);
		}
		if (!isValidPluginNamespace(name)) {
			throw new TypeError(`miyapad.db: namespace "${String(name)}" must match /^[a-z0-9_-]{1,32}$/`);
		}
		const nsPrefix = `${name}/`;

		return {
			get: rawKey => {
				const key = String(rawKey);
				return this.#enqueue(id, async () => {
					if (this.#serverEndpoint) {
						const res = await this.#postServer<{ value?: unknown }>(id, '/plugin-db/get', { id, ns: name, key });
						return res.value;
					}
					const db = await this.#openIdb(id, false);
					if (!db) return undefined;
					return new Promise<unknown>((resolve, reject) => {
						const tx = db.transaction(PLUGIN_KV_STORE, 'readonly');
						const req = tx.objectStore(PLUGIN_KV_STORE).get(`${nsPrefix}${key}`);
						req.onsuccess = () => resolve(req.result);
						req.onerror = () => reject(req.error);
					});
				});
			},

			set: async (rawKey, value) => {
				const key = String(rawKey);
				const json = JSON.stringify(value);
				if (json === undefined) {
					throw new TypeError(`miyapad.db.set: the value for "${key}" can't be converted to JSON`);
				}
				const cloned = JSON.parse(json);
				return this.#enqueue(id, async () => {
					if (this.#serverEndpoint) {
						await this.#postServer(id, '/plugin-db/set', { id, ns: name, key, value: cloned });
						return;
					}
					const db = (await this.#openIdb(id, true))!;
					await new Promise<void>((resolve, reject) => {
						const tx = db.transaction(PLUGIN_KV_STORE, 'readwrite');
						tx.objectStore(PLUGIN_KV_STORE).put(cloned, `${nsPrefix}${key}`);
						tx.oncomplete = () => resolve();
						tx.onerror = () => reject(tx.error);
					});
				});
			},

			delete: rawKey => {
				const key = String(rawKey);
				return this.#enqueue(id, async () => {
					if (this.#serverEndpoint) {
						await this.#postServer(id, '/plugin-db/delete', { id, ns: name, key });
						return;
					}
					const db = await this.#openIdb(id, false);
					if (!db) return;
					await new Promise<void>((resolve, reject) => {
						const tx = db.transaction(PLUGIN_KV_STORE, 'readwrite');
						tx.objectStore(PLUGIN_KV_STORE).delete(`${nsPrefix}${key}`);
						tx.oncomplete = () => resolve();
						tx.onerror = () => reject(tx.error);
					});
				});
			},

			keys: (rawPrefix?: string) => {
				const prefix = rawPrefix === undefined ? '' : String(rawPrefix);
				return this.#enqueue(id, async () => {
					if (this.#serverEndpoint) {
						const res = await this.#postServer<{ keys: string[] }>(id, '/plugin-db/keys', { id, ns: name, prefix });
						return res.keys;
					}
					const db = await this.#openIdb(id, false);
					if (!db) return [];
					const fullPrefix = `${nsPrefix}${prefix}`;
					return new Promise<string[]>((resolve, reject) => {
						const tx = db.transaction(PLUGIN_KV_STORE, 'readonly');
						const store = tx.objectStore(PLUGIN_KV_STORE);
						const matched: string[] = [];
						const range = typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.lowerBound(fullPrefix) : undefined;
						const req = store.openKeyCursor(range);
						req.onsuccess = () => {
							const cursor = req.result;
							if (!cursor) {
								resolve(matched);
								return;
							}
							if (typeof cursor.key !== 'string' || cursor.key < fullPrefix) {
								cursor.continue();
								return;
							}
							if (!cursor.key.startsWith(fullPrefix)) {
								resolve(matched);
								return;
							}
							matched.push(cursor.key.slice(nsPrefix.length));
							cursor.continue();
						};
						req.onerror = () => reject(req.error);
					});
				});
			},

			clear: () => this.#enqueue(id, async () => {
				if (this.#serverEndpoint) {
					await this.#postServer(id, '/plugin-db/clear', { id, ns: name });
					return;
				}
				const db = await this.#openIdb(id, false);
				if (!db) return;
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction(PLUGIN_KV_STORE, 'readwrite');
					const store = tx.objectStore(PLUGIN_KV_STORE);
					const range = typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.lowerBound(nsPrefix) : undefined;
					const req = store.openCursor(range);
					req.onsuccess = () => {
						const cursor = req.result;
						if (!cursor) return;
						if (typeof cursor.key !== 'string' || cursor.key < nsPrefix) {
							cursor.continue();
							return;
						}
						if (!cursor.key.startsWith(nsPrefix)) {
							return;
						}
						cursor.delete();
						cursor.continue();
					};
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				});
			}),
		};
	}

	/** Deletes the plugin's entire container (`plugins/<id>.db` or `miyapad-plugin-<id>`). */
	deleteContainer(id: string): Promise<void> {
		if (!isValidPluginId(id)) return Promise.resolve();
		return this.#enqueue(id, async () => {
			if (this.#serverEndpoint) {
				await this.#postServer(id, '/plugin-db/drop', { id });
				return;
			}
			const cached = this.#idbCache.get(id);
			if (cached) {
				this.#idbCache.delete(id);
				cached.close();
			}
			await new Promise<void>((resolve, reject) => {
				const req = indexedDB.deleteDatabase(`${PLUGIN_DB_PREFIX}${id}`);
				req.onsuccess = () => resolve();
				req.onerror = () => reject(req.error);
				req.onblocked = () => resolve();
			});
		});
	}

	closeAll(): void {
		for (const db of this.#idbCache.values()) {
			db.close();
		}
		this.#idbCache.clear();
	}
}
