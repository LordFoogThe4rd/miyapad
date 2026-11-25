import { useSyncExternalStore } from 'react';
import { recordPluginRuntimeError } from '../plugins';

export type ContextInjectionPosition = 'before' | 'after' | 'depth';

export interface ContextInjectionInput {
	text: string;
	position?: ContextInjectionPosition;
	depth?: number;
	scanWorldInfo?: boolean;
}

export interface ContextInjectionEntry {
	pluginId: string;
	order: number;
	key: string;
	text: string;
	position: ContextInjectionPosition;
	depth: number;
	scanWorldInfo: boolean;
}

export interface ContextPlaceholderEntry {
	pluginId: string;
	order: number;
	name: string;
	fn: () => string;
}

export interface PluginContextSnapshot {
	readonly injections: readonly ContextInjectionEntry[];
	readonly placeholders: ReadonlyMap<string, ContextPlaceholderEntry>;
}

export interface PluginContextApi {
	setInjection(key: string, entry: ContextInjectionInput | null): void;
	setPlaceholder(name: string, fn: (() => string) | null): void;
}

const VALID_POSITIONS = new Set<ContextInjectionPosition>(['before', 'after', 'depth']);

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareInjections(a: ContextInjectionEntry, b: ContextInjectionEntry): number {
	return a.order - b.order || compareStrings(a.pluginId, b.pluginId) || compareStrings(a.key, b.key);
}

function comparePlaceholders(a: ContextPlaceholderEntry, b: ContextPlaceholderEntry): number {
	return a.order - b.order || compareStrings(a.pluginId, b.pluginId) || compareStrings(a.name, b.name);
}

/**
 * Reactive store for pre-truncation prompt injections and synchronous placeholders registered by
 * plugins through `miyapad.context`. Read by `usePromptBuilder` via `useSyncExternalStore`.
 */
export class PluginContextStore {
	#injections = new Map<string, ContextInjectionEntry>();
	#placeholders = new Map<string, ContextPlaceholderEntry>();
	#listeners = new Set<() => void>();
	#snapshot: PluginContextSnapshot = {
		injections: [],
		placeholders: new Map(),
	};

	subscribe = (listener: () => void): (() => void) => {
		this.#listeners.add(listener);
		return () => { this.#listeners.delete(listener); };
	};

	getSnapshot = (): PluginContextSnapshot => this.#snapshot;

	setInjection(pluginId: string, order: number, key: string, entry: ContextInjectionInput | null): void {
		if (typeof key !== 'string' || key.length === 0) {
			throw new TypeError('miyapad.context.setInjection: key must be a non-empty string');
		}
		const storageKey = `${pluginId}/${key}`;
		if (entry === null) {
			if (!this.#injections.delete(storageKey)) return;
			this.#rebuild();
			return;
		}
		if (typeof entry !== 'object' || Array.isArray(entry) || typeof entry.text !== 'string') {
			throw new TypeError('miyapad.context.setInjection: entry must be null or an object with a string text');
		}
		const position: ContextInjectionPosition = entry.position ?? 'before';
		if (!VALID_POSITIONS.has(position)) {
			throw new TypeError(`miyapad.context.setInjection: invalid position "${String(position)}"`);
		}
		const depth = entry.depth === undefined
			? 0
			: (typeof entry.depth === 'number' && Number.isFinite(entry.depth) && entry.depth >= 0
				? Math.floor(entry.depth)
				: (() => { throw new RangeError('miyapad.context.setInjection: depth must be a non-negative finite number'); })());
		this.#injections.set(storageKey, {
			pluginId,
			order,
			key,
			text: entry.text,
			position,
			depth,
			scanWorldInfo: Boolean(entry.scanWorldInfo),
		});
		this.#rebuild();
	}

	setPlaceholder(pluginId: string, order: number, name: string, fn: (() => string) | null): void {
		if (typeof name !== 'string' || name.length === 0 || /[{}]/.test(name)) {
			throw new TypeError('miyapad.context.setPlaceholder: name must be a non-empty string without braces');
		}
		const storageKey = `${pluginId}/${name}`;
		if (fn === null) {
			if (!this.#placeholders.delete(storageKey)) return;
			this.#rebuild();
			return;
		}
		if (typeof fn !== 'function') {
			throw new TypeError('miyapad.context.setPlaceholder: fn must be a function or null');
		}
		this.#placeholders.set(storageKey, { pluginId, order, name, fn });
		this.#rebuild();
	}

	forPlugin(pluginId: string, order = 0): PluginContextApi {
		return {
			setInjection: (key, entry) => this.setInjection(pluginId, order, key, entry),
			setPlaceholder: (name, fn) => this.setPlaceholder(pluginId, order, name, fn),
		};
	}

	clear(): void {
		if (this.#injections.size === 0 && this.#placeholders.size === 0) return;
		this.#injections.clear();
		this.#placeholders.clear();
		this.#rebuild();
	}

	#rebuild(): void {
		const injections = [...this.#injections.values()].sort(compareInjections);
		const placeholders = new Map<string, ContextPlaceholderEntry>();
		for (const entry of [...this.#placeholders.values()].sort(comparePlaceholders)) {
			placeholders.set(entry.name, entry);
		}
		this.#snapshot = { injections, placeholders };
		for (const listener of this.#listeners) listener();
	}
}

export const pluginContext = new PluginContextStore();

export function usePluginContext(): PluginContextSnapshot {
	return useSyncExternalStore(pluginContext.subscribe, pluginContext.getSnapshot, pluginContext.getSnapshot);
}

/**
 * Expands registered `{<name>}` and `{{<name>}}` plugin placeholders in a single pass.
 * A throwing or non-string placeholder is logged under its plugin id and left untouched.
 */
export function expandPluginPlaceholders(
	text: string,
	placeholders: ReadonlyMap<string, ContextPlaceholderEntry>,
): string {
	if (placeholders.size === 0 || text.length === 0 || !text.includes('{')) return text;
	return text.replace(/\{\{([^{}]+)\}\}|\{([^{}]+)\}/g, (match, doubleName: string | undefined, singleName: string | undefined) => {
		const name = doubleName ?? singleName!;
		const entry = placeholders.get(name);
		if (!entry) return match;
		try {
			const value = entry.fn();
			if (typeof value === 'string') return value;
			const detail = `placeholder "${name}" returned ${value === null ? 'null' : typeof value} instead of a string`;
			recordPluginRuntimeError(entry.pluginId, detail);
			console.error(`[plugins] "${entry.pluginId}": ${detail}, so it was left untouched:`, value);
			return match;
		} catch (error) {
			recordPluginRuntimeError(entry.pluginId, String(error));
			console.error(`[plugins] "${entry.pluginId}": placeholder "${name}" failed, so it was left untouched:`, error);
			return match;
		}
	});
}
