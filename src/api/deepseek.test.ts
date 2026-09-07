import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deepseekModels } from './deepseek';

const fetchMock = vi.fn();

function ok(body: unknown) {
	return { ok: true, status: 200, json: async () => body };
}

function lastCall() {
	const [url, init] = fetchMock.mock.calls.at(-1)!;
	return { url: url as string, init: init as RequestInit & { headers: Record<string, string> } };
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('deepseekModels', () => {
	it('requests /models on the endpoint and returns the ids', async () => {
		fetchMock.mockResolvedValue(ok({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }));

		await expect(deepseekModels({ endpoint: 'https://api.deepseek.com' }))
			.resolves.toEqual(['deepseek-chat', 'deepseek-reasoner']);

		const { url, init } = lastCall();
		expect(url).toBe('https://api.deepseek.com/models');
		expect(init.method).toBe('GET');
	});

	it('returns an empty list when the account has no models', async () => {
		fetchMock.mockResolvedValue(ok({ data: [] }));

		await expect(deepseekModels({ endpoint: 'https://api.deepseek.com' })).resolves.toEqual([]);
	});

	it('sends the API key as a bearer token when there is no proxy', async () => {
		fetchMock.mockResolvedValue(ok({ data: [] }));

		await deepseekModels({ endpoint: 'https://api.deepseek.com', endpointAPIKey: 'sk-abc' });

		const { init } = lastCall();
		expect(init.headers['Authorization']).toBe('Bearer sk-abc');
		expect(init.headers['X-Real-Authorization']).toBeUndefined();
		expect(init.headers['X-Real-URL']).toBeUndefined();
	});

	it('routes through the proxy and moves the key and target URL to X-Real-* headers', async () => {
		fetchMock.mockResolvedValue(ok({ data: [{ id: 'deepseek-chat' }] }));

		await deepseekModels({
			endpoint: 'https://api.deepseek.com',
			endpointAPIKey: 'sk-abc',
			proxyEndpoint: 'http://proxy.local',
		});

		const { url, init } = lastCall();
		expect(url).toBe('http://proxy.local/models');
		expect(init.headers['X-Real-Authorization']).toBe('Bearer sk-abc');
		expect(init.headers['X-Real-URL']).toBe('https://api.deepseek.com');
		expect(init.headers['Authorization']).toBeUndefined();
	});

	it('forwards the abort signal', async () => {
		fetchMock.mockResolvedValue(ok({ data: [] }));
		const ac = new AbortController();

		await deepseekModels({ endpoint: 'https://api.deepseek.com', signal: ac.signal });

		expect(lastCall().init.signal).toBe(ac.signal);
	});

	it('throws on a non-OK response', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });

		await expect(deepseekModels({ endpoint: 'https://api.deepseek.com' })).rejects.toThrow('HTTP 402');
	});

	it('propagates a network failure', async () => {
		fetchMock.mockRejectedValue(new TypeError('network down'));

		await expect(deepseekModels({ endpoint: 'https://api.deepseek.com' })).rejects.toThrow('network down');
	});
});
