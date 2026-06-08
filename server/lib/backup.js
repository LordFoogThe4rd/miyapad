const fs = require('fs');
const path = require('path');

let backupIntervalId = null;

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

const rotateBackups = (dir, keep) => {
    let files;
    try {
        files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.backup'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
    } catch {
        return;
    }

    if (files.length <= keep) return;

    for (const file of files.slice(keep)) {
        try {
            fs.unlinkSync(path.join(dir, file.name));
            console.log(`Removed old backup: ${file.name}`);
        } catch (err) {
            console.error(`Failed to remove old backup ${file.name}:`, err.message);
        }
    }
};

const runBackup = (db, dir, keep, versionRef) => {
    db.get("PRAGMA data_version", (err, row) => {
        if (err) {
            console.error("Backup: failed to read data_version:", err.message);
            return;
        }

        const currentVersion = row.data_version;

        if (versionRef.current !== null && currentVersion === versionRef.current) {
            return;
        }

        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
            console.error("Backup: failed to create backup directory:", err.message);
            return;
        }

        const backupName = `web-session-storage.db.${timestamp()}.backup`;
        const backupPath = path.join(dir, backupName);

        db.run("VACUUM INTO ?", [backupPath], (err) => {
            if (err) {
                console.error("Backup: VACUUM INTO failed:", err.message);
                return;
            }

            versionRef.current = currentVersion;
            console.log(`Backup created: ${backupName}`);
            rotateBackups(dir, keep);
        });
    });
};

const startAutoBackup = (db, { interval = 30, dir = './backups', keep = 10 } = {}) => {
    if (backupIntervalId) {
        console.log("Auto-backup is already running.");
        return;
    }

    const dirAbsolute = path.resolve(dir);

    const versionRef = { current: null };

    runBackup(db, dirAbsolute, keep, versionRef);

    backupIntervalId = setInterval(() => {
        runBackup(db, dirAbsolute, keep, versionRef);
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

module.exports = { startAutoBackup, stopAutoBackup };
