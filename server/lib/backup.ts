import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream';

let backupIntervalId: ReturnType<typeof setInterval> | null = null;

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
            .filter(f => f.endsWith('.backup.gz'))
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

const runBackup = (db: import('sqlite3').Database, dbPath: string, dir: string, keep: number, lastMtimeRef: { current: number | null }) => {
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

    db.run("VACUUM INTO ?", [tmpPath], (err) => {
        if (err) {
            console.error("Backup: VACUUM INTO failed:", err.message);
            return;
        }

        const cleanup = () => {
            try { fs.unlinkSync(tmpPath); } catch { /* ok */ }
        };

        pipeline(
            fs.createReadStream(tmpPath),
            zlib.createGzip(),
            fs.createWriteStream(backupPath + '.gz'),
            (err: Error | null) => {
                if (err) {
                    console.error("Backup: compression failed:", err.message);
                    cleanup();
                    return;
                }
                cleanup();
                lastMtimeRef.current = currentMtime;
                console.log(`Backup created: ${backupName}.gz`);
                rotateBackups(dir, keep);
            }
        );
    });
};

const startAutoBackup = (db: import('sqlite3').Database, dbPath: string, { interval = 30, dir = './backups', keep = 10 } = {}) => {
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
