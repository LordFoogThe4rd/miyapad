import { AbstractStorage } from './AbstractStorage.js';
import { NameStorage } from './NameStorage.js';

export class SessionStorage extends AbstractStorage {
	constructor(dbAdapter) {
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
		this.nextId = (await this.loadFromDatabase(db, 'nextSessionId')) || 0;
		this.selectedSession = (await this.loadFromDatabase(db, 'selectedSessionId')) || 0;
		await this.loadSessions(db);
		this.startSaveTimer(async (sessionId) => await this.saveSessionToDB(sessionId));
	}

	async saveToDatabase(db, key, data) {
        if (data.hasOwnProperty('name')) {
            const nameData = { name: data.name, created: data.created || null, modified: data.modified || null };
            await this.nameStorage.saveToDatabase(db, key, nameData);
            const { name, created, modified, ...sessionData } = data;
            await super.saveToDatabase(db, key, sessionData);
        } else {
            await super.saveToDatabase(db, key, data);
        }
	}

	async loadFromDatabase(db, key) {
		const data = await super.loadFromDatabase(db, key);
		if(data && !['selectedSessionId', 'nextSessionId'].includes(key)){
			const nameData = await this.nameStorage.loadFromDatabase(db, key);
			if (typeof nameData === 'string') {
				data['name'] = nameData === '[object Object]' ? `Session #${key}` : nameData;
				data['created'] = null;
				data['modified'] = null;
			} else if (nameData && typeof nameData === 'object') {
				data['name'] = (nameData.name === '[object Object]' ? `Session #${key}` : nameData.name) || 'Untitled';
				data['created'] = nameData.created || null;
				data['modified'] = nameData.modified || null;
			}
		}
		return data;
	}

	async deleteFromDatabase(db, key) {
		await super.deleteFromDatabase(db, key);
		await this.nameStorage.deleteFromDatabase(db, key);
	}

	async saveSessionToDB(sessionId) {
		const { name, created, modified, ...sessionData } = this.sessions[sessionId];
		if (!sessionData || sessionData.inactive)
			return;
		const db = await this.openDatabase();
		await this.saveToDatabase(db, sessionId, { name, created, modified, ...sessionData });
	}

	async getNewId() {
		const db = await this.openDatabase();
		await this.saveToDatabase(db, 'nextSessionId', this.nextId + 1);
		this.nextId += 1;
		return this.nextId - 1;
	}

	// We leave the localStorage content untouched for now,
	// but we might want to erase it in the future.
	async migrateSessions() {
		const nextId = +localStorage.getItem('nextSessionId');
		if (nextId == 0)
			return false;
		this.nextId = nextId;
		this.selectedSession = +localStorage.getItem('selectedSessionId');
		for (const key of Object.keys(localStorage)) {
			const [sessionId, propertyName] = key.split('/');
			if (propertyName === undefined) continue;
			let value = localStorage.getItem(key);
			try {
				value = JSON.parse(value);
			} catch {
				// This might have been added to the localStorage by a extension rather than us. Let's just skip it.
				continue;
			}
			if (value !== null) {
				this.sessions[sessionId] = this.sessions[sessionId] || {};
				this.sessions[sessionId][propertyName] = value;
			}
		};
		const db = await this.openDatabase();
		await this.saveToDatabase(db, 'nextSessionId', this.nextId);
		await this.saveToDatabase(db, 'selectedSessionId', this.selectedSession);
		for (const sessionId of Object.keys(this.sessions)) {
			await this.saveToDatabase(db, +sessionId, this.sessions[sessionId]);
		}
		return true;
	}

	async loadSessions(db) {
		const sessions = await this.loadSessionInfoFromDatabase(db);
		for (const [key, data] of Object.entries(sessions)) {
			// Handle both legacy string names and new metadata objects
			if (typeof data === 'string') {
				this.sessions[key] = { name: data === '[object Object]' ? `Session #${key}` : data, created: null, modified: null };
			} else if (data && typeof data === 'object') {
				this.sessions[key] = { name: (data.name === '[object Object]' ? `Session #${key}` : data.name) || 'Untitled', created: data.created || null, modified: data.modified || null };
			} else {
				this.sessions[key] = { name: 'Untitled', created: null, modified: null };
			}
		}
		if (Object.keys(this.sessions).length === 0) {
			if (!await this.migrateSessions()) {
				await this.createSession('MiyaPad #1');
			}
		}
		await this.switchSession(this.selectedSession);
	}

	getProperty(propertyName) {
		return this.sessions[this.selectedSession]?.[propertyName];
	}

	setProperty(propertyName, value) {
		if (!this.sessions[this.selectedSession])
			return;
		this.sessions[this.selectedSession][propertyName] = value;
		this.sessions[this.selectedSession].modified = Date.now();
		this.enqueueSave(this.selectedSession);
	}

	async switchSession(sessionId) {
		if (!this.sessions[sessionId])
			return;

		// Flush pending save.
		await this.saveTimerHandler(async (sessionId) => await this.saveSessionToDB(sessionId));

		//Clear data of old session in order to minimize memory usage.
		if (this.sessions[this.selectedSession] && this.sessions[this.selectedSession]['name'])
			this.sessions[this.selectedSession] = { name: this.sessions[this.selectedSession]['name'], created: this.sessions[this.selectedSession].created, modified: this.sessions[this.selectedSession].modified, inactive: true };

		const db = await this.openDatabase();
		await this.saveToDatabase(db, 'selectedSessionId', +sessionId);

		this.selectedSession = +sessionId;
		this.sessions[this.selectedSession] = (await this.loadFromDatabase(db, this.selectedSession));

		this.dispatchChangeEvent();
		this.dispatchSessionChangeEvent();
	}

	async renameSession(sessionId, renameSessionName) {
		this.sessions[sessionId]['name'] = renameSessionName;
		this.sessions[sessionId].modified = Date.now();

		const db = await this.openDatabase();
		await this.renameSessionInDatabase(db, sessionId, renameSessionName);

		this.dispatchChangeEvent();
	}

	async deleteSession(sessionId) {
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

	async createSession(newSessionName) {
		const newId = await this.getNewId();
		const now = Date.now();
		this.sessions[newId] = { name: newSessionName, created: now, modified: now };
		
		const db = await this.openDatabase();
		await this.saveToDatabase(db, newId, this.sessions[newId]);

		onchange?.();
		return newId;
	}

	async createSessionFromObject(obj, cloned) {
		const newId = await this.getNewId();
		this.sessions[newId] = {};

		for (const [propertyName, value] of Object.entries(obj)) {
			if (propertyName === 'darkMode') continue;
			this.sessions[newId][propertyName] = JSON.parse(value);
		}

		if (!this.sessions[newId].hasOwnProperty('name')) {
			this.sessions[newId]['name'] = `MiyaPad #${this.nextId + 1}`;
		}

		if (cloned && !this.sessions[newId]['name'].startsWith('Cloned')) {
			this.sessions[newId]['name'] = `Cloned ${this.sessions[newId]['name']}`;
		}

		const now = Date.now();
		this.sessions[newId].created = now;
		this.sessions[newId].modified = now;

		const db = await this.openDatabase();
		await this.saveToDatabase(db, newId, this.sessions[newId]);

		//Clear data of the session in order to minimize memory usage.
		if (this.sessions[newId] && this.sessions[newId]['name'])
			this.sessions[newId] = { name: this.sessions[newId]['name'], created: now, modified: now };

		onchange?.();
		return newId;
	}
}
