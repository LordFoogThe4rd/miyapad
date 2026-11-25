import type { SessionStorage } from '../storage/SessionStorage';

export interface SessionDataWriteOptions {
	sessionId?: number;
}

export interface PluginSessionDataApi {
	readonly sessionId: number | undefined;
	get(key: string): unknown;
	keys(): string[];
	set(key: string, value: unknown, opts?: SessionDataWriteOptions): boolean;
	delete(key: string, opts?: SessionDataWriteOptions): boolean;
	clear(opts?: SessionDataWriteOptions): boolean;
}

type SessionStorageSlice = Pick<SessionStorage, 'selectedSession' | 'sessions' | 'enqueueSave'>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getActiveSession(sessionStorage: SessionStorageSlice): { id: number; session: SessionData } | null {
	const id = sessionStorage.selectedSession;
	if (id === undefined) return null;
	const session = sessionStorage.sessions[id];
	if (!session || session.inactive) return null;
	return { id, session };
}

function getPluginBucket(session: SessionData, pluginId: string): Record<string, unknown> | undefined {
	const all = session.pluginData;
	if (!isRecord(all) || !Object.hasOwn(all, pluginId)) return undefined;
	const bucket = all[pluginId];
	return isRecord(bucket) ? bucket : undefined;
}

/**
 * Per-session storage view backed by `session.pluginData[id]` on the currently open session.
 * Writes JSON-clone values, skip bumping `session.modified` or arming `SessionHistory`, and
 * honor an optional `{ sessionId }` switch guard so async work from one session cannot clobber
 * another after the user switches sessions.
 */
export function sessionDataFor(id: string, sessionStorage: SessionStorageSlice): PluginSessionDataApi {
	return {
		get sessionId() {
			return sessionStorage.selectedSession;
		},

		get(rawKey: string): unknown {
			const active = getActiveSession(sessionStorage);
			if (!active) return undefined;
			const bucket = getPluginBucket(active.session, id);
			const key = String(rawKey);
			if (!bucket || !Object.hasOwn(bucket, key)) return undefined;
			return structuredClone(bucket[key]);
		},

		keys(): string[] {
			const active = getActiveSession(sessionStorage);
			if (!active) return [];
			const bucket = getPluginBucket(active.session, id);
			return bucket ? Object.keys(bucket) : [];
		},

		set(rawKey: string, value: unknown, opts?: SessionDataWriteOptions): boolean {
			const key = String(rawKey);
			const json = JSON.stringify(value);
			if (json === undefined) {
				throw new TypeError(`miyapad.sessionData.set: the value for "${key}" can't be converted to JSON`);
			}
			const data = JSON.parse(json);

			const active = getActiveSession(sessionStorage);
			if (!active) return false;
			if (opts?.sessionId !== undefined && opts.sessionId !== active.id) return false;

			if (!isRecord(active.session.pluginData)) {
				active.session.pluginData = {};
			}
			const all = active.session.pluginData;
			if (!Object.hasOwn(all, id) || !isRecord(all[id])) {
				all[id] = {};
			}
			Object.defineProperty(all[id], key, {
				value: data,
				writable: true,
				enumerable: true,
				configurable: true,
			});
			sessionStorage.enqueueSave(active.id);
			return true;
		},

		delete(rawKey: string, opts?: SessionDataWriteOptions): boolean {
			const active = getActiveSession(sessionStorage);
			if (!active) return false;
			if (opts?.sessionId !== undefined && opts.sessionId !== active.id) return false;

			const bucket = getPluginBucket(active.session, id);
			const key = String(rawKey);
			if (bucket && Object.hasOwn(bucket, key)) {
				delete bucket[key];
				if (Object.keys(bucket).length === 0) {
					delete active.session.pluginData![id];
					if (Object.keys(active.session.pluginData!).length === 0) {
						delete active.session.pluginData;
					}
				}
				sessionStorage.enqueueSave(active.id);
			}
			return true;
		},

		clear(opts?: SessionDataWriteOptions): boolean {
			const active = getActiveSession(sessionStorage);
			if (!active) return false;
			if (opts?.sessionId !== undefined && opts.sessionId !== active.id) return false;

			if (getPluginBucket(active.session, id)) {
				delete active.session.pluginData![id];
				if (Object.keys(active.session.pluginData!).length === 0) {
					delete active.session.pluginData;
				}
				sessionStorage.enqueueSave(active.id);
			}
			return true;
		},
	};
}
