import { AbstractStorage } from './AbstractStorage';

export class TemplateStorage extends AbstractStorage {
	templates: Record<string, InstructTemplate> = {};

	constructor(dbAdapter: DatabaseAdapter) {
		super('Templates', dbAdapter);
	}

	async init() {
		const db = await this.openDatabase();
		await this.loadTemplates(db);
	}

	async performFullSave(newTemplates: Record<string, InstructTemplate>, writeOnly: boolean = false) {
		const db = await this.openDatabase();

		for (const key of Object.keys(this.templates)) {
			if (Object.keys(newTemplates).includes(key))
				continue;
			if (writeOnly)
				continue;
			try {
				await this.deleteFromDatabase(db, key);
				console.warn('Deleted key:', key);
			} catch {
				console.error('Error deleting key:', key);
			}
		}

		for (const [key, value] of Object.entries(newTemplates)) {
			if (JSON.stringify(value) === JSON.stringify(this.templates[key]))
				continue;
			await this.saveToDatabase(db, key, value);
		}

		this.templates = newTemplates;
        this.dispatchChangeEvent();
	}

	getStorageData(): Record<string, InstructTemplate> {
		return this.templates;
	}

	async loadTemplates(db: DbConnection) {
		this.templates = await this.loadAllFromDatabase(db);
	}
}
