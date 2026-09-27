// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import systemRoutes from './system.js';
import { clearMaintenanceScheduler } from '../lib/database.js';
import { serve, postJson, hasZstd, zstdExtension, type Served } from '../lib/testing.js';

vi.mock('../lib/update.js', () => ({
    getUpdateInfo: () => ({ latestVersion: '9.9.9', downloadUrl: 'https://example.com/release' }),
}));
vi.mock('../tokenizer.js', () => ({ getAvailableTokenizers: () => ['tiny'] }));

let dir: string;
let db: Database.Database;
let server: Served;

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyapad-system-'));
    db = new Database(path.join(dir, 'test.db'));
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
    server = await serve(app => systemRoutes(app, db));
});

afterEach(async () => {
    clearMaintenanceScheduler();
    await server.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const get = async (route: string) => {
    const res = await fetch(server.url + route);
    return { status: res.status, body: await res.json() };
};
const post = (route: string, body: unknown) => postJson(server.url + route, body);

describe('/version', () => {
    it('reports the server version, features, tokenizers and the latest release', async () => {
        expect((await get('/version')).body).toEqual({
            version: 4,
            features: { zstd_compression: true, server_tokenizer: true },
            tokenizers: ['tiny'],
            latestVersion: '9.9.9',
            downloadUrl: 'https://example.com/release',
        });
    });
});

describe('/vacuum', () => {
    it('vacuums the database', async () => {
        expect((await get('/vacuum')).body.ok).toBe(true);
    });

    it('answers 500 when VACUUM fails', async () => {
        db.exec('BEGIN');
        const res = await get('/vacuum');
        db.exec('ROLLBACK');
        expect(res.status).toBe(500);
        expect(res.body.ok).toBe(false);
    });
});

describe('/zstd_maintenance', () => {
    it('refuses a bad duration or load with 400', async () => {
        for (const body of [{ duration: -1 }, { duration: '5' }, { dbLoad: 1.5 }, { dbLoad: -0.1 }, { dbLoad: '1' }]) {
            expect((await post('/zstd_maintenance', body)).status).toBe(400);
        }
    });

    it('reports a maintenance failure in the answer', async () => {
        const res = await post('/zstd_maintenance', { duration: 1, dbLoad: 1 });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(false);
    });

    it.skipIf(!hasZstd)('runs maintenance with the extension loaded', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        db.loadExtension(zstdExtension);
        expect((await post('/zstd_maintenance', { duration: 1, dbLoad: 1 })).body).toEqual({ ok: true, message: 'zstd maintenance completed.' });
    });
});

describe('/maintenance_config', () => {
    const defaults = { duration: 5, dbLoad: 0.5, mode: 'shutdown', interval: 60, walEnabled: false };

    it('starts from the defaults', async () => {
        expect((await get('/maintenance_config')).body).toEqual(defaults);
    });

    it('saves a config over the defaults and reads it back', async () => {
        const res = await post('/maintenance_config', { duration: 2, mode: 'startup' });
        expect(res.body).toEqual({ ok: true, config: { ...defaults, duration: 2, mode: 'startup' } });
        expect((await get('/maintenance_config')).body).toEqual({ ...defaults, duration: 2, mode: 'startup' });
    });

    it('switches WAL on and off', async () => {
        const journal = () => db.pragma('journal_mode', { simple: true });
        await post('/maintenance_config', { walEnabled: true });
        expect(journal()).toBe('wal');
        await post('/maintenance_config', { walEnabled: false });
        expect(journal()).toBe('delete');
    });

    it('runs maintenance on an interval in interval mode and stops when switched off', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const prepare = vi.spyOn(db, 'prepare');
        const ran = () => prepare.mock.calls.filter(([sql]) => sql.includes('zstd_incremental_maintenance')).length;

        await post('/maintenance_config', { mode: 'interval', interval: 0.0005 });
        await vi.waitFor(() => expect(ran()).toBeGreaterThanOrEqual(2));

        await post('/maintenance_config', { mode: 'shutdown' });
        const after = ran();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(ran()).toBe(after);
    });
});

describe('/log', () => {
    it('writes what the client sent to the server log', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        expect((await post('/log', { msg: 'hi' })).body).toEqual({ ok: true });
        expect(log).toHaveBeenCalledWith('[CLIENT LOG]', { msg: 'hi' });
    });
});
