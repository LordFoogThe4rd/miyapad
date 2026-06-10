import { AbstractStorage } from './AbstractStorage.js';

export class ConnectionStorage extends AbstractStorage {
	constructor(dbAdapter) {
		super('Connections', dbAdapter);
		this.connections = {};
	}

	async init() {
		const db = await this.openDatabase();
		await this.loadConnections(db);
	}

	async performFullSave(newConnections) {
		const db = await this.openDatabase();

		for (const key of Object.keys(this.connections)) {
			if (!newConnections.hasOwnProperty(key)) {
				await this.deleteFromDatabase(db, key);
			}
		}

		for (const [key, value] of Object.entries(newConnections)) {
			if (JSON.stringify(value) !== JSON.stringify(this.connections[key])) {
				await this.saveToDatabase(db, key, value);
			}
		}

		this.connections = newConnections;
		this.dispatchChangeEvent();
	}

	getStorageData() {
		return this.connections;
	}

	async loadConnections(db) {
		this.connections = await this.loadAllFromDatabase(db);
	}
}
