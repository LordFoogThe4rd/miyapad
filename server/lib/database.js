const sqlite3 = require('sqlite3');
const path = require('path');
const { getColumnName, compressData, decompressData } = require('./utils');
const tokenizer = require('../tokenizer');

const runMigrationToV3 = (db) => {
    return new Promise((resolve, reject) => {
        const migrationCheckSql = `
            SELECT 'migration_needed' as status
            FROM sqlite_master
            WHERE type = 'table' AND name = 'sessions'
              AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'names');
        `;

        db.get(migrationCheckSql, (err, row) => {
            if (err) {
                return reject(err);
            }

            if (row) {
                db.serialize(async () => {
                    try {
                        const migrateTable = async (tableName, processRow) => {
                            await new Promise((res, rej) => db.run(`ALTER TABLE ${tableName} RENAME TO ${tableName}_old`, (err) => err ? rej(err) : res()));
                            await new Promise((res, rej) => db.run(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, data BLOB)`, (err) => err ? rej(err) : res()));
                            const rows = await new Promise((res, rej) => db.all(`SELECT key, data FROM ${tableName}_old`, [], (err, rows) => err ? rej(err) : res(rows)));
                            for (const row of rows) {
                                await processRow(row);
                            }
                            await new Promise((res, rej) => db.run(`DROP TABLE ${tableName}_old`, (err) => err ? rej(err) : res()));
                        };

                        db.run("BEGIN TRANSACTION;");

                        await new Promise((res, rej) => db.run(`CREATE TABLE names (key TEXT PRIMARY KEY, data TEXT);`, (err) => err ? rej(err) : res()));

                        await migrateTable('sessions', async (row) => {
                            const sessionData = JSON.parse(row.data);
                            const sessionName = sessionData.name;

                            if (sessionName) {
                                await new Promise((res, rej) => db.run("INSERT INTO names (key, data) VALUES (?, ?)", [row.key, sessionName], (err) => err ? rej(err) : res()));
                                delete sessionData.name;
                            }

                            const compressedData = await compressData(JSON.stringify(sessionData));
                            await new Promise((res, rej) => db.run("INSERT INTO sessions (key, data) VALUES (?, ?)", [row.key, compressedData], (err) => err ? rej(err) : res()));
                        });

                        await migrateTable('templates', async (row) => {
                            const compressedData = await compressData(row.data);
                            await new Promise((res, rej) => db.run("INSERT INTO templates (key, data) VALUES (?, ?)", [row.key, compressedData], (err) => err ? rej(err) : res()));
                        });

                        db.run("COMMIT;", (err) => {
                            if (err) {
                                return reject(err);
                            }
                            resolve(true);
                        });

                    } catch (e) {
                        db.run("ROLLBACK;");
                        reject(e);
                    }
                });
            } else {
                resolve(false);
            }
        });
    });
};

const enableTransparentCompressionIfMissing = (db, tableName) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [`_${tableName}_zstd`], (err, row) => {
            if (err) return reject(err);
            if (row) {
                return resolve();
            }
            const colName = getColumnName(tableName);
            console.log(`Enabling transparent zstd compression for table: ${tableName} (column: ${colName})...`);
            const config = JSON.stringify({
                table: tableName,
                column: colName,
                compression_level: 3,
                dict_chooser: "'a'"
            });
            db.run(`SELECT zstd_enable_transparent(?)`, [config], (err) => {
                if (err) {
                    console.error(`Failed to enable transparent compression for ${tableName}:`, err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
};

const runMigrationToV4 = (db) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT value FROM meta WHERE key = 'version'", async (err, row) => {
            if (err) {
                return resolve(false);
            }

            const version = row ? parseInt(row.value, 10) : 1;
            if (version >= 4) {
                return resolve(false);
            }

            console.log(`Migrating database from version ${version} to 4 (sqlite-zstd transparent compression)...`);

            try {
                const migrateTableToZstd = async (tableName) => {
                    const colName = getColumnName(tableName);

                    const tableExists = await new Promise((res, rej) => {
                        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, row) => {
                            if (err) rej(err);
                            else res(!!row);
                        });
                    });

                    if (!tableExists) {
                        await new Promise((res, rej) => db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (key TEXT PRIMARY KEY, ${colName} BLOB)`, (err) => err ? rej(err) : res()));
                        return;
                    }

                    const hasOldColumnName = await new Promise((res, rej) => {
                        db.all(`PRAGMA table_info(${tableName})`, [], (err, infoRows) => {
                            if (err) return rej(err);
                            const hasOld = infoRows.some(info => info.name === 'data');
                            res(hasOld);
                        });
                    });

                    let oldColName = hasOldColumnName ? 'data' : colName;

                    const rows = await new Promise((res, rej) => {
                        db.all(`SELECT key, ${oldColName} FROM ${tableName}`, [], (err, rows) => err ? rej(err) : res(rows));
                    });

                    console.log(`Migrating ${rows.length} rows from table ${tableName}...`);

                    const decompressedRows = [];
                    for (const row of rows) {
                        let decompressed;
                        try {
                            decompressed = await decompressData(row[oldColName]);
                        } catch (e) {
                            decompressed = row[oldColName] ? row[oldColName].toString() : '';
                        }
                        decompressedRows.push({ key: row.key, data: decompressed });
                    }

                    await new Promise((res, rej) => db.run(`DROP TABLE ${tableName}`, (err) => err ? rej(err) : res()));

                    await new Promise((res, rej) => db.run(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, ${colName} BLOB)`, (err) => err ? rej(err) : res()));

                    const config = JSON.stringify({
                        table: tableName,
                        column: colName,
                        compression_level: 3,
                        dict_chooser: "'a'"
                    });
                    await new Promise((res, rej) => db.run(`SELECT zstd_enable_transparent(?)`, [config], (err) => err ? rej(err) : res()));

                    if (decompressedRows.length > 0) {
                        await new Promise((res, rej) => db.run("BEGIN TRANSACTION", (err) => err ? rej(err) : res()));
                        try {
                            for (const row of decompressedRows) {
                                await new Promise((res, rej) => db.run(`INSERT INTO ${tableName} (key, ${colName}) VALUES (?, ?)`, [row.key, row.data], (err) => err ? rej(err) : res()));
                            }
                            await new Promise((res, rej) => db.run("COMMIT", (err) => err ? rej(err) : res()));
                        } catch (insertErr) {
                            await new Promise((res) => db.run("ROLLBACK", () => res()));
                            throw insertErr;
                        }
                    }
                };

                await migrateTableToZstd('sessions');
                await migrateTableToZstd('templates');
                await migrateTableToZstd('themes');

                console.log("Running initial zstd incremental maintenance (training dictionaries)...");
                await new Promise((res, rej) => db.run(`SELECT zstd_incremental_maintenance(null, 1)`, (err) => err ? rej(err) : res()));

                resolve(true);
            } catch (e) {
                reject(e);
            }
        });
    });
};

const startBackgroundMaintenance = (db) => {
    console.log("Scheduling background zstd incremental maintenance every 5 minutes.");
    setInterval(() => {
        db.run("SELECT zstd_incremental_maintenance(null, 1)", (err) => {
            if (err) {
                console.error("Error running background zstd_incremental_maintenance:", err.message);
            }
        });
    }, 5 * 60 * 1000);
};

const configureAutoVacuum = (db) => {
    return new Promise((resolve) => {
        db.get('PRAGMA auto_vacuum', (err, row) => {
            if (err || !row || row.auto_vacuum !== 0) {
                return resolve();
            }

            console.log('Enabling SQLite auto_vacuum mode...');
            db.serialize(() => {
                db.run('PRAGMA auto_vacuum = FULL');
                db.run('VACUUM', (err) => {
                    if (err) {
                        console.error('Failed to run VACUUM for auto_vacuum:', err.message);
                    } else {
                        console.log('Database auto_vacuum enabled successfully.');
                    }
                    resolve();
                });
            });
        });
    });
};

const initDatabase = (storagePath) => {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(storagePath, (err) => {
            if (err) {
                return reject(err);
            }

            const zstdLibName = {
                'win32': 'sqlite_zstd.dll',
                'darwin': 'libsqlite_zstd.dylib',
                'linux': 'libsqlite_zstd.so'
            }[process.platform] || 'libsqlite_zstd.so';

            db.loadExtension(path.join(__dirname, '..', zstdLibName), async (err) => {
                if (err) {
                    return reject(err);
                }
                console.log('sqlite-zstd extension loaded successfully.');

                try {
                    const sessionTableExists = await new Promise((res, rej) => {
                        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (err, row) => {
                            if (err) rej(err);
                            else res(!!row);
                        });
                    });

                    const isNewDatabase = !sessionTableExists;

                    await configureAutoVacuum(db);

                    await new Promise((res, rej) => {
                        db.serialize(() => {
                            const sessionCol = getColumnName('sessions');
                            const templateCol = getColumnName('templates');
                            const themeCol = getColumnName('themes');
                            db.run(`CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, ${sessionCol} BLOB)`);
                            db.run(`CREATE TABLE IF NOT EXISTS templates (key TEXT PRIMARY KEY, ${templateCol} BLOB)`);
                            db.run(`CREATE TABLE IF NOT EXISTS themes (key TEXT PRIMARY KEY, ${themeCol} BLOB)`);
                            db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`, (err) => {
                                if (err) rej(err);
                                else res();
                            });
                        });
                    });

                    if (!isNewDatabase) {
                        const didMigrateV3 = await runMigrationToV3(db);
                        if (didMigrateV3) {
                            console.log('Successfully migrated database to version 3.');
                        }

                        const didMigrateV4 = await runMigrationToV4(db);
                        if (didMigrateV4) {
                            console.log('Running VACUUM after migration to compact database...');
                            await new Promise((res) => {
                                db.run('VACUUM', (err) => {
                                    if (err) console.error('Failed to run post-migration VACUUM:', err.message);
                                    res();
                                });
                            });
                        }
                    } else {
                        console.log('Initializing brand new database at version 4 schema...');
                    }

                    await Promise.all([
                        enableTransparentCompressionIfMissing(db, 'sessions'),
                        enableTransparentCompressionIfMissing(db, 'templates'),
                        enableTransparentCompressionIfMissing(db, 'themes')
                    ]);

                    await new Promise((res, rej) => {
                        db.serialize(() => {
                            db.run(`CREATE TABLE IF NOT EXISTS names (key TEXT PRIMARY KEY, data TEXT)`);
                            db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('version', 4)`, (err) => {
                                if (err) rej(err);
                                else res();
                            });
                        });
                    });

                    await new Promise((res) => {
                        db.get(`SELECT value FROM meta WHERE key = 'tokenizer_model'`, async (err, row) => {
                            if (err) {
                                console.error('Failed to query saved tokenizer:', err.message);
                                return res();
                            }
                            if (row && row.value) {
                                try {
                                    await tokenizer.loadTokenizer(row.value);
                                    console.log(`Auto-restored saved tokenizer: ${row.value}`);
                                } catch (e) {
                                    console.error(`Failed to auto-restore tokenizer "${row.value}":`, e.message);
                                }
                            }
                            res();
                        });
                    });

                    startBackgroundMaintenance(db);

                    resolve(db);
                } catch (e) {
                    reject(e);
                }
            });
        });
    });
};

module.exports = { initDatabase };
