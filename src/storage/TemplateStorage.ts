import { AbstractStorage } from './AbstractStorage';

export class TemplateStorage extends AbstractStorage {
	constructor(dbAdapter) {
		super('Templates', dbAdapter);
		this.templates = {};
	}

	async init() {
		const db = await this.openDatabase();
		await this.loadTemplates(db);
	}

	async performFullSave(newTemplates, writeOnly=false) {
		const db = await this.openDatabase();

		// Check if the keys exists in input, if not, delete
		for (const key of Object.keys(this.templates)) {
			if (Object.keys(newTemplates).includes(key))
				continue;
			if (writeOnly)
				continue;
			try {
				// If the key not in input, delete it
				await this.deleteFromDatabase(db, key);
				console.warn('Deleted key:', key);
			} catch {
				console.error('Error deleting key:', key);
			}
		}

		// put input keys
		for (const [key, value] of Object.entries(newTemplates)) {
			if (JSON.stringify(value) === JSON.stringify(this.templates[key]))
				continue;
			await this.saveToDatabase(db, key, value);
		}

		this.templates = newTemplates;
        this.dispatchChangeEvent();
	}

	getStorageData() {
		return this.templates;
	}

	async loadTemplates(db) {
		this.templates = await this.loadAllFromDatabase(db);
	}
}
