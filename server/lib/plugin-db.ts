import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NAMESPACE_RE = /^[a-z0-9_-]{1,32}$/;

export const isValidPluginId = (id: unknown): id is string =>
    typeof id === 'string' && PLUGIN_ID_RE.test(id);

export const isValidNamespace = (ns: unknown): ns is string =>
    typeof ns === 'string' && (ns === '' || NAMESPACE_RE.test(ns));

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

const isSqliteCorrupt = (err: unknown): boolean => {
    if (!err || typeof err !== 'object') return false;
    const code = (err as { errcode?: number }).errcode;
    if (code === 11 || code === 26) return true;
    const msg = (err as { message?: string }).message ?? '';
    return /not a database|malformed|corrupt|file is encrypted/i.test(msg);
};

export class PluginDbManager {
    readonly dir: string;
    #open = new Map<string, DatabaseSync>();

    constructor(pluginsDir: string) {
        this.dir = path.resolve(pluginsDir);
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

    deleteContainer(id: string): void {
        const filePath = this.#filePath(id);
        const cached = this.#open.get(id);
        if (cached) {
            this.#open.delete(id);
            try { cached.close(); } catch { /* ignore */ }
        }
        for (const suffix of ['', '-wal', '-shm']) {
            fs.rmSync(filePath + suffix, { force: true });
        }
    }

    closeAll(): void {
        for (const db of this.#open.values()) {
            try { db.close(); } catch { /* ignore */ }
        }
        this.#open.clear();
    }
}
