// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import Database from 'better-sqlite3';
import { path7za } from '7zip-bin';
import { rotateBackups, timestamp, startAutoBackup, stopAutoBackup } from './backup.js';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('timestamp', () => {
    it('writes the local time as YYYYMMDDhhmmss, zero-padded', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 5, 7, 8, 9));
        expect(timestamp()).toBe('20260105070809');
    });
});

describe('rotateBackups', () => {
    function dirWith(files: string[]) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyapad-backup-'));
        dirs.push(dir);
        for (const file of files) fs.writeFileSync(path.join(dir, file), '');
        return dir;
    }

    it('keeps the newest backups and deletes the rest', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const dir = dirWith([
            'miyapad.20260101000000.backup.7z',
            'miyapad.20260102000000.backup.7z',
            'miyapad.20260103000000.backup.7z',
        ]);
        rotateBackups(dir, 2);
        expect(fs.readdirSync(dir).sort()).toEqual([
            'miyapad.20260102000000.backup.7z',
            'miyapad.20260103000000.backup.7z',
        ]);
    });

    it('ages out .gz backups from before 7-Zip along with the rest', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const dir = dirWith(['miyapad.20250101000000.backup.gz', 'miyapad.20260101000000.backup.7z']);
        rotateBackups(dir, 1);
        expect(fs.readdirSync(dir)).toEqual(['miyapad.20260101000000.backup.7z']);
    });

    it('leaves files that are not backups alone', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const dir = dirWith(['notes.txt', 'miyapad.db', 'miyapad.20260101000000.backup.7z']);
        rotateBackups(dir, 0);
        expect(fs.readdirSync(dir).sort()).toEqual(['miyapad.db', 'notes.txt']);
    });

    it('does nothing for a directory that does not exist', () => {
        expect(() => rotateBackups(path.join(os.tmpdir(), 'miyapad-no-such-dir'), 1)).not.toThrow();
    });
});

describe('startAutoBackup', () => {
    const open: Database.Database[] = [];

    afterEach(() => {
        stopAutoBackup();
        for (const db of open.splice(0)) db.close();
    });

    function liveDatabase() {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyapad-backup-'));
        dirs.push(dir);
        const dbPath = path.join(dir, 'live.db');
        const db = new Database(dbPath);
        open.push(db);
        db.exec("CREATE TABLE sessions (key TEXT PRIMARY KEY, session_data BLOB); INSERT INTO sessions VALUES ('1', '{\"prompt\":\"hello\"}')");
        return { dir, dbPath, db, backups: path.join(dir, 'backups') };
    }

    const quiet = () => ({
        log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    });
    const created = (log: ReturnType<typeof quiet>['log']) => log.mock.calls.filter(([msg]) => String(msg).startsWith('Backup created:')).length;

    it('writes a 7z that restores to the same data, and rotates old backups out', async () => {
        const { log } = quiet();
        const { dir, dbPath, db, backups } = liveDatabase();
        fs.mkdirSync(backups);
        for (const old of ['20200101000000', '20200102000000']) {
            fs.writeFileSync(path.join(backups, `web-session-storage.db.${old}.backup.7z`), '');
        }

        startAutoBackup(db, dbPath, { dir: backups, keep: 2 });
        await vi.waitFor(() => expect(created(log)).toBe(1), { timeout: 10_000 });

        const files = fs.readdirSync(backups).sort();
        expect(files).toHaveLength(2);
        expect(files[0]).toBe('web-session-storage.db.20200102000000.backup.7z');
        expect(files[1]).toMatch(/^web-session-storage\.db\.\d{14}\.backup\.7z$/);

        const restored = path.join(dir, 'restored');
        expect(spawnSync(path7za, ['e', path.join(backups, files[1]), `-o${restored}`, '-y']).status).toBe(0);
        expect(fs.readdirSync(restored)).toEqual([files[1].replace(/\.7z$/, '')]);
        const copy = new Database(path.join(restored, fs.readdirSync(restored)[0]), { readonly: true });
        open.push(copy);
        expect(copy.prepare('SELECT * FROM sessions').all()).toEqual([{ key: '1', session_data: '{"prompt":"hello"}' }]);
    });

    it('skips a run when the database has not changed since the last backup', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        const { log } = quiet();
        const { dbPath, db, backups } = liveDatabase();

        startAutoBackup(db, dbPath, { dir: backups, interval: 30 });
        await vi.waitFor(() => expect(created(log)).toBe(1), { timeout: 10_000 });

        vi.advanceTimersByTime(30 * 60_000);
        expect(log).toHaveBeenCalledWith('Backup: no changes detected, skipping.');
        expect(created(log)).toBe(1);

        db.prepare('INSERT INTO sessions VALUES (?, ?)').run('2', '{}');
        vi.advanceTimersByTime(30 * 60_000);
        await vi.waitFor(() => expect(created(log)).toBe(2), { timeout: 10_000 });
    });

    it('keeps the last good backups when the integrity check fails or cannot run', () => {
        const { error } = quiet();
        const { dbPath, backups } = liveDatabase();
        fs.mkdirSync(backups);
        fs.writeFileSync(path.join(backups, 'web-session-storage.db.20200101000000.backup.7z'), 'good');

        const damaged = [{ integrity_check: '*** in database main ***' }, { integrity_check: 'Page 5: never used' }];
        for (const pragma of [() => damaged, () => { throw new Error('disk I/O error'); }]) {
            const db = { pragma: vi.fn(pragma), prepare: vi.fn() };
            startAutoBackup(db as unknown as Database.Database, dbPath, { dir: backups, keep: 0 });
            stopAutoBackup();
            expect(db.pragma).toHaveBeenCalledWith('integrity_check');
            expect(db.prepare).not.toHaveBeenCalled();
        }
        expect(error).toHaveBeenCalledWith(expect.stringContaining('integrity check failed'), damaged);
        expect(error).toHaveBeenCalledWith('Backup: integrity check failed to run:', 'disk I/O error');
        expect(fs.readdirSync(backups)).toEqual(['web-session-storage.db.20200101000000.backup.7z']);
    });

    it('skips when the database file is missing', () => {
        const { error } = quiet();
        const { dir, db, backups } = liveDatabase();
        startAutoBackup(db, path.join(dir, 'missing.db'), { dir: backups });
        expect(error).toHaveBeenCalledWith('Backup: cannot stat database file, skipping.');
        expect(fs.existsSync(backups)).toBe(false);
    });

    it('says how to point at 7-Zip when it is missing, and leaves no temp file behind', async () => {
        const { error } = quiet();
        const { dir, dbPath, db, backups } = liveDatabase();
        vi.stubEnv('MIYAPAD_7Z_PATH', path.join(dir, 'no-7z'));
        vi.resetModules();
        const backup = await import('./backup.js');
        try {
            backup.startAutoBackup(db, dbPath, { dir: backups });
            await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Backup: compression failed:', expect.stringContaining('Set MIYAPAD_7Z_PATH')));
        } finally {
            backup.stopAutoBackup();
            vi.unstubAllEnvs();
        }
        expect(fs.readdirSync(backups)).toEqual([]);
    });
});
