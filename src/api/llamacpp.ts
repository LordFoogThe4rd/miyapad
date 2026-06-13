import { parseEventStream, applyTemperatureToProbs } from './common';

export async function llamaCppTokenCount({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }: { endpoint: any; endpointAPIKey: any; proxyEndpoint: any; signal: any; [key: string]: any }) {
	const res = await fetch(`${proxyEndpoint ?? endpoint}/tokenize`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(endpointAPIKey ? (proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }) : {}),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		body: JSON.stringify(options),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const { tokens } = await res.json();
	return tokens.length + 1; // + 1 for BOS, I guess.
}

export async function llamaCppTokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }: { endpoint: any; endpointAPIKey: any; proxyEndpoint: any; signal: any; [key: string]: any }) {
	const res = await fetch(`${proxyEndpoint ?? endpoint}/tokenize`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(endpointAPIKey ? (proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }) : {}),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		body: JSON.stringify(options),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const { tokens } = await res.json();

	const strings = await Promise.all(tokens.map((token: any) =>
		llamaCppDetokenize({
			endpoint,
			endpointAPIKey,
			proxyEndpoint,
			signal,
			tokens: [token],
		})
	));

	return { ids: tokens, str: strings };
}

async function llamaCppDetokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }: { endpoint: any; endpointAPIKey: any; proxyEndpoint: any; signal: any; [key: string]: any }) {
	const res = await fetch(`${proxyEndpoint ?? endpoint}/detokenize`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(endpointAPIKey ? (proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }) : {}),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		body: JSON.stringify(options),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const { content } = await res.json();
	return content
}

export async function* llamaCppCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }: { endpoint: any; endpointAPIKey: any; proxyEndpoint: any; signal: any; [key: string]: any }): AsyncGenerator<CompletionChunk, void, unknown> {
	const res = await fetch(`${proxyEndpoint ?? endpoint}/completion`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(endpointAPIKey ? (proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }) : {}),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		body: JSON.stringify({
			...options,
			cache_prompt: true,
		}),
		signal,
	});

	if (!res.ok) {
		throw new Error(`HTTP ${res.status}`);
	}

	async function* yieldTokens(chunks: any) {
		for await (const chunk of chunks) {
			const token = chunk.content || chunk.token;
			const choice = chunk.completion_probabilities?.[0];

			let prob;
			let probs;
			if (choice?.top_probs) { // post_sampling_probs: true
				probs = choice.top_probs.map(({ token: t, prob: p }: { token: any; prob: any }) => {
					if (t === token) prob = p;
					return { tok_str: t, prob: p };
				});
			} else {  // post_sampling_probs: false
					let rawProbsArr = [];
				if (choice?.probs) {
						rawProbsArr = choice.probs.map((p: any) => ({ tok_str: p.tok_str, prob: p.prob }));
				} else {
						rawProbsArr = Object.values(choice?.top_logprobs || chunk.top_logprobs || {}).map(({ token: t, logprob }: any) => ({ tok_str: t, logprob }));
				}
					const res = applyTemperatureToProbs(rawProbsArr, token, options.temperature);
					probs = res.probs;
					prob = res.prob;
			}

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
		const { completion_probabilities } = await res.json();
		yield* yieldTokens(completion_probabilities);
	}
}
