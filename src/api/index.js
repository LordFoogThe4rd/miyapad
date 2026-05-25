import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE } from '../constants.js';
import { normalizeEndpoint } from './common.js';
import { llamaCppTokenCount, llamaCppTokenize, llamaCppCompletion } from './llamacpp.js';
import { koboldCppTokenCount, koboldCppTokenize, koboldCppCompletion, koboldCppAbortCompletion } from './koboldcpp.js';
import { openaiAphroditeTokenCount, openaiOobaTokenCount, openaiTabbyTokenCount, openaiOobaTokenize, openaiTabbyTokenize, openaiModels, openaiCompletion, openaiChatCompletion, openaiOobaAbortCompletion } from './openai.js';
import { aiHordeModels, aiHordeCompletion, aiHordeAbortCompletion } from './aihorde.js';

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

export async function getTokenCount({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_LLAMA_CPP:
			return await llamaCppTokenCount({ endpoint, endpointAPIKey, signal, ...options });
		case API_KOBOLD_CPP:
			return await koboldCppTokenCount({ endpoint, endpointAPIKey, signal, ...options });
		case API_OPENAI_COMPAT:
			// These endpoints don't have a token count endpoint...
			if (new URL(endpoint).host === 'api.openai.com' || new URL(endpoint).host === 'api.together.xyz')
				return 0;

			// Each backend that exposes an OpenAI-compatible API may have a different token count endpoint.
			// Instead of asking the user which backend they are using, let's try each one.
			let tokenCount = 0;
			tokenCount = await openaiAphroditeTokenCount({ endpoint, endpointAPIKey, signal, ...options });
			if (tokenCount != -1)
				return tokenCount;
			tokenCount = await openaiOobaTokenCount({ endpoint, signal, ...options });
			if (tokenCount != -1)
				return tokenCount;
			tokenCount = await openaiTabbyTokenCount({ endpoint, endpointAPIKey, signal, ...options });
			if (tokenCount != -1)
				return tokenCount;
			return 0;
		default:
			return 0;
	}
}

export async function getTokens({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	// currently only implemented for llama.cpp and koboldcpp
	// returns a json object in the format of:
	// { ids:[ array of token ids ], str:[ array of detokenized ids ] }
	// example: { ids:[9288,4731],str:["test"," string"] }
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_LLAMA_CPP:
			return await llamaCppTokenize({ endpoint, endpointAPIKey, signal, ...options });
		case API_KOBOLD_CPP:
			return await koboldCppTokenize({ endpoint, endpointAPIKey, signal, ...options });
		case API_OPENAI_COMPAT:
			// These endpoints don't have a tokenenizer endpoint...
			if (new URL(endpoint).host === 'api.openai.com' || new URL(endpoint).host === 'api.together.xyz')
				return [];
			
			// Each backend that exposes an OpenAI-compatible API may have a different tokenizer endpoint.
			// Instead of asking the user which backend they are using, let's try each one.
			let tokens = null;
			tokens = await openaiOobaTokenize({ endpoint, endpointAPIKey, signal, ...options });
			if (tokens !== null)
				return tokens;
			tokens = await openaiTabbyTokenize({ endpoint, endpointAPIKey, signal, ...options });
			if (tokens !== null)
				return tokens;
			return [];
		default:
			return [];
	}
}

export async function getModels({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_OPENAI_COMPAT:
			return await openaiModels({ endpoint, endpointAPIKey, signal, ...options });
		case API_AI_HORDE:
			return await aiHordeModels({ endpoint, endpointAPIKey, signal, ...options });
		default:
			return [];
	}
}

export async function* completion({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_LLAMA_CPP:
			return yield* await llamaCppCompletion({ endpoint, endpointAPIKey, signal, ...options });
		case API_KOBOLD_CPP:
			return yield* await koboldCppCompletion({ endpoint, endpointAPIKey, signal, ...options });
		case API_OPENAI_COMPAT:
			return yield* await openaiCompletion({ endpoint, endpointAPIKey, signal, ...options });
		case API_AI_HORDE:
			return yield* await aiHordeCompletion({ endpoint, endpointAPIKey, signal, ...options });
	}
}

export async function* chatCompletion({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_OPENAI_COMPAT:
			return yield* await openaiChatCompletion({ endpoint, endpointAPIKey, signal, ...options });
	}
}

export async function abortCompletion({ endpoint, endpointAPI, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_KOBOLD_CPP:
			return await koboldCppAbortCompletion({ endpoint, ...options });
		case API_OPENAI_COMPAT:
			return await openaiOobaAbortCompletion({ endpoint, ...options });
		case API_AI_HORDE:
			return await aiHordeAbortCompletion({ endpoint, ...options });
	}
}
