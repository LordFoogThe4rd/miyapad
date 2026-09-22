import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { path7za } from '7zip-bin';
import { pipeline } from 'stream';
import type { Database } from 'better-sqlite3';

let backupIntervalId: ReturnType<typeof setInterval> | null = null;

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

// Streams srcPath into a .7z archive holding a single LZMA2-compressed entry named entryName.
// LZMA2 over LZMA1 because the database is mostly zstd blobs (sqlite-zstd transparent
// compression), and LZMA2 stores incompressible runs raw instead of paying encoder overhead
// on them: 17,691,698 bytes against 17,870,246 on a 20.7MB snapshot, same second of work.
const compressToArchive = (srcPath: string, archivePath: string, entryName: string, done: (err: Error | null) => void) => {
    // `7z a` appends to an existing archive, so drop a leftover before writing.
    try { fs.rmSync(archivePath, { force: true }); } catch { /* ok */ }

    const child = spawn(SEVEN_ZIP, [
        'a', '-t7z', '-m0=lzma2', '-mx=9', '-bso0', '-bsp0', `-si${entryName}`, archivePath
    ], { stdio: ['pipe', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });

    let settled = false;
    const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        done(err);
    };

    child.on('error', (err: NodeJS.ErrnoException) => finish(err.code === 'ENOENT'
        ? new Error(`7-Zip executable not found (tried "${SEVEN_ZIP}"). Set MIYAPAD_7Z_PATH to a 7-Zip executable.`)
        : err));

    child.on('close', code => finish(code === 0
        ? null
        : new Error(`7-Zip exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)));

    pipeline(fs.createReadStream(srcPath), child.stdin, (err: Error | null) => {
        if (err) {
            child.kill();
            finish(err);
        }
    });
};

const runBackup = (db: Database, dbPath: string, dir: string, keep: number, lastMtimeRef: { current: number | null }) => {
    const currentMtime = getDbFileMtime(dbPath);

    if (currentMtime === null) {
        console.error("Backup: cannot stat database file, skipping.");
        return;
    }

    if (lastMtimeRef.current !== null && currentMtime === lastMtimeRef.current) {
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
    const tmpPath = backupPath + '.tmp';

    if (!runIntegrityCheck(db)) return;

    try {
        db.prepare("VACUUM INTO ?").run(tmpPath);
    } catch (err) {
        console.error("Backup: VACUUM INTO failed:", (err as Error).message);
        return;
    }

    const cleanup = () => {
        try { fs.unlinkSync(tmpPath); } catch { /* ok */ }
    };

    compressToArchive(tmpPath, backupPath + '.7z', backupName, (err: Error | null) => {
        cleanup();
        if (err) {
            console.error("Backup: compression failed:", err.message);
            return;
        }
        lastMtimeRef.current = currentMtime;
        console.log(`Backup created: ${backupName}.7z`);
        rotateBackups(dir, keep);
    });
};

const startAutoBackup = (db: Database, dbPath: string, { interval = 30, dir = './backups', keep = 10 } = {}) => {
    if (backupIntervalId) {
        console.log("Auto-backup is already running.");
        return;
    }

    const dirAbsolute = path.resolve(dir);

    const lastMtimeRef: { current: number | null } = { current: null };

    runBackup(db, dbPath, dirAbsolute, keep, lastMtimeRef);

    backupIntervalId = setInterval(() => {
        runBackup(db, dbPath, dirAbsolute, keep, lastMtimeRef);
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

export { startAutoBackup, stopAutoBackup };
