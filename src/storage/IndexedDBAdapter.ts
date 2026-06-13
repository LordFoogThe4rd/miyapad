export class IndexedDBAdapter {
	dbName: string = 'MiyaPad';

	constructor() {
	}

	async init() {
		try {
			if (!await navigator.storage.persisted()) {
				const startTime = performance.now();
				const persistent = await navigator.storage.persist();
				const elapsedTime = performance.now() - startTime;
				
				if (!persistent && !localStorage.getItem('persistentStorageWarningShown')) {
					// If the response came back in less than 500ms, it was likely an automatic denial
					// (500ms is generally considered faster than human reaction time)
					if (elapsedTime < 500) {
						alert('Your browser has automatically denied persistent storage for Miyapad. Be aware that the browser may clear the database when under storage pressure. You might need to adjust your browser settings to enable this feature, or alternatively, you can use the Miyapad server.');
					} else {
						alert('You have chosen not to enable persistent storage for Miyapad. Be aware that the browser may clear the database when under storage pressure. As an optional alternative, you can use the Miyapad server.');
					}
					localStorage.setItem('persistentStorageWarningShown', 'true');
				}
			}
		} catch {}
	}

	async openDatabase(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const openRequest = indexedDB.open(this.dbName, 5);

			openRequest.onerror = () => reject(openRequest.error);
			openRequest.onsuccess = () => resolve(openRequest.result);

			openRequest.onupgradeneeded = (event: IDBVersionChangeEvent) => {
				const request = event.target as IDBOpenDBRequest;
				const db = request.result;
				const transaction = request.transaction!;

				for (const storeName of ["Sessions", "Templates", "Names", "Themes", "Connections"]) {
					if (!db.objectStoreNames.contains(storeName)) {
						db.createObjectStore(storeName);
					}
				}

				switch (event.oldVersion) {
					case 2:
						// NameStore has been introduced in version 3.
						const sessionsStore = transaction.objectStore("Sessions");
						const namesStore = transaction.objectStore("Names");

						sessionsStore.openCursor().onsuccess = (e: Event) => {
							const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
							if (cursor) {
								const sessionData = cursor.value;
								const sessionId = cursor.key;

								if (sessionData && sessionData.name && typeof sessionId === 'number') {
									namesStore.add(sessionData.name, sessionId);
									delete sessionData.name;
									cursor.update(sessionData);
								}
								cursor.continue();
							}
						};
						break;
				}
			};
			openRequest.onblocked = () => console.warn('Request was blocked');
		});
	}

	async loadFromDatabase(db: any, storeName: any, key: any) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, 'readonly');
			const store = tx.objectStore(storeName);
			const request = store.get(key);

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async loadAllFromDatabase(db: any, storeName: any) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, 'readonly');
			const store = tx.objectStore(storeName);
			const request = store.openCursor();

			let allTables = {};

			request.onsuccess = async (event: Event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
				if (cursor) {
					allTables[cursor.key as string] = cursor.value;
					cursor.continue();
				} else {
					resolve(allTables);
				}
			};
			request.onerror = () => reject(request.error);
		});
	}

	async loadSessionInfoFromDatabase(db: any, storeName: any) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction("Names", 'readonly');
			const store = tx.objectStore("Names");
			const request = store.openCursor();

			let allTables = {};

			request.onsuccess = async (event: Event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
				if (cursor) {
					if (cursor.key !== 'nextSessionId' && cursor.key !== 'selectedSessionId') {
						allTables[cursor.key as string] = cursor.value;
					}
					cursor.continue();
				} else {
					resolve(allTables);
				}
			};
			request.onerror = () => reject(request.error);
		});
	}
	

	async saveToDatabase(db: any, storeName: any, key: any, data: any) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, 'readwrite');
			const store = tx.objectStore(storeName);
			const request = store.put(data, key);

			request.onsuccess = () => resolve(undefined);
			request.onerror = () => reject(request.error);
		});
	}

	async renameSessionInDatabase(db: any, storeName: any, key: any, newName: any) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction("Names", 'readwrite');
			const store = tx.objectStore("Names");
			const getRequest = store.get(key);
			getRequest.onsuccess = () => {
				const current = getRequest.result;
				let dataToPut;
				if (current && typeof current === 'object' && current.name !== undefined) {
					dataToPut = { ...current, name: newName, modified: Date.now() };
				} else {
					dataToPut = { name: newName, created: null, modified: Date.now() };
				}
				const putRequest = store.put(dataToPut, key);
				putRequest.onsuccess = () => resolve(undefined);
				putRequest.onerror = () => reject(putRequest.error);
			};
			getRequest.onerror = () => reject(getRequest.error);
		});
	}

	async deleteFromDatabase(db: any, storeName: any, key: any) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, 'readwrite');
			const store = tx.objectStore(storeName);
			const request = store.delete(key);

			request.onsuccess = () => resolve(undefined);
			request.onerror = () => reject(request.error);
		});
	}

	async exportDatabase() {
		const db = await this.openDatabase();
		const exportObject = {};
		const storeNames = Array.from(db.objectStoreNames);

		const transaction = db.transaction(storeNames, 'readonly');
		transaction.onerror = (event: Event) => {
			console.error("Transaction error:", (event.target as IDBTransaction).error);
		};

		for (const storeName of storeNames) {
			exportObject[storeName] = [];
			const store = transaction.objectStore(storeName);
			const request = store.openCursor();

			await new Promise((resolve, reject) => {
				request.onsuccess = (event: Event) => {
					const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
					if (cursor) {
						exportObject[storeName].push({ key: cursor.key, value: cursor.value });
						cursor.continue();
					} else {
						resolve(undefined);
					}
				};
				request.onerror = (event: Event) => {
					reject((event.target as IDBRequest).error);
				};
			});
		}

		return exportObject;
	}

	async importDatabase(data: any) {
		const db = await this.openDatabase();
		const storeNames = Array.from(db.objectStoreNames);
		const transaction = db.transaction(storeNames, 'readwrite');

		transaction.onerror = (event: Event) => {
			console.error("Transaction error:", (event.target as IDBTransaction).error);
		};

		for (const storeName of storeNames) {
			if (data[storeName]) {
				const store = transaction.objectStore(storeName);
				store.clear();
				for (const item of data[storeName]) {
					store.put(item.value, item.key);
				}
			}
		}

		return new Promise((resolve, reject) => {
			transaction.oncomplete = () => {
				resolve(undefined);
			};
			transaction.onerror = (event: Event) => {
				reject((event.target as IDBTransaction).error);
			};
		});
	}
}
