import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openaiTabbyTokenCount, openaiModels } from './openai';

const fetchMock = vi.fn();

function ok(body: unknown) {
	return { ok: true, status: 200, json: async () => body };
}

function notOk(status: number) {
	return { ok: false, status, json: async () => ({}) };
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

describe('openaiTabbyTokenCount', () => {
	it('posts the content as `text` to /v1/token/encode and returns the token count', async () => {
		fetchMock.mockResolvedValue(ok([1, 2, 3, 4]));

		const count = await openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', content: 'hi there' });

		expect(count).toBe(4);
		const { url, init } = lastCall();
		expect(url).toBe('http://localhost:5000/v1/token/encode');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({ text: 'hi there' });
	});

	it('sends the API key as a bearer token when there is no proxy', async () => {
		fetchMock.mockResolvedValue(ok([]));

		await openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', endpointAPIKey: 'sk-abc', content: 'x' });

		const { init } = lastCall();
		expect(init.headers['Authorization']).toBe('Bearer sk-abc');
		expect(init.headers['X-Real-URL']).toBeUndefined();
	});

	it('routes through the proxy and moves the key and target URL to X-Real-* headers', async () => {
		fetchMock.mockResolvedValue(ok([1]));

		await openaiTabbyTokenCount({
			endpoint: 'http://localhost:5000',
			endpointAPIKey: 'sk-abc',
			proxyEndpoint: 'http://proxy.local',
			content: 'x',
		});

		const { url, init } = lastCall();
		expect(url).toBe('http://proxy.local/v1/token/encode');
		expect(init.headers['X-Real-Authorization']).toBe('Bearer sk-abc');
		expect(init.headers['X-Real-URL']).toBe('http://localhost:5000');
		expect(init.headers['Authorization']).toBeUndefined();
	});

	it('forwards the abort signal', async () => {
		fetchMock.mockResolvedValue(ok([]));
		const ac = new AbortController();

		await openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', content: 'x', signal: ac.signal });

		expect(lastCall().init.signal).toBe(ac.signal);
	});

	it('returns -1 on a non-OK response instead of throwing', async () => {
		fetchMock.mockResolvedValue(notOk(404));

		await expect(openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', content: 'x' })).resolves.toBe(-1);
	});

	it('returns -1 when the request itself rejects', async () => {
		fetchMock.mockRejectedValue(new TypeError('network down'));

		await expect(openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', content: 'x' })).resolves.toBe(-1);
	});

	it('returns -1 when an OK response has no usable length (not a Tabby server)', async () => {
		fetchMock.mockResolvedValue(ok({ detail: 'not found' }));

		await expect(openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', content: 'x' })).resolves.toBe(-1);
	});

	it('returns -1 when an OK response is a bare value with no length', async () => {
		fetchMock.mockResolvedValue(ok(null));

		await expect(openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', content: 'x' })).resolves.toBe(-1);
	});

	it('still accepts an object carrying a numeric length', async () => {
		fetchMock.mockResolvedValue(ok({ length: 12, tokens: [1, 2] }));

		await expect(openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', content: 'x' })).resolves.toBe(12);
	});

	it('accepts a zero-length result', async () => {
		fetchMock.mockResolvedValue(ok([]));

		await expect(openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', content: '' })).resolves.toBe(0);
	});

	it('returns -1 for a count that is not a non-negative whole number', async () => {
		// None of these are usable counts, and getTokenCount screens only for
		// exactly -1, so each has to become the sentinel here.
		for (const length of [-5, -1, 2.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			fetchMock.mockResolvedValue(ok({ length }));

			await expect(openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', content: 'x' })).resolves.toBe(-1);
		}
	});

	it('returns -1 for a non-numeric length', async () => {
		for (const length of ['12', true, null, {}]) {
			fetchMock.mockResolvedValue(ok({ length }));

			await expect(openaiTabbyTokenCount({ endpoint: 'http://localhost:5000', content: 'x' })).resolves.toBe(-1);
		}
	});
});

describe('openaiModels', () => {
	it('returns the ids from the `data` array of a standard /v1/models response', async () => {
		fetchMock.mockResolvedValue(ok({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }));

		await expect(openaiModels({ endpoint: 'https://api.openai.com' })).resolves.toEqual(['gpt-4o', 'gpt-4o-mini']);
		expect(lastCall().url).toBe('https://api.openai.com/v1/models');
		expect(lastCall().init.method).toBe('GET');
	});

	it('reads a bare array for TogetherAI, which does not wrap the list in `data`', async () => {
		fetchMock.mockResolvedValue(ok([{ id: 'meta-llama/Llama-3-8b' }, { id: 'mistralai/Mistral-7B' }]));

		await expect(openaiModels({ endpoint: 'https://api.together.xyz' }))
			.resolves.toEqual(['meta-llama/Llama-3-8b', 'mistralai/Mistral-7B']);
	});

	it('sends the API key as a bearer token when there is no proxy', async () => {
		fetchMock.mockResolvedValue(ok({ data: [] }));

		await openaiModels({ endpoint: 'http://localhost:5000', endpointAPIKey: 'sk-abc' });

		expect(lastCall().init.headers['Authorization']).toBe('Bearer sk-abc');
	});

	it('routes through the proxy and moves the key and target URL to X-Real-* headers', async () => {
		fetchMock.mockResolvedValue(ok({ data: [] }));

		await openaiModels({ endpoint: 'http://localhost:5000', endpointAPIKey: 'sk-abc', proxyEndpoint: 'http://proxy.local' });

		const { url, init } = lastCall();
		expect(url).toBe('http://proxy.local/v1/models');
		expect(init.headers['X-Real-Authorization']).toBe('Bearer sk-abc');
		expect(init.headers['X-Real-URL']).toBe('http://localhost:5000');
	});

	it('still uses the `data` shape when TogetherAI is only reachable through a proxy', async () => {
		// The TogetherAI check reads the real endpoint, not the proxy URL.
		fetchMock.mockResolvedValue(ok([{ id: 'a' }]));

		await expect(openaiModels({ endpoint: 'https://api.together.xyz', proxyEndpoint: 'http://proxy.local' }))
			.resolves.toEqual(['a']);
		expect(lastCall().url).toBe('http://proxy.local/v1/models');
	});

	it('treats an unparseable endpoint as a non-TogetherAI host', async () => {
		fetchMock.mockResolvedValue(ok({ data: [{ id: 'local' }] }));

		await expect(openaiModels({ endpoint: 'not a url' })).resolves.toEqual(['local']);
	});

	it('throws on a non-OK response', async () => {
		fetchMock.mockResolvedValue(notOk(401));

		await expect(openaiModels({ endpoint: 'http://localhost:5000' })).rejects.toThrow('HTTP 401');
	});
});
