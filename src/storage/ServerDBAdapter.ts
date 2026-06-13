type ServerDbFn = (route: string, options: any) => Promise<Response | { ok: false; status: string }>;

export class ServerDBAdapter {
	sessionEndpoint: string;

	constructor(sessionEndpoint: string) {
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
			throw new Error("Not a miyapad server or version mismatch.");
		const { version } = await res.json();
		if (version < 3)
			throw new Error("Miyapad server version mismatch.");
	}

	async openDatabase(): Promise<ServerDbFn> {
		return async (route: string, options: any) => {
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
				return { ok: false as const, status: String(e) };
			}
		};
	}

	async loadFromDatabase(db: ServerDbFn, storeName: string, key: string) {
		return new Promise<any>(async (resolve, reject) => {
			const res = await db("/load", { storeName, key });
			if (!res.ok) {
				if (res.status == 404) {
					resolve(undefined);
				} else {
					reject(res.status);
				}
				return;
			}
			const { result } = await (res as Response).json();
			resolve(result);
		});
	}

	async loadAllFromDatabase(db: ServerDbFn, storeName: string) {
		return new Promise<Record<string, any>>(async (resolve, reject) => {
			const res = await db("/all", { storeName });
			if (!res.ok) {
				reject(res.status);
				return;
			}
			const { result } = await (res as Response).json();
			resolve(result);
		});
	}

	async loadSessionInfoFromDatabase(db: ServerDbFn, storeName: string) {
		return new Promise<Record<string, any>>(async (resolve, reject) => {
			const res = await db("/sessions", { storeName });
			if (!res.ok) {
				reject(res.status);
				return;
			}
			const { result } = await (res as Response).json();
			resolve(result);
		});
	}

	async saveToDatabase(db: ServerDbFn, storeName: string, key: string, data: any) {
		return new Promise<any>(async (resolve, reject) => {
			const res = await db("/save", { storeName, key, data });
			if (!res.ok) {
				reject(res.status);
				return;
			}
			const { result } = await (res as Response).json();
			resolve(result);
		});
	}

	async renameSessionInDatabase(db: ServerDbFn, storeName: string, key: string, newName: string) {
		return new Promise<any>(async (resolve, reject) => {
			const res = await db("/rename", { storeName, key, newName });
			if (!res.ok) {
				reject(res.status);
				return;
			}
			const { result } = await (res as Response).json();
			resolve(result);
		});
	}

	async deleteFromDatabase(db: ServerDbFn, storeName: string, key: string) {
		return new Promise<void>(async (resolve, reject) => {
			const res = await db("/delete", { storeName, key });
			if (!res.ok) {
				reject(res.status);
				return;
			}
			resolve(undefined);
		});
	}
}
