import type { Express, Request, Response } from 'express';
import type { Database } from 'sqlite3';
import { getColumnName, normalizeStoreName } from '../lib/utils.js';

export default function(app: Express, db: Database): void {
    app.post('/load', (req: Request, res: Response) => {
        const { storeName, key } = req.body as { storeName: string; key: string };
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }
        const colName = getColumnName(normStoreName);
        db.get(`SELECT ${colName} AS data FROM ${normStoreName} WHERE key = ?`, [key], async (err, row: { data: Buffer | string } | undefined) => {
            if (err) {
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
    });

    app.post('/save', async (req: Request, res: Response) => {
        const { storeName, key, data } = req.body as { storeName: string; key: string; data: any };
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }

        try {
            let dataToStore: string;
            if (normStoreName !== "names") {
                dataToStore = JSON.stringify(data);
            } else {
                dataToStore = typeof data === 'object' ? JSON.stringify(data) : data;
            }

            const colName = getColumnName(normStoreName);
            db.run(`INSERT OR REPLACE INTO ${normStoreName} (key, ${colName}) VALUES (?, ?)`, [key, dataToStore], (err) => {
                if (err) {
                    res.status(500).json({ ok: false, message: 'Error writing to the database' });
                } else {
                    res.json({ ok: true, result: 'Data saved successfully' });
                }
            });
        } catch (e) {
            res.status(500).json({ ok: false, message: 'Failed to save data.' });
        }
    });

    app.post('/rename', (req: Request, res: Response) => {
        const { storeName, key, newName } = req.body as { storeName: string; key: string; newName: string };
        const normStoreName = normalizeStoreName(storeName);
        if (normStoreName !== 'sessions') {
            return res.status(400).json({ ok: false, message: 'Renaming is only supported for sessions' });
        }
        db.get(`SELECT data FROM names WHERE key = ?`, [key], (err, row: { data: string } | undefined) => {
            if (err) {
                return res.status(500).json({ ok: false, message: 'Error querying the database' });
            }
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
            db.run(
                `UPDATE names SET data = ? WHERE key = ?`,
                [JSON.stringify(nameData), key],
                (err) => {
                    if (err) {
                        res.status(500).json({ ok: false, message: 'Error updating the database' });
                    } else {
                        res.json({ ok: true, result: 'Session renamed successfully' });
                    }
                }
            );
        });
    });

    app.post('/all', (req: Request, res: Response) => {
        const { storeName } = req.body as { storeName: string };
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }
        const colName = getColumnName(normStoreName);
        db.all(`SELECT key, ${colName} AS data FROM ${normStoreName}`, [], async (err, rows: { key: string; data: Buffer | string }[]) => {
            if (err) {
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
    });

    app.post('/sessions', (req: Request, res: Response) => {
        db.all(
            `
            SELECT key, data AS name
            FROM names
            `,
            [],
            (err, rows: { key: string; name: string }[]) => {
                if (err) {
                    res.status(500).json({ ok: false, message: 'Error querying the database' });
                } else {
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
                }
            }
        );
    });

    app.post('/delete', (req: Request, res: Response) => {
        const { storeName, key } = req.body as { storeName: string; key: string };
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            db.run(`DELETE FROM ${normStoreName} WHERE key = ?`, [key]);

            if (normStoreName === 'sessions') {
                db.run(`DELETE FROM names WHERE key = ?`, [key]);
            }

            db.run("COMMIT", (err) => {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ ok: false, message: 'Error deleting from the database' });
                }
                res.json({ ok: true, result: 'Session deleted successfully' });
            });
        });
    });

    app.post('/batch', (req: Request, res: Response) => {
        const { storeName, ops } = req.body as { storeName: string; ops: { type: 'save' | 'delete'; key: string; data?: any }[] };
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
            if (op.key === undefined || op.key === null || (typeof op.key !== 'string' && typeof op.key !== 'number')) {
                return res.status(400).json({ ok: false, message: 'Missing key in operation' });
            }
            if (op.type === 'save' && !Object.hasOwn(op, 'data')) {
                return res.status(400).json({ ok: false, message: 'Missing data in save operation' });
            }
        }

        db.serialize(() => {
            db.run("BEGIN TRANSACTION", (err) => {
                if (err) {
                    return res.status(500).json({ ok: false, message: 'Transaction begin failed' });
                }

                let i = 0;
                function next() {
                    if (i >= ops.length) {
                        db.run("COMMIT", (err) => {
                            if (err) {
                                db.run("ROLLBACK");
                                return res.status(500).json({ ok: false, message: 'Batch operation failed' });
                            }
                            res.json({ ok: true, result: 'Batch completed' });
                        });
                        return;
                    }

                    const op = ops[i++];
                    if (op.type === 'save') {
                        const dataToStore = normStoreName !== 'names' ? JSON.stringify(op.data) : op.data;
                        db.run(`INSERT OR REPLACE INTO ${normStoreName} (key, ${colName}) VALUES (?, ?)`, [op.key, dataToStore], (err) => {
                            if (err) {
                                db.run("ROLLBACK");
                                return res.status(500).json({ ok: false, message: 'Batch operation failed' });
                            }
                            next();
                        });
                    } else {
                        db.run(`DELETE FROM ${normStoreName} WHERE key = ?`, [op.key], (err) => {
                            if (err) {
                                db.run("ROLLBACK");
                                return res.status(500).json({ ok: false, message: 'Batch operation failed' });
                            }
                            next();
                        });
                    }
                }

                next();
            });
        });
    });
};
