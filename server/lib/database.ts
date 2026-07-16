import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { getColumnName, compressData, decompressData } from './utils.js';
import { basedir, resolveExeRelative } from './paths.js';
import * as tokenizer from '../tokenizer.js';

const runMigrationToV3 = (db: sqlite3.Database) => {
    return new Promise<boolean>((resolve, reject) => {
        const migrationCheckSql = `
            SELECT 'migration_needed' as status
            FROM sqlite_master
            WHERE type = 'table' AND name = 'sessions'
              AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'names');
        `;

        db.get(migrationCheckSql, (err, row: { status: string } | undefined) => {
            if (err) {
                return reject(err);
            }

            if (!row) {
                return resolve(false);
            }

            const run = (sql: string, params?: any[]) => {
                return new Promise<void>((res, rej) => {
                    db.run(sql, params ?? [], (err: Error | null) => err ? rej(err) : res());
                });
            };
            const all = (sql: string, params?: any[]) => {
                return new Promise<any[]>((res, rej) => {
                    db.all(sql, params ?? [], (err: Error | null, rows: any[]) => err ? rej(err) : res(rows));
                });
            };

            const migrateTable = async (tableName: string, processRow: (row: { key: string; data: string }) => Promise<void>) => {
                await run(`ALTER TABLE ${tableName} RENAME TO ${tableName}_old`);
                await run(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, data BLOB)`);
                const rows = await all(`SELECT key, data FROM ${tableName}_old`) as { key: string; data: string }[];
                for (const row of rows) {
                    await processRow(row);
                }
                await run(`DROP TABLE ${tableName}_old`);
            };

            (async () => {
                try {
                    await run("BEGIN TRANSACTION");

                    await run("CREATE TABLE names (key TEXT PRIMARY KEY, data TEXT)");

                    await migrateTable('sessions', async (row) => {
                        const sessionData = JSON.parse(row.data);
                        const sessionName = sessionData.name;

                        if (sessionName) {
                            await run("INSERT INTO names (key, data) VALUES (?, ?)", [row.key, sessionName]);
                            delete sessionData.name;
                        }

                        const compressedData = await compressData(JSON.stringify(sessionData));
                        await run("INSERT INTO sessions (key, data) VALUES (?, ?)", [row.key, compressedData]);
                    });

                    await migrateTable('templates', async (row) => {
                        const compressedData = await compressData(row.data);
                        await run("INSERT INTO templates (key, data) VALUES (?, ?)", [row.key, compressedData]);
                    });

                    await run("COMMIT");
                    resolve(true);
                } catch (e) {
                    try { await run("ROLLBACK"); } catch { /* ROLLBACK failed, nothing more to do */ }
                    reject(e);
                }
            })();
        });
    });
};

const enableTransparentCompressionIfMissing = (db: sqlite3.Database, tableName: string) => {
    return new Promise<void>((resolve, reject) => {
        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [`_${tableName}_zstd`], (err, row: { name: string } | undefined) => {
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

const runMigrationToV4 = (db: sqlite3.Database) => {
    return new Promise<boolean>((resolve, reject) => {
        db.get("SELECT value FROM meta WHERE key = 'version'", async (err, row: { value: string } | undefined) => {
            if (err) {
                return resolve(false);
            }

            const version = row ? parseInt(row.value, 10) : 1;
            if (version >= 4) {
                return resolve(false);
            }

            console.log(`Migrating database from version ${version} to 4 (sqlite-zstd transparent compression)...`);

            try {
                const migrateTableToZstd = async (tableName: string) => {
                    const colName = getColumnName(tableName);

                    const tableExists: boolean = await new Promise((res, rej) => {
                        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, row: { name: string } | undefined) => {
                            if (err) rej(err);
                            else res(!!row);
                        });
                    });

                    if (!tableExists) {
                        await new Promise<void>((res, rej) => db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (key TEXT PRIMARY KEY, ${colName} BLOB)`, (err) => err ? rej(err) : res()));
                        return;
                    }

                    const hasOldColumnName: boolean = await new Promise((res, rej) => {
                        db.all(`PRAGMA table_info(${tableName})`, [], (err, infoRows: { name: string }[]) => {
                            if (err) return rej(err);
                            const hasOld = infoRows.some(info => info.name === 'data');
                            res(hasOld);
                        });
                    });

                    let oldColName = hasOldColumnName ? 'data' : colName;

                    const rows = await new Promise<{ key: string; [col: string]: unknown }[]>((res, rej) => {
                        db.all(`SELECT key, ${oldColName} FROM ${tableName}`, [], (err, rows) => err ? rej(err) : res(rows as { key: string; [col: string]: unknown }[]));
                    });

                    console.log(`Migrating ${rows.length} rows from table ${tableName}...`);

                    const decompressedRows: { key: string; data: string }[] = [];
                    for (const row of rows) {
                        const colVal = row[oldColName];
                        let decompressed: string;
                        try {
                            decompressed = await decompressData(colVal as Buffer);
                        } catch (e) {
                            decompressed = colVal ? String(colVal) : '';
                        }
                        decompressedRows.push({ key: row.key, data: decompressed });
                    }

                    await new Promise<void>((res, rej) => db.run(`DROP TABLE ${tableName}`, (err) => err ? rej(err) : res()));

                    await new Promise<void>((res, rej) => db.run(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, ${colName} BLOB)`, (err) => err ? rej(err) : res()));

                    const config = JSON.stringify({
                        table: tableName,
                        column: colName,
                        compression_level: 3,
                        dict_chooser: "'a'"
                    });
                    await new Promise<void>((res, rej) => db.run(`SELECT zstd_enable_transparent(?)`, [config], (err) => err ? rej(err) : res()));

                    if (decompressedRows.length > 0) {
                        await new Promise<void>((res, rej) => db.run("BEGIN TRANSACTION", (err) => err ? rej(err) : res()));
                        try {
                            for (const row of decompressedRows) {
                                await new Promise<void>((res, rej) => db.run(`INSERT INTO ${tableName} (key, ${colName}) VALUES (?, ?)`, [row.key, row.data], (err) => err ? rej(err) : res()));
                            }
                            await new Promise<void>((res, rej) => db.run("COMMIT", (err) => err ? rej(err) : res()));
                        } catch (insertErr) {
                            await new Promise<void>((res) => db.run("ROLLBACK", () => res()));
                            throw insertErr;
                        }
                    }
                };

                await migrateTableToZstd('sessions');
                await migrateTableToZstd('templates');
                await migrateTableToZstd('themes');
                await migrateTableToZstd('connections');
                await migrateTableToZstd('samplerpresets');

                console.log("Running initial zstd incremental maintenance (training dictionaries)...");
                await new Promise<void>((res, rej) => db.run(`SELECT zstd_incremental_maintenance(null, 1)`, (err) => err ? rej(err) : res()));

                resolve(true);
            } catch (e) {
                reject(e);
            }
        });
    });
};

let maintenanceSchedulerId: ReturnType<typeof setInterval> | null = null;

const DEFAULT_MAINTENANCE_CONFIG = {
    duration: 5,
    dbLoad: 0.5,
    mode: 'shutdown',
    interval: 60,
    walEnabled: false
} as const;

const configureAutoVacuum = (db: sqlite3.Database) => {
    return new Promise<void>((resolve) => {
        db.get('PRAGMA auto_vacuum', (err, row: { auto_vacuum: number } | undefined) => {
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

const runZstdMaintenance = (db: sqlite3.Database, duration?: number, dbLoad?: number) => {
    return new Promise<{ ok: boolean; message: string }>((resolve) => {
        const d = duration !== undefined ? duration : null;
        const l = dbLoad !== undefined ? dbLoad : 1.0;
        db.run(`SELECT zstd_incremental_maintenance(?, ?)`, [d, l], (err) => {
            if (err) {
                resolve({ ok: false, message: 'Error running zstd maintenance: ' + err.message });
            } else {
                console.log(`zstd maintenance completed (duration=${d}, db_load=${l}).`);
                resolve({ ok: true, message: 'zstd maintenance completed.' });
            }
        });
    });
};

const configureWAL = (db: sqlite3.Database, enabled: boolean) => {
    return new Promise<{ ok: boolean; message?: string }>((resolve) => {
        const mode = enabled ? 'WAL' : 'DELETE';
        db.run(`PRAGMA journal_mode=${mode}`, (err) => {
            if (err) {
                console.error('Error configuring WAL mode:', err.message);
                resolve({ ok: false, message: err.message });
            } else {
                resolve({ ok: true });
            }
        });
    });
};

interface MaintenanceConfig {
    duration: number;
    dbLoad: number;
    mode: string;
    interval: number;
    walEnabled: boolean;
}

const getMaintenanceConfig = (db: sqlite3.Database) => {
    return new Promise<MaintenanceConfig>((resolve) => {
        db.get(`SELECT value FROM meta WHERE key = 'maintenance_config'`, (err, row: { value: string } | undefined) => {
            if (err || !row) {
                resolve({ ...DEFAULT_MAINTENANCE_CONFIG });
            } else {
                try {
                    const config = JSON.parse(row.value);
                    resolve({ ...DEFAULT_MAINTENANCE_CONFIG, ...config });
                } catch {
                    resolve({ ...DEFAULT_MAINTENANCE_CONFIG });
                }
            }
        });
    });
};

const saveMaintenanceConfig = (db: sqlite3.Database, config: Partial<MaintenanceConfig>) => {
    return new Promise<{ ok: boolean; message?: string; config?: MaintenanceConfig }>((resolve) => {
        const merged = { ...DEFAULT_MAINTENANCE_CONFIG, ...config };
        db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('maintenance_config', ?)`, [JSON.stringify(merged)], (err) => {
            if (err) {
                resolve({ ok: false, message: err.message });
            } else {
                resolve({ ok: true, config: merged });
            }
        });
    });
};

const clearMaintenanceScheduler = () => {
    if (maintenanceSchedulerId !== null) {
        clearInterval(maintenanceSchedulerId);
        maintenanceSchedulerId = null;
    }
};

const scheduleZstdMaintenance = (db: sqlite3.Database, config: MaintenanceConfig) => {
    clearMaintenanceScheduler();
    if (config.mode === 'interval' && config.interval > 0) {
        const intervalMs = config.interval * 60 * 1000;
        console.log(`Scheduling zstd maintenance every ${config.interval} minutes (duration=${config.duration}, db_load=${config.dbLoad}).`);
        maintenanceSchedulerId = setInterval(() => {
            runZstdMaintenance(db, config.duration, config.dbLoad);
        }, intervalMs);
    }
};

const initDatabase = (storagePath: string) => {
    return new Promise<sqlite3.Database>((resolve, reject) => {
        const db = new sqlite3.Database(storagePath, (err) => {
            if (err) {
                return reject(err);
            }

            const zstdLibName = ({
                'win32': 'sqlite_zstd.dll',
                'darwin': 'libsqlite_zstd.dylib',
                'linux': 'libsqlite_zstd.so'
            } as Record<string, string | undefined>)[process.platform] || 'libsqlite_zstd.so';

            const zstdPath = resolveExeRelative(zstdLibName, path.join(basedir, '..', zstdLibName));

            db.loadExtension(zstdPath, async (err) => {
                if (err) {
                    return reject(err);
                }
                console.log('sqlite-zstd extension loaded successfully.');

                try {
                    const sessionTableExists: boolean = await new Promise((res, rej) => {
                        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (err, row: { name: string } | undefined) => {
                            if (err) rej(err);
                            else res(!!row);
                        });
                    });

                    const isNewDatabase = !sessionTableExists;

                    await configureAutoVacuum(db);

                    await new Promise<void>((res, rej) => {
                        db.serialize(() => {
                            const sessionCol = getColumnName('sessions');
                            const templateCol = getColumnName('templates');
                            const themeCol = getColumnName('themes');
                            const connectionCol = getColumnName('connections');
                            const samplerPresetCol = getColumnName('samplerpresets');
                            db.run(`CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, ${sessionCol} BLOB)`);
                            db.run(`CREATE TABLE IF NOT EXISTS templates (key TEXT PRIMARY KEY, ${templateCol} BLOB)`);
                            db.run(`CREATE TABLE IF NOT EXISTS themes (key TEXT PRIMARY KEY, ${themeCol} BLOB)`);
                            db.run(`CREATE TABLE IF NOT EXISTS connections (key TEXT PRIMARY KEY, ${connectionCol} BLOB)`);
                            db.run(`CREATE TABLE IF NOT EXISTS samplerpresets (key TEXT PRIMARY KEY, ${samplerPresetCol} BLOB)`);
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
                            await new Promise<void>((res) => {
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
                        enableTransparentCompressionIfMissing(db, 'themes'),
                        enableTransparentCompressionIfMissing(db, 'connections'),
                        enableTransparentCompressionIfMissing(db, 'samplerpresets')
                    ]);

                    await new Promise<void>((res, rej) => {
                        db.serialize(() => {
                            db.run(`CREATE TABLE IF NOT EXISTS names (key TEXT PRIMARY KEY, data TEXT)`);
                            db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('version', 4)`, (err) => {
                                if (err) rej(err);
                                else res();
                            });
                        });
                    });

                    await new Promise<void>((res) => {
                        db.get(`SELECT value FROM meta WHERE key = 'tokenizer_model'`, async (err, row: { value: string } | undefined) => {
                            if (err) {
                                console.error('Failed to query saved tokenizer:', err.message);
                                return res();
                            }
                            if (row && row.value) {
                                try {
                                    await tokenizer.loadTokenizer(row.value);
                                    console.log(`Auto-restored saved tokenizer: ${row.value}`);
                                } catch (e) {
                                    console.error(`Failed to auto-restore tokenizer "${row.value}":`, (e as Error).message);
                                }
                            }
                            res();
                        });
                    });

                    const maintConfig = await getMaintenanceConfig(db);
                    if (maintConfig.walEnabled) {
                        await configureWAL(db, true);
                    }
                    if (maintConfig.mode === 'startup') {
                        await runZstdMaintenance(db, maintConfig.duration, maintConfig.dbLoad);
                    }
                    scheduleZstdMaintenance(db, maintConfig);

                    resolve(db);
                } catch (e) {
                    reject(e);
                }
            });
        });
    });
};

export { initDatabase, runZstdMaintenance, configureWAL, getMaintenanceConfig, saveMaintenanceConfig, clearMaintenanceScheduler, scheduleZstdMaintenance };
