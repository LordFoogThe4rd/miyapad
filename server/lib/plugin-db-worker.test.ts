// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginDbManager, PluginQueryInputError } from './plugin-db.js';
import { containsVacuumKeyword, MAX_PARAMS, MAX_ROWS, MAX_SQL_BYTES } from './plugin-db-worker.js';

let dir: string;
let manager: PluginDbManager;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyapad-plugin-worker-'));
    manager = new PluginDbManager(path.join(dir, 'plugins'), { queryTimeoutMs: 250 });
});

afterEach(async () => {
    await manager.closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('plugin-db-worker', () => {
    it('runs DDL, parameterized writes, and SELECT queries in a worker alongside KV', async () => {
        manager.set('notes', 'kvns', 'hello', { ok: true });
        await manager.rawQuery(
            'notes',
            'notes',
            'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, tag TEXT, pinned INTEGER)',
            [],
            'exec',
        );
        await manager.rawQuery(
            'notes',
            'notes',
            'INSERT INTO notes (tag, pinned) VALUES (?, ?)',
            ['work', true],
            'exec',
        );

        const rows = await manager.rawQuery(
            'notes',
            'notes',
            'SELECT tag, pinned FROM notes WHERE tag = ?',
            ['work'],
            'query',
        );
        expect(rows).toEqual([{ tag: 'work', pinned: 1 }]);
        expect(manager.get('notes', 'kvns', 'hello')).toEqual({ ok: true });
    });

    it('denies ATTACH, DETACH, PRAGMA, load_extension, and VACUUM while allowing quoted vacuum text', async () => {
        await manager.rawQuery('sec', 'ns', 'CREATE TABLE t (x TEXT)', [], 'exec');

        await expect(
            manager.rawQuery('sec', 'ns', "ATTACH DATABASE ':memory:' AS other", [], 'exec'),
        ).rejects.toThrow(/not authorized/i);

        await expect(
            manager.rawQuery('sec', 'ns', 'DETACH DATABASE main', [], 'exec'),
        ).rejects.toThrow(/not authorized/i);

        await expect(
            manager.rawQuery('sec', 'ns', 'PRAGMA user_version = 1', [], 'exec'),
        ).rejects.toThrow(/not authorized/i);

        await expect(
            manager.rawQuery('sec', 'ns', "SELECT load_extension('evil')", [], 'query'),
        ).rejects.toThrow(/not authorized|no such function/i);

        await expect(
            manager.rawQuery('sec', 'ns', 'VACUUM', [], 'exec'),
        ).rejects.toThrow(/VACUUM/i);

        await expect(
            manager.rawQuery('sec', 'ns', "VACUUM INTO 'outside.db'", [], 'exec'),
        ).rejects.toThrow(/VACUUM/i);

        expect(containsVacuumKeyword("SELECT 'vacuum' AS label")).toBe(false);
        const literal = await manager.rawQuery('sec', 'ns', "SELECT 'vacuum' AS label", [], 'query');
        expect(literal).toEqual([{ label: 'vacuum' }]);
    });

    it('terminates a slow query on timeout and recovers on the next query', async () => {
        await manager.rawQuery('slow', 'ns', 'CREATE TABLE items (n INTEGER)', [], 'exec');
        await manager.rawQuery('slow', 'ns', 'INSERT INTO items (n) VALUES (?)', [42], 'exec');

        const slowSql = `
            WITH RECURSIVE cnt(x) AS (
                SELECT 1
                UNION ALL
                SELECT x + 1 FROM cnt WHERE x < 50000000
            )
            SELECT count(*) AS total FROM cnt
        `;
        await expect(
            manager.rawQuery('slow', 'ns', slowSql, [], 'query'),
        ).rejects.toThrow(/timed out/i);

        // Next query spawns a fresh worker and reads the recovered WAL database cleanly.
        const rows = await manager.rawQuery('slow', 'ns', 'SELECT n FROM items', [], 'query');
        expect(rows).toEqual([{ n: 42 }]);
    });

    it('enforces row, serialized byte, SQL length, and parameter count caps', async () => {
        const atLimit = await manager.rawQuery(
            'caps',
            'ns',
            `WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < ${MAX_ROWS}) SELECT x FROM cnt`,
            [],
            'query',
        );
        expect(atLimit).toHaveLength(MAX_ROWS);

        await expect(
            manager.rawQuery(
                'caps',
                'ns',
                `WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < ${MAX_ROWS + 1}) SELECT x FROM cnt`,
                [],
                'query',
            ),
        ).rejects.toThrow(/5,000 row limit/i);

        // 200 rows x ~30 KB each > 5 MB serialized result cap
        await expect(
            manager.rawQuery(
                'caps',
                'ns',
                "WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 200) SELECT hex(randomblob(16000)) AS blob FROM cnt",
                [],
                'query',
            ),
        ).rejects.toThrow(/5 MB limit/i);

        await expect(
            manager.rawQuery('caps', 'ns', 'SELECT ' + '1'.repeat(MAX_SQL_BYTES), [], 'query'),
        ).rejects.toThrow(PluginQueryInputError);

        await expect(
            manager.rawQuery(
                'caps',
                'ns',
                'SELECT 1',
                Array.from({ length: MAX_PARAMS + 1 }, (_, i) => i),
                'query',
            ),
        ).rejects.toThrow(PluginQueryInputError);
    });
});
