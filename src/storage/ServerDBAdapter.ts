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
		const res = await db("/load", { storeName, key });
		if (!res.ok) {
			if (res instanceof Response && res.status === 404) {
				return undefined;
			}
			throw new Error(String(res.status));
		}
		const { result } = await (res as Response).json();
		return result;
	}

	async loadAllFromDatabase(db: ServerDbFn, storeName: string) {
		const res = await db("/all", { storeName });
		if (!res.ok) {
			throw new Error(String(res.status));
		}
		const { result } = await (res as Response).json();
		return result;
	}

	async loadSessionInfoFromDatabase(db: ServerDbFn, storeName: string) {
		const res = await db("/sessions", { storeName });
		if (!res.ok) {
			throw new Error(String(res.status));
		}
		const { result } = await (res as Response).json();
		return result;
	}

	async saveToDatabase(db: ServerDbFn, storeName: string, key: string, data: any) {
		const res = await db("/save", { storeName, key, data });
		if (!res.ok) {
			throw new Error(String(res.status));
		}
		const { result } = await (res as Response).json();
		return result;
	}

	async renameSessionInDatabase(db: ServerDbFn, storeName: string, key: string, newName: string) {
		const res = await db("/rename", { storeName, key, newName });
		if (!res.ok) {
			throw new Error(String(res.status));
		}
		const { result } = await (res as Response).json();
		return result;
	}

	async deleteFromDatabase(db: ServerDbFn, storeName: string, key: string) {
		const res = await db("/delete", { storeName, key });
		if (!res.ok) {
			throw new Error(String(res.status));
		}
	}
}
