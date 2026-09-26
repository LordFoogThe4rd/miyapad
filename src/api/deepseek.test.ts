import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deepseekModels, deepseekChatCompletion, deepseekCompletion } from './deepseek';
import { sse, collect, callOf } from './testing';

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

describe('deepseekChatCompletion', () => {
	const endpoint = 'https://api.deepseek.com';
	const messages = [{ role: 'user', content: 'hi' }];

	it('posts the messages to /chat/completions with thinking off and the default model', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: 'Hello!' } }] }));

		await expect(collect(deepseekChatCompletion({ endpoint, endpointAPIKey: 'sk', messages, n_predict: -1, temperature: 0.5, seed: -1 })))
			.resolves.toEqual([{ content: 'Hello!' }]);

		const { url, init, body } = callOf(fetchMock);
		expect(url).toBe(`${endpoint}/chat/completions`);
		expect(init.headers['Authorization']).toBe('Bearer sk');
		expect(body).toEqual({ max_tokens: 1024, temperature: 0.5, model: 'deepseek-v4-flash', messages, thinking: { type: 'disabled' } });
	});

	it('sends only the options DeepSeek understands', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [] }));

		await collect(deepseekChatCompletion({ endpoint, model: 'deepseek-chat', n_predict: 64, top_p: 0.9, stop: ['\n'], seed: 7, min_p: 0.1, repeat_penalty: 1.2 }));

		expect(callOf(fetchMock).body).toEqual({
			max_tokens: 64, top_p: 0.9, stop: ['\n'], seed: 7, model: 'deepseek-chat', thinking: { type: 'disabled' },
		});
	});

	it('asks for at most 20 top log probabilities', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [] }));

		await collect(deepseekChatCompletion({ endpoint, n_probs: 50 }));

		expect(callOf(fetchMock).body).toMatchObject({ logprobs: true, top_logprobs: 20 });
	});

	it('streams delta content with its probabilities', async () => {
		fetchMock.mockResolvedValue(sse(
			{ choices: [{ delta: { content: 'Hel' }, logprobs: { content: [{ top_logprobs: [{ token: 'Hel', logprob: Math.log(0.5) }] }] } }] },
			{ choices: [{ delta: {} }] },
			{ choices: [{ delta: { content: 'lo' } }] },
		));

		const chunks = await collect(deepseekChatCompletion({ endpoint, stream: true }));

		expect(chunks.map(c => c.content)).toEqual(['Hel', 'lo']);
		expect(chunks[0].prob).toBeCloseTo(0.5);
		expect(chunks[1]).toEqual({ content: 'lo' });
	});

	it('routes through the proxy with the key and target in X-Real-* headers', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [] }));

		await collect(deepseekChatCompletion({ endpoint, endpointAPIKey: 'sk', proxyEndpoint: 'http://proxy.local' }));

		const { url, init } = callOf(fetchMock);
		expect(url).toBe('http://proxy.local/chat/completions');
		expect(init.headers['X-Real-Authorization']).toBe('Bearer sk');
		expect(init.headers['X-Real-URL']).toBe(endpoint);
	});

	it('throws the error message the server sent, or the status without one', async () => {
		fetchMock.mockResolvedValueOnce({ ok: false, status: 402, json: async () => ({ error: { message: 'Insufficient Balance' } }) });
		await expect(collect(deepseekChatCompletion({ endpoint }))).rejects.toThrow('Insufficient Balance');

		fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
		await expect(collect(deepseekChatCompletion({ endpoint }))).rejects.toThrow('HTTP 500');
	});
});

describe('deepseekCompletion', () => {
	const endpoint = 'https://api.deepseek.com';

	it('posts the prompt to /beta/completions, asking for log probabilities by count', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: 'Once' }] }));

		await expect(collect(deepseekCompletion({ endpoint, prompt: 'Tell', n_probs: 3 }))).resolves.toEqual([{ content: 'Once' }]);

		const { url, body } = callOf(fetchMock);
		expect(url).toBe(`${endpoint}/beta/completions`);
		expect(body).toEqual({ model: 'deepseek-v4-flash', prompt: 'Tell', logprobs: 3 });
	});

	it('streams text, with probabilities in either shape', async () => {
		fetchMock.mockResolvedValue(sse(
			{ choices: [{ text: 'a', logprobs: { top_logprobs: [{ a: Math.log(0.25), b: Math.log(0.75) }] } }] },
			{ choices: [{ text: 'b', logprobs: { content: [{ top_logprobs: [{ token: 'b', logprob: 0 }] }] } }] },
			{ choices: [{ text: '' }] },
			{ choices: [{ text: 'c' }] },
		));

		const chunks = await collect(deepseekCompletion({ endpoint, stream: true }));

		expect(chunks.map(c => c.content)).toEqual(['a', 'b', 'c']);
		expect(chunks[0].prob).toBeCloseTo(0.25);
		expect(chunks[1].prob).toBe(1);
		expect(chunks[2]).toEqual({ content: 'c' });
	});

	it('yields nothing for an empty non-streamed completion', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: '' }] }));

		await expect(collect(deepseekCompletion({ endpoint }))).resolves.toEqual([]);
	});

	it('throws the error message the server sent', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'bad' } }) });

		await expect(collect(deepseekCompletion({ endpoint }))).rejects.toThrow('bad');
	});
});
