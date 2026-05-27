import { parseEventStream, applyTemperatureToProbs } from './common.js';

export async function openaiAphroditeTokenCount({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	try {
		const res = await fetch(`${proxyEndpoint ?? endpoint}/v1/token/encode`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }),
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
			body: JSON.stringify({
				prompt: options.content
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const tokens = await res.json();
		return tokens.length;
	} catch (e) {
		return -1;
	}
}

export async function openaiOobaTokenCount({ endpoint, proxyEndpoint, signal, ...options }) {
	try {
		const res = await fetch(`${proxyEndpoint ?? endpoint}/v1/internal/token-count`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
			body: JSON.stringify({
				text: options.content
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const { length } = await res.json();
		return length;
	} catch (e) {
		return -1;
	}
}

export async function openaiTabbyTokenCount({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	try {
		const res = await fetch(`${proxyEndpoint ?? endpoint}/v1/token/encode`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }),
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
			body: JSON.stringify({
				text: options.content
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const tokens = await res.json();
		return tokens.length;
	} catch (e) {
		return -1;
	}
}

export async function openaiOobaTokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	try {
		const res = await fetch(`${proxyEndpoint ?? endpoint}/v1/internal/encode`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
			body: JSON.stringify({
				text: options.content
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const { tokens } = await res.json();

		const strings = await Promise.all(tokens.map(token =>
			openaiOobaDetokenize({
				endpoint,
				...(endpointAPIKey ? {
					endpointAPIKey,
				} : {}),
				tokens: [ token ],
				signal: signal,
			})
		));
		return {ids:tokens,str:strings};
	} catch (e) {
		return null;
	}
}
async function openaiOobaDetokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	try {
		const res = await fetch(`${proxyEndpoint ?? endpoint}/v1/internal/decode`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
			body: JSON.stringify(options),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const { text } = await res.json();
		return text;
	} catch (e) {
		reportError(e);
		return null;
	}
}

export async function openaiTabbyTokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	try {
		const res = await fetch(`${proxyEndpoint ?? endpoint}/v1/token/encode`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
			body: JSON.stringify({
				text: options.content
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const { tokens } = await res.json();

		const strings = await Promise.all(tokens.map(token =>
			openaiTabbyDetokenize({
				endpoint,
				...(endpointAPIKey ? {
					endpointAPIKey,
				} : {}),
				tokens: [ token ],
				signal: signal,
			})
		));
		return {ids:tokens,str:strings};
	} catch (e) {
		return null;
	}
}
async function openaiTabbyDetokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	try {
		const res = await fetch(`${proxyEndpoint ?? endpoint}/v1/token/decode`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
			body: JSON.stringify(options),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const { text } = await res.json();
		return text;
	} catch (e) {
		reportError(e);
		return null;
	}
}

export async function openaiModels({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	const isTogetherAI = endpoint.toLowerCase().includes("together.xyz");

	const res = await fetch(`${proxyEndpoint ?? endpoint}/v1/models`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			...(proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);

	const response = await res.json();
	let data;

	if (isTogetherAI) {
		// TogetherAI returns an array.
		data = response;
	} else {
		data = response.data;
	}
	return data.map(item => item.id);
}

function openaiConvertOptions(options, endpoint, isChat) {
	const isOpenAI = endpoint.toLowerCase().includes("openai.com");
	const isTogetherAI = endpoint.toLowerCase().includes("together.xyz");
	const isOpenRouter = endpoint.toLowerCase().includes("openrouter.ai");
	const swapOption = (lhs, rhs) => {
		if (lhs in options) {
			options[rhs] = options[lhs];
			delete options[lhs];
		}
	};
	if (options.n_predict === -1) {
		options.n_predict = 1024;
	}
	if (isOpenAI && options.n_probs > 5 || endpoint.toLowerCase().includes("xai")) {
		options.n_probs = 5;
	}
	if (isTogetherAI && options.n_probs > 1) {
		options.n_probs = 1;
	}
	if ("dynatemp_range" in options && options.dynatemp_range !== 0) {
		// oobabooga specific.
		options.dynamic_temperature = true;
		options.dynatemp_low = Math.max(0, options.temperature - options.dynatemp_range);
		options.dynatemp_high = Math.max(0, options.temperature + options.dynatemp_range);
	}
	if (!isOpenAI && options.temperature === 0) {
		// oobabooga specific.
		options.do_sample = false;
	}
	swapOption("n_ctx", "max_context_length");
	swapOption("n_predict", "max_tokens");
	if (isChat) {
		if (options.n_probs > 0) {
			options.logprobs = true;
			swapOption("n_probs", "top_logprobs");
		} else {
			options.logprobs = false;
			delete options.n_probs;
		}
	} else {
		if (options.n_probs > 0) {
			swapOption("n_probs", "logprobs");
		} else {
			delete options.n_probs;
		}
	}
	swapOption("repeat_penalty", "repetition_penalty");
	swapOption("repeat_last_n", "repetition_penalty_range");
	swapOption("tfs_z", "tfs");
	swapOption("mirostat", "mirostat_mode");
	swapOption("ignore_eos", "ban_eos_token");
	swapOption("grammar", "grammar_string");
	return options;
}

export async function* openaiCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	let finalEndpoint = proxyEndpoint ?? endpoint;
	const needsPath = (() => {
		try {
			return !new URL(endpoint).pathname.endsWith("/completions");
		} catch {
			return !endpoint.endsWith("/completions");
		}
	})();
	if (needsPath) {
		try {
			const url = new URL(finalEndpoint);
			url.pathname = url.pathname.replace(/\/$/, "") + "/v1/completions";
			finalEndpoint = url.toString();
		} catch {
			finalEndpoint += "/v1/completions";
		}
	}
	const res = await fetch(finalEndpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		body: JSON.stringify({
			...openaiConvertOptions(options, endpoint)
		}),
		signal,
	});

	if (!res.ok) {
		let json;
		try {
			json = await res.json();
		} catch {}
		if (json?.error?.message) {
			throw new Error(json.error.message);
		}
		throw new Error(`HTTP ${res.status}`);
	}

	async function* yieldTokens(chunks) {
		for await (const chunk of chunks) {
			if (!chunk.choices || chunk.choices.length === 0) {
				if (chunk.content) yield { content: chunk.content };
				continue;
			}

			const choice = chunk.choices[0];
			const text = choice.text;
			const logprobsData = choice.logprobs;
			let probs = [];
			let prob;
			let rawProbsArr = [];

			if (logprobsData?.content?.[0]?.top_logprobs) {
				rawProbsArr = logprobsData.content[0].top_logprobs.map(({ token, logprob }) => ({ tok_str: token, logprob }));
			} else if (logprobsData?.top_logprobs?.[0]) {
				const top_logprobs_obj = logprobsData.top_logprobs[0];
				rawProbsArr = Object.entries(top_logprobs_obj).map(([tok, logprob]) => ({ tok_str: tok, logprob }));
			}

			if (rawProbsArr.length > 0) {
				const res = applyTemperatureToProbs(rawProbsArr, text, options.temperature);
				probs = res.probs;
				prob = res.prob;
			}

			yield {
				content: text,
				...(probs.length > 0 ? {
					prob: prob ?? -1,
					completion_probabilities: [{
						content: text,
						probs
					}]
				} : {})
			};
		}
	}

	if (options.stream) {
		yield* yieldTokens(parseEventStream(res.body));
	} else {
		const { content, choices } = await res.json();
		if (choices?.[0].logprobs?.tokens) {
			const logprobs = choices[0].logprobs;
			const chunks = Object.values(logprobs.tokens).map((token, i) => ({
				choices: [{
					text: token,
					logprobs: { top_logprobs: [logprobs.top_logprobs[i]] }
				}]
			}));
			yield* yieldTokens(chunks);
		} else if (choices?.[0].text) {
			yield { content: choices[0].text };
		} else if (content) { // llama.cpp specific?
			yield { content };
		}
	}
}

async function* openaiBufferUtf8Stream(stream) {
	const decoder = new TextDecoder('utf-8', { fatal: false });

	function parseEscapedString(escapedStr) {
		return new Uint8Array(
			escapedStr
				.split('\\x')
				.slice(1)
				.map(hex => parseInt(hex, 16))
		);
	}

	const hasEscapedSequence = str => /\\x[0-9a-fA-F]{2}/.test(str);
	const encoder = new TextEncoder();

	for await (const chunk of stream) {
		const content = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.text;

		if (!content) {
			yield chunk;
			continue;
		}

		const binaryData = hasEscapedSequence(content)
			? parseEscapedString(content)
			: encoder.encode(content);

		const decoded = decoder.decode(binaryData, { stream: true });

		yield {
			...chunk,
			choices: [{
				...chunk.choices[0],
				...(chunk.choices[0].delta
					? { delta: { ...chunk.choices[0].delta, content: decoded } }
					: { text: decoded }
				)
			}]
		};
	}
}

export async function* openaiChatCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	let finalEndpoint = proxyEndpoint ?? endpoint;
	const needsPath = (() => {
		try {
			return !new URL(endpoint).pathname.endsWith("/completions");
		} catch {
			return !endpoint.endsWith("/completions");
		}
	})();
	if (needsPath) {
		try {
			const url = new URL(finalEndpoint);
			url.pathname = url.pathname.replace(/\/$/, "") + "/v1/chat/completions";
			finalEndpoint = url.toString();
		} catch {
			finalEndpoint += "/v1/chat/completions";
		}
	}
	const res = await fetch(finalEndpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		body: JSON.stringify({
			...openaiConvertOptions(options, endpoint, true)
		}),
		signal,
	});

	if (!res.ok) {
		let json;
		try {
			json = await res.json();
		} catch {}
		if (json?.error?.message) {
			throw new Error(json.error.message);
		}
		throw new Error(`HTTP ${res.status}`);
	}

	async function* yieldTokens(chunks) {
		for await (const chunk of chunks) {
			if (!chunk.choices || chunk.choices.length === 0) continue;
			const choice = chunk.choices[0];
			const token = choice.delta?.content || choice.text;
			const top_logprobs = choice.logprobs?.content?.[0]?.top_logprobs ?? {};
			if (!token) continue;

				let rawProbsArr = Object.values(top_logprobs).map(({ token: t, logprob }) => ({ tok_str: t, logprob }));
				const res = applyTemperatureToProbs(rawProbsArr, token, options.temperature);
				const probs = res.probs;
				let prob = res.prob;

			yield {
				content: token,
				...(probs.length > 0 ? {
					prob: prob ?? -1,
					completion_probabilities: [{
						content: token,
						probs
					}]
				} : {})
			};
		}
	}

	if (options.stream) {
		yield* yieldTokens(parseEventStream(res.body));
	} else {
		const { choices } = await res.json();
		const chunks = choices?.[0].logprobs?.content;

		if (chunks?.length) {
			const formattedChunks = chunks.map(chunk => ({
				choices: [{
					delta: { content: chunk.token },
					logprobs: { content: [{ top_logprobs: chunk.top_logprobs }] }
				}]
			}));
			yield* yieldTokens(openaiBufferUtf8Stream(formattedChunks));
		} else if (choices?.[0].message?.content) {
			yield { content: choices[0].message.content };
		}
	}
}

export async function openaiOobaAbortCompletion({ endpoint, proxyEndpoint, ...options }) {
	try {
		await fetch(`${proxyEndpoint ?? endpoint}/v1/internal/stop-generation`, {
			method: 'POST',
			headers: {
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
		});
	} catch (e) {
		// do nothing
	}
}
