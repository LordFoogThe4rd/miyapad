import { API_AI_HORDE, API_DEEPSEEK, API_LLAMA_CPP, API_OPENAI_COMPAT } from '../constants';
import { defaultPresets } from '../defaults/presets';
import { convertChatToJSON, streamGeneration, type GenerationRequestConfig } from '../api/request';
import type { ConnectionStorage } from '../storage/ConnectionStorage';
import type { SamplerPresetStorage } from '../storage/SamplerPresetStorage';
import type { SessionStorage } from '../storage/SessionStorage';
import type { SettingsState } from '../types/contexts';

export interface PluginGenerateOptions {
	prompt?: string;
	messages?: ChatMessage[];
	connectionId?: string;
	samplerPresetId?: string;
	maxTokens?: number;
	temperature?: number;
	stop?: string[];
	params?: Record<string, unknown>;
	signal?: AbortSignal;
}

export interface PluginGenerateDeps {
	getSettings: () => SettingsState | null;
	connectionStorage: Pick<ConnectionStorage, 'connections'>;
	samplerPresetStorage: Pick<SamplerPresetStorage, 'presets'>;
	sessionStorage: Pick<SessionStorage, 'proxyEndpoint'>;
	isMiyapadEndpoint: boolean;
}

export type PluginGenerateFn = (options: PluginGenerateOptions) => Promise<string>;

function supportsChatAPI(endpointAPI: number): boolean {
	return endpointAPI === API_OPENAI_COMPAT || endpointAPI === API_DEEPSEEK;
}

function parseStoppingStrings(raw: string | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
	} catch {
		return [];
	}
}

/**
 * Creates `miyapad.generate`: a quiet off-screen completion helper that shares payload assembly
 * and `/proxy` routing with `predict()`, without touching UI state, undo history, session stats,
 * TTS, or generation hooks/events.
 */
export function createPluginGenerate(deps: PluginGenerateDeps): PluginGenerateFn {
	return async function generate(options: PluginGenerateOptions): Promise<string> {
		if (!options || typeof options !== 'object') {
			throw new TypeError('miyapad.generate: options must be an object');
		}
		const hasPrompt = typeof options.prompt === 'string';
		const hasMessages = Array.isArray(options.messages);
		if (!hasPrompt && !hasMessages) {
			throw new TypeError('miyapad.generate: provide a prompt string or a messages array');
		}
		options.signal?.throwIfAborted();

		const settings = deps.getSettings();
		const conn = options.connectionId && Object.hasOwn(deps.connectionStorage.connections, options.connectionId)
			? deps.connectionStorage.connections[options.connectionId]
			: undefined;
		if (!conn && !settings) {
			throw new Error('miyapad.generate: app settings are not ready yet');
		}

		const preset = options.samplerPresetId && Object.hasOwn(deps.samplerPresetStorage.presets, options.samplerPresetId)
			? deps.samplerPresetStorage.presets[options.samplerPresetId]
			: undefined;

		const endpointAPI = conn ? conn.api : settings!.endpointAPI;
		const endpoint = conn
			? (conn.api === API_DEEPSEEK ? 'https://api.deepseek.com' : (conn.api === API_AI_HORDE ? 'https://aihorde.net/api' : conn.endpoint))
			: settings!.endpoint;
		const endpointAPIKey = conn ? (conn.key || '') : settings!.endpointAPIKey;
		const endpointModel = conn ? (conn.model || '') : settings!.endpointModel;
		const openaiPresets = conn
			? (supportsChatAPI(conn.api) ? (conn.strict ?? false) : false)
			: settings!.openaiPresets;
		const postSamplingProbs = conn
			? (conn.api === API_LLAMA_CPP ? (conn.postSamplingProbs ?? true) : false)
			: settings!.postSamplingProbs;

		let useChatAPI = conn
			? (supportsChatAPI(conn.api) ? (conn.chatAPI ?? false) : false)
			: settings!.useChatAPI;

		if (hasMessages) {
			if (!supportsChatAPI(endpointAPI)) {
				throw new TypeError('miyapad.generate: messages requires an OpenAI-compatible or DeepSeek connection');
			}
			useChatAPI = true;
		} else if (useChatAPI && !supportsChatAPI(endpointAPI)) {
			useChatAPI = false;
		}

		let messages: ChatMessage[] | undefined;
		if (useChatAPI) {
			if (hasMessages) {
				messages = options.messages;
			} else {
				const template = settings?.templates?.[settings.selectedTemplate];
				const converted = template ? convertChatToJSON(options.prompt!, template) : [];
				messages = converted.length > 0 ? converted : [{ role: 'user', content: options.prompt! }];
			}
		}

		const samplerSource = preset ?? settings ?? defaultPresets;
		const baseSamplers = [...samplerSource.enabledSamplers];
		if (options.temperature !== undefined && !baseSamplers.includes('temperature')) {
			baseSamplers.push('temperature');
		}

		const stop = options.stop !== undefined
			? options.stop
			: (settings && !settings.useBasicStoppingMode ? parseStoppingStrings(settings.stoppingStrings) : []);

		const config: GenerationRequestConfig = {
			endpoint,
			endpointAPI,
			endpointAPIKey,
			endpointModel,
			useChatAPI,
			openaiPresets,
			postSamplingProbs,
			useTokenStreaming: settings?.useTokenStreaming ?? true,
			disableLogprobs: true,
			proxyEndpoint: deps.isMiyapadEndpoint ? deps.sessionStorage.proxyEndpoint : undefined,
			prompt: useChatAPI ? undefined : options.prompt,
			messages,
			seed: samplerSource.seed,
			maxPredictTokens: options.maxTokens !== undefined ? options.maxTokens : samplerSource.maxPredictTokens,
			temperature: options.temperature !== undefined ? options.temperature : samplerSource.temperature,
			dynaTempRange: samplerSource.dynaTempRange,
			dynaTempExp: samplerSource.dynaTempExp,
			repeatPenalty: samplerSource.repeatPenalty,
			repeatLastN: samplerSource.repeatLastN,
			penalizeNl: samplerSource.penalizeNl,
			presencePenalty: samplerSource.presencePenalty,
			frequencyPenalty: samplerSource.frequencyPenalty,
			topK: samplerSource.topK,
			topP: samplerSource.topP,
			typicalP: samplerSource.typicalP,
			minP: samplerSource.minP,
			tfsZ: samplerSource.tfsZ,
			mirostat: samplerSource.mirostat,
			mirostatTau: samplerSource.mirostatTau,
			mirostatEta: samplerSource.mirostatEta,
			xtcThreshold: samplerSource.xtcThreshold,
			xtcProbability: samplerSource.xtcProbability,
			dryMultiplier: samplerSource.dryMultiplier,
			dryBase: samplerSource.dryBase,
			dryAllowedLength: samplerSource.dryAllowedLength,
			dryPenaltyRange: samplerSource.dryPenaltyRange,
			drySequenceBreakers: samplerSource.drySequenceBreakers,
			bannedTokens: samplerSource.bannedTokens,
			ignoreEos: samplerSource.ignoreEos,
			enabledSamplers: baseSamplers,
			grammar: samplerSource.grammar,
			logitBias: settings?.logitBias,
			stop,
			signal: options.signal,
			customParams: options.params,
		};

		let output = '';
		for await (const chunk of streamGeneration(config)) {
			options.signal?.throwIfAborted();
			if (endpointAPI === API_AI_HORDE) {
				const hordeChunk = chunk as AIHordeChunk;
				if (hordeChunk.status === 'queue_init' || hordeChunk.status === 'queue_status') continue;
			}
			const compChunk = chunk as CompletionChunk;
			const text = compChunk.stopping_word ?? compChunk.content;
			if (text) output += text;
		}
		return output;
	};
}
