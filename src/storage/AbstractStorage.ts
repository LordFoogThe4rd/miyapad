export class AbstractStorage extends EventTarget {
	storeName: string;
	dbAdapter: DatabaseAdapter;
	pendingSaveKey: string | number | null;
	saveTimer: ReturnType<typeof setInterval> | undefined;

	constructor(storeName: string, dbAdapter: DatabaseAdapter) {
		super();
		this.storeName = storeName;
		this.dbAdapter = dbAdapter;
		this.pendingSaveKey = null;
		this.saveTimer = undefined;
	}

	dispatchChangeEvent() {
		this.dispatchEvent(new CustomEvent('change'));
	}

	dispatchErrorEvent(detail: unknown) {
		console.error('[AbstractStorage Error]', this.storeName, detail);
		fetch('/log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				storeName: this.storeName,
				error: (detail as Error)?.message || String(detail),
				stack: (detail as Error)?.stack || null
			})
		}).catch(() => {});
		this.dispatchEvent(new CustomEvent('error', { detail }));
	}

	startSaveTimer(saveCallback: (key: string | number) => Promise<void>) {
		this.saveTimer = setInterval(async () => {
			try {
				await this.saveTimerHandler(saveCallback);
			} catch {
				// Timer retries on next tick; error already dispatched by saveTimerHandler
			}
		}, 500);
	}

	async saveTimerHandler(saveCallback: (key: string | number) => Promise<void>) {
		const key = this.pendingSaveKey;
		if (key !== null) {
			this.pendingSaveKey = null;
			try {
				await saveCallback(key);
			} catch (e) {
				this.dispatchErrorEvent(e);
				if (this.pendingSaveKey === null) {
					this.pendingSaveKey = key;
				}
				throw e;
			}
		}
	}

	enqueueSave(key: string | number) {
		this.pendingSaveKey = key;
	}

	async performFullSave(data: unknown) {
		throw new Error("Not Implemented");
	}

	getStorageData(): unknown {
		throw new Error("Not Implemented");
	}

	async openDatabase(): Promise<DbConnection> {
		try {
			return await this.dbAdapter.openDatabase();
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async loadFromDatabase(db: DbConnection, key: string | number): Promise<unknown> {
		try {
			return await this.dbAdapter.loadFromDatabase(db, this.storeName, key);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async loadAllFromDatabase(db: DbConnection): Promise<Record<string, unknown>> {
		try {
			return await this.dbAdapter.loadAllFromDatabase(db, this.storeName);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async loadSessionInfoFromDatabase(db: DbConnection): Promise<Record<string, unknown>> {
		try {
			return await this.dbAdapter.loadSessionInfoFromDatabase(db, this.storeName);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async saveToDatabase(db: DbConnection, key: string | number, data: unknown): Promise<void> {
		try {
			return await this.dbAdapter.saveToDatabase(db, this.storeName, key, data);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async renameSessionInDatabase(db: DbConnection, key: string | number, newName: string): Promise<void> {
		try {
			return await this.dbAdapter.renameSessionInDatabase(db, this.storeName, key, newName);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async deleteFromDatabase(db: DbConnection, key: string | number): Promise<void> {
		try {
			return await this.dbAdapter.deleteFromDatabase(db, this.storeName, key);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}
}
