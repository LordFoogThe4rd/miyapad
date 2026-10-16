import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkVersion, DEFAULT_PLUGIN_START_TIMEOUT_S, hooks, parseHeader, pluginHooksFor, runOutputHooks, runPlugins, runPromptHooks, startPlugins, switchOffMismatched } from './plugins';
import { APP_VERSION } from './version';
import type { PluginStorage } from './storage/PluginStorage';

beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	hooks.prompt.length = 0;
	hooks.output.length = 0;
	hooks.commands.length = 0;
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

describe('checkVersion', () => {
	it('is mismatched below min', () => {
		expect(checkVersion({ min: '2.10.0' }, '2.9.5')).toBe('mismatched');
	});

	it('covers every release of a short max, and nothing after it', () => {
		expect(checkVersion({ max: '2.10' }, '2.10.3')).toBe('fits');
		expect(checkVersion({ max: '2.10' }, '2.11.0')).toBe('mismatched');
		expect(checkVersion({ max: '2.10.0' }, '2.10')).toBe('fits');
	});

	it('fits inside the range', () => {
		expect(checkVersion({ min: '2.9.0', max: '2.10' }, '2.9.0')).toBe('fits');
		expect(checkVersion({ min: '2.9.0', max: '2.10' }, '2.10.7')).toBe('fits');
	});

	it('treats a min on its own as that version and every later one', () => {
		expect(checkVersion({ min: '2.0.0' }, '9.0.0')).toBe('fits');
	});

	it('is undeclared without either line', () => {
		expect(checkVersion({})).toBe('undeclared');
	});
});

describe('switchOffMismatched', () => {
	function storageWith(plugins: Record<string, PluginRecord>) {
		const storage = {
			plugins: { ...plugins },
			setEnabled: vi.fn(async (name: string, enabled: boolean) => { storage.plugins[name] = { ...storage.plugins[name], enabled }; }),
		};
		return storage;
	}

	it('switches off and saves mismatched and undeclared plugins, and leaves the rest on', async () => {
		const storage = storageWith({
			old: { code: '', enabled: true, max: '0.1' },
			bare: { code: '', enabled: true },
			allowed: { code: '', enabled: true, max: '0.1', allowedVersion: APP_VERSION },
			allowedEarlier: { code: '', enabled: true, allowedVersion: '0.0.1' },
			fits: { code: '', enabled: true, min: '0.1' },
			off: { code: '', enabled: false, max: '0.1' },
		});

		expect(await switchOffMismatched(storage as unknown as PluginStorage)).toEqual(['allowedEarlier', 'bare', 'old']);
		expect(storage.setEnabled.mock.calls).toEqual([['allowedEarlier', false], ['bare', false], ['old', false]]);
		expect(storage.plugins.allowed.enabled).toBe(true);
		expect(storage.plugins.fits.enabled).toBe(true);
	});

	it('still lists a plugin whose save failed, so it is not run', async () => {
		const storage = storageWith({ old: { code: '', enabled: true, max: '0.1' } });
		storage.setEnabled.mockRejectedValueOnce(new Error('offline'));
		expect(await switchOffMismatched(storage as unknown as PluginStorage)).toEqual(['old']);
	});
});

describe('startPlugins', () => {
	it('runs the switched-on plugins that fit, and none of the ones it switched off', async () => {
		const storage = {
			plugins: {
				fits: { code: 'miyapad.ran.push("fits")', enabled: true, min: '0.1' },
				old: { code: 'miyapad.ran.push("old")', enabled: true, max: '0.1' },
				off: { code: 'miyapad.ran.push("off")', enabled: false, min: '0.1' },
			} as Record<string, PluginRecord>,
			setEnabled: vi.fn(async () => {}),
		};
		const ran: string[] = [];
		const result = await startPlugins(storage as unknown as PluginStorage, false, () => ({ ran }));
		expect(result).toEqual({ safeMode: false, switchedOff: ['old'], errors: {}, timedOut: [], skipped: [] });
		expect(ran).toEqual(['fits']);
	});

	it('runs nothing and writes nothing in safe mode', async () => {
		const storage = { plugins: { old: { code: 'miyapad.ran = true', enabled: true, max: '0.1' } }, setEnabled: vi.fn() };
		const miyapad = { ran: false };
		expect(await startPlugins(storage as unknown as PluginStorage, true, () => miyapad))
			.toEqual({ safeMode: true, switchedOff: [], errors: {}, timedOut: [], skipped: [] });
		expect(storage.setEnabled).not.toHaveBeenCalled();
		expect(miyapad.ran).toBe(false);
	});
});

describe('runPlugins', () => {
	const record = (code: string): PluginRecord => ({ code, enabled: true });

	it('runs plugins in name order with their own miyapad object', async () => {
		const seen: string[] = [];
		(globalThis as Record<string, unknown>).seen = seen;
		const plugins = { b: record('seen.push(miyapad.name)'), a: record('await null; seen.push(miyapad.name)') };
		await runPlugins(plugins, ['b', 'a'], name => ({ name }));
		delete (globalThis as Record<string, unknown>).seen;
		expect(seen).toEqual(['a', 'b']);
	});

	it('records a plugin that throws or does not parse, and still runs the next', async () => {
		const plugins = { a: record('throw new Error("boom")'), b: record('this is not js'), c: record('miyapad.ran = true') };
		const c = { ran: false };
		const result = await runPlugins(plugins, ['a', 'b', 'c'], name => (name === 'c' ? c : {}));
		expect(result.errors).toEqual({ a: 'Error: boom', b: expect.stringMatching(/^SyntaxError/) });
		expect(result.timedOut).toEqual([]);
		expect(c.ran).toBe(true);
	});

	it('moves on from a plugin that is still starting after the timeout', async () => {
		vi.useFakeTimers();
		const plugins = { slow: record('await new Promise(() => {})'), next: record('miyapad.ran = true') };
		const next = { ran: false };
		const done = runPlugins(plugins, ['slow', 'next'], name => (name === 'next' ? next : {}));
		await vi.advanceTimersByTimeAsync(DEFAULT_PLUGIN_START_TIMEOUT_S * 1000);
		expect(await done).toEqual({ errors: {}, timedOut: ['slow'], skipped: [] });
		expect(next.ran).toBe(true);
	});

	it('gives up on a plugin after its own declared start timeout', async () => {
		vi.useFakeTimers();
		const plugins = { a: { code: 'await new Promise(() => {})', enabled: true, startTimeout: 2 }, b: record('miyapad.ran = true') };
		const b = { ran: false };
		const done = runPlugins(plugins, ['a', 'b'], name => (name === 'b' ? b : {}));
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
		const plugins = { a: record('await new Promise(() => {})'), b: record('miyapad.ran = true'), c: record('miyapad.ran = true') };
		const b = { ran: false };
		const c = { ran: false };
		const done = runPlugins(plugins, ['a', 'b', 'c'], name => (name === 'b' ? b : name === 'c' ? c : {}), { skip: skipPromise });
		await vi.advanceTimersByTimeAsync(1);
		skip();
		expect(await done).toEqual({ errors: {}, timedOut: [], skipped: ['a', 'b', 'c'] });
		expect(b.ran).toBe(false);
		expect(c.ran).toBe(false);
	});

	it('reports each plugin as it starts', async () => {
		const seen: [string, number, number][] = [];
		const plugins = { a: record(''), b: record('') };
		await runPlugins(plugins, ['b', 'a'], () => ({}), { skip: new Promise(() => {}), onProgress: (name, index, total) => seen.push([name, index, total]) });
		expect(seen).toEqual([['a', 1, 2], ['b', 2, 2]]);
	});
});

describe('runPromptHooks', () => {
	it('passes the prompt through each hook, skipping one that throws or returns a non-string', async () => {
		hooks.prompt.push(
			p => p + ' one',
			() => { throw new Error('broken'); },
			async () => 42 as unknown as string,
			async p => p + ' two',
		);
		expect(await runPromptHooks('start')).toBe('start one two');
	});
});

describe('runOutputHooks', () => {
	it('calls every hook, even after one fails', async () => {
		const seen = vi.fn();
		hooks.output.push(() => { throw new Error('broken'); }, seen);
		await runOutputHooks('text', { complete: true });
		expect(seen).toHaveBeenCalledWith('text', { complete: true });
	});
});

describe('pluginHooksFor', () => {
	it('skips a prompt hook that outlives its timeout and runs the next one', async () => {
		vi.useFakeTimers();
		const view = pluginHooksFor({ code: '', enabled: true, hookTimeout: 1 });
		view.prompt.push(() => new Promise(() => {}));
		view.prompt.push(p => p + ' done');
		const result = runPromptHooks('start');
		await vi.advanceTimersByTimeAsync(1000);
		expect(await result).toBe('start done');
	});

	it('keeps the output chain going after a hook times out', async () => {
		vi.useFakeTimers();
		const view = pluginHooksFor({ code: '', enabled: true, hookTimeout: 1 });
		const seen = vi.fn();
		view.output.push(() => new Promise(() => {}));
		view.output.push(seen);
		const result = runOutputHooks('text', { complete: true });
		await vi.advanceTimersByTimeAsync(1000);
		await result;
		expect(seen).toHaveBeenCalledWith('text', { complete: true });
	});

	it('hands over the shared commands array', () => {
		expect(pluginHooksFor({ code: '', enabled: true }).commands).toBe(hooks.commands);
	});
});
