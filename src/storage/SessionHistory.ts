import { AbstractStorage } from './AbstractStorage';

/** How long content has to sit unchanged before it's saved as a version. */
export const HISTORY_IDLE_MS = 60_000;

/** localStorage keys (written by usePersistentState) and their defaults. */
export const HISTORY_KEEP_KEY = 'historyKeep';
export const HISTORY_DELETION_THRESHOLD_KEY = 'historyDeletionThreshold';
export const DEFAULT_HISTORY_KEEP = 30;
export const DEFAULT_HISTORY_DELETION_THRESHOLD = 100;

/** Session properties a version captures. Changing anything else never creates one. */
export const HISTORY_CONTENT_KEYS = ['prompt', 'memoryTokens', 'authorNoteTokens', 'worldInfo'];

/** A positive whole number, or the fallback for anything else (an emptied number input stores null). */
export function positiveCount(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function readCount(key: string, fallback: number): number {
	try {
		return positiveCount(JSON.parse(localStorage.getItem(key) ?? 'null'), fallback);
	} catch {
		return fallback;
	}
}

function pick(value: unknown, keys: string[]) {
	if (!value || typeof value !== 'object') return undefined;
	const src = value as Record<string, unknown>;
	return Object.fromEntries(keys.filter(k => Object.hasOwn(src, k)).map(k => [k, src[k]]));
}

/**
 * The part of a session a version stores. Leaves out per-token probabilities (often
 * many times the size of the text) and the token counts older sessions still carry
 * inside memoryTokens; settings like the API key are never included.
 */
export function snapshotContent(session: SessionData): SessionSnapshot {
	return {
		prompt: Array.isArray(session.prompt)
			? (session.prompt as PromptChunk[]).map(({ completion_probabilities, ...chunk }) => chunk)
			: undefined,
		memoryTokens: pick(session.memoryTokens, ['contextOrder', 'prefix', 'text', 'suffix']) as MemoryTokensData | undefined,
		authorNoteTokens: pick(session.authorNoteTokens, ['prefix', 'text', 'suffix']) as AuthorNoteData | undefined,
		worldInfo: session.worldInfo as WorldInfoData | undefined,
	};
}

// cyrb53: crypto.subtle is missing on plain-http LAN hosts, and this only has to spot duplicates.
function hashString(str: string): string {
	let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Saved versions of each session. Key `<sessionId>` holds that session's index (oldest
 * first), and key `<sessionId>/<time>` holds one version's content.
 */
export class SessionHistory extends AbstractStorage {
	#queue: Promise<unknown> = Promise.resolve();

	constructor(dbAdapter: DatabaseAdapter) {
		super('SessionHistory', dbAdapter);
	}

	/** One operation at a time, so two snapshots can't both append to the same stale index. */
	#enqueue<T>(work: () => Promise<T>): Promise<T> {
		const run = this.#queue.then(work, work);
		this.#queue = run.catch(() => {});
		return run;
	}

	async #index(db: DbConnection, sessionId: string | number): Promise<HistoryEntry[]> {
		const index = await this.loadFromDatabase(db, String(sessionId));
		return Array.isArray(index) ? index : [];
	}

	list(sessionId: string | number): Promise<HistoryEntry[]> {
		return this.#enqueue(async () => this.#index(await this.openDatabase(), sessionId));
	}

	load(sessionId: string | number, time: number): Promise<SessionSnapshot | undefined> {
		return this.#enqueue(async () => await this.loadFromDatabase(await this.openDatabase(), `${sessionId}/${time}`) as SessionSnapshot | undefined);
	}

	/**
	 * Saves the session's content as a new version unless it matches the latest one,
	 * then drops the oldest versions beyond the keep limit. The content is captured
	 * before this returns, so callers can pass state that is about to change.
	 */
	snapshot(sessionId: string | number, session: SessionData, reason: HistoryReason): Promise<boolean> {
		const content = snapshotContent(session);
		// A session that never stored any content is still showing the defaults; nothing to keep.
		if (Object.values(content).every(v => v === undefined)) return Promise.resolve(false);
		const hash = hashString(JSON.stringify(content));
		const text = content.prompt?.map(c => c.content).join('') ?? '';
		return this.#enqueue(async () => {
			const db = await this.openDatabase();
			const index = await this.#index(db, sessionId);
			const latest = index[index.length - 1];
			if (latest?.hash === hash) return false;

			const time = Math.max(Date.now(), (latest?.time ?? 0) + 1);
			const entries = [...index, { time, hash, reason, words: text.match(/\S+/g)?.length ?? 0, tail: text.slice(-100) }];
			const dropped = entries.splice(0, Math.max(0, entries.length - readCount(HISTORY_KEEP_KEY, DEFAULT_HISTORY_KEEP)));
			await this.batchMutation(db, [
				{ type: 'save', key: `${sessionId}/${time}`, data: content },
				{ type: 'save', key: String(sessionId), data: entries },
				...dropped.map(e => ({ type: 'delete' as const, key: `${sessionId}/${e.time}` })),
			]);
			return true;
		});
	}

	deleteAll(sessionId: string | number): Promise<void> {
		return this.#enqueue(async () => {
			const db = await this.openDatabase();
			const index = await this.#index(db, sessionId);
			if (index.length === 0) return;
			await this.batchMutation(db, [
				...index.map(e => ({ type: 'delete' as const, key: `${sessionId}/${e.time}` })),
				{ type: 'delete', key: String(sessionId) },
			]);
		});
	}
}
