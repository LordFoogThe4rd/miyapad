import { parseEventStream, applyTemperatureToProbs } from './common.js';

export async function koboldCppTokenCount({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	const res = await fetch(`${proxyEndpoint ?? endpoint}/api/extra/tokencount`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(endpointAPIKey ? (proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }) : {}),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		body: JSON.stringify({
			prompt: options.content
		}),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const { value } = await res.json();
	return value;
}

export async function koboldCppTokenize({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	const res = await fetch(`${proxyEndpoint ?? endpoint}/api/extra/tokencount`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(endpointAPIKey ? (proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }) : {}),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		body: JSON.stringify({
			prompt: options.content
		}),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const { ids } = await res.json();
	ids.shift() // kobold automatically adds a token, so we need to remove it
	return {ids:ids,str:""};

}

export function koboldCppConvertOptions(options, endpoint) {
	const endpointHost = (() => { try { return new URL(endpoint).hostname; } catch { return ''; } })();
	const isHorde = endpointHost === "aihorde.net" || endpointHost.endsWith(".aihorde.net");
	const swapOption = (lhs, rhs) => {
		if (lhs in options) {
			options[rhs] = options[lhs];
			delete options[lhs];
		}
	};
	if (options.n_predict === -1) {
		options.n_predict = isHorde ? 512 : 1024;
	}
	if (options.n_predict < 16 && isHorde) {
		options.n_predict = 16;
	}
	swapOption("n_ctx", "max_context_length");
	swapOption("n_predict", "max_length");
	swapOption("n_probs", "logprobs");
	swapOption("repeat_penalty", "rep_pen");
	swapOption("repeat_last_n", "rep_pen_range");
	swapOption("tfs_z", "tfs");
	swapOption("typical_p", "typical");
	swapOption("seed", "sampler_seed");
	swapOption("stop", "stop_sequence");
	swapOption("ignore_eos", "use_default_badwordsids");
	return options;
}

export async function* koboldCppCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	const res = await fetch(`${proxyEndpoint ?? endpoint}/api/${options.stream ? 'extra/generate/stream' : 'v1/generate'}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(endpointAPIKey ? (proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }) : {}),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		body: JSON.stringify({
			...koboldCppConvertOptions(options, endpoint)
		}),
		signal,
	});

	if (!res.ok) {
		throw new Error(`HTTP ${res.status}`);
	}

	async function* yieldTokens(chunks) {
		for await (const chunk of chunks) {
			const { token, top_logprobs } = chunk;

			let rawProbsArr = Object.values(top_logprobs ?? {}).map(({ token: t, logprob }) => ({ tok_str: t, logprob }));
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
		const { results } = await res.json();
		yield* yieldTokens(results?.[0].logprobs?.content ?? []);
	}
}

export async function koboldCppAbortCompletion({ endpoint, proxyEndpoint, ...options }) {
	try {
		await fetch(`${proxyEndpoint ?? endpoint}/api/extra/abort`, {
			method: 'POST',
			headers: {
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
		});
	} catch (e) {
		reportError(e);
	}
}
