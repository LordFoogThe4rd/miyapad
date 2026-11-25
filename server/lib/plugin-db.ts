import fs from 'fs';
import path from 'path';
import { fork, type ChildProcess } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import { basedir } from './paths.js';
import {
    MAX_PARAMS,
    MAX_SQL_BYTES,
    type WorkerQueryRequest,
    type WorkerQueryResponse,
} from './plugin-db-worker.js';

export { MAX_PARAMS, MAX_SQL_BYTES };
export const DEFAULT_QUERY_TIMEOUT_MS = 2_000;

export type SqlParam = string | number | boolean | null;
export type SqlQueryMode = 'query' | 'exec';

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NAMESPACE_RE = /^[a-z0-9_-]{1,32}$/;

export const isValidPluginId = (id: unknown): id is string =>
    typeof id === 'string' && PLUGIN_ID_RE.test(id);

export const isValidNamespace = (ns: unknown): ns is string =>
    typeof ns === 'string' && (ns === '' || NAMESPACE_RE.test(ns));

export const isValidSqlParam = (value: unknown): value is SqlParam =>
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));

export const escapeLikePrefix = (prefix: string): string =>
    prefix.replace(/[\\%_]/g, '\\$&');

export class PluginContainerError extends Error {
    readonly pluginId: string;

    constructor(pluginId: string, message: string) {
        super(message);
        this.name = 'PluginContainerError';
        this.pluginId = pluginId;
    }
}

export class PluginQueryInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PluginQueryInputError';
    }
}

interface WorkerSlot {
    worker: ChildProcess | null;
    queue: Promise<unknown>;
    nextReqId: number;
    terminating: Set<Promise<unknown>>;
}

export interface PluginDbManagerOptions {
    queryTimeoutMs?: number;
    workerPath?: string;
}

function resolveDefaultWorkerPath(): string {
    const bundled = path.join(basedir, 'plugin-db-worker.cjs');
    if (fs.existsSync(bundled)) return bundled;
    return path.join(basedir, 'plugin-db-worker.ts');
}

const isSqliteCorrupt = (err: unknown): boolean => {
    if (!err || typeof err !== 'object') return false;
    const code = (err as { errcode?: number }).errcode;
    if (code === 11 || code === 26) return true;
    const msg = (err as { message?: string }).message ?? '';
    return /not a database|malformed|corrupt|file is encrypted/i.test(msg);
};

export class PluginDbManager {
    readonly dir: string;
    readonly #queryTimeoutMs: number;
    readonly #workerPath: string;
    #open = new Map<string, DatabaseSync>();
    #workers = new Map<string, WorkerSlot>();

    constructor(pluginsDir: string, options: PluginDbManagerOptions = {}) {
        this.dir = path.resolve(pluginsDir);
        this.#queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
        this.#workerPath = options.workerPath ?? resolveDefaultWorkerPath();
    }

    #filePath(id: string): string {
        if (!isValidPluginId(id)) {
            throw new Error(`Invalid plugin id "${String(id)}"`);
        }
        const resolved = path.resolve(this.dir, `${id}.db`);
        if (path.dirname(resolved) !== this.dir) {
            throw new Error(`Invalid plugin id "${id}"`);
        }
        return resolved;
    }

    #getConnection(id: string, createIfMissing: boolean): DatabaseSync | null {
        const filePath = this.#filePath(id);
        const cached = this.#open.get(id);
        if (cached) return cached;
        if (!createIfMissing && !fs.existsSync(filePath)) {
            return null;
        }

        let db: DatabaseSync | undefined;
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            db = new DatabaseSync(filePath, { allowExtension: false });
            db.enableDefensive(true);
            db.exec('PRAGMA journal_mode = WAL');
            db.exec('PRAGMA case_sensitive_like = ON');
            db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BLOB)');
            this.#open.set(id, db);
            return db;
        } catch (err) {
            try { db?.close(); } catch { /* ignore */ }
            throw new PluginContainerError(id, `Container "${id}" could not be opened: ${(err as Error).message}`);
        }
    }

    #rethrow(id: string, err: unknown): never {
        if (err instanceof PluginContainerError) throw err;
        if (isSqliteCorrupt(err)) {
            const cached = this.#open.get(id);
            if (cached) {
                this.#open.delete(id);
                try { cached.close(); } catch { /* ignore */ }
            }
            throw new PluginContainerError(id, `Container "${id}" is unreadable: ${(err as Error).message}`);
        }
        throw err;
    }

    get(id: string, ns: string, key: string): unknown {
        if (!isValidNamespace(ns)) throw new Error('Invalid namespace');
        const db = this.#getConnection(id, false);
        if (!db) return undefined;
        try {
            const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(`${ns}/${key}`) as { value: Uint8Array | string | null } | undefined;
            if (!row || row.value === null || row.value === undefined) return undefined;
            const text = typeof row.value === 'string' ? row.value : Buffer.from(row.value).toString('utf8');
            try {
                return JSON.parse(text);
            } catch (parseErr) {
                throw new PluginContainerError(id, `Container "${id}" has corrupt JSON for key "${key}": ${(parseErr as Error).message}`);
            }
        } catch (err) {
            this.#rethrow(id, err);
        }
    }

    set(id: string, ns: string, key: string, value: unknown): void {
        if (!isValidNamespace(ns)) throw new Error('Invalid namespace');
        const json = JSON.stringify(value);
        if (json === undefined) {
            throw new TypeError(`Value for "${key}" cannot be converted to JSON`);
        }
        const db = this.#getConnection(id, true)!;
        try {
            db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(`${ns}/${key}`, Buffer.from(json, 'utf8'));
        } catch (err) {
            this.#rethrow(id, err);
        }
    }

    delete(id: string, ns: string, key: string): void {
        if (!isValidNamespace(ns)) throw new Error('Invalid namespace');
        const db = this.#getConnection(id, false);
        if (!db) return;
        try {
            db.prepare('DELETE FROM kv WHERE key = ?').run(`${ns}/${key}`);
        } catch (err) {
            this.#rethrow(id, err);
        }
    }

    keys(id: string, ns: string, prefix = ''): string[] {
        if (!isValidNamespace(ns)) throw new Error('Invalid namespace');
        const db = this.#getConnection(id, false);
        if (!db) return [];
        const nsPrefix = `${ns}/`;
        const fullPrefix = `${nsPrefix}${prefix}`;
        const pattern = `${escapeLikePrefix(fullPrefix)}%`;
        try {
            const rows = db.prepare("SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\' ORDER BY key").all(pattern) as { key: string }[];
            return rows.filter(r => r.key.startsWith(fullPrefix)).map(r => r.key.slice(nsPrefix.length));
        } catch (err) {
            this.#rethrow(id, err);
        }
    }

    clear(id: string, ns: string): void {
        if (!isValidNamespace(ns)) throw new Error('Invalid namespace');
        const db = this.#getConnection(id, false);
        if (!db) return;
        const pattern = `${escapeLikePrefix(`${ns}/`)}%`;
        try {
            db.prepare("DELETE FROM kv WHERE key LIKE ? ESCAPE '\\'").run(pattern);
        } catch (err) {
            this.#rethrow(id, err);
        }
    }

    #getWorkerSlot(id: string): WorkerSlot {
        let slot = this.#workers.get(id);
        if (!slot) {
            slot = { worker: null, queue: Promise.resolve(), nextReqId: 1, terminating: new Set() };
            this.#workers.set(id, slot);
        }
        return slot;
    }

    #trackTerminate(slot: WorkerSlot, worker: ChildProcess, force = false): Promise<unknown> {
        const p = new Promise<void>(resolve => {
            if (worker.exitCode !== null || worker.signalCode !== null) {
                resolve();
                return;
            }
            worker.once('exit', () => resolve());
            try {
                if (force) {
                    worker.kill('SIGKILL');
                } else if (worker.connected) {
                    worker.disconnect();
                } else {
                    worker.kill('SIGKILL');
                }
            } catch {
                resolve();
            }
        }).finally(() => {
            slot.terminating.delete(p);
        });
        slot.terminating.add(p);
        return p;
    }

    async #terminateWorker(id: string): Promise<void> {
        const slot = this.#workers.get(id);
        if (!slot) return;
        if (slot.worker) {
            const worker = slot.worker;
            slot.worker = null;
            this.#trackTerminate(slot, worker, false);
        }
        if (slot.terminating.size > 0) {
            await Promise.all([...slot.terminating]);
        }
    }

    #runOnWorker(
        id: string,
        filePath: string,
        sql: string,
        params: SqlParam[],
        mode: SqlQueryMode,
    ): Promise<Record<string, unknown>[] | undefined> {
        const slot = this.#getWorkerSlot(id);
        const execute = (): Promise<Record<string, unknown>[] | undefined> => new Promise((resolve, reject) => {
            let worker = slot.worker;
            if (!worker || !worker.connected || worker.exitCode !== null || worker.signalCode !== null) {
                worker = fork(this.#workerPath, [], {
                    execArgv: [],
                    env: {
                        ...process.env,
                        MIYAPAD_PLUGIN_DB_PATH: filePath,
                        MIYAPAD_PLUGIN_DB_ID: id,
                    },
                    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
                });
                slot.worker = worker;
            }

            const activeWorker = worker;
            const reqId = slot.nextReqId++;
            let settled = false;

            const cleanup = (): void => {
                clearTimeout(timer);
                activeWorker.off('message', onMessage);
                activeWorker.off('error', onError);
                activeWorker.off('exit', onExit);
            };

            const onMessage = (res: WorkerQueryResponse): void => {
                if (settled || res.reqId !== reqId) return;
                settled = true;
                cleanup();
                if (res.ok) {
                    resolve(res.rows);
                    return;
                }
                if (res.unreadable) {
                    const cached = this.#open.get(id);
                    if (cached) {
                        this.#open.delete(id);
                        try { cached.close(); } catch { /* ignore */ }
                    }
                    reject(new PluginContainerError(id, res.message || `Container "${id}" is unreadable`));
                    return;
                }
                if (res.status === 400) {
                    reject(new PluginQueryInputError(res.message || 'Invalid SQL query'));
                    return;
                }
                reject(new Error(res.message || 'SQL query failed'));
            };

            const onError = (err: Error): void => {
                if (slot.worker === activeWorker) slot.worker = null;
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error(`Plugin SQL worker failed: ${err.message}`));
            };

            const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
                if (slot.worker === activeWorker) slot.worker = null;
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error(`Plugin SQL worker exited unexpectedly (${signal ?? code ?? 'unknown'})`));
            };

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                if (slot.worker === activeWorker) slot.worker = null;
                void this.#trackTerminate(slot, activeWorker, true);
                reject(new Error(`Query timed out after ${this.#queryTimeoutMs} ms`));
            }, this.#queryTimeoutMs);

            activeWorker.on('message', onMessage);
            activeWorker.on('error', onError);
            activeWorker.on('exit', onExit);

            const req: WorkerQueryRequest = { reqId, sql, params, mode };
            activeWorker.send(req);
        });

        const next = slot.queue.then(execute, execute);
        slot.queue = next.then(() => undefined, () => undefined);
        return next;
    }

    async rawQuery(
        id: string,
        name: string,
        sql: string,
        params: unknown[] = [],
        mode: SqlQueryMode = 'query',
    ): Promise<Record<string, unknown>[] | undefined> {
        if (!isValidPluginId(id)) {
            throw new PluginQueryInputError('Invalid plugin id');
        }
        if (!isValidNamespace(name)) {
            throw new PluginQueryInputError('Invalid namespace');
        }
        if (typeof sql !== 'string' || sql.trim().length === 0) {
            throw new PluginQueryInputError('Missing sql');
        }
        if (Buffer.byteLength(sql, 'utf8') > MAX_SQL_BYTES) {
            throw new PluginQueryInputError('SQL exceeds the 100 KB limit');
        }
        if (mode !== 'query' && mode !== 'exec') {
            throw new PluginQueryInputError('Invalid mode');
        }
        if (!Array.isArray(params)) {
            throw new PluginQueryInputError('Parameters must be an array');
        }
        if (params.length > MAX_PARAMS) {
            throw new PluginQueryInputError('Too many parameters (max 100)');
        }
        const validatedParams: SqlParam[] = [];
        for (const p of params) {
            if (!isValidSqlParam(p)) {
                throw new PluginQueryInputError('Parameters must be strings, finite numbers, booleans, or null');
            }
            validatedParams.push(p);
        }
        const filePath = this.#filePath(id);
        return this.#runOnWorker(id, filePath, sql, validatedParams, mode);
    }

    async deleteContainer(id: string): Promise<void> {
        const filePath = this.#filePath(id);
        await this.#terminateWorker(id);
        this.#workers.delete(id);
        const cached = this.#open.get(id);
        if (cached) {
            this.#open.delete(id);
            try { cached.close(); } catch { /* ignore */ }
        }
        for (const suffix of ['', '-wal', '-shm']) {
            fs.rmSync(filePath + suffix, { force: true });
        }
    }

    async closeAll(): Promise<void> {
        const terminations: Promise<unknown>[] = [];
        for (const slot of this.#workers.values()) {
            if (slot.worker) {
                const worker = slot.worker;
                slot.worker = null;
                this.#trackTerminate(slot, worker);
            }
            for (const p of slot.terminating) {
                terminations.push(p);
            }
        }
        this.#workers.clear();
        for (const db of this.#open.values()) {
            try { db.close(); } catch { /* ignore */ }
        }
        this.#open.clear();
        if (terminations.length > 0) {
            await Promise.all(terminations);
        }
    }
}
