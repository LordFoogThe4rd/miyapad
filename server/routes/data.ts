import type { Express, Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import { getColumnName, normalizeStoreName } from '../lib/utils.js';

// better-sqlite3 binds every JS number as REAL, and the TEXT key column then stores or compares
// it as "81.0" — so numeric session ids would miss their existing "81" rows. Bind strings only.
const toKey = (key: unknown): string | null =>
    typeof key === 'string' || typeof key === 'number' ? String(key) : null;

export default function(app: Express, db: Database): void {
    app.post('/load', (req: Request, res: Response) => {
        const { storeName } = req.body as { storeName: string };
        const key = toKey(req.body.key);
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }
        if (key === null) {
            return res.status(400).json({ ok: false, message: 'Missing key' });
        }
        const colName = getColumnName(normStoreName);
        let row: { data: Buffer | string } | undefined;
        try {
            row = db.prepare(`SELECT ${colName} AS data FROM ${normStoreName} WHERE key = ?`).get(key) as typeof row;
        } catch {
            return res.status(500).json({ ok: false, message: 'Error querying the database' });
        }
        if (!row) {
            return res.status(404).json({ ok: false, message: 'Key not found' });
        }

        try {
            if (normStoreName !== "names") {
                const plainText = typeof row.data === 'string' ? row.data : row.data.toString();
                res.json({ ok: true, result: JSON.parse(plainText) });
            } else {
                const rowData = typeof row.data === 'string' ? row.data : row.data.toString();
                let parsedResult = rowData;
                try {
                    const parsed = JSON.parse(rowData);
                    if (parsed && typeof parsed === 'object' && parsed.name !== undefined) {
                        parsedResult = parsed;
                    }
                } catch {
                    // Ignore, legacy string
                }
                res.json({ ok: true, result: parsedResult });
            }
        } catch (e) {
            res.status(500).json({ ok: false, message: 'Failed to parse data.' });
        }
    });

    app.post('/save', (req: Request, res: Response) => {
        const { storeName, data } = req.body as { storeName: string; data: any };
        const key = toKey(req.body.key);
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }
        if (key === null) {
            return res.status(400).json({ ok: false, message: 'Missing key' });
        }

        try {
            let dataToStore: string;
            if (normStoreName !== "names") {
                dataToStore = JSON.stringify(data);
            } else {
                dataToStore = typeof data === 'object' ? JSON.stringify(data) : data;
            }

            const colName = getColumnName(normStoreName);
            db.prepare(`INSERT OR REPLACE INTO ${normStoreName} (key, ${colName}) VALUES (?, ?)`).run(key, dataToStore);
            res.json({ ok: true, result: 'Data saved successfully' });
        } catch (e) {
            res.status(500).json({ ok: false, message: 'Error writing to the database' });
        }
    });

    app.post('/rename', (req: Request, res: Response) => {
        const { storeName, newName } = req.body as { storeName: string; newName: string };
        const key = toKey(req.body.key);
        const normStoreName = normalizeStoreName(storeName);
        if (normStoreName !== 'sessions') {
            return res.status(400).json({ ok: false, message: 'Renaming is only supported for sessions' });
        }
        if (key === null) {
            return res.status(400).json({ ok: false, message: 'Missing key' });
        }
        try {
            const row = db.prepare(`SELECT data FROM names WHERE key = ?`).get(key) as { data: string } | undefined;
            let nameData: { name: string; created: number | null; modified: number };
            if (row && row.data) {
                try {
                    const parsed = JSON.parse(row.data);
                    if (parsed && typeof parsed === 'object' && parsed.name !== undefined) {
                        nameData = { ...parsed, name: newName, modified: Date.now() };
                    } else {
                        nameData = { name: newName, created: null, modified: Date.now() };
                    }
                } catch {
                    nameData = { name: newName, created: null, modified: Date.now() };
                }
            } else {
                nameData = { name: newName, created: null, modified: Date.now() };
            }
            db.prepare(`UPDATE names SET data = ? WHERE key = ?`).run(JSON.stringify(nameData), key);
            res.json({ ok: true, result: 'Session renamed successfully' });
        } catch {
            res.status(500).json({ ok: false, message: 'Error updating the database' });
        }
    });

    app.post('/all', (req: Request, res: Response) => {
        const { storeName } = req.body as { storeName: string };
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }
        const colName = getColumnName(normStoreName);
        let rows: { key: string; data: Buffer | string }[];
        try {
            rows = db.prepare(`SELECT key, ${colName} AS data FROM ${normStoreName}`).all() as typeof rows;
        } catch {
            return res.status(500).json({ ok: false, message: 'Error querying the database' });
        }

        try {
            const all: Record<string, any> = {};
            if (normStoreName !== "names") {
                rows.forEach((row) => {
                    const plainText = typeof row.data === 'string' ? row.data : row.data.toString();
                    all[row.key] = JSON.parse(plainText);
                });
            } else {
                rows.forEach((row) => {
                    all[row.key] = row.data;
                });
            }
            res.json({ ok: true, result: all });
        } catch (e) {
            res.status(500).json({ ok: false, message: 'Failed to parse data for one or more items.' });
        }
    });

    app.post('/sessions', (req: Request, res: Response) => {
        let rows: { key: string; name: string }[];
        try {
            rows = db.prepare(`SELECT key, data AS name FROM names`).all() as typeof rows;
        } catch {
            return res.status(500).json({ ok: false, message: 'Error querying the database' });
        }
        const sessions: Record<string, any> = {};
        rows.forEach((row) => {
            try {
                const parsed = JSON.parse(row.name);
                if (parsed && typeof parsed === 'object' && parsed.name !== undefined) {
                    sessions[row.key] = parsed;
                } else {
                    sessions[row.key] = row.name;
                }
            } catch {
                sessions[row.key] = row.name;
            }
        });
        res.json({ ok: true, result: sessions });
    });

    app.post('/delete', (req: Request, res: Response) => {
        const { storeName } = req.body as { storeName: string };
        const key = toKey(req.body.key);
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }
        if (key === null) {
            return res.status(400).json({ ok: false, message: 'Missing key' });
        }
        try {
            db.transaction(() => {
                db.prepare(`DELETE FROM ${normStoreName} WHERE key = ?`).run(key);
                if (normStoreName === 'sessions') {
                    db.prepare(`DELETE FROM names WHERE key = ?`).run(key);
                }
            })();
            res.json({ ok: true, result: 'Session deleted successfully' });
        } catch {
            res.status(500).json({ ok: false, message: 'Error deleting from the database' });
        }
    });

    app.post('/batch', (req: Request, res: Response) => {
        const { storeName, ops } = req.body as { storeName: string; ops: { type: 'save' | 'delete'; key: string | number; data?: any }[] };
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }
        if (!Array.isArray(ops) || ops.length === 0) {
            return res.status(400).json({ ok: false, message: 'ops must be a non-empty array' });
        }

        const colName = getColumnName(normStoreName);

        for (const op of ops) {
            if (!op || typeof op !== 'object' || (op.type !== 'save' && op.type !== 'delete')) {
                return res.status(400).json({ ok: false, message: `Unknown operation type: ${op?.type}` });
            }
            if (toKey(op.key) === null) {
                return res.status(400).json({ ok: false, message: 'Missing key in operation' });
            }
            if (op.type === 'save' && !Object.hasOwn(op, 'data')) {
                return res.status(400).json({ ok: false, message: 'Missing data in save operation' });
            }
        }

        try {
            const save = db.prepare(`INSERT OR REPLACE INTO ${normStoreName} (key, ${colName}) VALUES (?, ?)`);
            const remove = db.prepare(`DELETE FROM ${normStoreName} WHERE key = ?`);
            db.transaction(() => {
                for (const op of ops) {
                    if (op.type === 'save') {
                        save.run(toKey(op.key), normStoreName !== 'names' ? JSON.stringify(op.data) : op.data);
                    } else {
                        remove.run(toKey(op.key));
                    }
                }
            })();
            res.json({ ok: true, result: 'Batch completed' });
        } catch {
            res.status(500).json({ ok: false, message: 'Batch operation failed' });
        }
    });
};
