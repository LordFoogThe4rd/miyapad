import { AbstractStorage } from './AbstractStorage';
import { isInstructTemplate } from './validators';

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
			throw error;
		}
	}

	getStorageData(): Record<string, InstructTemplate> {
		return this.templates;
	}

	async loadTemplates(db: DbConnection) {
		const raw = await this.loadAllFromDatabase(db);
		this.templates = {};
		for (const [key, value] of Object.entries(raw)) {
			if (isInstructTemplate(value)) {
				this.templates[key] = value;
			} else {
				console.warn(`[TemplateStorage] Removing invalid entry: ${key}`);
				await this.deleteFromDatabase(db, key).catch(e => console.warn(`[TemplateStorage] Failed to delete invalid entry: ${key}`, e));
			}
		}
	}
}
