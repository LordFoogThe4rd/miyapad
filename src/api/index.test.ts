import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE, API_DEEPSEEK } from '../constants';

const { llamacpp, koboldcpp, openai, aihorde, deepseek } = vi.hoisted(() => ({
	llamacpp: { llamaCppTokenCount: vi.fn(), llamaCppTokenize: vi.fn(), llamaCppCompletion: vi.fn() },
	koboldcpp: { koboldCppTokenCount: vi.fn(), koboldCppTokenize: vi.fn(), koboldCppCompletion: vi.fn(), koboldCppAbortCompletion: vi.fn() },
	openai: {
		openaiAphroditeTokenCount: vi.fn(), openaiOobaTokenCount: vi.fn(), openaiTabbyTokenCount: vi.fn(),
		openaiOobaTokenize: vi.fn(), openaiTabbyTokenize: vi.fn(), openaiModels: vi.fn(),
		openaiCompletion: vi.fn(), openaiChatCompletion: vi.fn(), openaiOobaAbortCompletion: vi.fn(),
	},
	aihorde: { aiHordeModels: vi.fn(), aiHordeCompletion: vi.fn(), aiHordeAbortCompletion: vi.fn() },
	deepseek: { deepseekModels: vi.fn(), deepseekCompletion: vi.fn(), deepseekChatCompletion: vi.fn(), deepseekAbortCompletion: vi.fn() },
}));

vi.mock('./llamacpp', () => llamacpp);
vi.mock('./koboldcpp', () => koboldcpp);
vi.mock('./openai', () => openai);
vi.mock('./aihorde', () => aihorde);
vi.mock('./deepseek', () => deepseek);

const { getModels, getTokens, serverDetokenize } = await import('./index');

const fetchMock = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('getModels', () => {
	it('dispatches an OpenAI-compatible endpoint to openaiModels', async () => {
		openai.openaiModels.mockResolvedValue(['a', 'b']);

		await expect(getModels({ endpoint: 'http://localhost:5000/v1', endpointAPI: API_OPENAI_COMPAT })).resolves.toEqual(['a', 'b']);
		expect(deepseek.deepseekModels).not.toHaveBeenCalled();
	});

	it('normalizes the endpoint before handing it to the provider', async () => {
		openai.openaiModels.mockResolvedValue([]);

		await getModels({ endpoint: 'http://localhost:5000/v1/', endpointAPI: API_OPENAI_COMPAT });

		expect(openai.openaiModels).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'http://localhost:5000' }));
	});

	it('dispatches DeepSeek to deepseekModels rather than the OpenAI one', async () => {
		deepseek.deepseekModels.mockResolvedValue(['deepseek-chat']);

		await expect(getModels({ endpoint: 'https://api.deepseek.com/v1', endpointAPI: API_DEEPSEEK })).resolves.toEqual(['deepseek-chat']);
		expect(openai.openaiModels).not.toHaveBeenCalled();
	});

	it('dispatches AI Horde to aiHordeModels with the hardcoded Horde endpoint', async () => {
		aihorde.aiHordeModels.mockResolvedValue(['koboldcpp/x']);

		await expect(getModels({ endpoint: 'http://ignored.local', endpointAPI: API_AI_HORDE })).resolves.toEqual(['koboldcpp/x']);
		expect(aihorde.aiHordeModels).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://aihorde.net/api' }));
	});

	it('forwards the API key, proxy endpoint and signal', async () => {
		openai.openaiModels.mockResolvedValue([]);
		const ac = new AbortController();

		await getModels({
			endpoint: 'http://localhost:5000',
			endpointAPI: API_OPENAI_COMPAT,
			endpointAPIKey: 'sk-abc',
			proxyEndpoint: 'http://proxy.local',
			signal: ac.signal,
		});

		expect(openai.openaiModels).toHaveBeenCalledWith(expect.objectContaining({
			endpointAPIKey: 'sk-abc',
			proxyEndpoint: 'http://proxy.local',
			signal: ac.signal,
		}));
	});

	it('returns an empty list for APIs with no model listing', async () => {
		await expect(getModels({ endpoint: 'http://localhost:8080', endpointAPI: API_LLAMA_CPP })).resolves.toEqual([]);
		await expect(getModels({ endpoint: 'http://localhost:5001', endpointAPI: API_KOBOLD_CPP })).resolves.toEqual([]);
	});
});

describe('getTokens', () => {
	const content = 'test string';

	it('dispatches llama.cpp to llamaCppTokenize', async () => {
		llamacpp.llamaCppTokenize.mockResolvedValue({ ids: [9288, 4731], str: ['test', ' string'] });

		await expect(getTokens({ endpoint: 'http://localhost:8080/', endpointAPI: API_LLAMA_CPP, content }))
			.resolves.toEqual({ ids: [9288, 4731], str: ['test', ' string'] });
		expect(llamacpp.llamaCppTokenize).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'http://localhost:8080', content }));
	});

	it('dispatches koboldcpp to koboldCppTokenize with the /api suffix stripped', async () => {
		koboldcpp.koboldCppTokenize.mockResolvedValue({ ids: [1], str: ['x'] });

		await getTokens({ endpoint: 'http://localhost:5001/api', endpointAPI: API_KOBOLD_CPP, content });

		expect(koboldcpp.koboldCppTokenize).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'http://localhost:5001' }));
	});

	it('tries Ooba first for an OpenAI-compatible endpoint and stops when it answers', async () => {
		openai.openaiOobaTokenize.mockResolvedValue({ ids: [5], str: ['x'] });

		await expect(getTokens({ endpoint: 'http://localhost:5000', endpointAPI: API_OPENAI_COMPAT, content }))
			.resolves.toEqual({ ids: [5], str: ['x'] });
		expect(openai.openaiTabbyTokenize).not.toHaveBeenCalled();
	});

	it('falls back to Tabby when Ooba returns null', async () => {
		openai.openaiOobaTokenize.mockResolvedValue(null);
		openai.openaiTabbyTokenize.mockResolvedValue({ ids: [7], str: ['y'] });

		await expect(getTokens({ endpoint: 'http://localhost:5000', endpointAPI: API_OPENAI_COMPAT, content }))
			.resolves.toEqual({ ids: [7], str: ['y'] });
	});

	it('returns an empty list when neither Ooba nor Tabby can tokenize', async () => {
		openai.openaiOobaTokenize.mockResolvedValue(null);
		openai.openaiTabbyTokenize.mockResolvedValue(null);

		await expect(getTokens({ endpoint: 'http://localhost:5000', endpointAPI: API_OPENAI_COMPAT, content })).resolves.toEqual([]);
	});

	it('short-circuits hosted OpenAI and TogetherAI without any request', async () => {
		await expect(getTokens({ endpoint: 'https://api.openai.com/v1', endpointAPI: API_OPENAI_COMPAT, content })).resolves.toEqual([]);
		await expect(getTokens({ endpoint: 'https://api.together.xyz/v1', endpointAPI: API_OPENAI_COMPAT, content })).resolves.toEqual([]);
		expect(openai.openaiOobaTokenize).not.toHaveBeenCalled();
		expect(openai.openaiTabbyTokenize).not.toHaveBeenCalled();
	});

	it('does not short-circuit a DeepSeek endpoint on the OpenAI host check', async () => {
		openai.openaiOobaTokenize.mockResolvedValue({ ids: [1], str: ['a'] });

		await expect(getTokens({ endpoint: 'https://api.deepseek.com', endpointAPI: API_DEEPSEEK, content }))
			.resolves.toEqual({ ids: [1], str: ['a'] });
	});

	it('returns an empty list for AI Horde', async () => {
		await expect(getTokens({ endpoint: 'http://localhost:5000', endpointAPI: API_AI_HORDE, content })).resolves.toEqual([]);
	});
});

describe('serverDetokenize', () => {
	function ok(body: unknown) {
		return { ok: true, status: 200, json: async () => body };
	}

	it('posts the token ids to /api/v1/detokenize and returns the content', async () => {
		fetchMock.mockResolvedValue(ok({ content: 'test string' }));
		const ac = new AbortController();

		const content = await serverDetokenize({
			sessionEndpoint: 'http://localhost:3000',
			signal: ac.signal,
			tokens: [9288, 4731],
		});

		expect(content).toBe('test string');
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe('http://localhost:3000/api/v1/detokenize');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
		expect(JSON.parse(init.body)).toEqual({ tokens: [9288, 4731] });
		expect(init.signal).toBe(ac.signal);
	});

	it('sends an empty token array as-is', async () => {
		fetchMock.mockResolvedValue(ok({ content: '' }));

		await expect(serverDetokenize({
			sessionEndpoint: 'http://localhost:3000',
			signal: new AbortController().signal,
			tokens: [],
		})).resolves.toBe('');
		expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ tokens: [] });
	});

	it('throws with the status on a non-OK response', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

		await expect(serverDetokenize({
			sessionEndpoint: 'http://localhost:3000',
			signal: new AbortController().signal,
			tokens: [1],
		})).rejects.toThrow('HTTP 500');
	});

	it('propagates an abort', async () => {
		fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

		await expect(serverDetokenize({
			sessionEndpoint: 'http://localhost:3000',
			signal: new AbortController().signal,
			tokens: [1],
		})).rejects.toThrow('aborted');
	});
});
