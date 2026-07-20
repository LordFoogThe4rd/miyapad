import { AbstractStorage } from './AbstractStorage';
import { isSamplerPresetData } from './validators';

export class SamplerPresetStorage extends AbstractStorage {
	presets: Record<string, SamplerPresetData> = {};

	constructor(dbAdapter: DatabaseAdapter) {
		super('SamplerPresets', dbAdapter);
	}

	async init() {
		const db = await this.openDatabase();
		await this.loadPresets(db);
	}

	async performFullSave(newPresets: Record<string, SamplerPresetData>) {
		try {
			const db = await this.openDatabase();
			const oldPresets = this.presets;

			if (this.dbAdapter.batchMutation) {
				const ops: BatchOp[] = [];

				for (const key of Object.keys(oldPresets)) {
					if (!Object.hasOwn(newPresets, key)) {
						ops.push({ type: 'delete', key });
					}
				}

				for (const [key, value] of Object.entries(newPresets)) {
					if (JSON.stringify(value) !== JSON.stringify(oldPresets[key])) {
						ops.push({ type: 'save', key, data: value });
					}
				}

				if (ops.length > 0) {
					await this.dbAdapter.batchMutation(db, this.storeName, ops);
				}
			} else {
				// ponytail: fallback for adapters without batchMutation; non-atomic but preserves old behavior
				for (const key of Object.keys(oldPresets)) {
					if (!Object.hasOwn(newPresets, key)) {
						await this.deleteFromDatabase(db, key);
					}
				}

				for (const [key, value] of Object.entries(newPresets)) {
					if (JSON.stringify(value) !== JSON.stringify(oldPresets[key])) {
						await this.saveToDatabase(db, key, value);
					}
				}
			}

			this.presets = newPresets;
			this.dispatchChangeEvent();
		} catch (error) {
			this.dispatchErrorEvent(error);
			throw error;
		}
	}

	getStorageData(): Record<string, SamplerPresetData> {
		return this.presets;
	}

	async loadPresets(db: DbConnection) {
		const raw = await this.loadAllFromDatabase(db);
		this.presets = {};
		for (const [key, value] of Object.entries(raw)) {
			if (isSamplerPresetData(value)) {
				this.presets[key] = value;
			} else {
				console.warn(`[SamplerPresetStorage] Removing invalid entry: ${key}`);
				await this.deleteFromDatabase(db, key).catch(e => console.warn(`[SamplerPresetStorage] Failed to delete invalid entry: ${key}`, e));
			}
		}
	}
}
