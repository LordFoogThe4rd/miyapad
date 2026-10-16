import { APP_VERSION } from './version';
import { isNewer } from './hooks/useUpdateCheck';
import type { PluginStorage } from './storage/PluginStorage';

export type PromptHook = (prompt: string) => string | Promise<string>;
export type OutputHook = (text: string, info: { complete: boolean }) => void | Promise<void>;
export interface PluginCommand {
	label: string;
	action: () => void;
}

/**
 * Shared by every plugin. Plugins push onto these, and Miyapad reads them each time it uses
 * them, so an entry pushed after startup still works.
 */
export const hooks = {
	prompt: [] as PromptHook[],
	output: [] as OutputHook[],
	commands: [] as PluginCommand[],
};

/** What happened to the plugins on this start. Kept in memory only, for the Plugins tab. */
export interface PluginStartInfo {
	safeMode: boolean;
	/** Switched off because they aren't declared for this version. */
	switchedOff: string[];
	/** Plugins that threw while starting, with the error. */
	errors: Record<string, string>;
	/** Plugins still running when startup stopped waiting for them. */
	timedOut: string[];
	/** Plugins the user skipped on the loading screen: the one starting and every one after it. */
	skipped: string[];
}

/** What the loading screen tells `startPlugins` while it waits. */
export interface PluginStartControl {
	/** Resolved when the user presses Skip on the loading screen. */
	skip: Promise<void>;
	onProgress?: (name: string, index: number, total: number) => void;
}

export const DEFAULT_PLUGIN_START_TIMEOUT_S = 5;
export const DEFAULT_PLUGIN_HOOK_TIMEOUT_S = 10;

const VERSION = /^\d+(\.\d+)*$/;
const SECONDS = /^[1-9]\d*$/;

export interface PluginHeader {
	min?: string;
	max?: string;
	/** `// @miyapad-start-timeout`, in whole seconds. */
	startTimeout?: number;
	/** `// @miyapad-hook-timeout`, in whole seconds. */
	hookTimeout?: number;
	/** A version or timeout line that isn't accepted, which rejects the import. */
	bad?: { kind: 'version' | 'timeout'; value: string };
}

/** Reads `// @miyapad-min`, `// @miyapad-max` and the two timeout lines from the comment lines at the top of the file. A header in a block comment isn't read, so the plugin imports as undeclared. */
export function parseHeader(code: string): PluginHeader {
	const header: PluginHeader = {};
	for (const line of code.split('\n').map(l => l.trim())) {
		if (line === '') continue;
		if (!line.startsWith('//')) break;
		const match = /^\/\/\s*@miyapad-(min|max|start-timeout|hook-timeout)\b\s*(.*)$/.exec(line);
		if (!match) continue;
		if (match[1] === 'min' || match[1] === 'max') {
			if (!VERSION.test(match[2])) return { bad: { kind: 'version', value: match[2] } };
			header[match[1]] = match[2];
		} else {
			if (!SECONDS.test(match[2])) return { bad: { kind: 'timeout', value: match[2] } };
			header[match[1] === 'start-timeout' ? 'startTimeout' : 'hookTimeout'] = Number(match[2]);
		}
	}
	return header;
}

export type PluginFit = 'fits' | 'mismatched' | 'undeclared';

export function checkVersion({ min, max }: { min?: string; max?: string }, version = APP_VERSION): PluginFit {
	if (min === undefined && max === undefined) return 'undeclared';
	if (min !== undefined && isNewer(min, version)) return 'mismatched';
	// Cut to as many parts as max has, so a max of 2.10 covers every 2.10.x release.
	if (max !== undefined && isNewer(version.split('.').slice(0, max.split('.').length).join('.'), max)) return 'mismatched';
	return 'fits';
}

/**
 * Switches off every switched-on plugin that isn't declared for this version, unless you
 * already switched it on for this version, and returns their names. A plugin whose save
 * fails is still in the list, so it doesn't run this time either.
 */
export async function switchOffMismatched(pluginStorage: PluginStorage): Promise<string[]> {
	const names = Object.keys(pluginStorage.plugins).sort().filter(name => {
		const plugin = pluginStorage.plugins[name];
		return plugin.enabled && checkVersion(plugin) !== 'fits' && plugin.allowedVersion !== APP_VERSION;
	});
	for (const name of names) {
		console.warn(`[plugins] Switched off "${name}": it isn't declared for Miyapad ${APP_VERSION}.`);
		await pluginStorage.setEnabled(name, false).catch(e => console.error(`[plugins] Couldn't save "${name}" as switched off:`, e));
	}
	return names;
}

const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
const TIMED_OUT = Symbol('timed out');
const SKIPPED = Symbol('skipped');

/**
 * Runs each named plugin in name order. A plugin that throws is recorded and skipped. One that
 * is still running after its start timeout is left running and recorded; nothing can stop a
 * synchronous infinite loop, which is what `?safe` is for. When `control.skip` resolves, the
 * plugin starting and every one after it are recorded as skipped and the loop stops.
 */
export async function runPlugins(
	plugins: Record<string, PluginRecord>,
	names: string[],
	miyapadFor: (name: string) => unknown,
	control?: PluginStartControl,
): Promise<Pick<PluginStartInfo, 'errors' | 'timedOut' | 'skipped'>> {
	const errors: Record<string, string> = {};
	const timedOut: string[] = [];
	const skipped: string[] = [];
	const ordered = [...names].sort();
	// One sentinel for the whole run: once the user skips, it keeps winning the race.
	const skipPromise = control?.skip.then(() => SKIPPED);
	for (const [index, name] of ordered.entries()) {
		control?.onProgress?.(name, index + 1, ordered.length);
		const seconds = plugins[name].startTimeout ?? DEFAULT_PLUGIN_START_TIMEOUT_S;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const run = new AsyncFunction('miyapad', plugins[name].code)(miyapadFor(name));
			const timeout = new Promise(resolve => { timer = setTimeout(resolve, seconds * 1000, TIMED_OUT); });
			const outcome = await Promise.race([run, timeout, ...(skipPromise ? [skipPromise] : [])]);
			if (outcome === TIMED_OUT) {
				timedOut.push(name);
				console.warn(`[plugins] "${name}" took more than ${seconds} seconds to start; Miyapad didn't wait for it.`);
				run.catch(e => console.error(`[plugins] "${name}" failed to start:`, e));
			} else if (outcome === SKIPPED) {
				skipped.push(...ordered.slice(index));
				run.catch(e => console.error(`[plugins] "${name}" failed to start:`, e));
				break;
			}
		} catch (e) {
			errors[name] = String(e);
			console.error(`[plugins] "${name}" failed to start:`, e);
		} finally {
			clearTimeout(timer);
		}
	}
	return { errors, timedOut, skipped };
}

/**
 * Startup, after the stores are ready and before the app is drawn. In safe mode nothing runs and
 * nothing is written, so a plugin that breaks Miyapad can still be switched off.
 */
export async function startPlugins(pluginStorage: PluginStorage, safeMode: boolean, miyapadFor: (name: string) => unknown, control?: PluginStartControl): Promise<PluginStartInfo> {
	if (safeMode) return { safeMode, switchedOff: [], errors: {}, timedOut: [], skipped: [] };
	const switchedOff = await switchOffMismatched(pluginStorage);
	const names = Object.keys(pluginStorage.plugins).filter(name => pluginStorage.plugins[name].enabled && !switchedOff.includes(name));
	return { safeMode, switchedOff, ...await runPlugins(pluginStorage.plugins, names, miyapadFor, control) };
}

/** Passes the prompt through each prompt hook. A hook that throws or returns a non-string is skipped. */
export async function runPromptHooks(prompt: string): Promise<string> {
	for (const hook of [...hooks.prompt]) {
		try {
			const result = await hook(prompt);
			if (typeof result === 'string') prompt = result;
			else console.error('[plugins] A prompt hook returned something that isn\'t a string, so it was skipped:', result);
		} catch (e) {
			console.error('[plugins] A prompt hook failed, so it was skipped:', e);
		}
	}
	return prompt;
}

/**
 * A plugin's own view of the shared hook arrays. `prompt` and `output` entries are wrapped with
 * the plugin's hook timeout, because the shared array loses the plugin's identity by the time a
 * hook runs. `commands` is the shared array: actions are synchronous, so no timeout applies.
 */
export function pluginHooksFor(record: PluginRecord) {
	const timeoutMs = (record.hookTimeout ?? DEFAULT_PLUGIN_HOOK_TIMEOUT_S) * 1000;
	const wrap = <A extends unknown[], R>(hook: (...args: A) => R | Promise<R>) => (...args: A): Promise<R> => {
		const call = Promise.resolve().then(() => hook(...args));
		// A timeout means stop waiting, not cancel, so a late failure from the abandoned call is swallowed.
		call.catch(() => {});
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs);
		});
		return Promise.race([call, timeout]).finally(() => clearTimeout(timer)) as Promise<R>;
	};
	return {
		prompt: { push: (hook: PromptHook) => { hooks.prompt.push(wrap(hook)); } },
		output: { push: (hook: OutputHook) => { hooks.output.push(wrap(hook)); } },
		commands: hooks.commands,
	};
}

let outputChain: Promise<void> = Promise.resolve();

/** Queues the output hooks on their own chain, so the caller doesn't wait and generations reach them in order. */
export function runOutputHooks(text: string, info: { complete: boolean }): Promise<void> {
	outputChain = outputChain.then(async () => {
		for (const hook of [...hooks.output]) {
			try {
				await hook(text, info);
			} catch (e) {
				console.error('[plugins] An output hook failed:', e);
			}
		}
	});
	return outputChain;
}
