import Database from 'better-sqlite3';
import path from 'path';
import zlib from 'zlib';
import { getColumnName } from './utils.js';
import { basedir, resolveExeRelative } from './paths.js';
import * as tokenizer from '../tokenizer.js';

type DB = Database.Database;

// sqlite-zstd's triggers store new rows uncompressed and zstd_incremental_maintenance
// compresses them afterwards, so the level is paid in maintenance time (at shutdown, per
// DEFAULT_MAINTENANCE_CONFIG) rather than on the save path. Measured over the session tables
// (73.7MB of text in 131 rows): level 3 stores 20.0MB, 9 stores 18.1MB, and 19 stores 15.2MB
// for ~8x the maintenance time.
// Only governs rows compressed from here on - maintenance skips rows that already carry a
// dictionary, so existing rows keep their level until something rewrites them.
const ZSTD_COMPRESSION_LEVEL = 9;

const runMigrationToV3 = (db: DB): boolean => {
    const row = db.prepare(`
        SELECT 'migration_needed' as status
        FROM sqlite_master
        WHERE type = 'table' AND name = 'sessions'
          AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'names');
    `).get();

    if (!row) {
        return false;
    }

    const migrateTable = (tableName: string, processRow: (row: { key: string; data: string }) => void) => {
        db.exec(`ALTER TABLE ${tableName} RENAME TO ${tableName}_old`);
        db.exec(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, data BLOB)`);
        const rows = db.prepare(`SELECT key, data FROM ${tableName}_old`).all() as { key: string; data: string }[];
        for (const row of rows) {
            processRow(row);
        }
        db.exec(`DROP TABLE ${tableName}_old`);
    };

    db.transaction(() => {
        db.exec("CREATE TABLE names (key TEXT PRIMARY KEY, data TEXT)");

        migrateTable('sessions', (row) => {
            const sessionData = JSON.parse(row.data);
            const sessionName = sessionData.name;

            if (sessionName) {
                db.prepare("INSERT INTO names (key, data) VALUES (?, ?)").run(row.key, sessionName);
                delete sessionData.name;
            }

            db.prepare("INSERT INTO sessions (key, data) VALUES (?, ?)").run(row.key, zlib.gzipSync(JSON.stringify(sessionData)));
        });

        migrateTable('templates', (row) => {
            db.prepare("INSERT INTO templates (key, data) VALUES (?, ?)").run(row.key, zlib.gzipSync(row.data));
        });
    })();

    return true;
};

const enableTransparentCompressionIfMissing = (db: DB, tableName: string) => {
    if (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(`_${tableName}_zstd`)) {
        return;
    }
    const colName = getColumnName(tableName);
    console.log(`Enabling transparent zstd compression for table: ${tableName} (column: ${colName})...`);
    const config = JSON.stringify({
        table: tableName,
        column: colName,
        compression_level: ZSTD_COMPRESSION_LEVEL,
        dict_chooser: "'a'"
    });
    try {
        db.prepare(`SELECT zstd_enable_transparent(?)`).run(config);
    } catch (err) {
        console.error(`Failed to enable transparent compression for ${tableName}:`, (err as Error).message);
        throw err;
    }
};

const runMigrationToV4 = (db: DB): boolean => {
    let row: { value: string } | undefined;
    try {
        row = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string } | undefined;
    } catch {
        return false;
    }

    const version = row ? parseInt(row.value, 10) : 1;
    if (version >= 4) {
        return false;
    }

    console.log(`Migrating database from version ${version} to 4 (sqlite-zstd transparent compression)...`);

    const migrateTableToZstd = (tableName: string) => {
        const colName = getColumnName(tableName);

        if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName)) {
            db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (key TEXT PRIMARY KEY, ${colName} BLOB)`);
            return;
        }

        const infoRows = db.pragma(`table_info(${tableName})`) as { name: string }[];
        const oldColName = infoRows.some(info => info.name === 'data') ? 'data' : colName;

        const rows = db.prepare(`SELECT key, ${oldColName} FROM ${tableName}`).all() as { key: string; [col: string]: unknown }[];

        console.log(`Migrating ${rows.length} rows from table ${tableName}...`);

        const decompressedRows = rows.map((row) => {
            const colVal = row[oldColName];
            let decompressed: string;
            try {
                decompressed = zlib.gunzipSync(colVal as Buffer).toString();
            } catch {
                decompressed = colVal ? String(colVal) : '';
            }
            return { key: row.key, data: decompressed };
        });

        // Rebuild in one transaction so a failure can't leave the table dropped. zstd_enable_transparent
        // opens its own transaction, so it runs after the commit and moves the rows over itself.
        db.transaction(() => {
            db.exec(`DROP TABLE ${tableName}`);
            db.exec(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, ${colName} BLOB)`);
            const insert = db.prepare(`INSERT INTO ${tableName} (key, ${colName}) VALUES (?, ?)`);
            for (const row of decompressedRows) {
                insert.run(row.key, row.data);
            }
        })();

        const config = JSON.stringify({
            table: tableName,
            column: colName,
            compression_level: ZSTD_COMPRESSION_LEVEL,
            dict_chooser: "'a'"
        });
        db.prepare(`SELECT zstd_enable_transparent(?)`).run(config);
    };

    migrateTableToZstd('sessions');
    migrateTableToZstd('templates');
    migrateTableToZstd('themes');
    migrateTableToZstd('connections');
    migrateTableToZstd('samplerpresets');

    console.log("Running initial zstd incremental maintenance (training dictionaries)...");
    db.prepare(`SELECT zstd_incremental_maintenance(null, 1)`).run();

    return true;
};

let maintenanceSchedulerId: ReturnType<typeof setInterval> | null = null;

const DEFAULT_MAINTENANCE_CONFIG = {
    duration: 5,
    dbLoad: 0.5,
    mode: 'shutdown',
    interval: 60,
    walEnabled: false
} as const;

const configureAutoVacuum = (db: DB) => {
    try {
        if (db.pragma('auto_vacuum', { simple: true }) !== 0) {
            return;
        }
        console.log('Enabling SQLite auto_vacuum mode...');
        db.pragma('auto_vacuum = FULL');
        db.exec('VACUUM');
        console.log('Database auto_vacuum enabled successfully.');
    } catch (err) {
        console.error('Failed to run VACUUM for auto_vacuum:', (err as Error).message);
    }
};

// ponytail: runs on the event loop, so with dbLoad < 1 sqlite-zstd's sleeps stall every request
// (including proxied generations) for up to `duration` seconds; move to a worker_thread with its
// own connection if interval mode on large databases makes that noticeable.
const runZstdMaintenance = (db: DB, duration?: number, dbLoad?: number) => {
    const d = duration !== undefined ? duration : null;
    const l = dbLoad !== undefined ? dbLoad : 1.0;
    try {
        db.prepare(`SELECT zstd_incremental_maintenance(?, ?)`).run(d, l);
        console.log(`zstd maintenance completed (duration=${d}, db_load=${l}).`);
        return { ok: true, message: 'zstd maintenance completed.' };
    } catch (err) {
        return { ok: false, message: 'Error running zstd maintenance: ' + (err as Error).message };
    }
};

const configureWAL = (db: DB, enabled: boolean): { ok: boolean; message?: string } => {
    try {
        db.pragma(`journal_mode = ${enabled ? 'WAL' : 'DELETE'}`);
        return { ok: true };
    } catch (err) {
        console.error('Error configuring WAL mode:', (err as Error).message);
        return { ok: false, message: (err as Error).message };
    }
};

interface MaintenanceConfig {
    duration: number;
    dbLoad: number;
    mode: string;
    interval: number;
    walEnabled: boolean;
}

const getMaintenanceConfig = (db: DB): MaintenanceConfig => {
    try {
        const row = db.prepare(`SELECT value FROM meta WHERE key = 'maintenance_config'`).get() as { value: string } | undefined;
        return { ...DEFAULT_MAINTENANCE_CONFIG, ...(row ? JSON.parse(row.value) : {}) };
    } catch {
        return { ...DEFAULT_MAINTENANCE_CONFIG };
    }
};

const saveMaintenanceConfig = (db: DB, config: Partial<MaintenanceConfig>): { ok: boolean; message?: string; config?: MaintenanceConfig } => {
    const merged = { ...DEFAULT_MAINTENANCE_CONFIG, ...config };
    try {
        db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('maintenance_config', ?)`).run(JSON.stringify(merged));
        return { ok: true, config: merged };
    } catch (err) {
        return { ok: false, message: (err as Error).message };
    }
};

const clearMaintenanceScheduler = () => {
    if (maintenanceSchedulerId !== null) {
        clearInterval(maintenanceSchedulerId);
        maintenanceSchedulerId = null;
    }
};

const scheduleZstdMaintenance = (db: DB, config: MaintenanceConfig) => {
    clearMaintenanceScheduler();
    if (config.mode === 'interval' && config.interval > 0) {
        const intervalMs = config.interval * 60 * 1000;
        console.log(`Scheduling zstd maintenance every ${config.interval} minutes (duration=${config.duration}, db_load=${config.dbLoad}).`);
        maintenanceSchedulerId = setInterval(() => {
            runZstdMaintenance(db, config.duration, config.dbLoad);
        }, intervalMs);
    }
};

const initDatabase = async (storagePath: string): Promise<DB> => {
    const db = new Database(storagePath);

    const zstdLibName = ({
        'win32': 'sqlite_zstd.dll',
        'darwin': 'libsqlite_zstd.dylib',
        'linux': 'libsqlite_zstd.so'
    } as Record<string, string | undefined>)[process.platform] || 'libsqlite_zstd.so';

    db.loadExtension(resolveExeRelative(zstdLibName, path.join(basedir, '..', zstdLibName)));
    console.log('sqlite-zstd extension loaded successfully.');

    // sqlite-zstd turns `sessions` into a view over `_sessions_zstd`, so match either.
    const isNewDatabase = !db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name='sessions'").get();

    configureAutoVacuum(db);

    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, ${getColumnName('sessions')} BLOB);
        CREATE TABLE IF NOT EXISTS templates (key TEXT PRIMARY KEY, ${getColumnName('templates')} BLOB);
        CREATE TABLE IF NOT EXISTS themes (key TEXT PRIMARY KEY, ${getColumnName('themes')} BLOB);
        CREATE TABLE IF NOT EXISTS connections (key TEXT PRIMARY KEY, ${getColumnName('connections')} BLOB);
        CREATE TABLE IF NOT EXISTS samplerpresets (key TEXT PRIMARY KEY, ${getColumnName('samplerpresets')} BLOB);
        -- Created on every start rather than in a versioned migration, so existing databases pick it up too.
        CREATE TABLE IF NOT EXISTS sessionhistory (key TEXT PRIMARY KEY, ${getColumnName('sessionhistory')} BLOB);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `);

    if (!isNewDatabase) {
        if (runMigrationToV3(db)) {
            console.log('Successfully migrated database to version 3.');
        }

        if (runMigrationToV4(db)) {
            console.log('Running VACUUM after migration to compact database...');
            try {
                db.exec('VACUUM');
            } catch (err) {
                console.error('Failed to run post-migration VACUUM:', (err as Error).message);
            }
        }
    } else {
        console.log('Initializing brand new database at version 4 schema...');
    }

    for (const table of ['sessions', 'templates', 'themes', 'connections', 'samplerpresets', 'sessionhistory']) {
        enableTransparentCompressionIfMissing(db, table);
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS names (key TEXT PRIMARY KEY, data TEXT);
        INSERT OR REPLACE INTO meta (key, value) VALUES ('version', 4);
    `);

    let savedTokenizer: { value: string } | undefined;
    try {
        savedTokenizer = db.prepare(`SELECT value FROM meta WHERE key = 'tokenizer_model'`).get() as { value: string } | undefined;
    } catch (err) {
        console.error('Failed to query saved tokenizer:', (err as Error).message);
    }
    if (savedTokenizer?.value) {
        try {
            await tokenizer.loadTokenizer(savedTokenizer.value);
            console.log(`Auto-restored saved tokenizer: ${savedTokenizer.value}`);
        } catch (e) {
            console.error(`Failed to auto-restore tokenizer "${savedTokenizer.value}":`, (e as Error).message);
        }
    }

    const maintConfig = getMaintenanceConfig(db);
    if (maintConfig.walEnabled) {
        configureWAL(db, true);
    }
    if (maintConfig.mode === 'startup') {
        runZstdMaintenance(db, maintConfig.duration, maintConfig.dbLoad);
    }
    scheduleZstdMaintenance(db, maintConfig);

    return db;
};

export { initDatabase, runZstdMaintenance, configureWAL, getMaintenanceConfig, saveMaintenanceConfig, clearMaintenanceScheduler, scheduleZstdMaintenance };
