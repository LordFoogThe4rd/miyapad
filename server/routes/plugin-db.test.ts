// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Express, Request, Response } from 'express';
import { PluginDbManager } from '../lib/plugin-db.js';
import pluginDbRoutes from './plugin-db.js';

type Handler = (req: Request, res: Response) => void;

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

afterEach(() => {
    manager.closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
});

function post(route: string, body: Record<string, unknown>) {
    const res = {
        status: 200,
        body: undefined as Record<string, unknown> | undefined,
    };
    const fake = {
        status(code: number) { res.status = code; return fake; },
        json(payload: Record<string, unknown>) { res.body = payload; return fake; },
    };
    routes[route]({ body } as Request, fake as unknown as Response);
    return res;
}

describe('/plugin-db KV and container routes', () => {
    it('handles a missing container without creating files on disk', () => {
        expect(post('/plugin-db/get', { id: 'notes', ns: '', key: 'a' })).toEqual({ status: 200, body: { ok: true } });
        expect(post('/plugin-db/keys', { id: 'notes', ns: '' })).toEqual({ status: 200, body: { ok: true, keys: [] } });
        expect(post('/plugin-db/delete', { id: 'notes', ns: '', key: 'a' })).toEqual({ status: 200, body: { ok: true } });
        expect(post('/plugin-db/clear', { id: 'notes', ns: '' })).toEqual({ status: 200, body: { ok: true } });
        expect(post('/plugin-db/drop', { id: 'notes' })).toEqual({ status: 200, body: { ok: true } });
        expect(fs.existsSync(path.join(dir, 'plugins'))).toBe(false);
    });

    it('round-trips JSON values, isolates namespaces, escapes LIKE wildcards, and drops containers', () => {
        expect(post('/plugin-db/set', { id: 'notes', ns: '', key: 'cache/x', value: { root: true } }).body).toEqual({ ok: true });
        expect(post('/plugin-db/set', { id: 'notes', ns: 'cache', key: 'x', value: [1, 2, null] }).body).toEqual({ ok: true });
        expect(post('/plugin-db/set', { id: 'notes', ns: 'cache', key: 'img_1/a', value: 'underscore' }).body).toEqual({ ok: true });
        expect(post('/plugin-db/set', { id: 'notes', ns: 'cache', key: 'imgX1/a', value: 'other' }).body).toEqual({ ok: true });
        expect(post('/plugin-db/set', { id: 'notes', ns: 'cache', key: '100%/done', value: 'percent' }).body).toEqual({ ok: true });
        expect(post('/plugin-db/set', { id: 'notes', ns: 'cache', key: '100X/done', value: 'not-percent' }).body).toEqual({ ok: true });
        expect(post('/plugin-db/set', { id: 'notes', ns: 'cache', key: 'Img_1/a', value: 'upper' }).body).toEqual({ ok: true });

        expect(post('/plugin-db/get', { id: 'notes', ns: '', key: 'cache/x' }).body).toEqual({ ok: true, value: { root: true } });
        expect(post('/plugin-db/get', { id: 'notes', ns: 'cache', key: 'x' }).body).toEqual({ ok: true, value: [1, 2, null] });

        // Wildcard characters `_` and `%` and ASCII case must match literally.
        expect(post('/plugin-db/keys', { id: 'notes', ns: 'cache', prefix: 'img_1/' }).body).toEqual({ ok: true, keys: ['img_1/a'] });
        expect(post('/plugin-db/keys', { id: 'notes', ns: 'cache', prefix: '100%/' }).body).toEqual({ ok: true, keys: ['100%/done'] });
        expect(post('/plugin-db/keys', { id: 'notes', ns: '' }).body).toEqual({ ok: true, keys: ['cache/x'] });

        // Clearing one namespace leaves the default namespace intact.
        expect(post('/plugin-db/clear', { id: 'notes', ns: 'cache' }).body).toEqual({ ok: true });
        expect(post('/plugin-db/keys', { id: 'notes', ns: 'cache' }).body).toEqual({ ok: true, keys: [] });
        expect(post('/plugin-db/get', { id: 'notes', ns: '', key: 'cache/x' }).body).toEqual({ ok: true, value: { root: true } });

        // Deleting a single key removes only that key.
        expect(post('/plugin-db/delete', { id: 'notes', ns: '', key: 'cache/x' }).body).toEqual({ ok: true });
        expect(post('/plugin-db/get', { id: 'notes', ns: '', key: 'cache/x' }).body).toEqual({ ok: true });

        // Dropping the container closes the open WAL database and removes its files.
        expect(fs.existsSync(path.join(dir, 'plugins', 'notes.db'))).toBe(true);
        expect(post('/plugin-db/drop', { id: 'notes' }).body).toEqual({ ok: true });
        expect(fs.existsSync(path.join(dir, 'plugins', 'notes.db'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'plugins', 'notes.db-wal'))).toBe(false);
    });

    it('rejects bad plugin ids, namespaces, and missing keys or values with 400', () => {
        for (const badId of ['', '../escape', 'Upper', '-dash', 'a/b', 123]) {
            expect(post('/plugin-db/get', { id: badId, ns: '', key: 'k' }).status).toBe(400);
            expect(post('/plugin-db/drop', { id: badId }).status).toBe(400);
        }
        for (const badNs of ['Upper', 'a/b', 'x'.repeat(33), 42, null]) {
            expect(post('/plugin-db/get', { id: 'ok', ns: badNs, key: 'k' }).status).toBe(400);
        }
        expect(post('/plugin-db/get', { id: 'ok', ns: '' }).status).toBe(400);
        expect(post('/plugin-db/set', { id: 'ok', ns: '', key: 'k' }).status).toBe(400);
        expect(post('/plugin-db/keys', { id: 'ok', ns: '', prefix: {} }).status).toBe(400);
    });

    it('flags an unreadable container as unreadable and recovers when dropped', () => {
        const pluginsDir = path.join(dir, 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });
        fs.writeFileSync(path.join(pluginsDir, 'broken.db'), 'not a sqlite file');

        const failed = post('/plugin-db/get', { id: 'broken', ns: '', key: 'k' });
        expect(failed.status).toBe(500);
        expect(failed.body).toMatchObject({ ok: false, unreadable: true });

        // Dropping recovers the unreadable container without leaving open handles.
        expect(post('/plugin-db/drop', { id: 'broken' })).toEqual({ status: 200, body: { ok: true } });
        expect(post('/plugin-db/set', { id: 'broken', ns: '', key: 'k', value: 'healthy' })).toEqual({ status: 200, body: { ok: true } });
        expect(post('/plugin-db/get', { id: 'broken', ns: '', key: 'k' }).body).toEqual({ ok: true, value: 'healthy' });
    });
});
