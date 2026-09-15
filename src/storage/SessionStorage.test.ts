import { describe, expect, it } from 'vitest';
import { SessionStorage } from './SessionStorage';

function storageWith(data: Record<string, unknown>) {
	const storage = new SessionStorage({} as DatabaseAdapter);
	storage.sessions = { 0: { name: 'Story', modified: 1, ...data } as SessionData };
	storage.selectedSession = 0;
	return storage;
}

describe('SessionStorage.setProperty', () => {
	it('leaves modified alone when re-applying values the session already has', () => {
		const storage = storageWith({ temperature: 0.7, enabledSamplers: ['top_k', 'min_p'] });

		storage.setProperty('temperature', 0.7);
		storage.setProperty('enabledSamplers', ['top_k', 'min_p']);

		expect(storage.sessions[0]!.modified).toBe(1);
	});

	it('bumps modified when a value actually changes', () => {
		const storage = storageWith({ temperature: 0.7, enabledSamplers: ['top_k', 'min_p'] });

		storage.setProperty('enabledSamplers', ['top_k']);

		expect(storage.sessions[0]!.modified).toBeGreaterThan(1);
		expect(storage.sessions[0]!.enabledSamplers).toEqual(['top_k']);
	});
});
