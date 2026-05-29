export class IndexedDBAdapter {
	constructor() {
		this.dbName = 'MiyaPad';
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

	async openDatabase() {
		return new Promise((resolve, reject) => {
			const openRequest = indexedDB.open(this.dbName, 4);

			openRequest.onerror = () => reject(openRequest.error);
			openRequest.onsuccess = () => resolve(openRequest.result);

			openRequest.onupgradeneeded = (event) => {
				const db = event.target.result;
				const transaction = event.target.transaction;

				for (const storeName of ["Sessions", "Templates", "Names", "Themes"]) {
					if (!db.objectStoreNames.contains(storeName)) {
						db.createObjectStore(storeName);
					}
				}

				switch (event.oldVersion) {
					case 2:
						// NameStore has been introduced in version 3.
						const sessionsStore = transaction.objectStore("Sessions");
						const namesStore = transaction.objectStore("Names");

						sessionsStore.openCursor().onsuccess = (e) => {
							const cursor = e.target.result;
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

	async loadFromDatabase(db, storeName, key) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, 'readonly');
			const store = tx.objectStore(storeName);
			const request = store.get(key);

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async loadAllFromDatabase(db, storeName) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, 'readonly');
			const store = tx.objectStore(storeName);
			const request = store.openCursor();

			let allTables = {};

			request.onsuccess = async (event) => {
				const cursor = event.target.result;
				if (cursor) {
					allTables[cursor.key] = cursor.value;
					cursor.continue();
				} else {
					resolve(allTables);
				}
			};
			request.onerror = () => reject(request.error);
		});
	}

	async loadSessionInfoFromDatabase(db, storeName) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction("Names", 'readonly');
			const store = tx.objectStore("Names");
			const request = store.openCursor();

			let allTables = {};

			request.onsuccess = async (event) => {
				const cursor = event.target.result;
				if (cursor) {
					if (cursor.key !== 'nextSessionId' && cursor.key !== 'selectedSessionId') {
						allTables[cursor.key] = cursor.value;
					}
					cursor.continue();
				} else {
					resolve(allTables);
				}
			};
			request.onerror = () => reject(request.error);
		});
	}
	

	async saveToDatabase(db, storeName, key, data) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, 'readwrite');
			const store = tx.objectStore(storeName);
			const request = store.put(data, key);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	async renameSessionInDatabase(db, storeName, key, newName) {
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
				putRequest.onsuccess = () => resolve();
				putRequest.onerror = () => reject(putRequest.error);
			};
			getRequest.onerror = () => reject(getRequest.error);
		});
	}

	async deleteFromDatabase(db, storeName, key) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, 'readwrite');
			const store = tx.objectStore(storeName);
			const request = store.delete(key);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	async exportDatabase() {
		const db = await this.openDatabase();
		const exportObject = {};
		const storeNames = Array.from(db.objectStoreNames);

		const transaction = db.transaction(storeNames, 'readonly');
		transaction.onerror = (event) => {
			console.error("Transaction error:", event.target.error);
		};

		for (const storeName of storeNames) {
			exportObject[storeName] = [];
			const store = transaction.objectStore(storeName);
			const request = store.openCursor();

			await new Promise((resolve, reject) => {
				request.onsuccess = (event) => {
					const cursor = event.target.result;
					if (cursor) {
						exportObject[storeName].push({ key: cursor.key, value: cursor.value });
						cursor.continue();
					} else {
						resolve();
					}
				};
				request.onerror = (event) => {
					reject(event.target.error);
				};
			});
		}

		return exportObject;
	}

	async importDatabase(data) {
		const db = await this.openDatabase();
		const storeNames = Array.from(db.objectStoreNames);
		const transaction = db.transaction(storeNames, 'readwrite');

		transaction.onerror = (event) => {
			console.error("Transaction error:", event.target.error);
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
				resolve();
			};
			transaction.onerror = (event) => {
				reject(event.target.error);
			};
		});
	}
}
