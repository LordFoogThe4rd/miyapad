import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_DEEPSEEK, API_LLAMA_CPP, API_OPENAI_COMPAT } from '../constants';
import { defaultPresets } from '../defaults/presets';
import { defaultTemplates } from '../defaults/templates';
import { createPluginGenerate } from './generate';
import type { SettingsState } from '../types/contexts';

const { api } = vi.hoisted(() => ({
	api: {
		completion: vi.fn(),
		chatCompletion: vi.fn(),
	},
}));

vi.mock('../api/index', () => api);

function yieldChunks(...chunks: (CompletionChunk | AIHordeChunk)[]) {
	return () => (async function* () { yield* chunks; })();
}

function makeSettings(overrides: Partial<SettingsState> = {}): SettingsState {
	return {
		endpoint: 'http://127.0.0.1:8080',
		endpointAPI: API_LLAMA_CPP,
		endpointAPIKey: 'active-key',
		endpointModel: 'active-model',
		useChatAPI: false,
		openaiPresets: false,
		postSamplingProbs: true,
		useTokenStreaming: true,
		disableLogprobs: false,
		templates: defaultTemplates,
		selectedTemplate: 'ChatML',
		seed: defaultPresets.seed,
		maxPredictTokens: 128,
		temperature: 0.7,
		dynaTempRange: defaultPresets.dynaTempRange,
		dynaTempExp: defaultPresets.dynaTempExp,
		repeatPenalty: defaultPresets.repeatPenalty,
		repeatLastN: defaultPresets.repeatLastN,
		penalizeNl: defaultPresets.penalizeNl,
		presencePenalty: defaultPresets.presencePenalty,
		frequencyPenalty: defaultPresets.frequencyPenalty,
		topK: defaultPresets.topK,
		topP: defaultPresets.topP,
		typicalP: defaultPresets.typicalP,
		minP: defaultPresets.minP,
		tfsZ: defaultPresets.tfsZ,
		mirostat: defaultPresets.mirostat,
		mirostatTau: defaultPresets.mirostatTau,
		mirostatEta: defaultPresets.mirostatEta,
		xtcThreshold: defaultPresets.xtcThreshold,
		xtcProbability: defaultPresets.xtcProbability,
		dryMultiplier: defaultPresets.dryMultiplier,
		dryBase: defaultPresets.dryBase,
		dryAllowedLength: defaultPresets.dryAllowedLength,
		dryPenaltyRange: defaultPresets.dryPenaltyRange,
		drySequenceBreakers: defaultPresets.drySequenceBreakers,
		bannedTokens: defaultPresets.bannedTokens,
		ignoreEos: defaultPresets.ignoreEos,
		enabledSamplers: ['temperature', 'top_p'],
		grammar: '',
		logitBias: { bias: {}, model: 'none' },
		useBasicStoppingMode: true,
		stoppingStrings: '[]',
		...overrides,
	} as unknown as SettingsState;
}

beforeEach(() => {
	api.completion.mockReset();
	api.chatCompletion.mockReset();
});

describe('createPluginGenerate (miyapad.generate)', () => {
	it('uses active settings and concatenates streamed chunks without touching UI state', async () => {
		const activeSettings = makeSettings();
		const sessionStorage = { proxyEndpoint: 'http://localhost:3000/proxy', addStats: vi.fn() };
		const generate = createPluginGenerate({
			getSettings: () => activeSettings,
			connectionStorage: { connections: {} },
			samplerPresetStorage: { presets: {} },
			sessionStorage,
			isMiyapadEndpoint: true,
		});

		api.completion.mockImplementation(yieldChunks({ content: 'Hello' }, { content: ' world' }, { content: '', stopping_word: '!' }));

		const reply = await generate({
			prompt: 'Greet me:',
			maxTokens: 64,
			temperature: 0.2,
			stop: ['\n'],
			params: { cache_prompt: false },
		});

		expect(reply).toBe('Hello world!');
		expect(api.completion).toHaveBeenCalledTimes(1);
		expect(api.completion.mock.calls[0][0]).toMatchObject({
			endpoint: 'http://127.0.0.1:8080',
			endpointAPI: API_LLAMA_CPP,
			prompt: 'Greet me:',
			n_predict: 64,
			temperature: 0.2,
			stop: ['\n'],
			n_probs: 0,
			proxyEndpoint: 'http://localhost:3000/proxy',
			cache_prompt: false,
		});
		expect(sessionStorage.addStats).not.toHaveBeenCalled();
	});

	it('applies overrides from connectionId and samplerPresetId, including Chat API mode', async () => {
		const activeSettings = makeSettings();
		const generate = createPluginGenerate({
			getSettings: () => activeSettings,
			connectionStorage: {
				connections: {
					'fast-chat': {
						id: 'fast-chat',
						name: 'Fast Chat',
						enabled: true,
						api: API_OPENAI_COMPAT,
						endpoint: 'https://api.example.com/v1',
						key: 'sk-fast',
						model: 'gpt-mini',
						strict: true,
						chatAPI: true,
					},
					'ds': {
						id: 'ds',
						name: 'DeepSeek',
						enabled: true,
						api: API_DEEPSEEK,
						endpoint: 'https://ignored.example.com',
						key: 'sk-ds',
						model: 'deepseek-chat',
						chatAPI: true,
					},
				},
			},
			samplerPresetStorage: {
				presets: {
					'deterministic': {
						id: 'deterministic',
						name: 'Deterministic',
						enabled: true,
						seed: 42,
						maxPredictTokens: 256,
						temperature: 0.1,
						dynaTempRange: 0,
						dynaTempExp: 1,
						repeatPenalty: 1.0,
						repeatLastN: 64,
						penalizeNl: false,
						presencePenalty: 0,
						frequencyPenalty: 0,
						topK: 10,
						topP: 0.5,
						typicalP: 1,
						minP: 0,
						tfsZ: 1,
						mirostat: 0,
						mirostatTau: 5,
						mirostatEta: 0.1,
						xtcThreshold: 0.1,
						xtcProbability: 0,
						dryMultiplier: 0,
						dryBase: 1.75,
						dryAllowedLength: 2,
						dryPenaltyRange: 1024,
						drySequenceBreakers: '[]',
						bannedTokens: '[]',
						ignoreEos: false,
						enabledSamplers: ['temperature', 'top_p', 'top_k'],
						grammar: '',
					},
				},
			},
			sessionStorage: { proxyEndpoint: undefined },
			isMiyapadEndpoint: false,
		});

		api.chatCompletion.mockImplementation(yieldChunks({ content: 'Summary.' }));

		const reply = await generate({
			prompt: 'Summarize this text.',
			connectionId: 'fast-chat',
			samplerPresetId: 'deterministic',
		});

		expect(reply).toBe('Summary.');
		expect(api.chatCompletion).toHaveBeenCalledTimes(1);
		const call = api.chatCompletion.mock.calls[0][0];
		expect(call).toMatchObject({
			endpoint: 'https://api.example.com/v1',
			endpointAPI: API_OPENAI_COMPAT,
			endpointAPIKey: 'sk-fast',
			model: 'gpt-mini',
			seed: 42,
			n_predict: 256,
			temperature: 0.1,
			top_p: 0.5,
			messages: [{ role: 'user', content: 'Summarize this text.' }],
		});
		// Strict OpenAI mode strips non-standard samplers like top_k.
		expect(call).not.toHaveProperty('top_k');

		// Explicit messages array on DeepSeek connection uses canonical DeepSeek endpoint.
		api.chatCompletion.mockImplementation(yieldChunks({ content: 'OK' }));
		const dsReply = await generate({
			messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }],
			connectionId: 'ds',
		});
		expect(dsReply).toBe('OK');
		expect(api.chatCompletion.mock.calls[1][0]).toMatchObject({
			endpoint: 'https://api.deepseek.com',
			endpointAPI: API_DEEPSEEK,
			messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }],
		});
	});

	it('respects an AbortSignal before and during streaming', async () => {
		const generate = createPluginGenerate({
			getSettings: () => makeSettings(),
			connectionStorage: { connections: {} },
			samplerPresetStorage: { presets: {} },
			sessionStorage: { proxyEndpoint: undefined },
			isMiyapadEndpoint: false,
		});

		const preAborted = new AbortController();
		preAborted.abort();
		await expect(generate({ prompt: 'hi', signal: preAborted.signal })).rejects.toThrow();
		expect(api.completion).not.toHaveBeenCalled();

		const ac = new AbortController();
		api.completion.mockImplementation(() => (async function* () {
			yield { content: 'part1' };
			ac.abort();
			yield { content: 'part2' };
		})());
		await expect(generate({ prompt: 'hi', signal: ac.signal })).rejects.toThrow();
	});

	it('enables temperature when explicitly passed even if temperature is off in enabledSamplers', async () => {
		const generate = createPluginGenerate({
			getSettings: () => makeSettings({ enabledSamplers: ['top_p'] }),
			connectionStorage: { connections: {} },
			samplerPresetStorage: { presets: {} },
			sessionStorage: { proxyEndpoint: undefined },
			isMiyapadEndpoint: false,
		});

		api.completion.mockImplementation(yieldChunks({ content: 'ok' }));
		await generate({ prompt: 'hi', temperature: 0.35 });
		expect(api.completion.mock.calls[0][0].temperature).toBe(0.35);
	});
});
