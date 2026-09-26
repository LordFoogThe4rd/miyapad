import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { koboldCppConvertOptions, koboldCppTokenCount, koboldCppTokenize, koboldCppCompletion, koboldCppAbortCompletion } from './koboldcpp';
import { ok, notOk, sse, collect, callOf } from './testing';

const LOCAL = 'http://localhost:5001';
const HORDE = 'https://aihorde.net/api';

describe('koboldCppConvertOptions', () => {
	it('renames llama.cpp sampler keys to their Kobold equivalents', () => {
		const out = koboldCppConvertOptions({
			n_ctx: 4096,
			n_predict: 256,
			n_probs: 10,
			repeat_penalty: 1.1,
			repeat_last_n: 320,
			tfs_z: 0.95,
			typical_p: 0.9,
			seed: 42,
			stop: ['\n'],
			ignore_eos: true,
		}, LOCAL);

		expect(out).toEqual({
			max_context_length: 4096,
			max_length: 256,
			logprobs: 10,
			rep_pen: 1.1,
			rep_pen_range: 320,
			tfs: 0.95,
			typical: 0.9,
			sampler_seed: 42,
			stop_sequence: ['\n'],
			use_default_badwordsids: true,
		});
	});

	it('leaves keys that have no Kobold alias alone', () => {
		expect(koboldCppConvertOptions({ temperature: 0.7, top_p: 0.95, prompt: 'hi', n_predict: 64 }, LOCAL))
			.toEqual({ temperature: 0.7, top_p: 0.95, prompt: 'hi', max_length: 64 });
	});

	it('only renames a key that is present, rather than inventing it', () => {
		const out = koboldCppConvertOptions({ n_predict: 64 }, LOCAL);
		expect(Object.hasOwn(out, 'max_context_length')).toBe(false);
		expect(Object.hasOwn(out, 'rep_pen')).toBe(false);
	});

	it('defaults an absent token budget to 1024 for a local endpoint', () => {
		expect(koboldCppConvertOptions({}, LOCAL).max_length).toBe(1024);
	});

	it('defaults an absent token budget to 512 for the horde', () => {
		expect(koboldCppConvertOptions({}, HORDE).max_length).toBe(512);
	});

	it('treats an unlimited (-1) token budget as the endpoint default', () => {
		expect(koboldCppConvertOptions({ n_predict: -1 }, LOCAL).max_length).toBe(1024);
		expect(koboldCppConvertOptions({ n_predict: -1 }, HORDE).max_length).toBe(512);
	});

	it('raises a horde request below the 16 token floor', () => {
		expect(koboldCppConvertOptions({ n_predict: 8 }, HORDE).max_length).toBe(16);
		expect(koboldCppConvertOptions({ n_predict: 0 }, HORDE).max_length).toBe(16);
	});

	it('leaves a small token budget alone for a local endpoint', () => {
		expect(koboldCppConvertOptions({ n_predict: 8 }, LOCAL).max_length).toBe(8);
	});

	it('applies the horde rules to horde subdomains too', () => {
		expect(koboldCppConvertOptions({ n_predict: 8 }, 'https://stablehorde.aihorde.net/api').max_length).toBe(16);
	});

	it('does not mistake a lookalike host for the horde', () => {
		expect(koboldCppConvertOptions({ n_predict: 8 }, 'https://notaihorde.net/api').max_length).toBe(8);
		expect(koboldCppConvertOptions({}, 'https://aihorde.net.example.com').max_length).toBe(1024);
	});

	it('falls back to the local defaults when the endpoint is not a valid URL', () => {
		expect(koboldCppConvertOptions({}, 'not a url').max_length).toBe(1024);
	});

	it('mutates and returns the options object it was given', () => {
		const options = { n_ctx: 2048, n_predict: 64 };
		const out = koboldCppConvertOptions(options, LOCAL);
		expect(out).toBe(options);
		expect(Object.hasOwn(options, 'n_ctx')).toBe(false);
	});
});

describe('koboldcpp requests', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('reportError', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('counts tokens with /api/extra/tokencount', async () => {
		fetchMock.mockResolvedValue(ok({ value: 7, ids: [] }));

		await expect(koboldCppTokenCount({ endpoint: LOCAL, content: 'hello' })).resolves.toBe(7);
		expect(callOf(fetchMock).url).toBe(`${LOCAL}/api/extra/tokencount`);
		expect(callOf(fetchMock).body).toEqual({ prompt: 'hello' });
	});

	it('drops the token kobold adds in front when tokenizing', async () => {
		fetchMock.mockResolvedValue(ok({ value: 3, ids: [1, 15, 16] }));

		await expect(koboldCppTokenize({ endpoint: LOCAL, content: 'hi' })).resolves.toEqual({ ids: [15, 16], str: '' });
	});

	it('routes a token count through the proxy with X-Real-* headers', async () => {
		fetchMock.mockResolvedValue(ok({ value: 0 }));

		await koboldCppTokenCount({ endpoint: LOCAL, endpointAPIKey: 'k', proxyEndpoint: 'http://proxy.local', content: '' });

		const { url, init } = callOf(fetchMock);
		expect(url).toBe('http://proxy.local/api/extra/tokencount');
		expect(init.headers['X-Real-Authorization']).toBe('Bearer k');
		expect(init.headers['X-Real-URL']).toBe(LOCAL);
	});

	it('throws when a token count fails', async () => {
		fetchMock.mockResolvedValue(notOk(500));

		await expect(koboldCppTokenCount({ endpoint: LOCAL, content: '' })).rejects.toThrow('HTTP 500');
		await expect(koboldCppTokenize({ endpoint: LOCAL, content: '' })).rejects.toThrow('HTTP 500');
	});

	it('generates with /api/v1/generate and the options renamed', async () => {
		fetchMock.mockResolvedValue(ok({ results: [{ text: 'Once upon' }] }));

		await expect(collect(koboldCppCompletion({ endpoint: LOCAL, prompt: 'Tell', n_predict: 32 })))
			.resolves.toEqual([{ content: 'Once upon' }]);

		const { url, body } = callOf(fetchMock);
		expect(url).toBe(`${LOCAL}/api/v1/generate`);
		expect(body).toEqual({ prompt: 'Tell', max_length: 32 });
	});

	it('splits a non-streamed result into tokens when it carries probabilities', async () => {
		fetchMock.mockResolvedValue(ok({ results: [{ text: 'ab', logprobs: { content: [
			{ token: 'a', top_logprobs: [{ token: 'a', logprob: Math.log(0.5) }] },
			{ token: 'b', top_logprobs: [] },
		] } }] }));

		const chunks = await collect(koboldCppCompletion({ endpoint: LOCAL }));

		expect(chunks.map(c => c.content)).toEqual(['a', 'b']);
		expect(chunks[0].prob).toBeCloseTo(0.5);
		expect(chunks[1]).toEqual({ content: 'b' });
	});

	it('yields nothing for an empty result', async () => {
		fetchMock.mockResolvedValue(ok({ results: [{ text: '' }] }));

		await expect(collect(koboldCppCompletion({ endpoint: LOCAL }))).resolves.toEqual([]);
	});

	it('streams tokens from /api/extra/generate/stream', async () => {
		fetchMock.mockResolvedValue(sse(
			{ token: 'He', top_logprobs: [{ token: 'He', logprob: 0 }] },
			{ token: 'y' },
		));

		const chunks = await collect(koboldCppCompletion({ endpoint: LOCAL, stream: true }));

		expect(callOf(fetchMock).url).toBe(`${LOCAL}/api/extra/generate/stream`);
		expect(chunks.map(c => c.content)).toEqual(['He', 'y']);
		expect(chunks[0].prob).toBe(1);
	});

	it('throws on a non-OK generate response', async () => {
		fetchMock.mockResolvedValue(notOk(503));

		await expect(collect(koboldCppCompletion({ endpoint: LOCAL }))).rejects.toThrow('HTTP 503');
	});

	it('aborts with /api/extra/abort, through the proxy when there is one', async () => {
		fetchMock.mockResolvedValue(ok({}));

		await koboldCppAbortCompletion({ endpoint: LOCAL, proxyEndpoint: 'http://proxy.local' });

		const { url, init } = callOf(fetchMock);
		expect(url).toBe('http://proxy.local/api/extra/abort');
		expect(init.method).toBe('POST');
		expect(init.headers['X-Real-URL']).toBe(LOCAL);
	});

	it('reports a failed abort instead of throwing', async () => {
		const error = new TypeError('network down');
		fetchMock.mockRejectedValue(error);

		await expect(koboldCppAbortCompletion({ endpoint: LOCAL })).resolves.toBeUndefined();
		expect(reportError).toHaveBeenCalledWith(error);
	});
});
