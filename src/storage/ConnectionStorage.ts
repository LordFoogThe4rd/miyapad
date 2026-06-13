import { AbstractStorage } from './AbstractStorage';

export class ConnectionStorage extends AbstractStorage {
	connections: Record<string, ConnectionData> = {};

	constructor(dbAdapter: DatabaseAdapter) {
		super('Connections', dbAdapter);
	}

	async init() {
		const db = await this.openDatabase();
		await this.loadConnections(db);
	}

	async performFullSave(newConnections: Record<string, ConnectionData>) {
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

	getStorageData(): Record<string, ConnectionData> {
		return this.connections;
	}

	async loadConnections(db: DbConnection) {
		this.connections = await this.loadAllFromDatabase(db);
	}
}
