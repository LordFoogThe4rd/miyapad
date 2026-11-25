import type { ComponentType, ReactNode } from 'react';
import { APP_VERSION } from './version';
import { isNewer } from './hooks/useUpdateCheck';
import { isZipBytes, parsePluginArchive, PluginArchiveError, type ParsedPluginArchive } from './plugins/archive';
import { SUPPORTED_PLUGIN_API } from './plugins/manifest';
import type { GenerationMode } from './plugins/events';
import type { EditorAdapter } from './editor/EditorAdapter';
import type { PluginStorage } from './storage/PluginStorage';

export interface PromptHookContext {
	readonly dryRun: boolean;
	readonly mode: GenerationMode;
	abort: () => void;
	params: (overrides: Record<string, unknown>) => void;
}

export interface MessagesHookContext {
	readonly dryRun: boolean;
	abort: () => void;
	params: (overrides: Record<string, unknown>) => void;
}

export interface HookRunState {
	readonly dryRun: boolean;
	readonly mode: GenerationMode;
	aborted: boolean;
	params: Record<string, unknown>;
}

export type PromptHook = (prompt: string, ctx: PromptHookContext) => string | Promise<string>;
export type MessagesHook = (messages: ChatMessage[], ctx: MessagesHookContext) => ChatMessage[] | Promise<ChatMessage[]>;
export type OutputHook = (text: string, info: { complete: boolean }) => void | Promise<void>;
export interface PluginCommand {
	label: string;
	action: () => void;
}

export type PluginSettingsMode = 'inline' | 'modal';

export interface PluginSettingsInput {
	mode?: PluginSettingsMode;
	Component: ComponentType;
}

export interface PluginSettingsEntry {
	readonly id: string;
	readonly name: string;
	readonly order: number;
	readonly mode: PluginSettingsMode;
	readonly Component: ComponentType;
}

export interface PluginSidebarInput {
	label: string;
	Component: ComponentType;
	expanded?: boolean;
}

export interface PluginSidebarEntry {
	readonly id: string;
	readonly name: string;
	readonly order: number;
	readonly label: string;
	readonly Component: ComponentType;
	readonly expanded?: boolean;
}

export interface PluginModalEntry {
	readonly id: string;
	readonly name: string;
	readonly order: number;
	readonly Component: ComponentType;
}

export interface PluginToolbarInput {
	title: string;
	icon: ReactNode | ComponentType;
	active?: boolean | (() => boolean);
	disabled?: boolean | (() => boolean);
	onClick: () => void;
}

export interface PluginToolbarEntry {
	readonly id: string;
	readonly name: string;
	readonly order: number;
	readonly title: string;
	readonly icon: ReactNode | ComponentType;
	readonly active?: boolean | (() => boolean);
	readonly disabled?: boolean | (() => boolean);
	readonly onClick: () => void;
}

export interface PluginUiSnapshot {
	readonly settings: Readonly<Record<string, PluginSettingsEntry>>;
	readonly sidebar: readonly PluginSidebarEntry[];
	readonly modals: readonly PluginModalEntry[];
	readonly toolbar: readonly PluginToolbarEntry[];
}

export type PluginEditor = Omit<EditorAdapter, 'destroy'>;

const HOOK_PLUGIN_ID = Symbol('pluginId');
type TaggedHook<F> = F & { [HOOK_PLUGIN_ID]?: string };

/**
 * Shared by every plugin. Plugins push onto these, and Miyapad reads them each time it uses
 * them, so an entry pushed after startup still works.
 */
export const hooks = {
	prompt: [] as PromptHook[],
	messages: [] as MessagesHook[],
	output: [] as OutputHook[],
	commands: [] as PluginCommand[],
};

let uiSnapshot: PluginUiSnapshot = {
	settings: {},
	sidebar: [],
	modals: [],
	toolbar: [],
};
const uiListeners = new Set<() => void>();

function notifyPluginUi() {
	for (const listener of uiListeners) listener();
}

export function getPluginUiSnapshot(): PluginUiSnapshot {
	return uiSnapshot;
}

export function subscribePluginUi(listener: () => void): () => void {
	uiListeners.add(listener);
	return () => { uiListeners.delete(listener); };
}

export function clearPluginUiHooks(): void {
	if (
		Object.keys(uiSnapshot.settings).length === 0 &&
		uiSnapshot.sidebar.length === 0 &&
		uiSnapshot.modals.length === 0 &&
		uiSnapshot.toolbar.length === 0
	) {
		return;
	}
	uiSnapshot = { settings: {}, sidebar: [], modals: [], toolbar: [] };
	notifyPluginUi();
}

export function createHookRunState(options: { dryRun: boolean; mode: GenerationMode }): HookRunState {
	return {
		dryRun: options.dryRun,
		mode: options.mode,
		aborted: false,
		params: {},
	};
}

let runtimeErrors: Record<string, string> = {};
const runtimeErrorListeners = new Set<() => void>();

function notifyRuntimeErrors() {
	for (const listener of runtimeErrorListeners) listener();
}

export function recordPluginRuntimeError(id: string, error: string): void {
	if (runtimeErrors[id] === error) return;
	runtimeErrors = { ...runtimeErrors, [id]: error };
	notifyRuntimeErrors();
}

export function clearPluginRuntimeError(id?: string): void {
	if (id === undefined) {
		if (Object.keys(runtimeErrors).length === 0) return;
		runtimeErrors = {};
		notifyRuntimeErrors();
		return;
	}
	if (!Object.hasOwn(runtimeErrors, id)) return;
	const { [id]: _, ...rest } = runtimeErrors;
	runtimeErrors = rest;
	notifyRuntimeErrors();
}

export function getPluginRuntimeErrors(): Readonly<Record<string, string>> {
	return runtimeErrors;
}

export function subscribePluginRuntimeErrors(listener: () => void): () => void {
	runtimeErrorListeners.add(listener);
	return () => { runtimeErrorListeners.delete(listener); };
}

/** What happened to the plugins on this start. Kept in memory only, for the Plugins tab. */
export interface PluginStartInfo {
	safeMode: boolean;
	/** Switched off because they aren't declared for this version or require an unavailable host capability. */
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

export interface HostCapabilities {
	server: boolean;
}

export const DEFAULT_PLUGIN_START_TIMEOUT_S = 5;
export const DEFAULT_PLUGIN_HOOK_TIMEOUT_S = 10;

/**
 * Fetches and parses a `.miyaplugin` zip archive from an address.
 * Checks zip magic bytes rather than trusting `Content-Type`.
 */
export async function fetchPluginFromUrl(url: string, viaServer: boolean): Promise<ParsedPluginArchive> {
	const res = await fetch(viaServer ? `/proxy-url?url=${encodeURIComponent(url)}` : url, { cache: 'no-store' });
	if (res.status === 413) {
		throw new PluginArchiveError('archive-too-large', 'Plugin archive exceeds the 10 MB limit');
	}
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	if ((res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
		throw new Error('That address is a web page, not a .miyaplugin archive');
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (!isZipBytes(bytes)) {
		throw new PluginArchiveError('not-zip', 'Not a valid .miyaplugin zip archive');
	}
	return parsePluginArchive(bytes);
}

export type PluginFit = 'fits' | 'mismatched' | 'undeclared';

export function checkVersion(
	{ minMiyapad: min, maxMiyapad: max }: Pick<PluginManifest, 'minMiyapad' | 'maxMiyapad'>,
	version = APP_VERSION,
): PluginFit {
	if (min === undefined && max === undefined) return 'undeclared';
	if (min !== undefined && isNewer(min, version)) return 'mismatched';
	// Cut to as many parts as max has, so a max of 2.10 covers every 2.10.x release.
	if (max !== undefined && isNewer(version.split('.').slice(0, max.split('.').length).join('.'), max)) return 'mismatched';
	return 'fits';
}

export function checkRequirements(
	manifest: Pick<PluginManifest, 'requires'>,
	host: HostCapabilities = { server: false },
): PluginCapability[] {
	return (manifest.requires ?? []).filter(req => req === 'server' && !host.server);
}

/** Sorts plugin ids by `manifest.order` ascending, then `id` ascending. */
export function comparePlugins(plugins: Record<string, PluginRecord>, a: string, b: string): number {
	const orderDiff = (plugins[a]?.manifest.order ?? 0) - (plugins[b]?.manifest.order ?? 0);
	if (orderDiff !== 0) return orderDiff;
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Switches off every switched-on plugin that isn't declared for this version (unless allowed
 * for this version) or requires a missing host capability, and returns their ids.
 */
export async function switchOffMismatched(
	pluginStorage: PluginStorage,
	host: HostCapabilities = { server: false },
): Promise<string[]> {
	const ids = Object.keys(pluginStorage.plugins).sort().filter(id => {
		const plugin = pluginStorage.plugins[id];
		if (!plugin.enabled) return false;
		if (checkRequirements(plugin.manifest, host).length > 0) return true;
		return checkVersion(plugin.manifest) !== 'fits' && plugin.allowedVersion !== APP_VERSION;
	});
	for (const id of ids) {
		const plugin = pluginStorage.plugins[id];
		const missing = checkRequirements(plugin.manifest, host);
		if (missing.length > 0) {
			console.warn(`[plugins] Switched off "${id}": it requires ${missing.join(', ')}.`);
		} else {
			console.warn(`[plugins] Switched off "${id}": it isn't declared for Miyapad ${APP_VERSION}.`);
		}
		await pluginStorage.setEnabled(id, false).catch(e => console.error(`[plugins] Couldn't save "${id}" as switched off:`, e));
	}
	return ids;
}

const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
const TIMED_OUT = Symbol('timed out');
const SKIPPED = Symbol('skipped');

/**
 * Runs each plugin in `(manifest.order, id)` order. A plugin missing required host capabilities
 * is skipped. A plugin that throws is recorded and skipped; one still running after its start
 * timeout is left running and recorded.
 */
export async function runPlugins(
	plugins: Record<string, PluginRecord>,
	ids: string[],
	miyapadFor: (id: string) => unknown,
	control?: PluginStartControl,
	host: HostCapabilities = { server: false },
): Promise<Pick<PluginStartInfo, 'errors' | 'timedOut' | 'skipped'>> {
	const errors: Record<string, string> = {};
	const timedOut: string[] = [];
	const skipped: string[] = [];
	const ordered = ids
		.filter(id => checkRequirements(plugins[id].manifest, host).length === 0)
		.sort((a, b) => comparePlugins(plugins, a, b));
	// One sentinel for the whole run: once the user skips, it keeps winning the race.
	const skipPromise = control?.skip.then(() => SKIPPED);
	for (const [index, id] of ordered.entries()) {
		const record = plugins[id];
		control?.onProgress?.(record.manifest.name, index + 1, ordered.length);
		if (record.manifest.api > SUPPORTED_PLUGIN_API) {
			console.warn(`[plugins] "${id}" declares API ${record.manifest.api}, which is newer than supported API ${SUPPORTED_PLUGIN_API}.`);
		}
		const seconds = record.manifest.startTimeout ?? DEFAULT_PLUGIN_START_TIMEOUT_S;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const run = new AsyncFunction('miyapad', record.code)(miyapadFor(id));
			const timeout = new Promise(resolve => { timer = setTimeout(resolve, seconds * 1000, TIMED_OUT); });
			const outcome = await Promise.race([run, timeout, ...(skipPromise ? [skipPromise] : [])]);
			if (outcome === TIMED_OUT) {
				timedOut.push(id);
				console.warn(`[plugins] "${id}" took more than ${seconds} seconds to start; Miyapad didn't wait for it.`);
				run.catch(e => {
					recordPluginRuntimeError(id, String(e));
					console.error(`[plugins] "${id}" failed to start:`, e);
				});
			} else if (outcome === SKIPPED) {
				skipped.push(...ordered.slice(index));
				run.catch(e => {
					recordPluginRuntimeError(id, String(e));
					console.error(`[plugins] "${id}" failed to start:`, e);
				});
				break;
			}
		} catch (e) {
			errors[id] = String(e);
			console.error(`[plugins] "${id}" failed to start:`, e);
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
export async function startPlugins(
	pluginStorage: PluginStorage,
	safeMode: boolean,
	miyapadFor: (id: string) => unknown,
	control?: PluginStartControl,
	host: HostCapabilities = { server: false },
): Promise<PluginStartInfo> {
	if (safeMode) return { safeMode, switchedOff: [], errors: {}, timedOut: [], skipped: [] };
	const switchedOff = await switchOffMismatched(pluginStorage, host);
	const ids = Object.keys(pluginStorage.plugins).filter(id => pluginStorage.plugins[id].enabled && !switchedOff.includes(id));
	return { safeMode, switchedOff, ...await runPlugins(pluginStorage.plugins, ids, miyapadFor, control, host) };
}

function makeHookControls(state: HookRunState): { abort: () => void; params: (overrides: Record<string, unknown>) => void } {
	return {
		abort: () => {
			if (!state.dryRun) state.aborted = true;
		},
		params: (overrides: Record<string, unknown>) => {
			if (!state.dryRun && overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
				Object.assign(state.params, overrides);
			}
		},
	};
}

/**
 * Passes the prompt through each prompt hook. A hook that throws or returns a non-string is
 * logged and skipped. Calling `ctx.abort()` stops later hooks and marks `state.aborted`.
 */
export async function runPromptHooks(prompt: string, state: HookRunState = createHookRunState({ dryRun: false, mode: 'completion' })): Promise<string> {
	const controls = makeHookControls(state);
	const ctx: PromptHookContext = {
		dryRun: state.dryRun,
		mode: state.mode,
		abort: controls.abort,
		params: controls.params,
	};
	for (const hook of [...hooks.prompt]) {
		if (state.aborted) break;
		const id = (hook as TaggedHook<PromptHook>)[HOOK_PLUGIN_ID];
		try {
			const result = await hook(prompt, ctx);
			if (state.aborted) break;
			if (typeof result === 'string') {
				prompt = result;
			} else {
				const detail = `prompt hook returned ${result === null ? 'null' : typeof result} instead of a string`;
				if (id !== undefined) {
					recordPluginRuntimeError(id, detail);
					console.error(`[plugins] "${id}": ${detail}, so it was skipped:`, result);
				} else {
					console.error('[plugins] A prompt hook returned something that isn\'t a string, so it was skipped:', result);
				}
			}
		} catch (e) {
			if (id !== undefined) {
				recordPluginRuntimeError(id, String(e));
				console.error(`[plugins] "${id}": prompt hook failed, so it was skipped:`, e);
			} else {
				console.error('[plugins] A prompt hook failed, so it was skipped:', e);
			}
		}
	}
	return prompt;
}

/**
 * Passes Chat API messages through each messages hook right after `convertChatToJSON`.
 * A hook that throws or returns a non-array is logged and skipped.
 */
export async function runMessagesHooks(messages: ChatMessage[], state: HookRunState = createHookRunState({ dryRun: false, mode: 'chat' })): Promise<ChatMessage[]> {
	const controls = makeHookControls(state);
	const ctx: MessagesHookContext = {
		dryRun: state.dryRun,
		abort: controls.abort,
		params: controls.params,
	};
	for (const hook of [...hooks.messages]) {
		if (state.aborted) break;
		const id = (hook as TaggedHook<MessagesHook>)[HOOK_PLUGIN_ID];
		try {
			const result = await hook(messages, ctx);
			if (state.aborted) break;
			if (Array.isArray(result)) {
				messages = result;
			} else {
				const detail = `messages hook returned ${result === null ? 'null' : typeof result} instead of an array`;
				if (id !== undefined) {
					recordPluginRuntimeError(id, detail);
					console.error(`[plugins] "${id}": ${detail}, so it was skipped:`, result);
				} else {
					console.error('[plugins] A messages hook returned something that isn\'t an array, so it was skipped:', result);
				}
			}
		} catch (e) {
			if (id !== undefined) {
				recordPluginRuntimeError(id, String(e));
				console.error(`[plugins] "${id}": messages hook failed, so it was skipped:`, e);
			} else {
				console.error('[plugins] A messages hook failed, so it was skipped:', e);
			}
		}
	}
	return messages;
}

/**
 * A plugin's own view of the shared hook arrays. `prompt`, `messages` and `output` entries are
 * wrapped with the plugin's `id` and `hookTimeout`, so runtime failures and timeouts are attributed to `id`.
 */
export function pluginHooksFor(id: string, record: PluginRecord) {
	const timeoutMs = (record.manifest.hookTimeout ?? DEFAULT_PLUGIN_HOOK_TIMEOUT_S) * 1000;
	const wrap = <A extends unknown[], R>(hook: (...args: A) => R | Promise<R>): TaggedHook<(...args: A) => Promise<R>> => {
		const wrapped: TaggedHook<(...args: A) => Promise<R>> = (...args: A): Promise<R> => {
			const call = Promise.resolve().then(() => hook(...args));
			// A timeout means stop waiting, not cancel, so a late failure from the abandoned call is swallowed.
			call.catch(() => {});
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs);
			});
			return Promise.race([call, timeout]).finally(() => clearTimeout(timer)) as Promise<R>;
		};
		wrapped[HOOK_PLUGIN_ID] = id;
		return wrapped;
	};
	return {
		prompt: { push: (hook: PromptHook) => { hooks.prompt.push(wrap(hook)); } },
		messages: { push: (hook: MessagesHook) => { hooks.messages.push(wrap(hook)); } },
		output: { push: (hook: OutputHook) => { hooks.output.push(wrap(hook)); } },
		commands: hooks.commands,
		settings: (entry: PluginSettingsInput) => {
			if (!entry || typeof entry.Component !== 'function') {
				const detail = 'hooks.settings() requires a Component function';
				recordPluginRuntimeError(id, detail);
				console.error(`[plugins] "${id}": ${detail}`);
				return;
			}
			const mode: PluginSettingsMode = entry.mode === 'modal' ? 'modal' : 'inline';
			uiSnapshot = {
				...uiSnapshot,
				settings: {
					...uiSnapshot.settings,
					[id]: {
						id,
						name: record.manifest.name,
						order: record.manifest.order,
						mode,
						Component: entry.Component,
					},
				},
			};
			notifyPluginUi();
		},
		sidebar: {
			push: (entry: PluginSidebarInput) => {
				if (!entry || typeof entry.label !== 'string' || typeof entry.Component !== 'function') {
					const detail = 'hooks.sidebar.push() requires a label string and Component function';
					recordPluginRuntimeError(id, detail);
					console.error(`[plugins] "${id}": ${detail}`);
					return;
				}
				uiSnapshot = {
					...uiSnapshot,
					sidebar: [
						...uiSnapshot.sidebar,
						{
							id,
							name: record.manifest.name,
							order: record.manifest.order,
							label: entry.label,
							Component: entry.Component,
							expanded: entry.expanded,
						},
					],
				};
				notifyPluginUi();
			},
		},
		modals: {
			push: (Component: ComponentType) => {
				if (typeof Component !== 'function') {
					const detail = 'hooks.modals.push() requires a Component function';
					recordPluginRuntimeError(id, detail);
					console.error(`[plugins] "${id}": ${detail}`);
					return;
				}
				uiSnapshot = {
					...uiSnapshot,
					modals: [
						...uiSnapshot.modals,
						{
							id,
							name: record.manifest.name,
							order: record.manifest.order,
							Component,
						},
					],
				};
				notifyPluginUi();
			},
		},
		toolbar: {
			push: (entry: PluginToolbarInput) => {
				if (!entry || typeof entry.title !== 'string' || typeof entry.onClick !== 'function') {
					const detail = 'hooks.toolbar.push() requires a title string and onClick function';
					recordPluginRuntimeError(id, detail);
					console.error(`[plugins] "${id}": ${detail}`);
					return;
				}
				uiSnapshot = {
					...uiSnapshot,
					toolbar: [
						...uiSnapshot.toolbar,
						{
							id,
							name: record.manifest.name,
							order: record.manifest.order,
							title: entry.title,
							icon: entry.icon,
							active: entry.active,
							disabled: entry.disabled,
							onClick: entry.onClick,
						},
					],
				};
				notifyPluginUi();
			},
		},
	};
}

/**
 * Returns a safe wrapper around the mounted prompt editor adapter with `destroy()` omitted,
 * or `undefined` before the editor mounts.
 */
export function pluginEditorFor(
	current: () => { promptEditorView: { current: EditorAdapter | null } } | null,
): PluginEditor | undefined {
	const adapter = current()?.promptEditorView.current;
	if (!adapter) return undefined;
	return {
		getText: () => adapter.getText(),
		getSelection: () => adapter.getSelection(),
		replaceText: (newText: string) => adapter.replaceText(newText),
		replaceRange: (from: number, to: number, insert: string) => adapter.replaceRange(from, to, insert),
		replaceRanges: (changes: { from: number; to: number; insert: string }[]) => adapter.replaceRanges(changes),
		focus: () => adapter.focus(),
		scrollIntoView: (pos: number, options?: { y?: string }) => adapter.scrollIntoView(pos, options),
		setSelection: (anchor: number, head: number) => adapter.setSelection(anchor, head),
		posAtCoords: (coords: { x: number; y: number }) => adapter.posAtCoords(coords),
		coordsAtPos: (pos: number) => adapter.coordsAtPos(pos),
		get dom() { return adapter.dom; },
	};
}

/**
 * Ranges from the sampler inputs in the sidebar. A setter not listed gets only the type check.
 * shortcut: copied from Sidebar.tsx rather than shared, so the two can drift; make one table
 * when a range changes in the UI.
 */
const RANGES: Record<string, { min?: number; max?: number }> = {
	setTemperature: { min: 0, max: 5 },
	setRepeatPenalty: { min: 1, max: 3 },
	setRepeatLastN: { min: 0 },
	setPresencePenalty: { min: -2, max: 2 },
	setFrequencyPenalty: { min: -2, max: 2 },
	setMirostat: { min: 0, max: 2 },
	setMirostatTau: { min: 0, max: 20 },
	setMirostatEta: { min: 0, max: 1 },
	setXtcThreshold: { min: 0, max: 0.5 },
	setXtcProbability: { min: 0, max: 1 },
	setDryMultiplier: { min: 0, max: 5 },
	setDryBase: { min: 1, max: 4 },
	setDryAllowedLength: { min: 0, max: 20 },
	setDryPenaltyRange: { min: 0 },
	setTopK: { min: 0, max: 200 },
	setTopP: { min: 0, max: 1 },
	setMinP: { min: 0, max: 1 },
	setTypicalP: { min: 0, max: 1 },
	setTfsZ: { min: 0, max: 1 },
	setMaxPredictTokens: { min: -1 },
	setSeed: { min: -1 },
	setMemoryTokens: { min: 0 },
	setAuthorNoteTokens: { min: 0 },
	setAuthorNoteDepth: { min: 0 },
	setHistoryKeep: { min: 1 },
	setHistoryDeletionThreshold: { min: 1 },
};

/** The field a `set*` key writes to, found the way React names them: `setTTSEnabled` writes `ttsEnabled`. */
function fieldOf(state: Record<string, unknown>, setter: string): string | undefined {
	return Object.keys(state).find(key => key !== setter && `set${key}`.toLowerCase() === setter.toLowerCase());
}

/**
 * A plugin's view of an app state object. Reads go to the latest value. A `set*` call is checked
 * against what the field holds now, and against its range if it has one; a rejected call throws
 * and writes nothing. Only a plugin's calls are checked, so Miyapad's own code keeps its
 * half-typed input values.
 */
export function pluginStateView<T extends object>(current: () => T | null): T {
	const read = (key: string) => {
		const state = current() as Record<string, unknown> | null;
		if (!state) return undefined;
		const value = state[key];
		if (typeof value !== 'function' || !key.startsWith('set')) return value;
		return (next: unknown) => {
			const live = current() as Record<string, unknown> | null;
			const field = live ? fieldOf(live, key) : undefined;
			checkSetter(key, field ? live![field] : undefined, next);
			return (value as (arg: unknown) => unknown)(next);
		};
	};
	return new Proxy({} as T, {
		get: (_, key) => typeof key === 'string' ? read(key) : undefined,
		has: (_, key) => typeof key === 'string' && key in (current() ?? {}),
		ownKeys: () => Object.keys(current() ?? {}),
		getOwnPropertyDescriptor: (_, key) => typeof key === 'string' && current()
			? { value: read(key), enumerable: true, configurable: true }
			: undefined,
	});
}

/** Throws a `TypeError` for a value the field can't take, so the plugin author sees it. */
function checkSetter(setter: string, currentValue: unknown, next: unknown) {
	// A null or undefined field says nothing about the type it takes.
	const known = currentValue !== null && currentValue !== undefined;
	if (next === null) {
		if (known && typeof currentValue !== 'object' && typeof currentValue !== 'function') {
			throw new TypeError(`miyapad: ${setter}() doesn't take null`);
		}
	} else if (known && typeof next !== typeof currentValue) {
		throw new TypeError(`miyapad: ${setter}() takes a ${typeof currentValue}`);
	} else if (known && Array.isArray(next) !== Array.isArray(currentValue)) {
		throw new TypeError(`miyapad: ${setter}() takes ${Array.isArray(currentValue) ? 'an array' : 'no array'}`);
	}
	if (typeof next === 'number') {
		if (!Number.isFinite(next)) throw new TypeError(`miyapad: ${setter}() takes a finite number`);
		const range = RANGES[setter];
		if (range?.min !== undefined && next < range.min) throw new RangeError(`miyapad: ${setter}() takes ${range.min} or more`);
		if (range?.max !== undefined && next > range.max) throw new RangeError(`miyapad: ${setter}() takes ${range.max} or less`);
	}
}

let outputChain: Promise<void> = Promise.resolve();

/** Queues the output hooks on their own chain, so the caller doesn't wait and generations reach them in order. */
export function runOutputHooks(text: string, info: { complete: boolean }): Promise<void> {
	outputChain = outputChain.then(async () => {
		for (const hook of [...hooks.output]) {
			const id = (hook as TaggedHook<OutputHook>)[HOOK_PLUGIN_ID];
			try {
				await hook(text, info);
			} catch (e) {
				if (id !== undefined) {
					recordPluginRuntimeError(id, String(e));
					console.error(`[plugins] "${id}": output hook failed:`, e);
				} else {
					console.error('[plugins] An output hook failed:', e);
				}
			}
		}
	});
	return outputChain;
}
