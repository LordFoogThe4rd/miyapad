import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
	checkRequirements,
	checkVersion,
	clearPluginRuntimeError,
	clearPluginUiHooks,
	createHookRunState,
	DEFAULT_PLUGIN_START_TIMEOUT_S,
	fetchPluginFromUrl,
	getPluginRuntimeErrors,
	getPluginUiSnapshot,
	hooks,
	pluginEditorFor,
	pluginHooksFor,
	pluginStateView,
	runMessagesHooks,
	runOutputHooks,
	runPlugins,
	runPromptHooks,
	startPlugins,
	subscribePluginUi,
	switchOffMismatched,
} from './plugins';
import type { EditorAdapter } from './editor/EditorAdapter';
import { PluginArchiveError } from './plugins/archive';
import { APP_VERSION } from './version';
import { PluginContainerError } from './storage/PluginDatabase';
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
			id,
			name: id,
			version: '1.0.0',
			order: 0,
			api: 1,
			...manifest,
		},
	};
}

beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	hooks.prompt.length = 0;
	hooks.messages.length = 0;
	hooks.output.length = 0;
	hooks.commands.length = 0;
	clearPluginUiHooks();
	clearPluginRuntimeError();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('fetchPluginFromUrl', () => {
	const answer = (body: BodyInit, init?: ResponseInit) => vi.fn(async () => new Response(body, init));
	const sampleZip = () => zipSync({
		'manifest.json': strToU8(JSON.stringify({ id: 'date', name: 'Date', version: '1.0.0' })),
		'main.js': strToU8('const x = 1;'),
	});

	afterEach(() => vi.unstubAllGlobals());

	it('parses a .miyaplugin zip archive from the address even with octet-stream or text/plain content-type', async () => {
		vi.stubGlobal('fetch', answer(sampleZip(), { headers: { 'content-type': 'application/octet-stream' } }));
		const result = await fetchPluginFromUrl('https://example.com/date.miyaplugin', false);
		expect(result.manifest).toMatchObject({ id: 'date', name: 'Date', version: '1.0.0' });
		expect(result.code).toBe('const x = 1;');

		vi.stubGlobal('fetch', answer(sampleZip(), { headers: { 'content-type': 'text/plain; charset=utf-8' } }));
		const rawResult = await fetchPluginFromUrl('https://raw.githubusercontent.com/o/r/main/dist/date.miyaplugin', false);
		expect(rawResult.manifest.id).toBe('date');
	});

	it('goes through the server when asked and maps 413 to archive-too-large', async () => {
		const fetchMock = answer(sampleZip());
		vi.stubGlobal('fetch', fetchMock);
		await fetchPluginFromUrl('https://example.com/date.miyaplugin', true);
		expect(fetchMock).toHaveBeenCalledWith('/proxy-url?url=https%3A%2F%2Fexample.com%2Fdate.miyaplugin', { cache: 'no-store' });

		vi.stubGlobal('fetch', answer('Response exceeds size limit', { status: 413, statusText: 'Payload Too Large' }));
		await expect(fetchPluginFromUrl('https://example.com/huge.miyaplugin', true)).rejects.toMatchObject({
			name: 'PluginArchiveError',
			kind: 'archive-too-large',
		});
	});

	it('refuses a failed reply, a web page, and non-zip content', async () => {
		vi.stubGlobal('fetch', answer('', { status: 404, statusText: 'Not Found' }));
		await expect(fetchPluginFromUrl('https://example.com/p.miyaplugin', false)).rejects.toThrow('404 Not Found');

		vi.stubGlobal('fetch', answer('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
		await expect(fetchPluginFromUrl('https://example.com/p.miyaplugin', false)).rejects.toThrow('web page');

		vi.stubGlobal('fetch', answer('const x = 1;', { headers: { 'content-type': 'application/javascript' } }));
		await expect(fetchPluginFromUrl('https://example.com/p.js', false)).rejects.toThrow(PluginArchiveError);
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

	it('runs nothing and deletes nothing when the plugin registry is unreadable', async () => {
		const storage = {
			registryError: 'Failed to parse registry',
			plugins: { p: makeRecord('p', { code: 'miyapad.ran = true', manifest: { minMiyapad: '0.1' } }) },
			setEnabled: vi.fn(),
		};
		const miyapad = { ran: false };
		expect(await startPlugins(storage as unknown as PluginStorage, false, () => miyapad))
			.toEqual({
				safeMode: false,
				registryError: 'Failed to parse registry',
				switchedOff: [],
				errors: {},
				timedOut: [],
				skipped: [],
			});
		expect(storage.setEnabled).not.toHaveBeenCalled();
		expect(miyapad.ran).toBe(false);
	});

	it('switches off only a plugin whose container fails to open, while running every other plugin', async () => {
		const storage = {
			registryError: null,
			plugins: {
				broken: makeRecord('broken', { code: 'await miyapad.storage.get("k")', manifest: { minMiyapad: '0.1', order: 0 } }),
				healthy: makeRecord('healthy', { code: 'miyapad.ran.push("healthy")', manifest: { minMiyapad: '0.1', order: 1 } }),
			} as Record<string, PluginRecord>,
			setEnabled: vi.fn(async (id: string, enabled: boolean) => {
				storage.plugins[id] = { ...storage.plugins[id], enabled };
			}),
		};
		const ran: string[] = [];
		const result = await startPlugins(
			storage as unknown as PluginStorage,
			false,
			id => ({
				ran,
				storage: {
					get: async () => { throw new PluginContainerError(id, 'file is not a database'); },
				},
			}),
		);
		expect(result.errors).toEqual({ broken: 'PluginContainerError: file is not a database' });
		expect(storage.setEnabled).toHaveBeenCalledWith('broken', false);
		expect(storage.plugins.broken.enabled).toBe(false);
		expect(storage.plugins.healthy.enabled).toBe(true);
		expect(ran).toEqual(['healthy']);
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

	it('passes PromptHookContext, respects abort/params in live runs, and ignores them in dryRun', async () => {
		const seenLater = vi.fn(p => p + ' later');
		hooks.prompt.push(
			(p, ctx) => {
				expect(ctx.mode).toBe('chat');
				ctx.params({ stop: ['END'] });
				if (!ctx.dryRun) {
					ctx.abort();
					return undefined as unknown as string;
				}
				return p + ' preview';
			},
			seenLater,
		);

		const dryState = createHookRunState({ dryRun: true, mode: 'chat' });
		expect(await runPromptHooks('hi', dryState)).toBe('hi preview later');
		expect(dryState.aborted).toBe(false);
		expect(dryState.params).toEqual({});
		expect(seenLater).toHaveBeenCalledTimes(1);

		seenLater.mockClear();
		const liveState = createHookRunState({ dryRun: false, mode: 'chat' });
		await runPromptHooks('hi', liveState);
		expect(liveState.aborted).toBe(true);
		expect(liveState.params).toEqual({ stop: ['END'] });
		expect(seenLater).not.toHaveBeenCalled();
		expect(getPluginRuntimeErrors()).toEqual({});
	});

	it('runs messages hooks with attribution for throws, wrong return types, timeouts, and abort', async () => {
		vi.useFakeTimers();
		const slow = pluginHooksFor('slow-msg', makeRecord('slow-msg', { manifest: { hookTimeout: 1 } }));
		const broken = pluginHooksFor('broken-msg', makeRecord('broken-msg'));
		const wrong = pluginHooksFor('wrong-msg', makeRecord('wrong-msg'));
		const good = pluginHooksFor('good-msg', makeRecord('good-msg'));

		slow.messages.push(() => new Promise(() => {}));
		broken.messages.push(() => { throw new Error('msg boom'); });
		wrong.messages.push((() => 'not-an-array') as unknown as (m: ChatMessage[]) => ChatMessage[]);
		good.messages.push((msgs, ctx) => {
			ctx.params({ temperature: 0.2 });
			return [{ role: 'system', content: 'Injected' }, ...msgs];
		});

		const state = createHookRunState({ dryRun: false, mode: 'chat' });
		const run = runMessagesHooks([{ role: 'user', content: 'Hi' }], state);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await run).toEqual([
			{ role: 'system', content: 'Injected' },
			{ role: 'user', content: 'Hi' },
		]);
		expect(state.params).toEqual({ temperature: 0.2 });
		expect(getPluginRuntimeErrors()).toEqual({
			'slow-msg': 'Error: timed out after 1s',
			'broken-msg': 'Error: msg boom',
			'wrong-msg': 'messages hook returned string instead of an array',
		});
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

describe('pluginEditorFor', () => {
	it('returns undefined before the editor mounts and wraps the adapter without destroy()', () => {
		expect(pluginEditorFor(() => null)).toBeUndefined();
		expect(pluginEditorFor(() => ({ promptEditorView: { current: null } }))).toBeUndefined();

		const dom = document.createElement('div');
		const adapter: EditorAdapter = {
			getText: vi.fn(() => 'hello'),
			getSelection: vi.fn(() => ({ from: 1, to: 3 })),
			replaceText: vi.fn(),
			replaceRange: vi.fn(),
			replaceRanges: vi.fn(),
			focus: vi.fn(),
			scrollIntoView: vi.fn(),
			setSelection: vi.fn(),
			posAtCoords: vi.fn(() => 2),
			coordsAtPos: vi.fn(() => ({ top: 1, left: 2, right: 3, bottom: 4 })),
			dom,
			destroy: vi.fn(),
		};

		const editor = pluginEditorFor(() => ({ promptEditorView: { current: adapter } }))!;
		expect(editor).toBeDefined();
		expect('destroy' in editor).toBe(false);
		expect(editor.getText()).toBe('hello');
		expect(editor.getSelection()).toEqual({ from: 1, to: 3 });
		expect(editor.dom).toBe(dom);
		editor.replaceText('world');
		editor.replaceRange(0, 1, 'W');
		editor.replaceRanges([{ from: 0, to: 1, insert: 'X' }]);
		editor.focus();
		editor.scrollIntoView(0, { y: 'center' });
		editor.setSelection(0, 2);
		expect(editor.posAtCoords({ x: 5, y: 6 })).toBe(2);
		expect(editor.coordsAtPos(2)).toEqual({ top: 1, left: 2, right: 3, bottom: 4 });
		expect(adapter.replaceText).toHaveBeenCalledWith('world');
		expect(adapter.replaceRange).toHaveBeenCalledWith(0, 1, 'W');
		expect(adapter.replaceRanges).toHaveBeenCalledWith([{ from: 0, to: 1, insert: 'X' }]);
		expect(adapter.destroy).not.toHaveBeenCalled();
	});
});

describe('UI hook registries', () => {
	it('notifies subscribers and replaces settings per plugin', () => {
		const listener = vi.fn();
		const unsub = subscribePluginUi(listener);
		const p = pluginHooksFor('demo', makeRecord('demo', { manifest: { name: 'Demo', order: 2 } }));

		const CompA = () => null;
		const CompB = () => null;
		p.settings({ Component: CompA });
		expect(getPluginUiSnapshot().settings.demo).toMatchObject({ id: 'demo', mode: 'inline', Component: CompA });
		p.settings({ mode: 'modal', Component: CompB });
		expect(getPluginUiSnapshot().settings.demo).toMatchObject({ id: 'demo', mode: 'modal', Component: CompB });

		p.sidebar.push({ label: 'Tools', Component: CompA, expanded: true });
		p.modals.push(CompB);
		p.toolbar.push({ title: 'Act', icon: 'A', onClick: vi.fn() });

		const snap = getPluginUiSnapshot();
		expect(snap.sidebar).toHaveLength(1);
		expect(snap.modals).toHaveLength(1);
		expect(snap.toolbar).toHaveLength(1);
		expect(listener).toHaveBeenCalledTimes(5);
		unsub();
	});
});
