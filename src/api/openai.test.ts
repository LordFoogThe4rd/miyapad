import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openaiAphroditeTokenCount, openaiOobaTokenCount, openaiTabbyTokenCount, openaiModels, openaiOobaTokenize, openaiTabbyTokenize, openaiCompletion, openaiChatCompletion, openaiOobaAbortCompletion } from './openai';
import { sse, collect, callOf } from './testing';

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

describe('openaiTabbyTokenCount request', () => {
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
});

// All three counters hand their parsed body to the same tokenCountFrom helper,
// so every case below has to hold for each of them.
const tokenCounters: [string, (params: TokenCounterParams) => Promise<number>][] = [
	['openaiAphroditeTokenCount', openaiAphroditeTokenCount],
	['openaiOobaTokenCount', openaiOobaTokenCount],
	['openaiTabbyTokenCount', openaiTabbyTokenCount],
];

describe.each(tokenCounters)('%s response handling', (_name, tokenCount) => {
	const params: TokenCounterParams = { endpoint: 'http://localhost:5000', content: 'x' };

	it('returns the length of an array of token ids', async () => {
		fetchMock.mockResolvedValue(ok([1, 2, 3, 4]));

		await expect(tokenCount(params)).resolves.toBe(4);
	});

	it('accepts an object carrying a numeric length', async () => {
		fetchMock.mockResolvedValue(ok({ length: 12, tokens: [1, 2] }));

		await expect(tokenCount(params)).resolves.toBe(12);
	});

	it('accepts a zero-length result', async () => {
		fetchMock.mockResolvedValue(ok([]));

		await expect(tokenCount({ ...params, content: '' })).resolves.toBe(0);
	});

	it('returns -1 on a non-OK response instead of throwing', async () => {
		fetchMock.mockResolvedValue(notOk(404));

		await expect(tokenCount(params)).resolves.toBe(-1);
	});

	it('returns -1 when the request itself rejects', async () => {
		fetchMock.mockRejectedValue(new TypeError('network down'));

		await expect(tokenCount(params)).resolves.toBe(-1);
	});

	it('returns -1 when an OK response carries no length', async () => {
		fetchMock.mockResolvedValue(ok({ detail: 'not found' }));

		await expect(tokenCount(params)).resolves.toBe(-1);
	});

	it('returns -1 for a null body', async () => {
		fetchMock.mockResolvedValue(ok(null));

		await expect(tokenCount(params)).resolves.toBe(-1);
	});

	it('returns -1 for a count that is not a non-negative whole number', async () => {
		// getTokenCount screens only for exactly -1, so anything unusable has to
		// become the sentinel here.
		for (const length of [-5, -1, 2.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			fetchMock.mockResolvedValue(ok({ length }));

			await expect(tokenCount(params)).resolves.toBe(-1);
		}
	});

	it('returns -1 for a non-numeric length', async () => {
		for (const length of ['12', true, null, {}]) {
			fetchMock.mockResolvedValue(ok({ length }));

			await expect(tokenCount(params)).resolves.toBe(-1);
		}
	});

	it('returns -1 for a primitive body rather than reading its character count', async () => {
		// A bare JSON string has a `.length`, and it is a perfectly plausible
		// non-negative integer — it is just not a token count.
		for (const body of ['some error text', '', 42, true]) {
			fetchMock.mockResolvedValue(ok(body));

			await expect(tokenCount(params)).resolves.toBe(-1);
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

describe.each([
	['openaiOobaTokenize', openaiOobaTokenize, '/v1/internal/encode', '/v1/internal/decode'],
	['openaiTabbyTokenize', openaiTabbyTokenize, '/v1/token/encode', '/v1/token/decode'],
] as const)('%s', (_name, tokenize, encodePath, decodePath) => {
	const endpoint = 'http://localhost:5000';

	beforeEach(() => {
		vi.stubGlobal('reportError', vi.fn());
	});

	it('encodes, then decodes each id on its own', async () => {
		fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
			if (url.endsWith(encodePath)) return ok({ tokens: [5, 6] });
			const [id] = JSON.parse(String(init.body)).tokens;
			return ok({ text: id === 5 ? 'Hel' : 'lo' });
		});

		await expect(tokenize({ endpoint, content: 'Hello' })).resolves.toEqual({ ids: [5, 6], str: ['Hel', 'lo'] });
		expect(callOf(fetchMock, 0).body).toEqual({ text: 'Hello' });
		expect(callOf(fetchMock, 1).url).toBe(`${endpoint}${decodePath}`);
	});

	it('returns null when the backend has no such endpoint, so the caller can try the next one', async () => {
		fetchMock.mockResolvedValue(notOk(404));

		await expect(tokenize({ endpoint, content: 'x' })).resolves.toBeNull();
	});

	it('keeps a null in place of a token that failed to decode', async () => {
		fetchMock.mockImplementation(async (url: string) => url.endsWith(encodePath) ? ok({ tokens: [1] }) : notOk(500));

		await expect(tokenize({ endpoint, content: 'x' })).resolves.toEqual({ ids: [1], str: [null] });
	});
});

describe('openaiCompletion', () => {
	const endpoint = 'http://localhost:5000';

	it('posts to /v1/completions with the options converted', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: 'Hi' }] }));

		await expect(collect(openaiCompletion({
			endpoint, endpointAPIKey: 'k', prompt: 'P', n_predict: -1, n_ctx: 4096, repeat_penalty: 1.1,
			repeat_last_n: 64, tfs_z: 1, mirostat: 0, ignore_eos: false, grammar: 'root ::= "a"', temperature: 0.7,
		}))).resolves.toEqual([{ content: 'Hi' }]);

		const { url, init, body } = callOf(fetchMock);
		expect(url).toBe(`${endpoint}/v1/completions`);
		expect(init.headers['Authorization']).toBe('Bearer k');
		expect(body).toEqual({
			prompt: 'P', temperature: 0.7, max_tokens: 1024, max_context_length: 4096, repetition_penalty: 1.1,
			repetition_penalty_range: 64, tfs: 1, mirostat_mode: 0, ban_eos_token: false, grammar_string: 'root ::= "a"',
		});
	});

	it('uses an endpoint that already ends in /completions as it is', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: 'x' }] }));

		await collect(openaiCompletion({ endpoint: 'https://host/custom/completions' }));

		expect(callOf(fetchMock).url).toBe('https://host/custom/completions');
	});

	it('goes through the proxy with the key and target in X-Real-* headers', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: 'x' }] }));

		await collect(openaiCompletion({ endpoint, endpointAPIKey: 'k', proxyEndpoint: 'http://proxy.local/proxy' }));

		const { url, init } = callOf(fetchMock);
		expect(url).toBe('http://proxy.local/proxy/v1/completions');
		expect(init.headers['X-Real-Authorization']).toBe('Bearer k');
		expect(init.headers['X-Real-URL']).toBe(endpoint);
	});

	it('asks for log probabilities by count, and drops a zero count', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: 'x' }] }));

		await collect(openaiCompletion({ endpoint, n_probs: 3 }));
		expect(callOf(fetchMock).body).toMatchObject({ logprobs: 3 });

		await collect(openaiCompletion({ endpoint, n_probs: 0 }));
		expect(callOf(fetchMock).body).not.toHaveProperty('logprobs');
		expect(callOf(fetchMock).body).not.toHaveProperty('n_probs');
	});

	it('caps log probabilities where the host has a limit', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: 'x' }] }));

		await collect(openaiCompletion({ endpoint: 'https://api.openai.com', n_probs: 10 }));
		expect(callOf(fetchMock).body.logprobs).toBe(5);

		await collect(openaiCompletion({ endpoint: 'https://api.together.xyz', n_probs: 10 }));
		expect(callOf(fetchMock).body.logprobs).toBe(1);
	});

	it('turns sampling off for a zero temperature, except on OpenAI', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: 'x' }] }));

		await collect(openaiCompletion({ endpoint, temperature: 0 }));
		expect(callOf(fetchMock).body.do_sample).toBe(false);

		await collect(openaiCompletion({ endpoint: 'https://api.openai.com', temperature: 0 }));
		expect(callOf(fetchMock).body).not.toHaveProperty('do_sample');
	});

	it('spreads a dynamic temperature range around the temperature, never below zero', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: 'x' }] }));

		await collect(openaiCompletion({ endpoint, temperature: 0.5, dynatemp_range: 0.8 }));

		expect(callOf(fetchMock).body).toMatchObject({ dynamic_temperature: true, dynatemp_low: 0, dynatemp_high: 1.3 });
	});

	it('keeps ignore_eos as it is for Fireworks', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: 'x' }] }));

		await collect(openaiCompletion({ endpoint: 'https://api.fireworks.ai', ignore_eos: true }));

		expect(callOf(fetchMock).body).toMatchObject({ ignore_eos: true });
	});

	it('throws the error message the server sent, or the status without one', async () => {
		fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: 'bad prompt' } }) });
		await expect(collect(openaiCompletion({ endpoint }))).rejects.toThrow('bad prompt');

		fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new SyntaxError(); } });
		await expect(collect(openaiCompletion({ endpoint }))).rejects.toThrow('HTTP 502');
	});

	it('splits a non-streamed completion into tokens when it carries log probabilities', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ text: 'ab', logprobs: {
			tokens: ['a', 'b'],
			top_logprobs: [{ a: Math.log(0.75), c: Math.log(0.25) }, { b: 0 }],
		} }] }));

		const chunks = await collect(openaiCompletion({ endpoint }));

		expect(chunks.map(c => c.content)).toEqual(['a', 'b']);
		expect(chunks[0].prob).toBeCloseTo(0.75);
		expect(chunks[1].prob).toBe(1);
	});

	it('reads the top-level content llama.cpp sends when there are no choices', async () => {
		fetchMock.mockResolvedValue(ok({ content: 'from llama' }));

		await expect(collect(openaiCompletion({ endpoint }))).resolves.toEqual([{ content: 'from llama' }]);
	});

	it('streams text, with probabilities in either shape', async () => {
		fetchMock.mockResolvedValue(sse(
			{ choices: [{ text: 'He', logprobs: { top_logprobs: [{ He: Math.log(0.5), Ha: Math.log(0.5) }] } }] },
			{ choices: [{ text: 'llo', logprobs: { content: [{ top_logprobs: [{ token: 'llo', logprob: 0 }] }] } }] },
			{ choices: [{ text: '' }] },
			{ choices: [{ text: '!' }] },
		));

		const chunks = await collect(openaiCompletion({ endpoint, stream: true }));

		expect(chunks.map(c => c.content)).toEqual(['He', 'llo', '!']);
		expect(chunks[0].prob).toBeCloseTo(0.5);
		expect(chunks[0].completion_probabilities![0].probs.map(p => p.tok_str)).toEqual(['He', 'Ha']);
		expect(chunks[1].prob).toBe(1);
		expect(chunks[2]).toEqual({ content: '!' });
	});

	it('passes on streamed content that arrives without choices', async () => {
		fetchMock.mockResolvedValue(sse({ content: 'raw' }, { choices: [] }));

		await expect(collect(openaiCompletion({ endpoint, stream: true }))).resolves.toEqual([{ content: 'raw' }]);
	});
});

describe('openaiChatCompletion', () => {
	const endpoint = 'http://localhost:5000';
	const messages = [{ role: 'user', content: 'hi' }];

	it('posts to /v1/chat/completions and asks for top log probabilities', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: 'Hello!' } }] }));

		await expect(collect(openaiChatCompletion({ endpoint, messages, n_probs: 4 })))
			.resolves.toEqual([{ content: 'Hello!' }]);

		const { url, body } = callOf(fetchMock);
		expect(url).toBe(`${endpoint}/v1/chat/completions`);
		expect(body).toMatchObject({ messages, logprobs: true, top_logprobs: 4 });
		expect(body).not.toHaveProperty('n_probs');
	});

	it('turns log probabilities off without a count', async () => {
		fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: 'x' } }] }));

		await collect(openaiChatCompletion({ endpoint }));

		expect(callOf(fetchMock).body).toMatchObject({ logprobs: false });
	});

	it('streams the delta content and skips empty deltas', async () => {
		fetchMock.mockResolvedValue(sse(
			{ choices: [{ delta: { role: 'assistant' } }] },
			{ choices: [{ delta: { content: 'Hel' }, logprobs: { content: [{ top_logprobs: [{ token: 'Hel', logprob: 0 }] }] } }] },
			{ choices: [{ delta: { content: 'lo' } }] },
			{ choices: [] },
		));

		const chunks = await collect(openaiChatCompletion({ endpoint, stream: true }));

		expect(chunks.map(c => c.content)).toEqual(['Hel', 'lo']);
		expect(chunks[0].prob).toBe(1);
		expect(chunks[1]).toEqual({ content: 'lo' });
	});

	it('rebuilds characters split across byte-escaped tokens in a non-streamed answer', async () => {
		// "é" is the two bytes C3 A9, which some backends return as one token each.
		fetchMock.mockResolvedValue(ok({ choices: [{ logprobs: { content: [
			{ token: 'caf', top_logprobs: [{ token: 'caf', logprob: 0 }] },
			{ token: '\\xc3', top_logprobs: [{ token: '\\xc3', logprob: 0 }] },
			{ token: '\\xa9', top_logprobs: [{ token: '\\xa9', logprob: 0 }] },
		] } }] }));

		const chunks = await collect(openaiChatCompletion({ endpoint }));

		expect(chunks.map(c => c.content).join('')).toBe('café');
	});

	it('throws the error message the server sent', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API key' } }) });

		await expect(collect(openaiChatCompletion({ endpoint }))).rejects.toThrow('Invalid API key');
	});
});

describe('openaiOobaAbortCompletion', () => {
	it('asks the backend to stop generating', async () => {
		fetchMock.mockResolvedValue(ok({}));

		await openaiOobaAbortCompletion({ endpoint: 'http://localhost:5000' });

		expect(callOf(fetchMock).url).toBe('http://localhost:5000/v1/internal/stop-generation');
	});

	it('ignores a backend that cannot be reached', async () => {
		fetchMock.mockRejectedValue(new TypeError('offline'));

		await expect(openaiOobaAbortCompletion({ endpoint: 'http://localhost:5000' })).resolves.toBeUndefined();
	});
});
