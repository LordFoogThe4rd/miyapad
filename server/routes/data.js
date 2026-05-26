const { getColumnName, normalizeStoreName } = require('../lib/utils');

module.exports = function(app, db) {
    app.post('/load', (req, res) => {
        const { storeName, key } = req.body;
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }
        const colName = getColumnName(normStoreName);
        db.get(`SELECT ${colName} AS data FROM ${normStoreName} WHERE key = ?`, [key], async (err, row) => {
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
                    let parsedResult = row.data;
                    try {
                        const parsed = JSON.parse(row.data);
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

    app.post('/save', async (req, res) => {
        const { storeName, key, data } = req.body;
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }

        try {
            let dataToStore;
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

    app.post('/rename', (req, res) => {
        const { storeName, key, newName } = req.body;
        const normStoreName = normalizeStoreName(storeName);
        if (normStoreName !== 'sessions') {
            return res.status(400).json({ ok: false, message: 'Renaming is only supported for sessions' });
        }
        db.get(`SELECT data FROM names WHERE key = ?`, [key], (err, row) => {
            if (err) {
                return res.status(500).json({ ok: false, message: 'Error querying the database' });
            }
            let nameData;
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

    app.post('/all', (req, res) => {
        const { storeName } = req.body;
        const normStoreName = normalizeStoreName(storeName);
        if (!normStoreName) {
            return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
        }
        const colName = getColumnName(normStoreName);
        db.all(`SELECT key, ${colName} AS data FROM ${normStoreName}`, [], async (err, rows) => {
            if (err) {
                return res.status(500).json({ ok: false, message: 'Error querying the database' });
            }

            try {
                const all = {};
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

    app.post('/sessions', (req, res) => {
        db.all(
            `
            SELECT key, data AS name
            FROM names
            `,
            [],
            (err, rows) => {
                if (err) {
                    res.status(500).json({ ok: false, message: 'Error querying the database' });
                } else {
                    const sessions = {};
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

    app.post('/delete', (req, res) => {
        const { storeName, key } = req.body;
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
};
