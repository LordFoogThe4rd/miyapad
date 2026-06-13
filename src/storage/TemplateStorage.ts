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
		try {
			const db = await this.openDatabase();

			if (!writeOnly) {
				for (const key of Object.keys(this.templates)) {
					if (!Object.hasOwn(newTemplates, key)) {
						await this.deleteFromDatabase(db, key);
					}
				}
			}

			for (const [key, value] of Object.entries(newTemplates)) {
				if (JSON.stringify(value) !== JSON.stringify(this.templates[key])) {
					await this.saveToDatabase(db, key, value);
				}
			}

			this.templates = newTemplates;
			this.dispatchChangeEvent();
		} catch (error) {
			this.dispatchErrorEvent(error);
		}
	}

	getStorageData(): Record<string, InstructTemplate> {
		return this.templates;
	}

	async loadTemplates(db: DbConnection) {
		this.templates = await this.loadAllFromDatabase(db);
	}
}
