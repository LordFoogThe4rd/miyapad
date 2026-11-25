import { recordPluginRuntimeError } from '../plugins';

export type GenerationMode = 'completion' | 'chat' | 'fill';

export interface PluginEventMap {
	ready: undefined;
	sessionChange: { sessionId: number | undefined };
	generationStart: { mode: GenerationMode; sessionId: number | undefined };
	generationChunk: { text: string; chunk: CompletionChunk };
	generationEnd: { text: string; complete: boolean; aborted: boolean };
}

export type PluginEventName = keyof PluginEventMap;

export type PluginEventListener<K extends PluginEventName = PluginEventName> =
	K extends 'ready' ? () => void : (payload: PluginEventMap[K]) => void;

export interface PluginEventsApi {
	on<K extends PluginEventName>(event: K, fn: PluginEventListener<K>): void;
	once<K extends PluginEventName>(event: K, fn: PluginEventListener<K>): void;
	off<K extends PluginEventName>(event: K, fn: PluginEventListener<K>): void;
}

interface ListenerEntry {
	id: string;
	fn: (...args: unknown[]) => unknown;
	once: boolean;
}

interface PendingReadyEntry {
	id: string;
	fn: () => void;
	cancelled: boolean;
}

function reportListenerError(id: string, event: string, error: unknown): void {
	recordPluginRuntimeError(id, String(error));
	console.error(`[plugins] "${id}": "${event}" event listener failed:`, error);
}

function invokeSafely(id: string, event: string, fn: (...args: unknown[]) => unknown, args: unknown[]): void {
	try {
		const result = fn(...args);
		if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
			Promise.resolve(result).catch(error => reportListenerError(id, event, error));
		}
	} catch (error) {
		reportListenerError(id, event, error);
	}
}

/**
 * Shared event bus for plugins. `'ready'` is sticky: once emitted, later subscribers run on a
 * microtask unless removed synchronously before it flushes. Errors in any listener are attributed
 * to its plugin id and never block later listeners.
 */
export class PluginEventBus {
	#listeners = new Map<PluginEventName, ListenerEntry[]>();
	#readyFired = false;
	#pendingReady: PendingReadyEntry[] = [];

	get isReady(): boolean {
		return this.#readyFired;
	}

	on<K extends PluginEventName>(id: string, event: K, fn: PluginEventListener<K>): void {
		this.#subscribe(id, event, fn, false);
	}

	once<K extends PluginEventName>(id: string, event: K, fn: PluginEventListener<K>): void {
		this.#subscribe(id, event, fn, true);
	}

	off<K extends PluginEventName>(id: string, event: K, fn: PluginEventListener<K>): void {
		if (typeof fn !== 'function') return;
		if (event === 'ready' && this.#readyFired) {
			for (const pending of this.#pendingReady) {
				if (pending.id === id && pending.fn === fn) {
					pending.cancelled = true;
				}
			}
		}
		const list = this.#listeners.get(event);
		if (!list) return;
		const next = list.filter(entry => !(entry.id === id && entry.fn === (fn as (...args: unknown[]) => unknown)));
		if (next.length === 0) this.#listeners.delete(event);
		else this.#listeners.set(event, next);
	}

	emitReady(): void {
		if (this.#readyFired) return;
		this.#readyFired = true;
		const list = this.#listeners.get('ready');
		if (!list || list.length === 0) return;
		this.#listeners.delete('ready');
		for (const entry of [...list]) {
			invokeSafely(entry.id, 'ready', entry.fn, []);
		}
	}

	emit<K extends Exclude<PluginEventName, 'ready'>>(event: K, payload: PluginEventMap[K]): void {
		const list = this.#listeners.get(event);
		if (!list || list.length === 0) return;
		for (const entry of [...list]) {
			if (entry.once) {
				this.#removeEntry(event, entry);
			}
			invokeSafely(entry.id, event, entry.fn, [payload]);
		}
	}

	forPlugin(id: string): PluginEventsApi {
		return {
			on: (event, fn) => this.on(id, event, fn),
			once: (event, fn) => this.once(id, event, fn),
			off: (event, fn) => this.off(id, event, fn),
		};
	}

	reset(): void {
		this.#listeners.clear();
		this.#readyFired = false;
		for (const pending of this.#pendingReady) pending.cancelled = true;
		this.#pendingReady = [];
	}

	#subscribe<K extends PluginEventName>(id: string, event: K, fn: PluginEventListener<K>, once: boolean): void {
		if (typeof fn !== 'function') {
			throw new TypeError(`miyapad.events.${once ? 'once' : 'on'}: listener must be a function`);
		}
		if (event === 'ready' && this.#readyFired) {
			const pending: PendingReadyEntry = { id, fn: fn as () => void, cancelled: false };
			this.#pendingReady.push(pending);
			queueMicrotask(() => {
				const idx = this.#pendingReady.indexOf(pending);
				if (idx !== -1) this.#pendingReady.splice(idx, 1);
				if (pending.cancelled) return;
				invokeSafely(pending.id, 'ready', pending.fn, []);
			});
			return;
		}
		let list = this.#listeners.get(event);
		if (!list) {
			list = [];
			this.#listeners.set(event, list);
		}
		list.push({ id, fn: fn as (...args: unknown[]) => unknown, once });
	}

	#removeEntry(event: PluginEventName, target: ListenerEntry): void {
		const list = this.#listeners.get(event);
		if (!list) return;
		const idx = list.indexOf(target);
		if (idx !== -1) list.splice(idx, 1);
		if (list.length === 0) this.#listeners.delete(event);
	}
}

export const pluginEvents = new PluginEventBus();
