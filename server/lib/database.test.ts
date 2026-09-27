// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import Database from 'better-sqlite3';
import { initDatabase, clearMaintenanceScheduler } from './database.js';
import { getColumnName } from './utils.js';
import { hasZstd } from './testing.js';

const compressedTables = ['sessions', 'templates', 'themes', 'connections', 'samplerpresets', 'sessionhistory'];

describe.skipIf(!hasZstd)('initDatabase', () => {
    let dir: string;
    let dbPath: string;
    let log: ReturnType<typeof vi.spyOn>;
    const open: Database.Database[] = [];

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyapad-db-'));
        dbPath = path.join(dir, 'web-session-storage.db');
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        for (const db of open.splice(0)) db.close();
        clearMaintenanceScheduler();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    /** Writes a database the way an older server left it. */
    function legacy(sql: string, rows: Record<string, [string, string | Buffer][]>) {
        const db = new Database(dbPath);
        db.exec(sql);
        for (const [table, entries] of Object.entries(rows)) {
            for (const [key, data] of entries) db.prepare(`INSERT INTO ${table} (key, data) VALUES (?, ?)`).run(key, data);
        }
        db.close();
    }

    async function init() {
        const db = await initDatabase(dbPath);
        open.push(db);
        return db;
    }

    const version = (db: Database.Database) => db.prepare("SELECT value FROM meta WHERE key = 'version'").pluck().get();
    const rows = (db: Database.Database, table: string) => Object.fromEntries(
        (db.prepare(`SELECT key, ${getColumnName(table)} AS data FROM ${table}`).all() as { key: string; data: unknown }[])
            .map(row => [row.key, table === 'names' ? row.data : JSON.parse(String(row.data))]),
    );
    const kind = (db: Database.Database, name: string) => db.prepare('SELECT type FROM sqlite_master WHERE name = ?').pluck().get(name);

    // sqlite-zstd only trains a dictionary, and so only compresses, once a table holds ~500kB.
    const manySessions = Array.from({ length: 100 }, (_, i) => ({ prompt: `Once upon a time, story number ${i} began. `.repeat(150), seed: i }));

    it('creates a new database at version 4 with every data table compressed', async () => {
        const db = await init();
        expect(version(db)).toBe('4');
        for (const table of compressedTables) {
            expect(kind(db, table)).toBe('view');
            expect(kind(db, `_${table}_zstd`)).toBe('table');
        }
        expect(kind(db, 'names')).toBe('table');
        expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Migrating'));
    });

    it('moves a v1 database, with names inside the sessions, to v4', async () => {
        legacy(`
            CREATE TABLE sessions (key TEXT PRIMARY KEY, data TEXT);
            CREATE TABLE templates (key TEXT PRIMARY KEY, data TEXT);
        `, {
            sessions: [
                ['1', JSON.stringify({ name: 'First', prompt: 'hello' })],
                ['2', JSON.stringify({ prompt: 'unnamed' })],
                ...manySessions.map((s, i): [string, string] => [String(i + 10), JSON.stringify(s)]),
            ],
            templates: [['t', '{"instPre":"[INST]"}']],
        });

        const db = await init();

        expect(version(db)).toBe('4');
        expect(rows(db, 'names')).toEqual({ 1: 'First' });
        expect(rows(db, 'sessions')).toEqual({
            1: { prompt: 'hello' },
            2: { prompt: 'unnamed' },
            ...Object.fromEntries(manySessions.map((s, i) => [i + 10, s])),
        });
        expect(rows(db, 'templates')).toEqual({ t: { instPre: '[INST]' } });
        for (const table of compressedTables) expect(kind(db, table)).toBe('view');
        const stored = db.prepare('SELECT session_data FROM _sessions_zstd').pluck().all();
        expect(stored.some(data => Buffer.isBuffer(data))).toBe(true);
    });

    it('moves a v3 database, gzipped under either column name, to v4 and keeps rows that were never gzipped', async () => {
        const gz = (value: unknown) => zlib.gzipSync(JSON.stringify(value));
        legacy(`
            CREATE TABLE sessions (key TEXT PRIMARY KEY, data BLOB);
            CREATE TABLE templates (key TEXT PRIMARY KEY, data BLOB);
            CREATE TABLE themes (key TEXT PRIMARY KEY, theme_data BLOB);
            CREATE TABLE names (key TEXT PRIMARY KEY, data TEXT);
            INSERT INTO themes VALUES ('dark', X'${gz({ bg: '#000' }).toString('hex')}');
        `, {
            sessions: [['1', gz({ prompt: 'zipped' })], ['2', '{"prompt":"plain"}']],
            templates: [['t', gz({ instPre: '[INST]' })]],
            names: [['1', '{"name":"First","created":1}'], ['2', 'Legacy']],
        });

        const db = await init();

        expect(version(db)).toBe('4');
        expect(rows(db, 'sessions')).toEqual({ 1: { prompt: 'zipped' }, 2: { prompt: 'plain' } });
        expect(rows(db, 'templates')).toEqual({ t: { instPre: '[INST]' } });
        expect(rows(db, 'themes')).toEqual({ dark: { bg: '#000' } });
        expect(rows(db, 'names')).toEqual({ 1: '{"name":"First","created":1}', 2: 'Legacy' });
        expect(rows(db, 'connections')).toEqual({});
        expect(rows(db, 'samplerpresets')).toEqual({});
    });

    it('leaves a v4 database as it is when opened again', async () => {
        legacy('CREATE TABLE sessions (key TEXT PRIMARY KEY, data TEXT); CREATE TABLE templates (key TEXT PRIMARY KEY, data TEXT);', {
            sessions: manySessions.map((s, i): [string, string] => [String(i), JSON.stringify({ ...s, name: `S${i}` })]),
        });
        const first = await init();
        const before = { sessions: rows(first, 'sessions'), names: rows(first, 'names') };
        first.close();
        open.splice(0);
        log.mockClear();

        const again = await init();
        expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Migrating'));
        expect(version(again)).toBe('4');
        expect({ sessions: rows(again, 'sessions'), names: rows(again, 'names') }).toEqual(before);
    });
});
