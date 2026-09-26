import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TemplateStorage } from './TemplateStorage';

const DB = 'db' as unknown as DbConnection;

function makeTemplate(instPre = '[INST]'): InstructTemplate {
	return { sysPre: '<<SYS>>', sysSuf: '<</SYS>>', instPre, instSuf: '[/INST]' };
}

const adapter = {
	openDatabase: vi.fn(),
	loadFromDatabase: vi.fn(),
	loadAllFromDatabase: vi.fn(),
	loadSessionInfoFromDatabase: vi.fn(),
	saveToDatabase: vi.fn(),
	renameSessionInDatabase: vi.fn(),
	deleteFromDatabase: vi.fn(),
} satisfies DatabaseAdapter;

let storage: TemplateStorage;

beforeEach(async () => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	adapter.openDatabase.mockResolvedValue(DB);
	adapter.saveToDatabase.mockResolvedValue(undefined);
	adapter.deleteFromDatabase.mockResolvedValue(undefined);
	adapter.loadAllFromDatabase.mockResolvedValue({ keep: makeTemplate(), gone: makeTemplate(), bad: { sysPre: 1 } });
	storage = new TemplateStorage(adapter);
	await storage.init();
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('TemplateStorage', () => {
	it('keeps valid templates on load', () => {
		expect(Object.keys(storage.getStorageData())).toEqual(['keep', 'gone']);
	});

	it('deletes an invalid template from the database on load', async () => {
		adapter.loadAllFromDatabase.mockResolvedValue({ bad: 'not a template' });

		await new TemplateStorage(adapter).init();

		expect(adapter.deleteFromDatabase).toHaveBeenCalledExactlyOnceWith(DB, 'Templates', 'bad');
	});

	it('deletes removed templates and saves only changed or new ones', async () => {
		await storage.performFullSave({ keep: makeTemplate(), added: makeTemplate('<s>') });

		expect(adapter.deleteFromDatabase).toHaveBeenCalledExactlyOnceWith(DB, 'Templates', 'gone');
		expect(adapter.saveToDatabase).toHaveBeenCalledExactlyOnceWith(DB, 'Templates', 'added', makeTemplate('<s>'));
		expect(Object.keys(storage.getStorageData())).toEqual(['keep', 'added']);
	});

	it('deletes nothing on a write-only save, as an import does', async () => {
		await storage.performFullSave({ added: makeTemplate('<s>') }, true);

		expect(adapter.deleteFromDatabase).not.toHaveBeenCalled();
		expect(adapter.saveToDatabase).toHaveBeenCalledOnce();
	});

	it('keeps the old templates and reports the error when a save fails', async () => {
		adapter.saveToDatabase.mockRejectedValue(new Error('quota'));
		const onError = vi.fn();
		storage.addEventListener('error', onError);

		await expect(storage.performFullSave({ keep: makeTemplate('changed') })).rejects.toThrow('quota');

		expect(storage.getStorageData().keep).toEqual(makeTemplate());
		expect(onError).toHaveBeenCalled();
	});
});
