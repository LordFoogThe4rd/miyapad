// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import zstdRoutes from './zstd.js';
import { serve, postJson, hasZstd, zstdExtension, type Served } from '../lib/testing.js';

let db: Database.Database;
let server: Served;

beforeEach(async () => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE sessions (key TEXT PRIMARY KEY, session_data BLOB)');
    server = await serve(app => zstdRoutes(app, db));
});

afterEach(async () => {
    await server.close();
    db.close();
});

const getConfigs = async () => {
    const res = await fetch(server.url + '/zstd_get_configs');
    return { status: res.status, body: await res.json() };
};
const post = (route: string, body: unknown) => postJson(server.url + route, body);

// sqlite-zstd keeps its configs in this table; making it by hand tests the routes without the extension.
const fakeConfigTable = (...configs: string[]) => {
    db.exec('CREATE TABLE _zstd_configs (id INTEGER PRIMARY KEY, config TEXT)');
    for (const config of configs) db.prepare('INSERT INTO _zstd_configs (config) VALUES (?)').run(config);
};

describe('/zstd_get_configs', () => {
    it('returns each config by id, parsed, or raw when it is not JSON', async () => {
        fakeConfigTable('{"table":"sessions","compression_level":9}', 'not json');
        expect((await getConfigs()).body).toEqual({ ok: true, configs: { 1: { table: 'sessions', compression_level: 9 }, 2: 'not json' } });
    });

    it('answers 500 when compression was never set up', async () => {
        expect((await getConfigs()).status).toBe(500);
    });
});

describe('/zstd_update_transparent', () => {
    it('patches only the given settings into every config', async () => {
        fakeConfigTable('{"table":"sessions","compression_level":3,"dict_chooser":"\'a\'"}', '{"table":"templates","compression_level":3}');
        const res = await post('/zstd_update_transparent', { compression_level: 12 });
        expect(res.body).toEqual({ ok: true, message: 'Compression config updated', changes: 2 });
        await post('/zstd_update_transparent', { train_dict_samples_ratio: 50 });
        expect((await getConfigs()).body.configs).toEqual({
            1: { table: 'sessions', compression_level: 12, dict_chooser: "'a'", train_dict_samples_ratio: 50 },
            2: { table: 'templates', compression_level: 12, train_dict_samples_ratio: 50 },
        });
    });

    it('answers 500 when compression was never set up', async () => {
        expect((await post('/zstd_update_transparent', { compression_level: 12 })).status).toBe(500);
    });
});

describe('without the extension', () => {
    it('answers 500 to enabling compression and to maintenance', async () => {
        expect((await post('/zstd_enable_transparent', {})).status).toBe(500);
        expect((await post('/zstd_incremental_maintenance', {})).status).toBe(500);
    });
});

describe.skipIf(!hasZstd)('with the extension', () => {
    beforeEach(() => db.loadExtension(zstdExtension));

    it('enables compression on sessions at level 3 by default, and data still reads back', async () => {
        db.prepare('INSERT INTO sessions VALUES (?, ?)').run('a', '{"x":1}');
        expect((await post('/zstd_enable_transparent', {})).body.ok).toBe(true);
        expect((await getConfigs()).body.configs).toEqual({
            1: { table: 'sessions', column: 'session_data', compression_level: 3, dict_chooser: "'a'" },
        });
        expect((await post('/zstd_incremental_maintenance', { duration: null, db_load: 1 })).body.ok).toBe(true);
        expect(db.prepare('SELECT session_data FROM sessions').get()).toEqual({ session_data: '{"x":1}' });
    });

    it('uses the table\'s own column and passes the level and sample ratio on', async () => {
        db.exec('CREATE TABLE templates (key TEXT PRIMARY KEY, template_data BLOB)');
        await post('/zstd_enable_transparent', { table: 'templates', compression_level: 7, train_dict_samples_ratio: 20 });
        expect((await getConfigs()).body.configs[1]).toEqual({
            table: 'templates', column: 'template_data', compression_level: 7, dict_chooser: "'a'", train_dict_samples_ratio: 20,
        });
    });

    it('answers 500 for a table that does not exist', async () => {
        expect((await post('/zstd_enable_transparent', { table: 'nope' })).status).toBe(500);
    });
});
