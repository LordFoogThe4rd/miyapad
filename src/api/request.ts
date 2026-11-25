import { API_AI_HORDE, API_DEEPSEEK, API_LLAMA_CPP, API_OPENAI_COMPAT } from '../constants';
import { buildLogitBiasParam } from './common';
import { chatCompletion, completion } from './index';
import { createLenientPrefixRegex, createLenientRegex, prefixMatchLength, regexIndexOf } from '../utils/regex';
import { replaceNewlines } from '../utils/strings';

export interface GenerationRequestConfig {
	endpoint: string;
	endpointAPI: number;
	endpointAPIKey?: string;
	endpointModel?: string;
	useChatAPI?: boolean;
	openaiPresets?: boolean;
	postSamplingProbs?: boolean;
	useTokenStreaming?: boolean;
	disableLogprobs?: boolean;
	proxyEndpoint?: string;
	prompt?: string;
	messages?: ChatMessage[];
	seed: number;
	maxPredictTokens: number;
	temperature: number;
	dynaTempRange: number;
	dynaTempExp: number;
	repeatPenalty: number;
	repeatLastN: number;
	penalizeNl: boolean;
	presencePenalty: number;
	frequencyPenalty: number;
	topK: number;
	topP: number;
	typicalP: number;
	minP: number;
	tfsZ: number;
	mirostat: number;
	mirostatTau: number;
	mirostatEta: number;
	xtcThreshold: number;
	xtcProbability: number;
	dryMultiplier: number;
	dryBase: number;
	dryAllowedLength: number;
	dryPenaltyRange: number;
	drySequenceBreakers: string;
	bannedTokens: string;
	ignoreEos: boolean;
	enabledSamplers: string[];
	grammar: string;
	logitBias?: LogitBiasState;
	logitBiasParam?: unknown;
	stop?: string[];
	signal?: AbortSignal;
	customParams?: Record<string, unknown>;
}

/** Splits an instruct-formatted chat string into `{ role, content }` messages for Chat API endpoints. */
export function convertChatToJSON(chatString: string, template: InstructTemplate): ChatMessage[] {
	function extractMessage(
		text: string,
		prefix: string,
		suffixes: string[],
		role: 'system' | 'user' | 'assistant',
	): { message: ChatMessage; remainingString: string } | null {
		const matches = text.match(createLenientPrefixRegex(prefix));
		if (matches && matches.length) {
			text = text.substring(matches[0].length);
			let endIndex = suffixes[0] ? regexIndexOf(text, createLenientRegex(suffixes[0])) : -1;
			if (endIndex === -1) {
				if (suffixes.length > 1) {
					const indices = suffixes.slice(1)
						.map((suffix: string) => suffix ? regexIndexOf(text, createLenientRegex(suffix)) : -1)
						.filter((index: number) => index !== -1);
					endIndex = indices.length > 0 ? Math.min(...indices) : text.length;
				} else {
					endIndex = text.length;
				}
			}
			let content = text.substring(0, endIndex);
			content = endIndex !== text.length ? content.trim() : content.trimStart();
			return {
				message: { role, content },
				remainingString: text.substring(endIndex),
			};
		}
		return null;
	}

	function skipToNextKnownPrefix(text: string, ...prefixes: string[]): string {
		const indices = prefixes
			.map(prefix => prefix ? regexIndexOf(text, createLenientRegex(prefix)) : -1)
			.filter(index => index !== -1);
		const minIndex = indices.length > 0 ? Math.min(...indices) : text.length;
		if (minIndex == 0) {
			console.warn('Something went wrong!');
			return '';
		}
		return text.substring(minIndex);
	}

	if (!template || typeof template !== 'object') {
		console.warn('Invalid or missing template object!');
		return [];
	}

	const messages: ChatMessage[] = [];
	const { sysPre, sysSuf, instPre, instSuf } = replaceNewlines(template);

	let remainingString = chatString.trimStart();

	const indices = [sysPre, instPre]
		.map(prefix => prefix ? regexIndexOf(remainingString, createLenientPrefixRegex(prefix)) : -1)
		.filter(index => index !== -1);
	const minIndex = indices.length > 0 ? Math.min(...indices) : remainingString.length;
	if (minIndex !== 0) {
		// The prompt doesn't start with any of the prefixes, so treat it as an instruction.
		const matchLen = prefixMatchLength(instPre.trim(), remainingString);
		remainingString = instPre + remainingString.substring(matchLen);
	}

	while (remainingString.length > 0) {
		let extracted = null;
		if (sysPre) {
			extracted = extractMessage(remainingString, sysPre, [sysSuf, instPre, instSuf], 'system');
		}
		if (instPre && !extracted) {
			extracted = extractMessage(remainingString, instPre, [instSuf], 'user');
		}
		if (instSuf && !extracted) {
			extracted = extractMessage(remainingString, instSuf, [instPre], 'assistant');
		}
		if (!extracted) {
			remainingString = skipToNextKnownPrefix(remainingString, sysPre, instPre, instSuf);
			continue;
		}
		messages.push(extracted.message);
		remainingString = extracted.remainingString;
	}

	const lastMessage = messages.length ? messages[messages.length - 1] : null;
	if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content.length === 0) {
		messages.pop();
	}

	return messages;
}

/**
 * Builds the provider payload shared by `useGenerationLogic.predict()` and `miyapad.generate()`.
 * Applies sampler filtering, OpenAI/DeepSeek strict-mode quirks, logit bias formatting, and proxy routing.
 */
export function buildCompletionOptions(config: GenerationRequestConfig): CompletionOptions {
	const {
		endpoint, endpointAPI, endpointAPIKey, endpointModel,
		useChatAPI = false, openaiPresets = false, postSamplingProbs = true,
		useTokenStreaming = true, disableLogprobs = false, proxyEndpoint,
		prompt, messages,
		seed, maxPredictTokens, temperature, dynaTempRange, dynaTempExp,
		repeatPenalty, repeatLastN, penalizeNl, presencePenalty, frequencyPenalty,
		topK, topP, typicalP, minP, tfsZ,
		mirostat, mirostatTau, mirostatEta,
		xtcThreshold, xtcProbability,
		dryMultiplier, dryBase, dryAllowedLength, dryPenaltyRange, drySequenceBreakers,
		bannedTokens, ignoreEos, enabledSamplers, grammar,
		logitBias, logitBiasParam, stop, signal, customParams,
	} = config;

	const allowExtraSamplers = !openaiPresets || endpointAPI != API_OPENAI_COMPAT;
	const hasLogitBias = logitBias !== undefined && Object.keys(logitBias.bias ?? {}).length > 0;

	return {
		endpoint,
		endpointAPI,
		...(endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_LLAMA_CPP || endpointAPI == API_AI_HORDE || endpointAPI == API_DEEPSEEK ? {
			endpointAPIKey,
			model: endpointModel,
		} : {}),
		...(useChatAPI ? { messages } : { prompt }),
		...(seed != -1 ? { seed } : {}),
		...(enabledSamplers.includes('temperature') ? { temperature } : {}),
		...(allowExtraSamplers ? {
			...(enabledSamplers.includes('dynatemp') ? {
				dynatemp_range: dynaTempRange,
				dynatemp_exponent: dynaTempExp,
			} : {}),
			...(enabledSamplers.includes('rep_pen') ? {
				repeat_penalty: repeatPenalty,
				repeat_last_n: repeatLastN,
			} : {}),
			penalize_nl: penalizeNl,
			ignore_eos: ignoreEos,
		} : {}),
		...(hasLogitBias ? {
			logit_bias: logitBiasParam !== undefined ? logitBiasParam : buildLogitBiasParam(logitBias, endpointAPI),
		} : {}),
		...(allowExtraSamplers && grammar.length ? { grammar } : {}),
		...(enabledSamplers.includes('pres_pen') ? { presence_penalty: presencePenalty } : {}),
		...(enabledSamplers.includes('freq_pen') ? { frequency_penalty: frequencyPenalty } : {}),
		...((enabledSamplers.includes('mirostat') && mirostat && allowExtraSamplers) ? {
			mirostat,
			mirostat_tau: mirostatTau,
			mirostat_eta: mirostatEta,
		} : {
			...(enabledSamplers.includes('top_p') ? { top_p: topP } : {}),
			...(allowExtraSamplers ? {
				...(enabledSamplers.includes('top_k') ? { top_k: topK } : {}),
				...(enabledSamplers.includes('typical_p') ? { typical_p: typicalP } : {}),
				...(enabledSamplers.includes('min_p') ? { min_p: minP } : {}),
				...(enabledSamplers.includes('tfs_z') ? { tfs_z: tfsZ } : {}),
				...(enabledSamplers.includes('xtc') ? {
					xtc_threshold: xtcThreshold,
					xtc_probability: xtcProbability,
				} : {}),
				...(enabledSamplers.includes('dry') ? {
					dry_multiplier: dryMultiplier,
					dry_base: dryBase,
					dry_allowed_length: dryAllowedLength,
					dry_penalty_last_n: dryPenaltyRange,
					dry_sequence_breakers: (endpointAPI == API_OPENAI_COMPAT || endpointAPI == API_DEEPSEEK)
						? drySequenceBreakers
						: JSON.parse(drySequenceBreakers),
				} : {}),
				...(enabledSamplers.includes('ban_tokens') ? {
					banned_tokens: JSON.parse(bannedTokens),
				} : {}),
			} : {}),
		}),
		n_predict: maxPredictTokens,
		n_probs: disableLogprobs ? 0 : 10,
		...(endpointAPI === API_LLAMA_CPP ? { post_sampling_probs: postSamplingProbs } : {}),
		stream: useTokenStreaming,
		...(stop && stop.length ? { stop } : {}),
		signal,
		...(proxyEndpoint ? { proxyEndpoint } : {}),
		...customParams,
	};
}

/** Dispatches a built generation request to `chatCompletion` or `completion`. */
export function streamGeneration(
	config: GenerationRequestConfig,
): AsyncGenerator<CompletionChunk | AIHordeChunk, void, unknown> {
	const options = buildCompletionOptions(config);
	return config.useChatAPI ? chatCompletion(options) : completion(options);
}
