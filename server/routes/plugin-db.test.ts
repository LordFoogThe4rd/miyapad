// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Express, Request, Response } from 'express';
import { PluginDbManager } from '../lib/plugin-db.js';
import pluginDbRoutes from './plugin-db.js';

type Handler = (req: Request, res: Response) => void | Promise<void>;

let dir: string;
let manager: PluginDbManager;
let routes: Record<string, Handler>;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyapad-plugin-db-'));
    manager = new PluginDbManager(path.join(dir, 'plugins'));
    routes = {};
    pluginDbRoutes(
        { post: (route: string, handler: Handler) => { routes[route] = handler; } } as unknown as Express,
        manager,
    );
});

afterEach(async () => {
    await manager.closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
});

async function post(route: string, body: Record<string, unknown>) {
    const res = {
        status: 200,
        body: undefined as Record<string, unknown> | undefined,
    };
    const fake = {
        status(code: number) { res.status = code; return fake; },
        json(payload: Record<string, unknown>) { res.body = payload; return fake; },
    };
    await routes[route]({ body } as Request, fake as unknown as Response);
    return res;
}

describe('/plugin-db KV and container routes', () => {
    it('handles a missing container without creating files on disk', async () => {
        expect(await post('/plugin-db/get', { id: 'notes', ns: '', key: 'a' })).toEqual({ status: 200, body: { ok: true } });
        expect(await post('/plugin-db/keys', { id: 'notes', ns: '' })).toEqual({ status: 200, body: { ok: true, keys: [] } });
        expect(await post('/plugin-db/delete', { id: 'notes', ns: '', key: 'a' })).toEqual({ status: 200, body: { ok: true } });
        expect(await post('/plugin-db/clear', { id: 'notes', ns: '' })).toEqual({ status: 200, body: { ok: true } });
        expect(await post('/plugin-db/drop', { id: 'notes' })).toEqual({ status: 200, body: { ok: true } });
        expect(fs.existsSync(path.join(dir, 'plugins'))).toBe(false);
    });

    it('round-trips JSON values, isolates namespaces, escapes LIKE wildcards, and drops containers', async () => {
        expect((await post('/plugin-db/set', { id: 'notes', ns: '', key: 'cache/x', value: { root: true } })).body).toEqual({ ok: true });
        expect((await post('/plugin-db/set', { id: 'notes', ns: 'cache', key: 'x', value: [1, 2, null] })).body).toEqual({ ok: true });
        expect((await post('/plugin-db/set', { id: 'notes', ns: 'cache', key: 'img_1/a', value: 'underscore' })).body).toEqual({ ok: true });
        expect((await post('/plugin-db/set', { id: 'notes', ns: 'cache', key: 'imgX1/a', value: 'other' })).body).toEqual({ ok: true });
        expect((await post('/plugin-db/set', { id: 'notes', ns: 'cache', key: '100%/done', value: 'percent' })).body).toEqual({ ok: true });
        expect((await post('/plugin-db/set', { id: 'notes', ns: 'cache', key: '100X/done', value: 'not-percent' })).body).toEqual({ ok: true });
        expect((await post('/plugin-db/set', { id: 'notes', ns: 'cache', key: 'Img_1/a', value: 'upper' })).body).toEqual({ ok: true });

        expect((await post('/plugin-db/get', { id: 'notes', ns: '', key: 'cache/x' })).body).toEqual({ ok: true, value: { root: true } });
        expect((await post('/plugin-db/get', { id: 'notes', ns: 'cache', key: 'x' })).body).toEqual({ ok: true, value: [1, 2, null] });

        // Wildcard characters `_` and `%` and ASCII case must match literally.
        expect((await post('/plugin-db/keys', { id: 'notes', ns: 'cache', prefix: 'img_1/' })).body).toEqual({ ok: true, keys: ['img_1/a'] });
        expect((await post('/plugin-db/keys', { id: 'notes', ns: 'cache', prefix: '100%/' })).body).toEqual({ ok: true, keys: ['100%/done'] });
        expect((await post('/plugin-db/keys', { id: 'notes', ns: '' })).body).toEqual({ ok: true, keys: ['cache/x'] });

        // Clearing one namespace leaves the default namespace intact.
        expect((await post('/plugin-db/clear', { id: 'notes', ns: 'cache' })).body).toEqual({ ok: true });
        expect((await post('/plugin-db/keys', { id: 'notes', ns: 'cache' })).body).toEqual({ ok: true, keys: [] });
        expect((await post('/plugin-db/get', { id: 'notes', ns: '', key: 'cache/x' })).body).toEqual({ ok: true, value: { root: true } });

        // Deleting a single key removes only that key.
        expect((await post('/plugin-db/delete', { id: 'notes', ns: '', key: 'cache/x' })).body).toEqual({ ok: true });
        expect((await post('/plugin-db/get', { id: 'notes', ns: '', key: 'cache/x' })).body).toEqual({ ok: true });

        // Dropping the container closes the open WAL database and removes its files.
        expect(fs.existsSync(path.join(dir, 'plugins', 'notes.db'))).toBe(true);
        expect((await post('/plugin-db/drop', { id: 'notes' })).body).toEqual({ ok: true });
        expect(fs.existsSync(path.join(dir, 'plugins', 'notes.db'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'plugins', 'notes.db-wal'))).toBe(false);
    });

    it('rejects bad plugin ids, namespaces, and missing keys or values with 400', async () => {
        for (const badId of ['', '../escape', 'Upper', '-dash', 'a/b', 123]) {
            expect((await post('/plugin-db/get', { id: badId, ns: '', key: 'k' })).status).toBe(400);
            expect((await post('/plugin-db/drop', { id: badId })).status).toBe(400);
            expect((await post('/plugin-db/query', { id: badId, name: 'ns', sql: 'SELECT 1', mode: 'query' })).status).toBe(400);
        }
        for (const badNs of ['Upper', 'a/b', 'x'.repeat(33), 42, null]) {
            expect((await post('/plugin-db/get', { id: 'ok', ns: badNs, key: 'k' })).status).toBe(400);
            expect((await post('/plugin-db/query', { id: 'ok', name: badNs, sql: 'SELECT 1', mode: 'query' })).status).toBe(400);
        }
        expect((await post('/plugin-db/get', { id: 'ok', ns: '' })).status).toBe(400);
        expect((await post('/plugin-db/set', { id: 'ok', ns: '', key: 'k' })).status).toBe(400);
        expect((await post('/plugin-db/keys', { id: 'ok', ns: '', prefix: {} })).status).toBe(400);
        expect((await post('/plugin-db/query', { id: 'ok', name: 'ns', sql: '', mode: 'query' })).status).toBe(400);
        expect((await post('/plugin-db/query', { id: 'ok', name: 'ns', sql: 'SELECT 1', mode: 'bad' })).status).toBe(400);
        expect((await post('/plugin-db/query', { id: 'ok', name: 'ns', sql: 'SELECT 1', params: 'nope', mode: 'query' })).status).toBe(400);
        expect((await post('/plugin-db/query', { id: 'ok', name: 'ns', sql: 'SELECT ?', params: [{}], mode: 'query' })).status).toBe(400);
    });

    it('flags an unreadable container as unreadable and recovers when dropped', async () => {
        const pluginsDir = path.join(dir, 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });
        fs.writeFileSync(path.join(pluginsDir, 'broken.db'), 'not a sqlite file');

        const failed = await post('/plugin-db/get', { id: 'broken', ns: '', key: 'k' });
        expect(failed.status).toBe(500);
        expect(failed.body).toMatchObject({ ok: false, unreadable: true });

        // Dropping recovers the unreadable container without leaving open handles.
        expect(await post('/plugin-db/drop', { id: 'broken' })).toEqual({ status: 200, body: { ok: true } });
        expect(await post('/plugin-db/set', { id: 'broken', ns: '', key: 'k', value: 'healthy' })).toEqual({ status: 200, body: { ok: true } });
        expect((await post('/plugin-db/get', { id: 'broken', ns: '', key: 'k' })).body).toEqual({ ok: true, value: 'healthy' });
    });

    it('executes raw SQL queries, denies ATTACH/PRAGMA/VACUUM, enforces the row cap, and drops cleanly', async () => {
        expect(await post('/plugin-db/query', {
            id: 'notes',
            name: 'notes',
            sql: 'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, tag TEXT)',
            params: [],
            mode: 'exec',
        })).toEqual({ status: 200, body: { ok: true } });

        expect(await post('/plugin-db/query', {
            id: 'notes',
            name: 'notes',
            sql: 'INSERT INTO notes (tag) VALUES (?)',
            params: ['x'],
            mode: 'exec',
        })).toEqual({ status: 200, body: { ok: true } });

        expect(await post('/plugin-db/query', {
            id: 'notes',
            name: 'notes',
            sql: 'SELECT id, tag FROM notes WHERE tag = ?',
            params: ['x'],
            mode: 'query',
        })).toEqual({ status: 200, body: { ok: true, rows: [{ id: 1, tag: 'x' }] } });

        for (const denied of [
            "ATTACH DATABASE ':memory:' AS extra",
            'PRAGMA journal_mode',
            'VACUUM',
        ]) {
            const res = await post('/plugin-db/query', {
                id: 'notes',
                name: 'notes',
                sql: denied,
                params: [],
                mode: 'exec',
            });
            expect(res.status).toBe(500);
            expect(res.body).toMatchObject({ ok: false });
        }

        const tooMany = await post('/plugin-db/query', {
            id: 'notes',
            name: 'notes',
            sql: 'WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n < 5001) SELECT n FROM c',
            params: [],
            mode: 'query',
        });
        expect(tooMany.status).toBe(500);
        expect(tooMany.body).toMatchObject({ ok: false });

        // Dropping terminates the active worker and deletes the database file.
        expect(await post('/plugin-db/drop', { id: 'notes' })).toEqual({ status: 200, body: { ok: true } });
        expect(fs.existsSync(path.join(dir, 'plugins', 'notes.db'))).toBe(false);
    });
});
