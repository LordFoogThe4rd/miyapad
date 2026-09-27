// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Express, Request, Response } from 'express';
import dataRoutes, { toKey } from './data.js';
import { getColumnName } from '../lib/utils.js';

type Handler = (req: Request, res: Response) => void;

let db: Database.Database;
let routes: Record<string, Handler>;

beforeEach(() => {
    db = new Database(':memory:');
    for (const store of ['sessions', 'templates', 'samplerpresets']) {
        db.exec(`CREATE TABLE ${store} (key TEXT PRIMARY KEY, ${getColumnName(store)} BLOB)`);
    }
    db.exec('CREATE TABLE names (key TEXT PRIMARY KEY, data TEXT)');
    routes = {};
    dataRoutes({ post: (path: string, handler: Handler) => { routes[path] = handler; } } as unknown as Express, db);
});

afterEach(() => {
    db.close();
    vi.useRealTimers();
});

function post(path: string, body: Record<string, unknown>) {
    const res = {
        status: 200,
        body: undefined as any,
    };
    const fake = {
        status(code: number) { res.status = code; return fake; },
        json(payload: unknown) { res.body = payload; return fake; },
    };
    routes[path]({ body } as Request, fake as unknown as Response);
    return res;
}

const rawRow = (table: string, key: string) =>
    db.prepare(`SELECT ${getColumnName(table)} AS data FROM ${table} WHERE key = ?`).get(key) as { data: string } | undefined;

describe('toKey', () => {
    it('turns strings and numbers into strings', () => {
        expect(toKey('abc')).toBe('abc');
        expect(toKey(81)).toBe('81');
    });

    it('refuses anything else', () => {
        for (const key of [undefined, null, {}, [], true]) expect(toKey(key)).toBeNull();
    });
});

describe('/save and /load', () => {
    it('round-trips JSON through a store', () => {
        const data = { prompt: [{ type: 'user', content: 'hi' }], n: 1 };
        expect(post('/save', { storeName: 'Sessions', key: 'a', data }).body).toEqual({ ok: true, result: 'Data saved successfully' });
        expect(post('/load', { storeName: 'Sessions', key: 'a' }).body).toEqual({ ok: true, result: data });
    });

    it('finds a row saved under a string key when loaded with the same number', () => {
        post('/save', { storeName: 'sessions', key: '81', data: { x: 1 } });
        expect(post('/load', { storeName: 'sessions', key: 81 }).body.result).toEqual({ x: 1 });
    });

    it('overwrites an existing key', () => {
        post('/save', { storeName: 'templates', key: 't', data: 1 });
        post('/save', { storeName: 'templates', key: 't', data: 2 });
        expect(post('/load', { storeName: 'templates', key: 't' }).body.result).toBe(2);
    });

    it('stores a legacy string name as-is and a name object as JSON', () => {
        post('/save', { storeName: 'names', key: 'old', data: 'Legacy' });
        post('/save', { storeName: 'names', key: 'new', data: { name: 'Fresh', created: 1, modified: 2 } });
        expect(rawRow('names', 'old')?.data).toBe('Legacy');
        expect(post('/load', { storeName: 'names', key: 'old' }).body.result).toBe('Legacy');
        expect(post('/load', { storeName: 'names', key: 'new' }).body.result).toEqual({ name: 'Fresh', created: 1, modified: 2 });
    });

    it('returns a name that only looks like JSON as the plain string', () => {
        db.prepare('INSERT INTO names (key, data) VALUES (?, ?)').run('k', '42');
        expect(post('/load', { storeName: 'names', key: 'k' }).body.result).toBe('42');
    });

    it('refuses an unknown store or a missing key with 400', () => {
        expect(post('/save', { storeName: 'users', key: 'a', data: 1 }).status).toBe(400);
        expect(post('/save', { storeName: 'sessions', data: 1 }).status).toBe(400);
        expect(post('/load', { storeName: 'users', key: 'a' }).status).toBe(400);
        expect(post('/load', { storeName: 'sessions', key: { a: 1 } }).status).toBe(400);
    });

    it('answers 404 for a key that is not there', () => {
        expect(post('/load', { storeName: 'sessions', key: 'nope' })).toEqual({ status: 404, body: { ok: false, message: 'Key not found' } });
    });

    it('answers 500 when the stored data is not JSON', () => {
        db.prepare('INSERT INTO sessions (key, session_data) VALUES (?, ?)').run('bad', '{not json');
        expect(post('/load', { storeName: 'sessions', key: 'bad' }).status).toBe(500);
    });

    it('reads data stored as a BLOB', () => {
        db.prepare('INSERT INTO sessions (key, session_data) VALUES (?, ?)').run('b', Buffer.from('{"x":1}'));
        expect(post('/load', { storeName: 'sessions', key: 'b' }).body.result).toEqual({ x: 1 });
    });
});

describe('/rename', () => {
    it('changes the name and modified time and keeps the rest', () => {
        vi.useFakeTimers();
        vi.setSystemTime(5000);
        post('/save', { storeName: 'names', key: '1', data: { name: 'Old', created: 100, modified: 200, tags: ['x'] } });
        expect(post('/rename', { storeName: 'sessions', key: 1, newName: 'New' }).body.ok).toBe(true);
        expect(JSON.parse(rawRow('names', '1')!.data)).toEqual({ name: 'New', created: 100, modified: 5000, tags: ['x'] });
    });

    it('upgrades a legacy string name to an object with no creation time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(5000);
        post('/save', { storeName: 'names', key: '1', data: 'Old' });
        post('/rename', { storeName: 'sessions', key: '1', newName: 'New' });
        expect(JSON.parse(rawRow('names', '1')!.data)).toEqual({ name: 'New', created: null, modified: 5000 });
    });

    it('only renames sessions, and needs a key', () => {
        expect(post('/rename', { storeName: 'templates', key: '1', newName: 'x' }).status).toBe(400);
        expect(post('/rename', { storeName: 'sessions', newName: 'x' }).status).toBe(400);
    });
});

describe('/all', () => {
    it('returns every row of a store, parsed', () => {
        post('/save', { storeName: 'templates', key: 'a', data: { x: 1 } });
        post('/save', { storeName: 'templates', key: 'b', data: [2] });
        expect(post('/all', { storeName: 'templates' }).body).toEqual({ ok: true, result: { a: { x: 1 }, b: [2] } });
    });

    it('returns names unparsed', () => {
        post('/save', { storeName: 'names', key: 'a', data: { name: 'A' } });
        expect(post('/all', { storeName: 'names' }).body.result).toEqual({ a: '{"name":"A"}' });
    });

    it('answers 500 when any row is not JSON, and 400 for an unknown store', () => {
        db.prepare('INSERT INTO templates (key, template_data) VALUES (?, ?)').run('bad', 'nope');
        expect(post('/all', { storeName: 'templates' }).status).toBe(500);
        expect(post('/all', { storeName: 'users' }).status).toBe(400);
    });
});

describe('/sessions', () => {
    it('lists names, parsing objects and keeping legacy strings', () => {
        post('/save', { storeName: 'names', key: '1', data: { name: 'A', created: 1 } });
        post('/save', { storeName: 'names', key: '2', data: 'Legacy' });
        post('/save', { storeName: 'names', key: '3', data: '{"no":"name"}' });
        expect(post('/sessions', {}).body.result).toEqual({
            1: { name: 'A', created: 1 },
            2: 'Legacy',
            3: '{"no":"name"}',
        });
    });
});

describe('/delete', () => {
    it('deletes a session together with its name', () => {
        post('/save', { storeName: 'sessions', key: '7', data: {} });
        post('/save', { storeName: 'names', key: '7', data: { name: 'S' } });
        expect(post('/delete', { storeName: 'sessions', key: 7 }).body.ok).toBe(true);
        expect(rawRow('sessions', '7')).toBeUndefined();
        expect(rawRow('names', '7')).toBeUndefined();
    });

    it('leaves names alone when deleting from another store', () => {
        post('/save', { storeName: 'templates', key: '7', data: {} });
        post('/save', { storeName: 'names', key: '7', data: 'S' });
        post('/delete', { storeName: 'templates', key: '7' });
        expect(rawRow('templates', '7')).toBeUndefined();
        expect(rawRow('names', '7')?.data).toBe('S');
    });

    it('refuses an unknown store or a missing key with 400', () => {
        expect(post('/delete', { storeName: 'users', key: '1' }).status).toBe(400);
        expect(post('/delete', { storeName: 'sessions' }).status).toBe(400);
    });
});

describe('/batch', () => {
    it('applies saves and deletes in order', () => {
        post('/save', { storeName: 'samplerpresets', key: 'gone', data: 1 });
        const res = post('/batch', {
            storeName: 'samplerpresets',
            ops: [
                { type: 'save', key: 'a', data: { t: 1 } },
                { type: 'save', key: 2, data: null },
                { type: 'delete', key: 'gone' },
            ],
        });
        expect(res.body).toEqual({ ok: true, result: 'Batch completed' });
        expect(post('/all', { storeName: 'samplerpresets' }).body.result).toEqual({ a: { t: 1 }, 2: null });
    });

    it('rejects the whole batch before writing anything when one op is invalid', () => {
        const bad = [
            { type: 'rename', key: 'a' },
            null,
            { type: 'save', data: 1 },
            { type: 'save', key: 'b' },
        ];
        for (const op of bad) {
            const res = post('/batch', { storeName: 'templates', ops: [{ type: 'save', key: 'ok', data: 1 }, op] });
            expect(res.status).toBe(400);
        }
        expect(rawRow('templates', 'ok')).toBeUndefined();
    });

    it('refuses an unknown store or an empty op list with 400', () => {
        expect(post('/batch', { storeName: 'users', ops: [{ type: 'delete', key: 'a' }] }).status).toBe(400);
        expect(post('/batch', { storeName: 'templates', ops: [] }).status).toBe(400);
        expect(post('/batch', { storeName: 'templates' }).status).toBe(400);
    });

    it('rolls back every op when one fails in the database', () => {
        db.exec(`CREATE TRIGGER no_bad BEFORE INSERT ON templates WHEN NEW.key = 'bad' BEGIN SELECT RAISE(ABORT, 'nope'); END`);
        const res = post('/batch', {
            storeName: 'templates',
            ops: [{ type: 'save', key: 'a', data: 1 }, { type: 'save', key: 'bad', data: 2 }],
        });
        expect(res.status).toBe(500);
        expect(rawRow('templates', 'a')).toBeUndefined();
    });
});
