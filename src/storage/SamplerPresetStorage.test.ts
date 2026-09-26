import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SamplerPresetStorage } from './SamplerPresetStorage';

const DB = 'db' as unknown as DbConnection;

function makePreset(id: string, temperature = 0.7): SamplerPresetData {
	return {
		id, name: id, enabled: true, seed: -1, maxPredictTokens: 256, temperature, dynaTempRange: 0, dynaTempExp: 1,
		repeatPenalty: 1.1, repeatLastN: 256, penalizeNl: false, presencePenalty: 0, frequencyPenalty: 0, topK: 40,
		topP: 0.95, typicalP: 1, minP: 0.05, tfsZ: 1, mirostat: 0, mirostatTau: 5, mirostatEta: 0.1, xtcThreshold: 0.1,
		xtcProbability: 0, dryMultiplier: 0, dryBase: 1.75, dryAllowedLength: 2, dryPenaltyRange: 1024,
		drySequenceBreakers: '[]', bannedTokens: '', ignoreEos: false, enabledSamplers: ['temperature'], grammar: '',
	} as SamplerPresetData;
}

function makeAdapter() {
	return {
		openDatabase: vi.fn().mockResolvedValue(DB),
		loadFromDatabase: vi.fn(),
		loadAllFromDatabase: vi.fn().mockResolvedValue({}),
		loadSessionInfoFromDatabase: vi.fn(),
		saveToDatabase: vi.fn().mockResolvedValue(undefined),
		renameSessionInDatabase: vi.fn(),
		deleteFromDatabase: vi.fn().mockResolvedValue(undefined),
		batchMutation: vi.fn().mockResolvedValue(undefined),
	} satisfies DatabaseAdapter;
}

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('SamplerPresetStorage', () => {
	it('loads valid presets and deletes invalid ones from the database', async () => {
		const adapter = makeAdapter();
		adapter.loadAllFromDatabase.mockResolvedValue({ good: makePreset('good'), bad: { id: 'bad', name: 'bad' } });
		const storage = new SamplerPresetStorage(adapter);

		await storage.init();

		expect(Object.keys(storage.getStorageData())).toEqual(['good']);
		expect(adapter.deleteFromDatabase).toHaveBeenCalledExactlyOnceWith(DB, 'SamplerPresets', 'bad');
	});

	it('saves only what changed, in one batch with the deletions', async () => {
		const adapter = makeAdapter();
		adapter.loadAllFromDatabase.mockResolvedValue({ keep: makePreset('keep'), edit: makePreset('edit'), gone: makePreset('gone') });
		const storage = new SamplerPresetStorage(adapter);
		await storage.init();
		const onChange = vi.fn();
		storage.addEventListener('change', onChange);

		await storage.performFullSave({ keep: makePreset('keep'), edit: makePreset('edit', 1.2), added: makePreset('added') });

		expect(adapter.batchMutation).toHaveBeenCalledExactlyOnceWith(DB, 'SamplerPresets', [
			{ type: 'delete', key: 'gone' },
			{ type: 'save', key: 'edit', data: makePreset('edit', 1.2) },
			{ type: 'save', key: 'added', data: makePreset('added') },
		]);
		expect(adapter.saveToDatabase).not.toHaveBeenCalled();
		expect(Object.keys(storage.getStorageData())).toEqual(['keep', 'edit', 'added']);
		expect(onChange).toHaveBeenCalledOnce();
	});

	it('sends no batch when nothing changed', async () => {
		const adapter = makeAdapter();
		adapter.loadAllFromDatabase.mockResolvedValue({ a: makePreset('a') });
		const storage = new SamplerPresetStorage(adapter);
		await storage.init();

		await storage.performFullSave({ a: makePreset('a') });

		expect(adapter.batchMutation).not.toHaveBeenCalled();
	});

	it('saves and deletes one by one on an adapter without batches', async () => {
		const { batchMutation, ...adapter } = makeAdapter();
		adapter.loadAllFromDatabase.mockResolvedValue({ gone: makePreset('gone') });
		const storage = new SamplerPresetStorage(adapter);
		await storage.init();

		await storage.performFullSave({ added: makePreset('added') });

		expect(adapter.deleteFromDatabase).toHaveBeenCalledExactlyOnceWith(DB, 'SamplerPresets', 'gone');
		expect(adapter.saveToDatabase).toHaveBeenCalledExactlyOnceWith(DB, 'SamplerPresets', 'added', makePreset('added'));
	});

	it('keeps the old presets and reports the error when the batch fails', async () => {
		const adapter = makeAdapter();
		adapter.loadAllFromDatabase.mockResolvedValue({ a: makePreset('a') });
		adapter.batchMutation.mockRejectedValue(new Error('disk full'));
		const storage = new SamplerPresetStorage(adapter);
		await storage.init();
		const onError = vi.fn();
		storage.addEventListener('error', onError);

		await expect(storage.performFullSave({})).rejects.toThrow('disk full');

		expect(Object.keys(storage.getStorageData())).toEqual(['a']);
		expect(onError).toHaveBeenCalled();
	});
});
