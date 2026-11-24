import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
	checkRequirements,
	checkVersion,
	clearPluginRuntimeError,
	DEFAULT_PLUGIN_START_TIMEOUT_S,
	fetchPluginCode,
	fetchPluginFromUrl,
	getPluginRuntimeErrors,
	hooks,
	parseHeader,
	pluginHooksFor,
	pluginNameFromUrl,
	pluginStateView,
	runOutputHooks,
	runPlugins,
	runPromptHooks,
	startPlugins,
	switchOffMismatched,
} from './plugins';
import { legacyManifest } from './plugins/manifest';
import { APP_VERSION } from './version';
import type { PluginStorage } from './storage/PluginStorage';

function makeRecord(
	id: string,
	overrides: Partial<Omit<PluginRecord, 'manifest'>> & { manifest?: Partial<PluginManifest> } = {},
): PluginRecord {
	const { manifest, ...rest } = overrides;
	return {
		code: '',
		enabled: true,
		...rest,
		manifest: {
			...legacyManifest(id),
			...manifest,
			id,
		},
	};
}

beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	hooks.prompt.length = 0;
	hooks.output.length = 0;
	hooks.commands.length = 0;
	clearPluginRuntimeError();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('parseHeader', () => {
	it('reads both lines from the comments at the top', () => {
		expect(parseHeader('// a plugin\r\n// @miyapad-min 2.9.0\n\n//   @miyapad-max 2.10\nconst x = 1;'))
			.toEqual({ min: '2.9.0', max: '2.10' });
	});

	it('reads only one when only one is there', () => {
		expect(parseHeader('// @miyapad-min 2.0.0\nrun();')).toEqual({ min: '2.0.0' });
		expect(parseHeader('// @miyapad-max 3\nrun();')).toEqual({ max: '3' });
	});

	it('reads nothing past the first line of code', () => {
		expect(parseHeader('run();\n// @miyapad-min 2.0.0')).toEqual({});
		expect(parseHeader('')).toEqual({});
	});

	it('reports a version that is not plain numbers', () => {
		expect(parseHeader('// @miyapad-min 2.9.0-beta')).toEqual({ bad: { kind: 'version', value: '2.9.0-beta' } });
		expect(parseHeader('// @miyapad-max v2')).toEqual({ bad: { kind: 'version', value: 'v2' } });
		expect(parseHeader('// @miyapad-max')).toEqual({ bad: { kind: 'version', value: '' } });
	});

	it('reads the two timeout lines', () => {
		expect(parseHeader('// @miyapad-start-timeout 5\r\n// @miyapad-hook-timeout 30\nconst x = 1;'))
			.toEqual({ startTimeout: 5, hookTimeout: 30 });
	});

	it('reports a timeout that is not a plain positive whole number', () => {
		expect(parseHeader('// @miyapad-start-timeout 0')).toEqual({ bad: { kind: 'timeout', value: '0' } });
		expect(parseHeader('// @miyapad-hook-timeout 1.5')).toEqual({ bad: { kind: 'timeout', value: '1.5' } });
		expect(parseHeader('// @miyapad-hook-timeout')).toEqual({ bad: { kind: 'timeout', value: '' } });
	});
});

describe('pluginNameFromUrl', () => {
	it('takes the last part of the path without .js', () => {
		expect(pluginNameFromUrl('https://raw.githubusercontent.com/a/b/main/plugins/foo.js')).toBe('foo');
		expect(pluginNameFromUrl('https://cdn.jsdelivr.net/gh/a/b@1/Foo.JS?raw=1')).toBe('Foo');
	});

	it('refuses an address with no file name, or not http(s)', () => {
		expect(pluginNameFromUrl('https://example.com/')).toBeUndefined();
		expect(pluginNameFromUrl('https://example.com/plugins/')).toBe('plugins');
		expect(pluginNameFromUrl('https://example.com/.js')).toBeUndefined();
		expect(pluginNameFromUrl('file:///plugins/foo.js')).toBeUndefined();
		expect(pluginNameFromUrl('not a url')).toBeUndefined();
	});
});

describe('fetchPluginCode & fetchPluginFromUrl', () => {
	const answer = (body: BodyInit, init?: ResponseInit) => vi.fn(async () => new Response(body, init));

	afterEach(() => vi.unstubAllGlobals());

	it('reads legacy code from the address', async () => {
		vi.stubGlobal('fetch', answer('const x = 1;'));
		expect(await fetchPluginCode('https://example.com/p.js', false)).toBe('const x = 1;');
		expect(await fetchPluginFromUrl('https://example.com/p.js', false)).toEqual({ kind: 'legacy', code: 'const x = 1;' });
	});

	it('parses a .miyaplugin zip archive from the address even with octet-stream content-type', async () => {
		const zip = zipSync({
			'manifest.json': strToU8(JSON.stringify({ id: 'date', name: 'Date', version: '1.0.0' })),
			'main.js': strToU8('const x = 1;'),
		});
		vi.stubGlobal('fetch', answer(zip, { headers: { 'content-type': 'application/octet-stream' } }));
		const result = await fetchPluginFromUrl('https://example.com/date.miyaplugin', false);
		expect(result.kind).toBe('archive');
		if (result.kind === 'archive') {
			expect(result.archive.manifest).toMatchObject({ id: 'date', name: 'Date', version: '1.0.0' });
		}
	});

	it('goes through the server when asked', async () => {
		const fetchMock = answer('const x = 1;');
		vi.stubGlobal('fetch', fetchMock);
		await fetchPluginCode('https://example.com/p.js', true);
		expect(fetchMock).toHaveBeenCalledWith('/proxy-url?url=https%3A%2F%2Fexample.com%2Fp.js', { cache: 'no-store' });
	});

	it('refuses a failed reply and a web page', async () => {
		vi.stubGlobal('fetch', answer('', { status: 404, statusText: 'Not Found' }));
		await expect(fetchPluginCode('https://example.com/p.js', false)).rejects.toThrow('404 Not Found');

		vi.stubGlobal('fetch', answer('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
		await expect(fetchPluginCode('https://example.com/p.js', false)).rejects.toThrow('web page');
		vi.stubGlobal('fetch', answer('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
		await expect(fetchPluginFromUrl('https://example.com/p.miyaplugin', false)).rejects.toThrow('web page');
	});
});

describe('checkVersion', () => {
	it('is mismatched below minMiyapad', () => {
		expect(checkVersion({ minMiyapad: '2.10.0' }, '2.9.5')).toBe('mismatched');
	});

	it('covers every release of a short maxMiyapad, and nothing after it', () => {
		expect(checkVersion({ maxMiyapad: '2.10' }, '2.10.3')).toBe('fits');
		expect(checkVersion({ maxMiyapad: '2.10' }, '2.11.0')).toBe('mismatched');
		expect(checkVersion({ maxMiyapad: '2.10.0' }, '2.10')).toBe('fits');
	});

	it('fits inside the range', () => {
		expect(checkVersion({ minMiyapad: '2.9.0', maxMiyapad: '2.10' }, '2.9.0')).toBe('fits');
		expect(checkVersion({ minMiyapad: '2.9.0', maxMiyapad: '2.10' }, '2.10.7')).toBe('fits');
	});

	it('treats a minMiyapad on its own as that version and every later one', () => {
		expect(checkVersion({ minMiyapad: '2.0.0' }, '9.0.0')).toBe('fits');
	});

	it('is undeclared without either bound', () => {
		expect(checkVersion({})).toBe('undeclared');
	});
});

describe('checkRequirements & switchOffMismatched', () => {
	function storageWith(plugins: Record<string, PluginRecord>) {
		const storage = {
			plugins: { ...plugins },
			setEnabled: vi.fn(async (id: string, enabled: boolean) => { storage.plugins[id] = { ...storage.plugins[id], enabled }; }),
		};
		return storage;
	}

	it('switches off mismatched, undeclared, and server-requiring plugins in standalone', async () => {
		const storage = storageWith({
			old: makeRecord('old', { manifest: { maxMiyapad: '0.1' } }),
			bare: makeRecord('bare'),
			allowed: makeRecord('allowed', { allowedVersion: APP_VERSION, manifest: { maxMiyapad: '0.1' } }),
			allowedEarlier: makeRecord('allowedEarlier', { allowedVersion: '0.0.1' }),
			needsServer: makeRecord('needsServer', { allowedVersion: APP_VERSION, manifest: { minMiyapad: '0.1', requires: ['server'] } }),
			fits: makeRecord('fits', { manifest: { minMiyapad: '0.1' } }),
			off: makeRecord('off', { enabled: false, manifest: { maxMiyapad: '0.1' } }),
		});

		expect(checkRequirements({ requires: ['server'] }, { server: false })).toEqual(['server']);
		expect(checkRequirements({ requires: ['server'] }, { server: true })).toEqual([]);

		expect(await switchOffMismatched(storage as unknown as PluginStorage, { server: false }))
			.toEqual(['allowedEarlier', 'bare', 'needsServer', 'old']);
		expect(storage.setEnabled.mock.calls).toEqual([
			['allowedEarlier', false],
			['bare', false],
			['needsServer', false],
			['old', false],
		]);
		expect(storage.plugins.allowed.enabled).toBe(true);
		expect(storage.plugins.fits.enabled).toBe(true);
	});

	it('keeps server-requiring plugins enabled when running with the server', async () => {
		const storage = storageWith({
			needsServer: makeRecord('needsServer', { manifest: { minMiyapad: '0.1', requires: ['server'] } }),
		});
		expect(await switchOffMismatched(storage as unknown as PluginStorage, { server: true })).toEqual([]);
		expect(storage.plugins.needsServer.enabled).toBe(true);
	});

	it('still lists a plugin whose save failed, so it is not run', async () => {
		const storage = storageWith({ old: makeRecord('old', { manifest: { maxMiyapad: '0.1' } }) });
		storage.setEnabled.mockRejectedValueOnce(new Error('offline'));
		expect(await switchOffMismatched(storage as unknown as PluginStorage)).toEqual(['old']);
	});
});

describe('startPlugins', () => {
	it('runs switched-on plugins that fit and meet host requirements, and skips switched-off ones', async () => {
		const storage = {
			plugins: {
				fits: makeRecord('fits', { code: 'miyapad.ran.push("fits")', manifest: { minMiyapad: '0.1' } }),
				old: makeRecord('old', { code: 'miyapad.ran.push("old")', manifest: { maxMiyapad: '0.1' } }),
				serverOnly: makeRecord('serverOnly', { code: 'miyapad.ran.push("serverOnly")', manifest: { minMiyapad: '0.1', requires: ['server'] } }),
				off: makeRecord('off', { code: 'miyapad.ran.push("off")', enabled: false, manifest: { minMiyapad: '0.1' } }),
			} as Record<string, PluginRecord>,
			setEnabled: vi.fn(async () => {}),
		};
		const ran: string[] = [];
		const result = await startPlugins(storage as unknown as PluginStorage, false, () => ({ ran }), undefined, { server: false });
		expect(result).toEqual({ safeMode: false, switchedOff: ['old', 'serverOnly'], errors: {}, timedOut: [], skipped: [] });
		expect(ran).toEqual(['fits']);
	});

	it('runs nothing and writes nothing in safe mode', async () => {
		const storage = { plugins: { old: makeRecord('old', { code: 'miyapad.ran = true', manifest: { maxMiyapad: '0.1' } }) }, setEnabled: vi.fn() };
		const miyapad = { ran: false };
		expect(await startPlugins(storage as unknown as PluginStorage, true, () => miyapad))
			.toEqual({ safeMode: true, switchedOff: [], errors: {}, timedOut: [], skipped: [] });
		expect(storage.setEnabled).not.toHaveBeenCalled();
		expect(miyapad.ran).toBe(false);
	});
});

describe('runPlugins', () => {
	it('sorts plugins by manifest.order ascending, then id ascending', async () => {
		const seen: string[] = [];
		(globalThis as Record<string, unknown>).seen = seen;
		const plugins = {
			b: makeRecord('b', { code: 'seen.push(miyapad.id)', manifest: { order: 0 } }),
			a: makeRecord('a', { code: 'await null; seen.push(miyapad.id)', manifest: { order: 0 } }),
			early: makeRecord('early', { code: 'seen.push(miyapad.id)', manifest: { order: -10 } }),
			late: makeRecord('late', { code: 'seen.push(miyapad.id)', manifest: { order: 5 } }),
		};
		await runPlugins(plugins, ['late', 'b', 'a', 'early'], id => ({ id }));
		delete (globalThis as Record<string, unknown>).seen;
		expect(seen).toEqual(['early', 'a', 'b', 'late']);
	});

	it('skips plugins requiring server when host.server is false', async () => {
		const seen: string[] = [];
		(globalThis as Record<string, unknown>).seen = seen;
		const plugins = {
			srv: makeRecord('srv', { code: 'seen.push("srv")', manifest: { requires: ['server'] } }),
			plain: makeRecord('plain', { code: 'seen.push("plain")' }),
		};
		await runPlugins(plugins, ['srv', 'plain'], () => ({}), undefined, { server: false });
		expect(seen).toEqual(['plain']);

		await runPlugins(plugins, ['srv', 'plain'], () => ({}), undefined, { server: true });
		delete (globalThis as Record<string, unknown>).seen;
		expect(seen).toEqual(['plain', 'plain', 'srv']);
	});

	it('records a plugin that throws or does not parse, and still runs the next', async () => {
		const plugins = {
			a: makeRecord('a', { code: 'throw new Error("boom")' }),
			b: makeRecord('b', { code: 'this is not js' }),
			c: makeRecord('c', { code: 'miyapad.ran = true' }),
		};
		const c = { ran: false };
		const result = await runPlugins(plugins, ['a', 'b', 'c'], id => (id === 'c' ? c : {}));
		expect(result.errors).toEqual({ a: 'Error: boom', b: expect.stringMatching(/^SyntaxError/) });
		expect(result.timedOut).toEqual([]);
		expect(c.ran).toBe(true);
	});

	it('moves on from a plugin that is still starting after the timeout', async () => {
		vi.useFakeTimers();
		const plugins = {
			slow: makeRecord('slow', { code: 'await new Promise(() => {})' }),
			next: makeRecord('next', { code: 'miyapad.ran = true' }),
		};
		const next = { ran: false };
		const done = runPlugins(plugins, ['slow', 'next'], id => (id === 'next' ? next : {}));
		await vi.advanceTimersByTimeAsync(DEFAULT_PLUGIN_START_TIMEOUT_S * 1000);
		expect(await done).toEqual({ errors: {}, timedOut: ['slow'], skipped: [] });
		expect(next.ran).toBe(true);
	});

	it('gives up on a plugin after its own declared start timeout', async () => {
		vi.useFakeTimers();
		const plugins = {
			a: makeRecord('a', { code: 'await new Promise(() => {})', manifest: { startTimeout: 2 } }),
			b: makeRecord('b', { code: 'miyapad.ran = true' }),
		};
		const b = { ran: false };
		const done = runPlugins(plugins, ['a', 'b'], id => (id === 'b' ? b : {}));
		await vi.advanceTimersByTimeAsync(1000);
		expect(b.ran).toBe(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await done).toEqual({ errors: {}, timedOut: ['a'], skipped: [] });
		expect(b.ran).toBe(true);
	});

	it('stops at Skip, marking the plugin starting and every one after it as skipped', async () => {
		vi.useFakeTimers();
		let skip!: () => void;
		const skipPromise = new Promise<void>(resolve => { skip = resolve; });
		const plugins = {
			a: makeRecord('a', { code: 'await new Promise(() => {})' }),
			b: makeRecord('b', { code: 'miyapad.ran = true' }),
			c: makeRecord('c', { code: 'miyapad.ran = true' }),
		};
		const b = { ran: false };
		const c = { ran: false };
		const done = runPlugins(plugins, ['a', 'b', 'c'], id => (id === 'b' ? b : id === 'c' ? c : {}), { skip: skipPromise });
		await vi.advanceTimersByTimeAsync(1);
		skip();
		expect(await done).toEqual({ errors: {}, timedOut: [], skipped: ['a', 'b', 'c'] });
		expect(b.ran).toBe(false);
		expect(c.ran).toBe(false);
	});

	it('reports each plugin display name as it starts', async () => {
		const seen: [string, number, number][] = [];
		const plugins = {
			a: makeRecord('a', { manifest: { name: 'Alpha' } }),
			b: makeRecord('b', { manifest: { name: 'Beta' } }),
		};
		await runPlugins(plugins, ['b', 'a'], () => ({}), { skip: new Promise(() => {}), onProgress: (name, index, total) => seen.push([name, index, total]) });
		expect(seen).toEqual([['Alpha', 1, 2], ['Beta', 2, 2]]);
	});
});

describe('runPromptHooks & runOutputHooks', () => {
	it('passes the prompt through each hook, skipping one that throws or returns a non-string', async () => {
		hooks.prompt.push(
			p => p + ' one',
			() => { throw new Error('broken'); },
			async () => 42 as unknown as string,
			async p => p + ' two',
		);
		expect(await runPromptHooks('start')).toBe('start one two');
	});

	it('calls every output hook, even after one fails', async () => {
		const seen = vi.fn();
		hooks.output.push(() => { throw new Error('broken'); }, seen);
		await runOutputHooks('text', { complete: true });
		expect(seen).toHaveBeenCalledWith('text', { complete: true });
	});
});

describe('pluginHooksFor & hook attribution', () => {
	it('attributes prompt hook throws, wrong return types and timeouts to the plugin id', async () => {
		vi.useFakeTimers();
		const alpha = pluginHooksFor('alpha', makeRecord('alpha', { manifest: { hookTimeout: 1 } }));
		const beta = pluginHooksFor('beta', makeRecord('beta'));
		const gamma = pluginHooksFor('gamma', makeRecord('gamma'));

		alpha.prompt.push(() => new Promise(() => {}));
		beta.prompt.push(() => { throw new Error('boom'); });
		gamma.prompt.push((() => 123) as unknown as (p: string) => string);

		const run = runPromptHooks('hello');
		await vi.advanceTimersByTimeAsync(1000);
		expect(await run).toBe('hello');

		expect(getPluginRuntimeErrors()).toEqual({
			alpha: 'Error: timed out after 1s',
			beta: 'Error: boom',
			gamma: 'prompt hook returned number instead of a string',
		});
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugins] "alpha":'), expect.any(Error));
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugins] "beta":'), expect.any(Error));
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugins] "gamma":'), 123);
	});

	it('attributes output hook throws and timeouts to the plugin id and keeps the chain going', async () => {
		vi.useFakeTimers();
		const slow = pluginHooksFor('slow-out', makeRecord('slow-out', { manifest: { hookTimeout: 1 } }));
		const broken = pluginHooksFor('broken-out', makeRecord('broken-out'));
		const ok = pluginHooksFor('ok-out', makeRecord('ok-out'));
		const seen = vi.fn();

		slow.output.push(() => new Promise(() => {}));
		broken.output.push(() => { throw new Error('bad output'); });
		ok.output.push(seen);

		const result = runOutputHooks('text', { complete: true });
		await vi.advanceTimersByTimeAsync(1000);
		await result;

		expect(seen).toHaveBeenCalledWith('text', { complete: true });
		expect(getPluginRuntimeErrors()).toEqual({
			'slow-out': 'Error: timed out after 1s',
			'broken-out': 'Error: bad output',
		});
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugins] "broken-out":'), expect.any(Error));
	});

	it('hands over the shared commands array', () => {
		expect(pluginHooksFor('p', makeRecord('p')).commands).toBe(hooks.commands);
	});
});

describe('pluginStateView', () => {
	function makeState() {
		return {
			temperature: 0.7,
			label: 'x',
			list: [1],
			stop: null as (() => void) | null,
			setTemperature: vi.fn(),
			setLabel: vi.fn(),
			setList: vi.fn(),
			setStop: vi.fn(),
		};
	}

	it('reads the latest state and passes a valid value to the real setter', () => {
		let state = makeState();
		const view = pluginStateView(() => state);
		state = { ...makeState(), temperature: 1.2 };

		expect(view.temperature).toBe(1.2);
		expect(Object.keys(view)).toContain('setTemperature');
		expect('temperature' in view).toBe(true);
		expect('missing' in view).toBe(false);
		view.setTemperature(0.5);
		expect(state.setTemperature).toHaveBeenCalledWith(0.5);
	});

	it('reads nothing before the app has drawn', () => {
		expect(pluginStateView<Record<string, unknown>>(() => null).temperature).toBeUndefined();
	});

	it('rejects a value of the wrong type and writes nothing', () => {
		const state = makeState();
		const view = pluginStateView(() => state);

		expect(() => view.setTemperature('1')).toThrow(TypeError);
		expect(() => view.setList({})).toThrow(TypeError);
		expect(state.setTemperature).not.toHaveBeenCalled();
		expect(state.setList).not.toHaveBeenCalled();
	});

	it('rejects null for a field that holds a number, but allows it for a nullable one', () => {
		const state = makeState();
		const view = pluginStateView(() => state);

		expect(() => view.setTemperature(null)).toThrow(TypeError);
		view.setStop(null);
		view.setStop(() => {});
		expect(state.setStop).toHaveBeenNthCalledWith(1, null);
		expect(state.setStop).toHaveBeenNthCalledWith(2, expect.any(Function));
	});

	it('rejects NaN and infinity', () => {
		const view = pluginStateView(() => makeState());

		expect(() => view.setTemperature(NaN)).toThrow(TypeError);
		expect(() => view.setTemperature(Infinity)).toThrow(TypeError);
	});

	it('rejects a number outside the range the sidebar uses', () => {
		const view = pluginStateView(() => makeState());

		expect(() => view.setTemperature(6)).toThrow(RangeError);
		expect(() => view.setTemperature(-1)).toThrow(RangeError);
	});

	it('rejects an update function', () => {
		const view = pluginStateView(() => makeState());

		expect(() => view.setTemperature(() => 1)).toThrow(TypeError);
	});

	it('lets a plugin keep the view and still see the current values', () => {
		let state = makeState();
		const view = pluginStateView(() => state);
		const kept = view;

		state = { ...makeState(), label: 'changed' };
		expect(kept.label).toBe('changed');
	});
});
