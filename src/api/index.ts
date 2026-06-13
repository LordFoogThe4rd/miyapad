import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE, API_DEEPSEEK } from '../constants';
import { normalizeEndpoint } from './common';
import { llamaCppTokenCount, llamaCppTokenize, llamaCppCompletion } from './llamacpp';
import { koboldCppTokenCount, koboldCppTokenize, koboldCppCompletion, koboldCppAbortCompletion } from './koboldcpp';
import { openaiAphroditeTokenCount, openaiOobaTokenCount, openaiTabbyTokenCount, openaiOobaTokenize, openaiTabbyTokenize, openaiModels, openaiCompletion, openaiChatCompletion, openaiOobaAbortCompletion } from './openai';
import { aiHordeModels, aiHordeCompletion, aiHordeAbortCompletion } from './aihorde';
import { deepseekModels, deepseekCompletion, deepseekChatCompletion, deepseekAbortCompletion } from './deepseek';

export async function serverTokenCount({ sessionEndpoint, signal, content }) {
	const res = await fetch(`${sessionEndpoint}/api/v1/token-count`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ content }),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	if (data.error)
		throw new Error(data.error);
	return data.count;
}

export async function serverTokenize({ sessionEndpoint, signal, content }) {
	const res = await fetch(`${sessionEndpoint}/api/v1/tokenize`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ content }),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	return { ids: data.ids, str: data.strings };
}

export async function serverDetokenize({ sessionEndpoint, signal, tokens: tokenIds }) {
	const res = await fetch(`${sessionEndpoint}/api/v1/detokenize`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ tokens: tokenIds }),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const { content } = await res.json();
	return content;
}

export async function getServerTokenizers({ sessionEndpoint }) {
	const res = await fetch(`${sessionEndpoint}/api/v1/tokenizers`);
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	return data;
}

export async function loadServerTokenizer({ sessionEndpoint, model }) {
	const res = await fetch(`${sessionEndpoint}/api/v1/tokenizer/load`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model }),
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	return data;
}

export async function getTokenCount({ endpoint, endpointAPI, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_LLAMA_CPP:
			return await llamaCppTokenCount({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
		case API_KOBOLD_CPP:
			return await koboldCppTokenCount({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
		case API_DEEPSEEK:
		case API_OPENAI_COMPAT:
			// These endpoints don't have a token count endpoint...
			if (endpointAPI === API_OPENAI_COMPAT && (new URL(endpoint).host === 'api.openai.com' || new URL(endpoint).host === 'api.together.xyz'))
				return 0;

			// Each backend that exposes an OpenAI-compatible API may have a different token count endpoint.
			// Instead of asking the user which backend they are using, let's try each one.
			let tokenCount = 0;
			tokenCount = await openaiAphroditeTokenCount({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
			if (tokenCount != -1)
				return tokenCount;
			tokenCount = await openaiOobaTokenCount({ endpoint, proxyEndpoint, signal, ...options });
			if (tokenCount != -1)
				return tokenCount;
			tokenCount = await openaiTabbyTokenCount({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
			if (tokenCount != -1)
				return tokenCount;
			return 0;
		default:
			return 0;
	}
}

export async function getTokens({ endpoint, endpointAPI, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	// currently only implemented for llama.cpp and koboldcpp
	// returns a json object in the format of:
	// { ids:[ array of token ids ], str:[ array of detokenized ids ] }
	// example: { ids:[9288,4731],str:["test"," string"] }
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_LLAMA_CPP:
			return await llamaCppTokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
		case API_KOBOLD_CPP:
			return await koboldCppTokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
		case API_DEEPSEEK:
		case API_OPENAI_COMPAT:
			// These endpoints don't have a tokenenizer endpoint...
			if (endpointAPI === API_OPENAI_COMPAT && (new URL(endpoint).host === 'api.openai.com' || new URL(endpoint).host === 'api.together.xyz'))
				return [];
			
			// Each backend that exposes an OpenAI-compatible API may have a different tokenizer endpoint.
			// Instead of asking the user which backend they are using, let's try each one.
			let tokens = null;
			tokens = await openaiOobaTokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
			if (tokens !== null)
				return tokens;
			tokens = await openaiTabbyTokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
			if (tokens !== null)
				return tokens;
			return [];
		default:
			return [];
	}
}

export async function getModels({ endpoint, endpointAPI, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_DEEPSEEK:
		case API_OPENAI_COMPAT:
			return await (endpointAPI === API_DEEPSEEK ? deepseekModels : openaiModels)({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
		case API_AI_HORDE:
			return await aiHordeModels({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
		default:
			return [];
	}
}

export async function* completion({ endpoint, endpointAPI, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_LLAMA_CPP:
			return yield* await llamaCppCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
		case API_KOBOLD_CPP:
			return yield* await koboldCppCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
		case API_DEEPSEEK:
			return yield* await deepseekCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
		case API_OPENAI_COMPAT:
			return yield* await openaiCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
		case API_AI_HORDE:
			return yield* await aiHordeCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
	}
}

export async function* chatCompletion({ endpoint, endpointAPI, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_DEEPSEEK:
		case API_OPENAI_COMPAT:
			return yield* await (endpointAPI === API_DEEPSEEK ? deepseekChatCompletion : openaiChatCompletion)({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options });
	}
}

export async function abortCompletion({ endpoint, endpointAPI, proxyEndpoint, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_KOBOLD_CPP:
			return await koboldCppAbortCompletion({ endpoint, proxyEndpoint, ...options });
		case API_DEEPSEEK:
		case API_OPENAI_COMPAT:
			return await (endpointAPI === API_DEEPSEEK ? deepseekAbortCompletion : openaiOobaAbortCompletion)({ endpoint, proxyEndpoint, ...options });
		case API_AI_HORDE:
			return await aiHordeAbortCompletion({ endpoint, proxyEndpoint, ...options } as any);
	}
}
