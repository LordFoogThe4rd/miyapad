import { AbstractStorage } from './AbstractStorage';
import { HISTORY_CONTENT_KEYS, HISTORY_IDLE_MS, SessionHistory } from './SessionHistory';

function extractMeta(s: Record<string, unknown>) {
	return {
		name: typeof s.name === 'string' ? s.name : undefined,
		created: typeof s.created === 'number' ? s.created : null,
		modified: typeof s.modified === 'number' ? s.modified : null,
		pinned: !!s.pinned,
		tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string') : [],
		folder: folderName(s.folder),
		stats: sanitizeStats(s.stats),
		trashed: trashedAt(s.trashed),
	};
}

/** When a session went to the trash, or undefined for one that is not in it. */
function trashedAt(raw: unknown): number | undefined {
	return typeof raw === 'number' ? raw : undefined;
}

/** A folder name as stored: whitespace collapsed, and undefined (no folder) when blank. */
export function folderName(raw: unknown): string | undefined {
	return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') || undefined : undefined;
}

const EMPTY_STATS: SessionStats = { generations: 0, genTokens: 0, genChars: 0, genMs: 0, typedChars: 0, deletedChars: 0 };

/** A complete counter set, keeping only the values of a stored one that can be counted with. */
export function sanitizeStats(raw: unknown): SessionStats {
	const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const stats = { ...EMPTY_STATS };
	for (const key of Object.keys(EMPTY_STATS) as (keyof SessionStats)[]) {
		const value = src[key];
		// A negative or non-finite counter would poison every total it is summed into.
		if (typeof value === 'number' && Number.isFinite(value) && value > 0) stats[key] = value;
	}
	return stats;
}

function safeSessionName(name: unknown, key: string | number, fallback = 'Untitled'): string {
	return typeof name === 'string'
		? (name === '[object Object]' ? `Session #${key}` : name)
		: fallback;
}

/** Identical, or arrays with identical elements (preset arrays like enabledSamplers arrive as fresh copies). */
function sameValue(a: unknown, b: unknown): boolean {
	return Object.is(a, b) || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
}

/**
 * IndexedDB keys are type-sensitive and the sessions modal passes session ids as strings,
 * so writing under "3" leaves the record at 3 orphaned and lists the session twice. The
 * server normalizes keys of its own accord, so only browser storage ever needed this.
 *
 * ponytail: this stops new duplicates. The ones a database already holds are skipped by
 * IndexedDBAdapter.loadSessionInfoFromDatabase and removed with the session they shadow,
 * so they cost a dead row each until then. No migration sweeps them; add one to the next
 * IndexedDB version bump if those rows ever matter.
 */
function sessionKey(sessionId: string | number): string | number {
	return typeof sessionId === 'string' && /^\d+$/.test(sessionId) ? +sessionId : sessionId;
}

function sanitizeNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

function sanitizeSessionData(raw: unknown, key?: string | number): SessionData {
	if (typeof raw === 'string') {
		const name = raw === '[object Object]' ? `Session #${key}` : raw;
		return { name, created: null, modified: null, pinned: false, tags: [] };
	}
	if (!raw || typeof raw !== 'object') {
		return { name: safeSessionName(undefined, key ?? 'unknown'), created: null, modified: null, pinned: false, tags: [] };
	}
	const src = raw as Record<string, unknown>;
	return {
		...src,
		name: safeSessionName(src.name, key ?? 'unknown'),
		created: typeof src.created === 'number' ? src.created : null,
		modified: typeof src.modified === 'number' ? src.modified : null,
		pinned: !!src.pinned,
		tags: Array.isArray(src.tags) ? src.tags.filter((t): t is string => typeof t === 'string') : [],
		folder: folderName(src.folder),
		stats: sanitizeStats(src.stats),
		trashed: trashedAt(src.trashed),
		inactive: !!src.inactive,
	};
}

export class SessionStorage extends AbstractStorage {
	nextId: number | undefined;
	switchGeneration = 0;
	sessions: Record<string, SessionData> = {};
	selectedSession: number | undefined;
	nameStorage: AbstractStorage | undefined;
	history: SessionHistory;
	sessionEndpoint: string | undefined;
	proxyEndpoint: string | undefined;
	private onchange?: () => void;
	#idleSnapshotTimer: ReturnType<typeof setTimeout> | undefined;
	/** Settles once every session save started so far has finished. */
	#saving: Promise<void> = Promise.resolve();
	/**
	 * Sessions in the trash, kept out of `sessions` so nothing that lists, counts, opens or
	 * saves sessions has to skip them. Metadata only, like any session that is not open.
	 */
	trash: Record<string, SessionData> = {};
	#trashQueue: Promise<void> = Promise.resolve();

	constructor(dbAdapter: DatabaseAdapter) {
		super('Sessions', dbAdapter);
		this.nextId = undefined;
		this.sessions = {};
		this.selectedSession = undefined;
		this.nameStorage = new AbstractStorage('Names', dbAdapter);
		this.history = new SessionHistory(dbAdapter);

		if (dbAdapter.sessionEndpoint) {
			this.sessionEndpoint = dbAdapter.sessionEndpoint;
			this.proxyEndpoint = `${dbAdapter.sessionEndpoint}/proxy`;
		}
	}

	async init() {
		const db = await this.openDatabase();
		this.nextId = sanitizeNumber(await this.loadFromDatabase(db, 'nextSessionId'), 0);
		this.selectedSession = sanitizeNumber(await this.loadFromDatabase(db, 'selectedSessionId'), 0);
		await this.loadSessions(db);
		this.startSaveTimer(async (sessionId) => await this.saveSessionToDB(sessionId));
	}

	async saveToDatabase(db: DbConnection, key: string | number, data: unknown) {
        const record = data as Record<string, unknown> | undefined;
        if (record && Object.hasOwn(record, 'name')) {
            const nameData = extractMeta(record);
            await this.nameStorage!.saveToDatabase(db, key, nameData);
            const { name, created, modified, pinned, tags, folder, stats, trashed, ...sessionData } = record;
            await super.saveToDatabase(db, key, sessionData);
        } else {
            await super.saveToDatabase(db, key, data);
        }
	}

	async loadFromDatabase(db: DbConnection, key: string | number): Promise<unknown> {
		// Normalized like the writes below it: a session loaded under "3" misses the record at 3.
		const id = sessionKey(key);
		const raw = await super.loadFromDatabase(db, id);
		if (typeof raw !== 'object' || raw === null) return raw;
		const data = raw as Record<string, unknown>;
		if (!['selectedSessionId', 'nextSessionId'].includes(key as string)) {
			const nameData = await this.nameStorage!.loadFromDatabase(db, id);
			if (typeof nameData === 'string') {
				data['name'] = nameData === '[object Object]' ? `Session #${key}` : nameData;
				data['created'] = null;
				data['modified'] = null;
				data['pinned'] = false;
				data['tags'] = [];
				data['stats'] = sanitizeStats(undefined);
			} else if (nameData && typeof nameData === 'object') {
				const meta = nameData as Record<string, unknown>;
				data['name'] = safeSessionName(meta.name, key);
				data['created'] = typeof meta.created === 'number' ? meta.created : null;
				data['modified'] = typeof meta.modified === 'number' ? meta.modified : null;
				data['pinned'] = meta.pinned === undefined ? false : !!meta.pinned;
				data['tags'] = Array.isArray(meta.tags) ? meta.tags : [];
				data['folder'] = folderName(meta.folder);
				data['stats'] = sanitizeStats(meta.stats);
			}
		}
		return data;
	}

	async deleteFromDatabase(db: DbConnection, key: string | number) {
		// Versions first: if they can't be deleted, the session stays so its content isn't left behind unreachable.
		await this.history.deleteAll(key);
		await super.deleteFromDatabase(db, sessionKey(key));
		await this.nameStorage!.deleteFromDatabase(db, sessionKey(key));
	}

	/**
	 * Saves the selected session's content as a version. `overrides` replaces properties
	 * first, e.g. the prompt as it was before an edit. Errors are logged by the history
	 * store and never reach the caller.
	 */
	snapshot(reason: HistoryReason, overrides?: Partial<SessionData>): Promise<void> {
		const sessionId = this.selectedSession;
		const session = sessionId !== undefined ? this.sessions[sessionId] : undefined;
		if (sessionId === undefined || !session || session.inactive) return Promise.resolve();
		return this.history.snapshot(sessionId, { ...session, ...overrides }, reason).then(() => {}, () => {});
	}

	/** Takes the idle snapshot now if one is waiting, instead of when its timer runs out. */
	flushSnapshot(): Promise<void> {
		if (this.#idleSnapshotTimer === undefined) return Promise.resolve();
		clearTimeout(this.#idleSnapshotTimer);
		this.#idleSnapshotTimer = undefined;
		return this.snapshot('idle');
	}

	/** Creates a new session from the current one with a saved version's content, and returns its id. */
	async restoreSnapshot(time: number, name: string): Promise<number | undefined> {
		const sessionId = this.selectedSession;
		if (sessionId === undefined || !this.sessions[sessionId]) return undefined;
		const content = await this.history.load(sessionId, time);
		if (!content) return undefined;
		const restored: Record<string, unknown> = { ...this.sessions[sessionId], name };
		for (const key of HISTORY_CONTENT_KEYS) {
			const value = content[key as keyof SessionSnapshot];
			if (value === undefined) delete restored[key];
			else restored[key] = value;
		}
		const serialized = Object.fromEntries(Object.entries(restored).map(([k, v]) => [k, JSON.stringify(v)]));
		return await this.createSessionFromObject(serialized, false);
	}

	/**
	 * Replaces the selected session's content with a saved version. The current content is
	 * versioned first and, if that fails, nothing is replaced (the error is thrown), so the
	 * overwrite can always be undone from history. Returns false if there's nothing to restore.
	 */
	async overwriteWithSnapshot(time: number): Promise<boolean> {
		const sessionId = this.selectedSession;
		if (sessionId === undefined || !this.sessions[sessionId]) return false;
		const content = await this.history.load(sessionId, time);
		if (!content) return false;
		clearTimeout(this.#idleSnapshotTimer);
		this.#idleSnapshotTimer = undefined;
		await this.history.snapshot(sessionId, { ...this.sessions[sessionId] }, 'restore');

		const session = this.sessions[sessionId];
		if (this.selectedSession !== sessionId || !session || session.inactive) return false;
		for (const key of HISTORY_CONTENT_KEYS) {
			const value = content[key as keyof SessionSnapshot];
			if (value === undefined) delete session[key];
			else session[key] = value;
		}
		session.modified = Date.now();
		this.enqueueSave(sessionId);
		// Same reload path as a session switch: every useSessionState re-reads its value.
		this.dispatchEvent(new CustomEvent('sessionchange'));
		return true;
	}

	saveSessionToDB(sessionId: string | number): Promise<void> {
		const save = this.#saveSessionToDB(sessionId);
		this.#saving = Promise.allSettled([this.#saving, save]).then(() => {});
		return save;
	}

	async #saveSessionToDB(sessionId: string | number) {
		const session = this.sessions[sessionId];
		if (!session) return;
		// Only the selected session has its content in memory; the others hold just their
		// metadata, and saving their whole record would overwrite the stored content with nothing.
		// `!=` because the sessions modal passes string keys.
		const metaOnly = sessionId != this.selectedSession || session.inactive;
		const data = metaOnly ? extractMeta(session) : { ...session };
		const db = await this.openDatabase();
		const key = sessionKey(sessionId);
		if (metaOnly) await this.nameStorage!.saveToDatabase(db, key, data);
		else await this.saveToDatabase(db, key, data);
	}

	async getNewId() {
		const db = await this.openDatabase();
		await this.saveToDatabase(db, 'nextSessionId', (this.nextId ?? 0) + 1);
		this.nextId = (this.nextId ?? 0) + 1;
		return (this.nextId ?? 0) - 1;
	}

	// We leave the localStorage content untouched for now,
	// but we might want to erase it in the future.
	async migrateSessions() {
		const nextId = +(localStorage.getItem('nextSessionId') ?? 0);
		if (!(nextId > 0))
			return false;
		this.nextId = nextId;
		this.selectedSession = sanitizeNumber(+(localStorage.getItem('selectedSessionId') ?? 0), 0);
		for (const key of Object.keys(localStorage)) {
			const [sessionId, propertyName] = key.split('/');
			if (propertyName === undefined) continue;
			const rawValue = localStorage.getItem(key);
			if (rawValue === null) continue;
			let value: unknown;
			try {
				value = JSON.parse(rawValue);
			} catch {
				continue;
			}
			if (value !== null) {
				this.sessions[sessionId] = this.sessions[sessionId] || {};
				this.sessions[sessionId][propertyName] = value;
			}
		};
		for (const sessionId of Object.keys(this.sessions)) {
			this.sessions[sessionId] = sanitizeSessionData(this.sessions[sessionId], sessionId);
		}
		const db = await this.openDatabase();
		await this.saveToDatabase(db, 'nextSessionId', this.nextId);
		await this.saveToDatabase(db, 'selectedSessionId', this.selectedSession);
		for (const sessionId of Object.keys(this.sessions)) {
			await this.saveToDatabase(db, +sessionId, this.sessions[sessionId]);
		}
		return true;
	}

	async loadSessions(db: DbConnection) {
		const sessions = await this.loadSessionInfoFromDatabase(db);
		for (const [key, data] of Object.entries(sessions)) {
			const session = sanitizeSessionData(data, key);
			if (session.trashed) this.trash[key] = session;
			else this.sessions[key] = session;
		}
		if (Object.keys(this.sessions).length === 0) {
			// Sessions from before IndexedDB only move into an empty database.
			if (Object.keys(this.trash).length || !await this.migrateSessions()) {
				await this.createSession('MiyaPad #1');
			}
		}
		if (this.selectedSession !== undefined) {
			await this.switchSession(this.selectedSession);
		}
	}

	getProperty(propertyName: string) {
		return this.selectedSession !== undefined ? this.sessions[this.selectedSession]?.[propertyName] : undefined;
	}

	setProperty(propertyName: string, value: unknown) {
		if (this.selectedSession === undefined) return;
		const session = this.sessions[this.selectedSession];
		if (!session)
			return;
		// Re-applying a value the session already has (e.g. its saved connection or
		// sampler preset on open) is not an edit, so it doesn't bump modified. Still
		// saved either way, in case a caller mutated the stored value in place.
		if (!sameValue(session[propertyName], value)) {
			session.modified = Date.now();
			if (HISTORY_CONTENT_KEYS.includes(propertyName)) {
				clearTimeout(this.#idleSnapshotTimer);
				this.#idleSnapshotTimer = setTimeout(() => this.flushSnapshot(), HISTORY_IDLE_MS);
			}
		}
		session[propertyName] = value;
		this.enqueueSave(this.selectedSession);
	}

	/**
	 * Adds to the selected session's lifetime counters. Deliberately not `setProperty`:
	 * counting a keystroke or a generation is not itself an edit, so it neither bumps
	 * `modified` nor arms the version timer — whatever it counted already did both.
	 */
	addStats(delta: Partial<SessionStats>) {
		if (this.selectedSession === undefined) return;
		const session = this.sessions[this.selectedSession];
		if (!session) return;
		if (!Object.values(delta).some(v => typeof v === 'number' && v > 0)) return;
		const stats = sanitizeStats(session.stats);
		for (const key of Object.keys(stats) as (keyof SessionStats)[]) {
			const value = delta[key];
			if (typeof value === 'number' && Number.isFinite(value) && value > 0) stats[key] += value;
		}
		session.stats = stats;
		this.enqueueSave(this.selectedSession);
	}

	/**
	 * Clears the counters of one session, or of every session when no id is given. Each
	 * record is written directly because `enqueueSave` remembers a single key, so a bulk
	 * reset queued through it would only ever save the last session.
	 */
	async resetStats(sessionId?: string | number): Promise<void> {
		const ids = sessionId === undefined ? Object.keys(this.sessions) : [sessionId];
		for (const id of ids) {
			const session = this.sessions[id];
			if (!session) continue;
			session.stats = sanitizeStats(undefined);
			await this.saveSessionToDB(id);
		}
		this.dispatchChangeEvent();
	}

	async switchSession(sessionId: string | number) {
		if (!this.sessions[sessionId])
			return;

		const gen = ++this.switchGeneration;
		const targetId = +sessionId;

		// Capture the outgoing session's pending version while its content is still in memory.
		this.flushSnapshot();

		try {
			await this.saveTimerHandler(async (sessionId: string | number) => await this.saveSessionToDB(sessionId));
		} catch {
			return;
		}
		if (this.switchGeneration !== gen) return;

		const currSel = this.selectedSession;
		if (currSel !== undefined && this.sessions[currSel] && this.sessions[currSel]['name'])
			this.sessions[currSel] = { ...extractMeta(this.sessions[currSel]), inactive: true };

		const db = await this.openDatabase();
		if (this.switchGeneration !== gen) return;

		await this.saveToDatabase(db, 'selectedSessionId', targetId);

		this.selectedSession = targetId;
		this.sessions[targetId] = sanitizeSessionData(await this.loadFromDatabase(db, targetId), targetId);

		if (this.switchGeneration !== gen) return;

		await this.saveToDatabase(db, targetId, this.sessions[targetId]);

		// Versioning the session as it's opened covers edits the idle timer never got to
		// (the tab closed first), so they're kept before anything new overwrites them.
		this.snapshot('open');

		this.dispatchChangeEvent();
		this.dispatchEvent(new CustomEvent('sessionchange'));
	}

	async renameSession(sessionId: string | number, renameSessionName: string) {
		this.sessions[sessionId]['name'] = renameSessionName;
		this.sessions[sessionId].modified = Date.now();

		const db = await this.openDatabase();
		await this.renameSessionInDatabase(db, sessionKey(sessionId), renameSessionName);

		this.dispatchChangeEvent();
	}

	togglePinSession(sessionId: string | number): Promise<void> {
		return this.setPinned([sessionId], !this.sessions[sessionId]?.pinned);
	}

	/** Pins or unpins sessions. Each record is written directly for the same reason as in `resetStats`. */
	async setPinned(sessionIds: (string | number)[], pinned: boolean): Promise<void> {
		const ids = sessionIds.filter(id => this.sessions[id] && !!this.sessions[id].pinned !== pinned);
		if (!ids.length) return;
		for (const id of ids) this.sessions[id].pinned = pinned;
		this.dispatchChangeEvent();
		for (const id of ids) await this.saveSessionToDB(id);
	}

	setTags(sessionId: string | number, rawInput: string) {
		if (!this.sessions[sessionId]) return;
		const rawTags = rawInput.split(',').map((t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean);
		this.sessions[sessionId].tags = [...new Set(rawTags)] as string[];
		this.sessions[sessionId].modified = Date.now();
		this.enqueueSave(sessionId);
		this.dispatchChangeEvent();
	}

	/**
	 * Moves sessions into a folder, or out of their folder when the name is blank. A folder
	 * is only a name its sessions share, so it disappears with its last session. Like a pin,
	 * this is not an edit and leaves `modified` alone. Each record is written directly for
	 * the same reason as in `resetStats`.
	 */
	async setFolder(sessionIds: (string | number)[], folder: string | undefined): Promise<void> {
		const name = folderName(folder);
		const ids = sessionIds.filter(id => this.sessions[id] && this.sessions[id].folder !== name);
		if (!ids.length) return;
		for (const id of ids) this.sessions[id].folder = name;
		this.dispatchChangeEvent();
		for (const id of ids) await this.saveSessionToDB(id);
	}

	/** Runs trash, restore and purge one at a time, so none of them sees another half done. */
	#queueTrash(run: () => Promise<void>): Promise<void> {
		const next = this.#trashQueue.then(run);
		this.#trashQueue = next.catch(() => {});
		return next;
	}

	/**
	 * Moves sessions to the trash, content and versions included, until `purgeSessions`.
	 * The last session is never trashed, since there would be nothing left to open:
	 * `#trashSession` checks again before each, so a batch of every session leaves one behind.
	 */
	trashSessions(sessionIds: (string | number)[]): Promise<void> {
		return this.#queueTrash(async () => {
			for (const id of sessionIds) await this.#trashSession(id);
		});
	}

	async #trashSession(sessionId: string | number) {
		if (Object.keys(this.sessions).length === 1 || !this.sessions[sessionId])
			return;
		// `==` because the modal passes string keys.
		if (sessionId == this.selectedSession) {
			const ids = Object.keys(this.sessions);
			const idx = ids.indexOf(String(sessionId));
			await this.switchSession(ids[idx - 1] ?? ids[idx + 1]);
			// The switch gives up when the open session's last edits can't be saved.
			if (sessionId == this.selectedSession) return;
		}
		const session = { ...this.sessions[sessionId], trashed: Date.now() };
		// Out of `sessions` before anything is awaited, so no save started from here on writes it back untrashed.
		delete this.sessions[sessionId];
		this.trash[sessionId] = session;
		this.dispatchChangeEvent();
		try {
			// A save already running would land after this one and untrash it.
			await this.#saving;
			const db = await this.openDatabase();
			await this.nameStorage!.saveToDatabase(db, sessionKey(sessionId), extractMeta(session));
		} catch (e) {
			delete this.trash[sessionId];
			this.sessions[sessionId] = { ...session, trashed: undefined };
			this.dispatchChangeEvent();
			throw e;
		}
	}

	/** Takes sessions out of the trash with their folder, tags and pin as they were. */
	restoreSessions(sessionIds: (string | number)[]): Promise<void> {
		return this.#queueTrash(async () => {
			const ids = sessionIds.filter(id => this.trash[id]);
			if (!ids.length) return;
			for (const id of ids) {
				this.sessions[id] = { ...this.trash[id], trashed: undefined };
				delete this.trash[id];
			}
			this.dispatchChangeEvent();
			// Each written directly, for the same reason as in `resetStats`.
			for (const id of ids) await this.saveSessionToDB(id);
		});
	}

	/** Deletes trashed sessions for good, versions first; confirming is the caller's job. */
	purgeSessions(sessionIds: (string | number)[]): Promise<void> {
		return this.#queueTrash(async () => {
			for (const id of sessionIds) {
				if (!this.trash[id]) continue;
				const db = await this.openDatabase();
				await this.deleteFromDatabase(db, id);
				delete this.trash[id];
				this.dispatchChangeEvent();
			}
		});
	}

	async createSession(newSessionName: string) {
		const newId = await this.getNewId();
		const now = Date.now();
		this.sessions[newId] = { name: newSessionName, created: now, modified: now, pinned: false, tags: [] };
		
		const db = await this.openDatabase();
		await this.saveToDatabase(db, newId, this.sessions[newId]);

		this.onchange?.();
		return newId;
	}

	async createSessionFromObject(obj: Record<string, string>, cloned: boolean) {
		const newId = await this.getNewId();
		const raw: Record<string, unknown> = {};

		for (const [propertyName, value] of Object.entries(obj)) {
			// A new session counts its own activity. Carrying the counters over from the one it
			// was cloned, restored or imported from would count that activity twice in the
			// all-sessions totals, and the source session is usually still there.
			if (propertyName === 'darkMode' || propertyName === 'stats') continue;
			try {
				raw[propertyName] = JSON.parse(value as string);
			} catch {
				raw[propertyName] = value;
			}
		}

		if (!Object.hasOwn(raw, 'name')) {
			raw['name'] = `MiyaPad #${newId + 1}`;
		}

		if (cloned && typeof raw.name === 'string' && !raw.name.startsWith('Cloned')) {
			raw['name'] = `Cloned ${raw['name']}`;
		}

		const now = Date.now();
		raw.created = now;
		raw.modified = now;

		this.sessions[newId] = sanitizeSessionData(raw, newId);

		const db = await this.openDatabase();
		await this.saveToDatabase(db, newId, this.sessions[newId]);

		//Clear data of the session in order to minimize memory usage.
		if (this.sessions[newId] && this.sessions[newId]['name'])
			this.sessions[newId] = { ...extractMeta(this.sessions[newId]) };

		this.onchange?.();
		return newId;
}
}
