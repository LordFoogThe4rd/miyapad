export class ServerDBAdapter {
	constructor(sessionEndpoint) {
		this.sessionEndpoint = sessionEndpoint;
	}

	async init() {
		const res = await fetch(new URL('/version', this.sessionEndpoint), {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		});
		if (!res.ok)
			throw new Error("Not a mikupad server or version mismatch.");
		const { version } = await res.json();
		if (version < 3)
			throw new Error("Mikupad server version mismatch.");
	}

	async openDatabase() {
		return async (route, options) => {
			try {
				return await fetch(new URL(route, this.sessionEndpoint), {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(options),
				});
			} catch (e) {
				reportError(e);
				return { ok: false, status: e.toString() };
			}
		};
	}

	async loadFromDatabase(db, storeName, key) {
		return new Promise(async (resolve, reject) => {
			const res = await db("/load", { storeName, key });
			if (!res.ok) {
				if (res.status == 404) {
					resolve(undefined);
				} else {
					reject(res.status);
				}
				return;
			}
			const { result } = await res.json();
			resolve(result);
		});
	}

	async loadAllFromDatabase(db, storeName) {
		return new Promise(async (resolve, reject) => {
			const res = await db("/all", { storeName });
			if (!res.ok) {
				reject(res.status);
				return;
			}
			const { result } = await res.json();
			resolve(result);
		});
	}

	async loadSessionInfoFromDatabase(db, storeName) {
		return new Promise(async (resolve, reject) => {
			const res = await db("/sessions", { storeName });
			if (!res.ok) {
				reject(res.status);
				return;
			}
			const { result } = await res.json();
			resolve(result);
		});
	}

	async saveToDatabase(db, storeName, key, data) {
		return new Promise(async (resolve, reject) => {
			const res = await db("/save", { storeName, key, data });
			if (!res.ok) {
				reject(res.status);
				return;
			}
			const { result } = await res.json();
			resolve(result);
		});
	}

	async renameSessionInDatabase(db, storeName, key, newName) {
		return new Promise(async (resolve, reject) => {
			const res = await db("/rename", { storeName, key, newName });
			if (!res.ok) {
				reject(res.status);
				return;
			}
			const { result } = await res.json();
			resolve(result);
		});
	}

	async deleteFromDatabase(db, storeName, key) {
		return new Promise(async (resolve, reject) => {
			const res = await db("/delete", { storeName, key });
			if (!res.ok) {
				reject(res.status);
				return;
			}
			resolve();
		});
	}
}
