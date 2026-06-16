import { AbstractStorage } from './AbstractStorage';
import { NameStorage } from './NameStorage';

function extractMeta(s: Record<string, unknown>) {
	return {
		name: typeof s.name === 'string' ? s.name : undefined,
		created: typeof s.created === 'number' ? s.created : null,
		modified: typeof s.modified === 'number' ? s.modified : null,
		pinned: !!s.pinned,
		tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string') : [],
	};
}

function safeSessionName(name: unknown, key: string | number, fallback = 'Untitled'): string {
	return typeof name === 'string'
		? (name === '[object Object]' ? `Session #${key}` : name)
		: fallback;
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
		inactive: !!src.inactive,
	};
}

export class SessionStorage extends AbstractStorage {
	nextId: number | undefined;
	sessions: Record<string, SessionData> = {};
	selectedSession: number | undefined;
	nameStorage: NameStorage | undefined;
	sessionEndpoint: string | undefined;
	proxyEndpoint: string | undefined;
	private onchange?: () => void;

	constructor(dbAdapter: DatabaseAdapter) {
		super('Sessions', dbAdapter);
		this.nextId = undefined;
		this.sessions = {};
		this.selectedSession = undefined;
		this.nameStorage = new NameStorage(dbAdapter);

		if (dbAdapter.sessionEndpoint) {
			this.sessionEndpoint = dbAdapter.sessionEndpoint;
			this.proxyEndpoint = `${dbAdapter.sessionEndpoint}/proxy`;
		}
	}

	dispatchSessionChangeEvent() {
		this.dispatchEvent(new CustomEvent('sessionchange'));
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
            const { name, created, modified, pinned, tags, ...sessionData } = record;
            await super.saveToDatabase(db, key, sessionData);
        } else {
            await super.saveToDatabase(db, key, data);
        }
	}

	async loadFromDatabase(db: DbConnection, key: string | number): Promise<unknown> {
		const data = (await super.loadFromDatabase(db, key)) as Record<string, unknown> | null;
		if(data && !['selectedSessionId', 'nextSessionId'].includes(key as string)){
			const nameData = await this.nameStorage!.loadFromDatabase(db, key);
			if (typeof nameData === 'string') {
				data['name'] = nameData === '[object Object]' ? `Session #${key}` : nameData;
				data['created'] = null;
				data['modified'] = null;
				data['pinned'] = false;
				data['tags'] = [];
			} else if (nameData && typeof nameData === 'object') {
				const meta = nameData as Record<string, unknown>;
				data['name'] = safeSessionName(meta.name, key);
				data['created'] = typeof meta.created === 'number' ? meta.created : null;
				data['modified'] = typeof meta.modified === 'number' ? meta.modified : null;
				data['pinned'] = meta.pinned === undefined ? false : !!meta.pinned;
				data['tags'] = Array.isArray(meta.tags) ? meta.tags : [];
			}
		}
		return data;
	}

	async deleteFromDatabase(db: DbConnection, key: string | number) {
		await super.deleteFromDatabase(db, key);
		await this.nameStorage!.deleteFromDatabase(db, key);
	}

	async saveSessionToDB(sessionId: string | number) {
		const session = this.sessions[sessionId];
		if (!session) return;
		const { name, created, modified, pinned, tags, ...sessionData } = session;
		if (!sessionData || sessionData.inactive)
			return;
		const db = await this.openDatabase();
		await this.saveToDatabase(db, sessionId, { name, created, modified, pinned, tags, ...sessionData });
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
			this.sessions[key] = sanitizeSessionData(data, key);
		}
		if (Object.keys(this.sessions).length === 0) {
			if (!await this.migrateSessions()) {
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
		if (!this.sessions[this.selectedSession])
			return;
		this.sessions[this.selectedSession][propertyName] = value;
		this.sessions[this.selectedSession].modified = Date.now();
		this.enqueueSave(this.selectedSession);
	}

	async switchSession(sessionId: string | number) {
		if (!this.sessions[sessionId])
			return;

		// Flush pending save.
		try {
			await this.saveTimerHandler(async (sessionId: string | number) => await this.saveSessionToDB(sessionId));
		} catch {
			return;
		}

		//Clear data of old session in order to minimize memory usage.
		const currSel = this.selectedSession;
		if (currSel !== undefined && this.sessions[currSel] && this.sessions[currSel]['name'])
			this.sessions[currSel] = { ...extractMeta(this.sessions[currSel]), inactive: true };

		const db = await this.openDatabase();
		await this.saveToDatabase(db, 'selectedSessionId', +sessionId);

		this.selectedSession = +sessionId;
		this.sessions[this.selectedSession] = sanitizeSessionData(await this.loadFromDatabase(db, this.selectedSession), this.selectedSession);

		await this.saveToDatabase(db, this.selectedSession, this.sessions[this.selectedSession]);

		this.dispatchChangeEvent();
		this.dispatchSessionChangeEvent();
	}

	async renameSession(sessionId: string | number, renameSessionName: string) {
		this.sessions[sessionId]['name'] = renameSessionName;
		this.sessions[sessionId].modified = Date.now();

		const db = await this.openDatabase();
		await this.renameSessionInDatabase(db, sessionId, renameSessionName);

		this.dispatchChangeEvent();
	}

	async togglePinSession(sessionId: string | number) {
		if (!this.sessions[sessionId])
			return;
		this.sessions[sessionId].pinned = !this.sessions[sessionId].pinned;
		this.enqueueSave(sessionId);
		this.dispatchChangeEvent();
	}

	setTags(sessionId: string | number, rawInput: string) {
		if (!this.sessions[sessionId]) return;
		const rawTags = rawInput.split(',').map((t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean);
		this.sessions[sessionId].tags = [...new Set(rawTags)] as string[];
		this.sessions[sessionId].modified = Date.now();
		this.enqueueSave(sessionId);
		this.dispatchChangeEvent();
	}

	async deleteSession(sessionId: string | number) {
		if (Object.keys(this.sessions).length === 1)
			return;
		if (!window.confirm("Are you sure you want to delete this session? This action can't be undone."))
			return;

		const db = await this.openDatabase();
		await this.deleteFromDatabase(db, sessionId);

		// Select another session if the current was deleted
		if (sessionId == this.selectedSession) {
			const sessionIds = Object.keys(this.sessions).map(x => +x);
			const sessionIdx = sessionIds.indexOf(sessionId);
			const newSessionId = sessionIds[sessionIdx - 1] ?? sessionIds[sessionIdx + 1];
			await this.switchSession(+newSessionId)
		}

		delete this.sessions[sessionId];
		this.dispatchChangeEvent();
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
			if (propertyName === 'darkMode') continue;
			raw[propertyName] = JSON.parse(value as string);
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
