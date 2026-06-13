import { koboldCppConvertOptions } from './koboldcpp';

export async function aiHordeModels({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	const res = await fetch(`${proxyEndpoint ?? endpoint}/v2/status/models?type=text`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		signal,
	});

	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);

	const response = await res.json();

	return response
		.filter(model => model.type === "text")
		.map(model => model.name);
}

export async function* aiHordeCompletion({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	const { model, prompt, ...params } = options;
	const submitRes = await fetch(`${proxyEndpoint ?? endpoint}/v2/generate/text/async`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Apikey': endpointAPIKey?.trim() ? endpointAPIKey : '0000000000',
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		body: JSON.stringify({
			...(model ? { models: model.split(', ') } : {}),
			params: { ...koboldCppConvertOptions(params, endpoint) },
			prompt: prompt
		}),
		signal,
	});
	if (!submitRes.ok)
		throw new Error(`HTTP ${submitRes.status}`);
	const { id: taskId } = await submitRes.json();

	yield { status: 'queue_init', taskId: taskId };

	// Poll for results
	while (true) {
		const checkRes = await fetch(`${proxyEndpoint ?? endpoint}/v2/generate/text/status/${taskId}`, {
			headers: {
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
			signal,
		});

		if (!checkRes.ok)
			throw new Error(`HTTP ${checkRes.status}`);
		const status = await checkRes.json();

		yield { status: 'queue_status', position: status.queue_position, waitTime: status.wait_time, processing: status.processing };

		if (status.done) {
			if (status.generations && status.generations.length > 0) {
				yield { status: 'done', content: status.generations[0].text };
			}
			break;
		}

		// Wait before polling again
		await new Promise(resolve => setTimeout(resolve, 1000));
	}
}

export async function aiHordeAbortCompletion({ endpoint, proxyEndpoint, hordeTaskId, ...options }) {
	try {
		await fetch(`${proxyEndpoint ?? endpoint}/v2/generate/text/status/${hordeTaskId}`, {
			method: 'DELETE',
			headers: {
				...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
			},
		});
	} catch (e) {
		reportError(e);
	}
}
