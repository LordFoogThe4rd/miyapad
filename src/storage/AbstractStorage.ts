export class AbstractStorage extends EventTarget {
	storeName: string;
	dbAdapter: any;
	pendingSaveKey: any;
	saveTimer: any;

	constructor(storeName: string, dbAdapter: any) {
		super();
		this.storeName = storeName;
		this.dbAdapter = dbAdapter;
		this.pendingSaveKey = null;
		this.saveTimer = undefined;
	}

	dispatchChangeEvent() {
		this.dispatchEvent(new CustomEvent('change'));
	}

	dispatchErrorEvent(detail: any) {
		console.error('[AbstractStorage Error]', this.storeName, detail);
		fetch('/log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				storeName: this.storeName,
				error: detail?.message || detail?.toString() || String(detail),
				stack: detail?.stack || null
			})
		}).catch(() => {});
		this.dispatchEvent(new CustomEvent('error', { detail }));
	}

	startSaveTimer(saveCallback: (key: any) => Promise<void>) {
		this.saveTimer = setInterval(async () => await this.saveTimerHandler(saveCallback), 500);
	}

	async saveTimerHandler(saveCallback: (key: any) => Promise<void>) {
		const key = this.pendingSaveKey;
		this.pendingSaveKey = null;

		if (key !== null) {
			await saveCallback(key);
		}
	}

	enqueueSave(key: any) {
		this.pendingSaveKey = key;
	}

	async performFullSave(data: any) {
		throw new Error("Not Implemented");
	}

	getStorageData(): any {
		throw new Error("Not Implemented");
	}

	async openDatabase(): Promise<any> {
		try {
			return await this.dbAdapter.openDatabase();
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async loadFromDatabase(db: any, key: any): Promise<any> {
		try {
			return await this.dbAdapter.loadFromDatabase(db, this.storeName, key);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async loadAllFromDatabase(db: any): Promise<any> {
		try {
			return await this.dbAdapter.loadAllFromDatabase(db, this.storeName);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async loadSessionInfoFromDatabase(db: any): Promise<any> {
		try {
			return await this.dbAdapter.loadSessionInfoFromDatabase(db, this.storeName);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async saveToDatabase(db: any, key: any, data: any): Promise<void> {
		try {
			return await this.dbAdapter.saveToDatabase(db, this.storeName, key, data);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async renameSessionInDatabase(db: any, key: any, newName: any): Promise<void> {
		try {
			return await this.dbAdapter.renameSessionInDatabase(db, this.storeName, key, newName);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async deleteFromDatabase(db: any, key: any): Promise<void> {
		try {
			return await this.dbAdapter.deleteFromDatabase(db, this.storeName, key);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}
}
