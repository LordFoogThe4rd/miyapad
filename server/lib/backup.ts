import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import { path7za } from '7zip-bin';
import { pipeline } from 'stream';
import type { Database } from 'better-sqlite3';
import { isValidPluginId } from './plugin-db.js';

let backupIntervalId: ReturnType<typeof setInterval> | null = null;
let backupIntervalMinutes: number | null = null;
// Only a backup that was written moves this; a skipped or failed run leaves the older time.
let lastBackupAt: number | null = null;

// path7za is the 7-Zip binary bundled by 7zip-bin, so no host install is needed. It is
// resolved through require() at runtime (esbuild keeps 7zip-bin external), because the
// package locates the binary relative to its own directory.
// ponytail: 7zip-bin ships every platform's binary, adding ~12MB to node_modules and to
// each release archive. 7z-wasm is one ~3MB artifact instead — switch if that size starts
// to matter, at the cost of emscripten FS plumbing and of losing the stdin stream below,
// since the whole backup would have to be handed to the WASM filesystem in memory.
const SEVEN_ZIP = process.env.MIYAPAD_7Z_PATH || path7za;

const timestamp = () => {
    const now = new Date();
    const Y = now.getFullYear();
    const M = String(now.getMonth() + 1).padStart(2, '0');
    const D = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${Y}${M}${D}${h}${m}${s}`;
};

const getDbFileMtime = (dbPath: string): number | null => {
    try {
        return fs.statSync(dbPath).mtimeMs;
    } catch {
        return null;
    }
};

const rotateBackups = (dir: string, keep: number) => {
    let files: string[];
    try {
        files = fs.readdirSync(dir)
            // .gz is matched too so backups written before the switch to 7-Zip still age out.
            .filter(f => /\.backup\.(7z|gz)$/.test(f))
            .sort()
            .reverse();
    } catch {
        return;
    }

    if (files.length <= keep) return;

    for (const file of files.slice(keep)) {
        try {
            fs.unlinkSync(path.join(dir, file));
            console.log(`Removed old backup: ${file}`);
        } catch (err) {
            console.error(`Failed to remove old backup ${file}:`, (err as Error).message);
        }
    }
};

const runIntegrityCheck = (db: Database): boolean => {
    let rows: { integrity_check: string }[];
    try {
        rows = db.pragma("integrity_check") as typeof rows;
    } catch (err) {
        console.error("Backup: integrity check failed to run:", (err as Error).message);
        return false;
    }
    const ok = rows.length === 1 && rows[0].integrity_check === 'ok';
    if (!ok) {
        console.error("Backup: integrity check failed, skipping backup to preserve last good copy:", rows);
    }
    return ok;
};

const listPluginContainers = (pluginsDir: string): string[] => {
    try {
        return fs.readdirSync(pluginsDir)
            .filter(f => f.endsWith('.db') && isValidPluginId(f.slice(0, -3)))
            .sort();
    } catch {
        return [];
    }
};

const getStorageSignature = (dbPath: string, mainMtime: number): string => {
    const pluginsDir = path.join(path.dirname(dbPath), 'plugins');
    const pluginParts = listPluginContainers(pluginsDir).map(file => {
        const full = path.join(pluginsDir, file);
        return `${file}:${getDbFileMtime(full) ?? ''}:${getDbFileMtime(full + '-wal') ?? ''}`;
    });
    return [`main:${mainMtime}:${getDbFileMtime(dbPath + '-wal') ?? ''}`, ...pluginParts].join('|');
};

const snapshotPluginContainers = (pluginsDir: string, stageDir: string): string[] => {
    const files = listPluginContainers(pluginsDir);
    if (files.length === 0) return [];

    const staged: string[] = [];
    for (const file of files) {
        const src = path.join(pluginsDir, file);
        let pDb: DatabaseSync | undefined;
        try {
            pDb = new DatabaseSync(src, { allowExtension: false });
            const rows = pDb.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
            if (rows.length !== 1 || rows[0].integrity_check !== 'ok') {
                console.error(`Backup: skipping corrupt plugin container ${file}:`, rows);
                continue;
            }
            const destDir = path.join(stageDir, 'plugins');
            fs.mkdirSync(destDir, { recursive: true });
            pDb.prepare('VACUUM INTO ?').run(path.join(destDir, file));
            staged.push(path.join('plugins', file));
        } catch (err) {
            console.error(`Backup: skipping unreadable plugin container ${file}:`, (err as Error).message);
        } finally {
            try { pDb?.close(); } catch { /* ok */ }
        }
    }
    return staged;
};

// Streams srcPath into a .7z archive holding an LZMA2-compressed entry named entryName,
// then appends any staged `plugins/*.db` containers into the same archive.
// LZMA2 over LZMA1 because the database is mostly zstd blobs (sqlite-zstd transparent
// compression), and LZMA2 stores incompressible runs raw instead of paying encoder overhead
// on them: 17,691,698 bytes against 17,870,246 on a 20.7MB snapshot, same second of work.
const compressToArchive = (
    srcPath: string,
    archivePath: string,
    entryName: string,
    extraEntries: { cwd: string; files: string[] } | null,
    done: (err: Error | null) => void,
) => {
    const tmpArchivePath = archivePath + '.tmp';
    try { fs.rmSync(tmpArchivePath, { force: true }); } catch { /* ok */ }
    try { fs.rmSync(archivePath, { force: true }); } catch { /* ok */ }

    const finalize = (err: Error | null) => {
        if (err) {
            try { fs.rmSync(tmpArchivePath, { force: true }); } catch { /* ok */ }
            done(err);
            return;
        }
        try {
            fs.renameSync(tmpArchivePath, archivePath);
            done(null);
        } catch (renameErr) {
            try { fs.rmSync(tmpArchivePath, { force: true }); } catch { /* ok */ }
            done(renameErr as Error);
        }
    };

    const appendExtras = () => {
        if (!extraEntries || extraEntries.files.length === 0) {
            finalize(null);
            return;
        }
        const child = spawn(SEVEN_ZIP, [
            'a', '-t7z', '-m0=lzma2', '-mx=9', '-bso0', '-bsp0', tmpArchivePath, ...extraEntries.files,
        ], { cwd: extraEntries.cwd, stdio: ['ignore', 'ignore', 'pipe'] });

        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });

        let settled = false;
        const finishExtra = (err: Error | null) => {
            if (settled) return;
            settled = true;
            finalize(err);
        };

        child.on('error', (err: NodeJS.ErrnoException) => finishExtra(err.code === 'ENOENT'
            ? new Error(`7-Zip executable not found (tried "${SEVEN_ZIP}"). Set MIYAPAD_7Z_PATH to a 7-Zip executable.`)
            : err));

        child.on('close', code => finishExtra(code === 0
            ? null
            : new Error(`7-Zip exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)));
    };

    const child = spawn(SEVEN_ZIP, [
        'a', '-t7z', '-m0=lzma2', '-mx=9', '-bso0', '-bsp0', `-si${entryName}`, tmpArchivePath
    ], { stdio: ['pipe', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });

    let settled = false;
    const finishMain = (err: Error | null) => {
        if (settled) return;
        settled = true;
        if (err) {
            finalize(err);
        } else {
            appendExtras();
        }
    };

    child.on('error', (err: NodeJS.ErrnoException) => finishMain(err.code === 'ENOENT'
        ? new Error(`7-Zip executable not found (tried "${SEVEN_ZIP}"). Set MIYAPAD_7Z_PATH to a 7-Zip executable.`)
        : err));

    child.on('close', code => finishMain(code === 0
        ? null
        : new Error(`7-Zip exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)));

    pipeline(fs.createReadStream(srcPath), child.stdin, (err: Error | null) => {
        if (err) {
            child.kill();
            finishMain(err);
        }
    });
};

const runBackup = (db: Database, dbPath: string, dir: string, keep: number, lastSignatureRef: { current: string | null }) => {
    const currentMtime = getDbFileMtime(dbPath);

    if (currentMtime === null) {
        console.error("Backup: cannot stat database file, skipping.");
        return;
    }

    const currentSignature = getStorageSignature(dbPath, currentMtime);
    if (lastSignatureRef.current !== null && currentSignature === lastSignatureRef.current) {
        console.log("Backup: no changes detected, skipping.");
        return;
    }

    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
        console.error("Backup: failed to create backup directory:", (err as Error).message);
        return;
    }

    const backupName = `web-session-storage.db.${timestamp()}.backup`;
    const backupPath = path.join(dir, backupName);
    const stageDir = backupPath + '.stage';
    const tmpPath = path.join(stageDir, backupName);

    if (!runIntegrityCheck(db)) return;

    const cleanup = () => {
        try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ok */ }
    };

    let pluginEntries: string[] = [];
    try {
        fs.rmSync(stageDir, { recursive: true, force: true });
        fs.mkdirSync(stageDir, { recursive: true });
        db.prepare("VACUUM INTO ?").run(tmpPath);
        pluginEntries = snapshotPluginContainers(path.join(path.dirname(dbPath), 'plugins'), stageDir);
    } catch (err) {
        cleanup();
        console.error("Backup: VACUUM INTO failed:", (err as Error).message);
        return;
    }

    compressToArchive(
        tmpPath,
        backupPath + '.7z',
        backupName,
        pluginEntries.length > 0 ? { cwd: stageDir, files: pluginEntries } : null,
        (err: Error | null) => {
            cleanup();
            if (err) {
                console.error("Backup: compression failed:", err.message);
                return;
            }
            lastSignatureRef.current = currentSignature;
            lastBackupAt = Date.now();
            console.log(`Backup created: ${backupName}.7z`);
            rotateBackups(dir, keep);
        },
    );
};

const startAutoBackup = (db: Database, dbPath: string, { interval = 30, dir = './backups', keep = 10 } = {}) => {
    if (backupIntervalId) {
        console.log("Auto-backup is already running.");
        return;
    }

    const dirAbsolute = path.resolve(dir);
    backupIntervalMinutes = interval;

    const lastSignatureRef: { current: string | null } = { current: null };

    runBackup(db, dbPath, dirAbsolute, keep, lastSignatureRef);

    backupIntervalId = setInterval(() => {
        runBackup(db, dbPath, dirAbsolute, keep, lastSignatureRef);
    }, interval * 60 * 1000);

    console.log(`Auto-backup scheduled every ${interval} minutes (dir: ${dirAbsolute}, keep: ${keep})`);
};

const stopAutoBackup = () => {
    if (backupIntervalId) {
        clearInterval(backupIntervalId);
        backupIntervalId = null;
        console.log("Auto-backup stopped.");
    }
};

/** For the Plugins tab, so you can see how old the newest backup is before running a plugin. */
const getBackupStatus = () => ({
    enabled: backupIntervalId !== null,
    intervalMinutes: backupIntervalMinutes,
    lastBackupAt,
});

export { startAutoBackup, stopAutoBackup, getBackupStatus, timestamp, rotateBackups };
