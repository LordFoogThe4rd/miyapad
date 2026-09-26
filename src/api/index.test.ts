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

const { getModels, getTokens, getTokenCount, completion, chatCompletion, abortCompletion, serverTokenCount, serverTokenize, serverDetokenize, getServerTokenizers, loadServerTokenizer } = await import('./index');
const { ok, notOk, collect, callOf } = await import('./testing');

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

describe('server tokenizer', () => {
	const sessionEndpoint = 'http://localhost:3000';
	const signal = new AbortController().signal;

	it('counts tokens with /api/v1/token-count', async () => {
		fetchMock.mockResolvedValue(ok({ count: 12 }));

		await expect(serverTokenCount({ sessionEndpoint, signal, content: 'abc' })).resolves.toBe(12);
		expect(callOf(fetchMock).url).toBe(`${sessionEndpoint}/api/v1/token-count`);
		expect(callOf(fetchMock).body).toEqual({ content: 'abc' });
	});

	it('throws the error the server reports with an OK status', async () => {
		fetchMock.mockResolvedValue(ok({ error: 'No tokenizer loaded' }));

		await expect(serverTokenCount({ sessionEndpoint, signal, content: '' })).rejects.toThrow('No tokenizer loaded');
	});

	it('tokenizes into ids and their strings', async () => {
		fetchMock.mockResolvedValue(ok({ ids: [1, 2], strings: ['a', 'b'] }));

		await expect(serverTokenize({ sessionEndpoint, signal, content: 'ab' })).resolves.toEqual({ ids: [1, 2], str: ['a', 'b'] });
	});

	it('lists the tokenizers and loads one', async () => {
		fetchMock.mockResolvedValueOnce(ok({ available: ['llama3'], loaded: null }));
		await expect(getServerTokenizers({ sessionEndpoint })).resolves.toEqual({ available: ['llama3'], loaded: null });
		expect(callOf(fetchMock).url).toBe(`${sessionEndpoint}/api/v1/tokenizers`);

		fetchMock.mockResolvedValueOnce(ok({ loaded: 'llama3' }));
		await expect(loadServerTokenizer({ sessionEndpoint, model: 'llama3' })).resolves.toEqual({ loaded: 'llama3' });
		expect(callOf(fetchMock).body).toEqual({ model: 'llama3' });
	});

	it('throws with the status when a request fails', async () => {
		fetchMock.mockResolvedValue(notOk(500));

		await expect(serverTokenCount({ sessionEndpoint, signal, content: '' })).rejects.toThrow('HTTP 500');
		await expect(serverTokenize({ sessionEndpoint, signal, content: '' })).rejects.toThrow('HTTP 500');
		await expect(getServerTokenizers({ sessionEndpoint })).rejects.toThrow('HTTP 500');
		await expect(loadServerTokenizer({ sessionEndpoint, model: 'x' })).rejects.toThrow('HTTP 500');
	});
});

describe('getTokenCount', () => {
	const local = 'http://localhost:5000';

	it('asks llama.cpp and koboldcpp directly', async () => {
		llamacpp.llamaCppTokenCount.mockResolvedValue(5);
		koboldcpp.koboldCppTokenCount.mockResolvedValue(6);

		await expect(getTokenCount({ endpoint: local, endpointAPI: API_LLAMA_CPP, content: 'x' })).resolves.toBe(5);
		await expect(getTokenCount({ endpoint: `${local}/api`, endpointAPI: API_KOBOLD_CPP, content: 'x' })).resolves.toBe(6);
		expect(koboldcpp.koboldCppTokenCount).toHaveBeenCalledWith(expect.objectContaining({ endpoint: local }));
	});

	it('tries Aphrodite, then Ooba, then Tabby, stopping at the first that answers', async () => {
		openai.openaiAphroditeTokenCount.mockResolvedValue(-1);
		openai.openaiOobaTokenCount.mockResolvedValue(9);

		await expect(getTokenCount({ endpoint: local, endpointAPI: API_OPENAI_COMPAT, content: 'x' })).resolves.toBe(9);
		expect(openai.openaiTabbyTokenCount).not.toHaveBeenCalled();
	});

	it('counts zero when none of them can', async () => {
		openai.openaiAphroditeTokenCount.mockResolvedValue(-1);
		openai.openaiOobaTokenCount.mockResolvedValue(-1);
		openai.openaiTabbyTokenCount.mockResolvedValue(-1);

		await expect(getTokenCount({ endpoint: local, endpointAPI: API_DEEPSEEK, content: 'x' })).resolves.toBe(0);
		expect(openai.openaiTabbyTokenCount).toHaveBeenCalledOnce();
	});

	it('does not ask hosted OpenAI or TogetherAI, which have no count endpoint', async () => {
		await expect(getTokenCount({ endpoint: 'https://api.openai.com/v1', endpointAPI: API_OPENAI_COMPAT, content: 'x' })).resolves.toBe(0);
		await expect(getTokenCount({ endpoint: 'https://api.together.xyz/v1', endpointAPI: API_OPENAI_COMPAT, content: 'x' })).resolves.toBe(0);
		expect(openai.openaiAphroditeTokenCount).not.toHaveBeenCalled();
	});

	it('counts zero for AI Horde', async () => {
		await expect(getTokenCount({ endpoint: local, endpointAPI: API_AI_HORDE, content: 'x' })).resolves.toBe(0);
	});
});

describe('completion routing', () => {
	async function* chunks(...contents: string[]) {
		for (const content of contents) yield { content };
	}

	it.each([
		[API_LLAMA_CPP, () => llamacpp.llamaCppCompletion],
		[API_KOBOLD_CPP, () => koboldcpp.koboldCppCompletion],
		[API_OPENAI_COMPAT, () => openai.openaiCompletion],
		[API_DEEPSEEK, () => deepseek.deepseekCompletion],
		[API_AI_HORDE, () => aihorde.aiHordeCompletion],
	])('hands API %s to its own completion and passes its chunks on', async (endpointAPI, provider) => {
		provider().mockImplementation(() => chunks('a', 'b'));

		const out = await collect(completion({ endpoint: 'http://localhost:5000', endpointAPI, prompt: 'p' }));

		expect(out).toEqual([{ content: 'a' }, { content: 'b' }]);
		expect(provider()).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'p' }));
	});

	it('sends chat to DeepSeek or the OpenAI one, and nowhere else', async () => {
		deepseek.deepseekChatCompletion.mockImplementation(() => chunks('d'));
		openai.openaiChatCompletion.mockImplementation(() => chunks('o'));

		await expect(collect(chatCompletion({ endpoint: 'https://api.deepseek.com', endpointAPI: API_DEEPSEEK }))).resolves.toEqual([{ content: 'd' }]);
		await expect(collect(chatCompletion({ endpoint: 'http://localhost:5000', endpointAPI: API_OPENAI_COMPAT }))).resolves.toEqual([{ content: 'o' }]);
		await expect(collect(chatCompletion({ endpoint: 'http://localhost:8080', endpointAPI: API_LLAMA_CPP }))).resolves.toEqual([]);
	});

	it('aborts through the provider that can stop a generation', async () => {
		await abortCompletion({ endpoint: 'http://localhost:5001/api', endpointAPI: API_KOBOLD_CPP });
		expect(koboldcpp.koboldCppAbortCompletion).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'http://localhost:5001' }));

		await abortCompletion({ endpoint: 'http://localhost:5000', endpointAPI: API_OPENAI_COMPAT });
		expect(openai.openaiOobaAbortCompletion).toHaveBeenCalledOnce();

		await abortCompletion({ endpoint: 'https://api.deepseek.com', endpointAPI: API_DEEPSEEK });
		expect(deepseek.deepseekAbortCompletion).toHaveBeenCalledOnce();

		await abortCompletion({ endpoint: 'http://ignored.local', endpointAPI: API_AI_HORDE, hordeTaskId: 't' } as ApiEndpointConfig);
		expect(aihorde.aiHordeAbortCompletion).toHaveBeenCalledWith(expect.objectContaining({ hordeTaskId: 't' }));
	});
});
