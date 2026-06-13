export class AbstractStorage extends EventTarget {
	constructor(storeName, dbAdapter) {
		super();
		this.storeName = storeName;
		this.dbAdapter = dbAdapter;
		this.pendingSaveKey = null;
		this.saveTimer = undefined;
	}

	dispatchChangeEvent() {
		this.dispatchEvent(new CustomEvent('change'));
	}

	dispatchErrorEvent(detail) {
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

	startSaveTimer(saveCallback) {
		this.saveTimer = setInterval(async () => await this.saveTimerHandler(saveCallback), 500);
	}

	async saveTimerHandler(saveCallback) {
		const key = this.pendingSaveKey;
		this.pendingSaveKey = null;

		if (key !== null) {
			await saveCallback(key);
		}
	}

	enqueueSave(key) {
		this.pendingSaveKey = key;
	}

	async performFullSave(data) {
		throw new Error("Not Implemented");
	}

	getStorageData() {
		throw new Error("Not Implemented");
	}

	async openDatabase() {
		try {
			return await this.dbAdapter.openDatabase();
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async loadFromDatabase(db, key) {
		try {
			return await this.dbAdapter.loadFromDatabase(db, this.storeName, key);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async loadAllFromDatabase(db) {
		try {
			return await this.dbAdapter.loadAllFromDatabase(db, this.storeName);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async loadSessionInfoFromDatabase(db) {
		try {
			return await this.dbAdapter.loadSessionInfoFromDatabase(db, this.storeName);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async saveToDatabase(db, key, data) {
		try {
			return await this.dbAdapter.saveToDatabase(db, this.storeName, key, data);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async renameSessionInDatabase(db, key, newName) {
		try {
			return await this.dbAdapter.renameSessionInDatabase(db, this.storeName, key, newName);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}

	async deleteFromDatabase(db, key) {
		try {
			return await this.dbAdapter.deleteFromDatabase(db, this.storeName, key);
		} catch (e) {
			this.dispatchErrorEvent(e);
			throw e;
		}
	}
}
