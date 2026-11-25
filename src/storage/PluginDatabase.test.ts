import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { PLUGIN_DB_PREFIX, PLUGIN_DB_VERSION, PluginContainerError, PluginDatabase } from './PluginDatabase';

let pluginDb: PluginDatabase;

beforeEach(() => {
	vi.stubGlobal('indexedDB', new IDBFactory());
	pluginDb = new PluginDatabase();
});

afterEach(() => {
	pluginDb.closeAll();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('PluginDatabase (standalone IndexedDB)', () => {
	it('gets, sets, lists, deletes, and clears values without mixing namespaces', async () => {
		const root = pluginDb.dbFor('counter', '');
		const cache = pluginDb.dbFor('counter', 'cache');
		const otherPlugin = pluginDb.dbFor('other', 'cache');

		expect(await root.get('missing')).toBeUndefined();
		expect(await root.keys()).toEqual([]);

		await root.set('cache/x', 'in-root');
		await cache.set('x', 'in-cache');
		await cache.set('image/1', { ok: true });
		await cache.set('image/2', [1, 2]);
		await otherPlugin.set('x', 'in-other-plugin');

		expect(await root.get('cache/x')).toBe('in-root');
		expect(await cache.get('x')).toBe('in-cache');
		expect(await otherPlugin.get('x')).toBe('in-other-plugin');

		expect(await root.keys()).toEqual(['cache/x']);
		expect(await cache.keys()).toEqual(['image/1', 'image/2', 'x']);
		expect(await cache.keys('image/')).toEqual(['image/1', 'image/2']);

		await cache.delete('image/1');
		expect(await cache.keys('image/')).toEqual(['image/2']);

		await cache.clear();
		expect(await cache.keys()).toEqual([]);
		expect(await root.get('cache/x')).toBe('in-root');
		expect(await otherPlugin.get('x')).toBe('in-other-plugin');
	});

	it('treats `%`, `_`, `\\`, and ASCII case literally in keys(prefix)', async () => {
		const ns = pluginDb.dbFor('p', 'files');
		await ns.set('a_b/1', 1);
		await ns.set('aXb/1', 2);
		await ns.set('50%/1', 3);
		await ns.set('50X/1', 4);
		await ns.set('A_b/1', 5);
		await ns.set('c\\d/1', 6);

		expect(await ns.keys('a_b/')).toEqual(['a_b/1']);
		expect(await ns.keys('50%/')).toEqual(['50%/1']);
		expect(await ns.keys('c\\d/')).toEqual(['c\\d/1']);
	});

	it('validates namespace names and converts keys to strings', async () => {
		for (const bad of ['Upper', 'a/b', 'x'.repeat(33), 'a.b', 'a b']) {
			expect(() => pluginDb.dbFor('p', bad)).toThrow(TypeError);
		}
		const ns = pluginDb.dbFor('p', 'valid_ns-1');
		await ns.set(42 as unknown as string, 'forty-two');
		expect(await ns.get('42')).toBe('forty-two');
		expect(await ns.get(42 as unknown as string)).toBe('forty-two');
	});

	it('converts values through JSON and rejects undefined or BigInt synchronously before queueing', async () => {
		const ns = pluginDb.dbFor('p', '');
		const date = new Date(Date.UTC(2026, 4, 10));
		const box = { when: date };
		const pending = ns.set('when', box);
		box.when = new Date(0);
		await pending;

		expect(await ns.get('when')).toEqual({ when: '2026-05-10T00:00:00.000Z' });
		await expect(ns.set('bad', undefined)).rejects.toThrow(TypeError);
		await expect(ns.set('bad', 10n)).rejects.toThrow(TypeError);
		expect(await ns.keys()).toEqual(['when']);
	});

	it('serializes operations per container in queue order', async () => {
		const ns = pluginDb.dbFor('p', 'q');
		await Promise.all([
			ns.set('k', 1),
			ns.set('k', 2),
			ns.delete('k'),
			ns.set('k', 3),
		]);
		expect(await ns.get('k')).toBe(3);
	});

	it('deletes the plugin container without affecting other plugins', async () => {
		const gone = pluginDb.dbFor('gone', 'ns');
		const kept = pluginDb.dbFor('kept', 'ns');
		await gone.set('a', 1);
		await kept.set('a', 2);

		await pluginDb.deleteContainer('gone');

		expect(await gone.get('a')).toBeUndefined();
		expect(await gone.keys()).toEqual([]);
		expect(await kept.get('a')).toBe(2);
	});

	it('reports an unreadable container via onContainerError and recovers after deleteContainer', async () => {
		// Create a broken `miyapad-plugin-broken` database at version 1 WITHOUT the `kv` store.
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open(`${PLUGIN_DB_PREFIX}broken`, PLUGIN_DB_VERSION);
			req.onupgradeneeded = () => {
				req.result.createObjectStore('wrong_store');
			};
			req.onsuccess = () => { req.result.close(); resolve(); };
			req.onerror = () => reject(req.error);
		});

		const onContainerError = vi.fn();
		const db = new PluginDatabase({ onContainerError });
		try {
			await expect(db.dbFor('broken', '').get('k')).rejects.toThrow(PluginContainerError);
			expect(onContainerError).toHaveBeenCalledTimes(1);
			expect(onContainerError.mock.calls[0][0]).toBe('broken');

			await db.deleteContainer('broken');
			await db.dbFor('broken', '').set('k', 'recovered');
			expect(await db.dbFor('broken', '').get('k')).toBe('recovered');
		} finally {
			db.closeAll();
		}
	});
});

describe('PluginDatabase (server mode)', () => {
	it('routes KV calls and container deletes through /plugin-db/* and reports unreadable containers', async () => {
		const calls: { url: string; body: Record<string, unknown> }[] = [];
		vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			calls.push({ url, body });
			if (body.id === 'corrupt') {
				return new Response(JSON.stringify({ ok: false, unreadable: true, message: 'file is not a database' }), { status: 500 });
			}
			if (url.endsWith('/plugin-db/get')) {
				return new Response(JSON.stringify({ ok: true, value: { saved: true } }));
			}
			if (url.endsWith('/plugin-db/keys')) {
				return new Response(JSON.stringify({ ok: true, keys: ['img/1'] }));
			}
			return new Response(JSON.stringify({ ok: true }));
		}));

		const onContainerError = vi.fn();
		const srv = new PluginDatabase({ serverEndpoint: 'http://127.0.0.1:3000', onContainerError });
		const cache = srv.dbFor('demo', 'cache');

		await cache.set('img/1', { saved: true });
		expect(await cache.get('img/1')).toEqual({ saved: true });
		expect(await cache.keys('img/')).toEqual(['img/1']);
		await cache.delete('img/1');
		await cache.clear();
		await srv.deleteContainer('demo');

		expect(calls.map(c => new URL(c.url).pathname)).toEqual([
			'/plugin-db/set',
			'/plugin-db/get',
			'/plugin-db/keys',
			'/plugin-db/delete',
			'/plugin-db/clear',
			'/plugin-db/drop',
		]);

		await expect(srv.dbFor('corrupt', '').get('x')).rejects.toThrow(PluginContainerError);
		expect(onContainerError).toHaveBeenCalledWith('corrupt', expect.any(PluginContainerError));
	});
});
