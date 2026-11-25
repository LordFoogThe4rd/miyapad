import fs from 'fs';
import path from 'path';
import { DatabaseSync, constants } from 'node:sqlite';

export const MAX_SQL_BYTES = 100 * 1024;
export const MAX_PARAMS = 100;
export const MAX_ROWS = 5_000;
export const MAX_RESULT_BYTES = 5 * 1024 * 1024;

export interface WorkerQueryRequest {
    reqId: number;
    sql: string;
    params: (string | number | boolean | null)[];
    mode: 'query' | 'exec';
}

export interface WorkerQueryResponse {
    reqId: number;
    ok: boolean;
    rows?: Record<string, unknown>[];
    status?: 400 | 500;
    unreadable?: boolean;
    message?: string;
}

function isSqliteCorrupt(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const code = (err as { errcode?: number }).errcode;
    if (code === 11 || code === 26) return true;
    const msg = (err as { message?: string }).message ?? '';
    return /not a database|malformed|corrupt|file is encrypted/i.test(msg);
}

/**
 * Strips SQL string literals and comments so keyword checks don't false-positive on
 * quoted text like `SELECT 'vacuum'` while still catching `VACUUM` / `VACUUM INTO`.
 */
export function containsVacuumKeyword(sql: string): boolean {
    const stripped = sql
        .replace(/'(?:''|[^'])*'/g, "''")
        .replace(/"(?:""|[^"])*"/g, '""')
        .replace(/--[^\r\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ');
    return /\bVACUUM\b/i.test(stripped);
}

function normalizeParam(value: string | number | boolean | null): string | number | null {
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
}

function openAuthorizedDatabase(filePath: string): DatabaseSync {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const db = new DatabaseSync(filePath, { allowExtension: false });
    try {
        db.enableDefensive(true);
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA busy_timeout = 1000');
        db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BLOB)');
        db.setAuthorizer((actionCode, arg1, arg2) => {
            if (
                actionCode === constants.SQLITE_ATTACH
                || actionCode === constants.SQLITE_DETACH
                || actionCode === constants.SQLITE_PRAGMA
            ) {
                return constants.SQLITE_DENY;
            }
            if (
                actionCode === constants.SQLITE_FUNCTION
                && (
                    (typeof arg2 === 'string' && arg2.toLowerCase() === 'load_extension')
                    || (typeof arg1 === 'string' && arg1.toLowerCase() === 'load_extension')
                )
            ) {
                return constants.SQLITE_DENY;
            }
            return constants.SQLITE_OK;
        });
        return db;
    } catch (err) {
        try { db.close(); } catch { /* ignore */ }
        throw err;
    }
}

function runWorkerEntry(): void {
    const filePath = process.env.MIYAPAD_PLUGIN_DB_PATH;
    const id = process.env.MIYAPAD_PLUGIN_DB_ID;
    if (!process.send || !filePath || !id) return;

    const send = (res: WorkerQueryResponse): void => {
        process.send?.(res);
    };

    let db: DatabaseSync | null = null;

    const getDb = (): DatabaseSync => {
        if (db) return db;
        db = openAuthorizedDatabase(filePath);
        return db;
    };

    const closeDb = (): void => {
        if (!db) return;
        try { db.close(); } catch { /* ignore */ }
        db = null;
    };

    process.on('message', (msg: WorkerQueryRequest) => {
        const { reqId, sql, params, mode } = msg;
        try {
            if (typeof sql !== 'string' || sql.trim().length === 0) {
                send({ reqId, ok: false, status: 400, message: 'Missing sql' });
                return;
            }
            if (Buffer.byteLength(sql, 'utf8') > MAX_SQL_BYTES) {
                send({ reqId, ok: false, status: 400, message: 'SQL exceeds the 100 KB limit' });
                return;
            }
            if (params.length > MAX_PARAMS) {
                send({ reqId, ok: false, status: 400, message: 'Too many parameters (max 100)' });
                return;
            }
            if (containsVacuumKeyword(sql)) {
                send({ reqId, ok: false, status: 500, message: 'VACUUM is not allowed in plugin SQL' });
                return;
            }

            const conn = getDb();
            const bound = params.map(normalizeParam);

            if (mode === 'exec') {
                if (bound.length > 0) {
                    conn.prepare(sql).run(...bound);
                } else {
                    conn.exec(sql);
                }
                send({ reqId, ok: true });
                return;
            }

            const stmt = conn.prepare(sql);
            const rows: Record<string, unknown>[] = [];
            let totalBytes = 2; // opening and closing JSON array brackets

            for (const rawRow of stmt.iterate(...bound)) {
                if (rows.length >= MAX_ROWS) {
                    send({
                        reqId,
                        ok: false,
                        status: 500,
                        message: `Query exceeded the ${MAX_ROWS.toLocaleString('en-US')} row limit`,
                    });
                    return;
                }
                const plain = Object.assign({}, rawRow) as Record<string, unknown>;
                const serialized = JSON.stringify(plain);
                totalBytes += Buffer.byteLength(serialized, 'utf8') + (rows.length > 0 ? 1 : 0);
                if (totalBytes > MAX_RESULT_BYTES) {
                    send({
                        reqId,
                        ok: false,
                        status: 500,
                        message: 'Query result exceeded the 5 MB limit',
                    });
                    return;
                }
                rows.push(plain);
            }

            send({ reqId, ok: true, rows });
        } catch (err) {
            if (isSqliteCorrupt(err)) {
                closeDb();
                send({
                    reqId,
                    ok: false,
                    status: 500,
                    unreadable: true,
                    message: `Container "${id}" is unreadable: ${(err as Error).message}`,
                });
                return;
            }
            send({
                reqId,
                ok: false,
                status: 500,
                message: (err as Error).message || 'SQL query failed',
            });
        }
    });

    process.on('disconnect', () => {
        closeDb();
        process.exit(0);
    });
}

runWorkerEntry();
