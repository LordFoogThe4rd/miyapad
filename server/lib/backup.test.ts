// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { rotateBackups, timestamp } from './backup.js';

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
