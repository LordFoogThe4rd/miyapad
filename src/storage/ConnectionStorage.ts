import { AbstractStorage } from './AbstractStorage';
import { isConnectionData } from './validators';

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
			throw error;
		}
	}

	getStorageData(): Record<string, ConnectionData> {
		return this.connections;
	}

	async loadConnections(db: DbConnection) {
		const raw = await this.loadAllFromDatabase(db);
		this.connections = {};
		for (const [key, value] of Object.entries(raw)) {
			if (isConnectionData(value)) {
				this.connections[key] = value;
			} else {
				console.warn(`[ConnectionStorage] Skipped invalid entry: ${key}`);
			}
		}
	}
}
