import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { llamaCppTokenCount, llamaCppTokenize, llamaCppCompletion } from './llamacpp';
import { ok, notOk, sse, collect, callOf } from './testing';

const fetchMock = vi.fn();
const endpoint = 'http://localhost:8080';

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('llamaCppTokenCount', () => {
	it('posts the content to /tokenize and counts one more token for BOS', async () => {
		fetchMock.mockResolvedValue(ok({ tokens: [1, 2, 3] }));

		await expect(llamaCppTokenCount({ endpoint, content: 'abc' })).resolves.toBe(4);

		const { url, body } = callOf(fetchMock);
		expect(url).toBe(`${endpoint}/tokenize`);
		expect(body).toEqual({ content: 'abc' });
	});

	it('routes through the proxy and moves the key and target URL to X-Real-* headers', async () => {
		fetchMock.mockResolvedValue(ok({ tokens: [] }));

		await llamaCppTokenCount({ endpoint, endpointAPIKey: 'k', proxyEndpoint: 'http://proxy.local', content: '' });

		const { url, init } = callOf(fetchMock);
		expect(url).toBe('http://proxy.local/tokenize');
		expect(init.headers['X-Real-Authorization']).toBe('Bearer k');
		expect(init.headers['X-Real-URL']).toBe(endpoint);
		expect(init.headers['Authorization']).toBeUndefined();
	});

	it('throws on a non-OK response', async () => {
		fetchMock.mockResolvedValue(notOk(500));

		await expect(llamaCppTokenCount({ endpoint, content: '' })).rejects.toThrow('HTTP 500');
	});
});

describe('llamaCppTokenize', () => {
	it('detokenizes each id on its own, keeping the order', async () => {
		fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
			if (url.endsWith('/tokenize')) return ok({ tokens: [10, 20] });
			const [id] = JSON.parse(String(init.body)).tokens;
			return ok({ content: id === 10 ? 'Hel' : 'lo' });
		});

		await expect(llamaCppTokenize({ endpoint, endpointAPIKey: 'k', content: 'Hello' }))
			.resolves.toEqual({ ids: [10, 20], str: ['Hel', 'lo'] });
		expect(callOf(fetchMock, 1).init.headers['Authorization']).toBe('Bearer k');
	});

	it('throws when a detokenize request fails', async () => {
		fetchMock.mockImplementation(async (url: string) => url.endsWith('/tokenize') ? ok({ tokens: [1] }) : notOk(404));

		await expect(llamaCppTokenize({ endpoint, content: 'x' })).rejects.toThrow('HTTP 404');
	});
});

describe('llamaCppCompletion', () => {
	it('posts the options to /completion with the prompt cache on', async () => {
		fetchMock.mockResolvedValue(ok({ content: 'Hi' }));

		await collect(llamaCppCompletion({ endpoint, prompt: 'Say hi', n_predict: 8 }));

		const { url, body } = callOf(fetchMock);
		expect(url).toBe(`${endpoint}/completion`);
		expect(body).toEqual({ prompt: 'Say hi', n_predict: 8, cache_prompt: true });
	});

	it('yields a whole non-streamed completion as one chunk', async () => {
		fetchMock.mockResolvedValue(ok({ content: 'Hi there' }));

		await expect(collect(llamaCppCompletion({ endpoint }))).resolves.toEqual([{ content: 'Hi there' }]);
	});

	it('yields nothing for an empty non-streamed completion', async () => {
		fetchMock.mockResolvedValue(ok({ content: '' }));

		await expect(collect(llamaCppCompletion({ endpoint }))).resolves.toEqual([]);
	});

	it('splits a non-streamed completion into tokens when it carries probabilities', async () => {
		fetchMock.mockResolvedValue(ok({
			content: 'ab',
			completion_probabilities: [
				{ content: 'a', top_logprobs: [{ token: 'a', logprob: Math.log(0.75) }, { token: 'b', logprob: Math.log(0.25) }] },
				{ content: 'b', top_logprobs: [{ token: 'b', logprob: Math.log(0.5) }] },
			],
		}));

		const chunks = await collect(llamaCppCompletion({ endpoint }));

		expect(chunks.map(c => c.content)).toEqual(['a', 'b']);
		expect(chunks[0].prob).toBeCloseTo(0.75);
		expect(chunks[0].completion_probabilities![0].probs.map(p => p.tok_str)).toEqual(['a', 'b']);
		expect(chunks[1].prob).toBeCloseTo(0.5);
	});

	it('streams tokens and reads post-sampling probabilities as given', async () => {
		fetchMock.mockResolvedValue(sse(
			{ content: 'He', completion_probabilities: [{ top_probs: [{ token: 'He', prob: 0.6 }, { token: 'Ha', prob: 0.4 }] }] },
			{ content: 'llo', completion_probabilities: [{ top_probs: [{ token: 'llo', prob: 0.9 }] }] },
			{ content: '', stop: true },
		));

		const chunks = await collect(llamaCppCompletion({ endpoint, stream: true }));

		expect(chunks).toEqual([
			{ content: 'He', prob: 0.6, completion_probabilities: [{ content: 'He', probs: [{ tok_str: 'He', prob: 0.6 }, { tok_str: 'Ha', prob: 0.4 }] }] },
			{ content: 'llo', prob: 0.9, completion_probabilities: [{ content: 'llo', probs: [{ tok_str: 'llo', prob: 0.9 }] }] },
		]);
	});

	it('reads pre-sampling probabilities from the older probs shape', async () => {
		fetchMock.mockResolvedValue(sse(
			{ content: 'x', completion_probabilities: [{ probs: [{ tok_str: 'x', prob: 0.8 }, { tok_str: 'y', prob: 0.2 }] }] },
		));

		const [chunk] = await collect(llamaCppCompletion({ endpoint, stream: true }));

		expect(chunk.prob).toBeCloseTo(0.8);
		expect(chunk.completion_probabilities![0].probs).toHaveLength(2);
	});

	it('marks a chosen token missing from the probabilities with -1', async () => {
		fetchMock.mockResolvedValue(sse(
			{ content: 'z', completion_probabilities: [{ top_probs: [{ token: 'x', prob: 1 }] }] },
		));

		const [chunk] = await collect(llamaCppCompletion({ endpoint, stream: true }));

		expect(chunk.prob).toBe(-1);
	});

	it('leaves the probabilities off a streamed token that has none', async () => {
		fetchMock.mockResolvedValue(sse({ content: 'plain' }));

		await expect(collect(llamaCppCompletion({ endpoint, stream: true }))).resolves.toEqual([{ content: 'plain' }]);
	});

	it('throws on a non-OK response', async () => {
		fetchMock.mockResolvedValue(notOk(503));

		await expect(collect(llamaCppCompletion({ endpoint }))).rejects.toThrow('HTTP 503');
	});
});
