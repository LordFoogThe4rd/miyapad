import { AbstractStorage } from './AbstractStorage';

export class ConnectionStorage extends AbstractStorage {
	connections: Record<string, ConnectionData> = {};

	constructor(dbAdapter: any) {
		super('Connections', dbAdapter);
	}

	async init() {
		const db = await this.openDatabase();
		await this.loadConnections(db);
	}

	async performFullSave(newConnections: any) {
		try {
			const db = await this.openDatabase();

			for (const key of Object.keys(this.connections)) {
				if (!Object.hasOwn(newConnections, key)) {
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
		} catch (error) {
			this.dispatchErrorEvent(error);
		}
	}

	getStorageData() {
		return this.connections;
	}

	async loadConnections(db: any) {
		this.connections = await this.loadAllFromDatabase(db);
	}
}
