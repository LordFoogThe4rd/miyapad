import { API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE, API_DEEPSEEK } from '../constants';

export function exportUrl(filename: string, url: string) {
	var element = document.createElement('a');
	element.setAttribute('href', url);
	element.setAttribute('download', filename);
	element.style.display = 'none';
	document.body.appendChild(element);
	element.click();
	document.body.removeChild(element);
}

export function exportText(filename: string, text: string) {
	const textBlob = new Blob([text], {type: 'text/plain;charset=utf-8'});
	const textURL = URL.createObjectURL(textBlob);
	exportUrl(filename, textURL);
	URL.revokeObjectURL(textURL);
}

export function normalizeEndpoint(endpoint: string, endpointAPI: number) {
	const url = new URL(endpoint.trim());
	url.pathname = url.pathname.replace(/\/+/g, "/"); // normalize consecutive slashes

	let urlString = url.toString();
	if (endpointAPI == API_OPENAI_COMPAT)
		urlString = urlString.replace(/\/v1\/?$/, ""); // remove "/v1" from the end of the string
	if (endpointAPI == API_KOBOLD_CPP)
		urlString = urlString.replace(/\/api\/?$/, ""); // remove "/api" from the end of the string
	if (endpointAPI == API_AI_HORDE)
		urlString = "https://aihorde.net/api";
	urlString = urlString.replace(/\/$/, ""); // remove "/" from the end of the string

	return urlString;
}

// Function to parse text/event-stream data and yield JSON objects
export async function* parseEventStream(eventStream: ReadableStream<Uint8Array> | null): AsyncGenerator<unknown, void, undefined> {
	if (!eventStream)
		return;

	let buf = '';
	let ignoreNextLf = false;

	for await (let chunk of (eventStream.pipeThrough(new TextDecoderStream() as ReadableWritablePair<string, Uint8Array>))) {
		// A CRLF could be split between chunks, so if the last chunk ended in
		// CR and this chunk started with LF, trim the LF
		if (ignoreNextLf && /^\n/.test(chunk)) {
			chunk = chunk.slice(1);
		}
		ignoreNextLf = /\r$/.test(chunk);

		// Event streams must be parsed line-by-line (ending in CR, LF, or CRLF)
		const lines = (buf + chunk).split(/\n|\r\n?/);
		buf = lines.pop() ?? '';
		let type, data;

		for (const line of lines) {
			if (!line) {
				type = undefined;
				data = undefined;
				continue;
			}
			const { name, value } = /^(?<name>.*?)(?:: ?(?<value>.*))?$/s.exec(line)?.groups ?? {};
			switch (name) {
				case 'event':
					type = (value ?? '');
					break;
				case 'data':
					data = data === undefined ? (value ?? '') : `${data}\n${value}`;
					break;
			}
			// We only emit message-type events for now (and assume JSON)
			if (data && (type || 'message') === 'message') {
				if (data === '[DONE]') {
					// This is a hack because we aren't following exactly the spec...
					break;
				}
				let json;
				try {
					json = JSON.parse(data);
				} catch (e) {
					console.error('Failed to parse SSE data', data, e);
					continue;
				}
				if (json.error?.message) {
					throw new Error(json.error.message);
				}
				// Both Chrome and Firefox suck at debugging
				// text/event-stream, so make it easier by logging events
				if (window.logSSEEvents) {
					console.log('event', json);
				}
				yield json;
				type = undefined;
				data = undefined;
			}
		}
	}
}

export function applyTemperatureToProbs(probsArr: ProbItem[], token: string, temperature?: number): { probs: ProbItem[]; prob?: number } {
	const t = Math.max(0.01, (temperature != null && isFinite(temperature)) ? temperature : 1);
	if (t === 1) {
		let chosenProb;
	probsArr.forEach((p: ProbItem) => {
			if (p.logprob !== undefined && p.prob === undefined) {
				p.prob = Math.exp(p.logprob);
			}
			if (p.tok_str === token) chosenProb = p.prob;
		});
		return { probs: probsArr, prob: chosenProb };
	}

	let pSum = 0;
	let pOrigSum = 0;
	for (const p of probsArr as (ProbItem & { temp_p?: number })[]) {
		if (p.prob === undefined && p.logprob === undefined) continue;
		const orig_p = p.prob ?? Math.exp(p.logprob!);
		pOrigSum += orig_p;
		const log_p = p.logprob !== undefined ? p.logprob : Math.log(Math.max(1e-10, orig_p));
		p.temp_p = Math.exp(log_p / t);
		pSum += p.temp_p;
	}

	let chosenProb;
	for (const p of probsArr as (ProbItem & { temp_p?: number })[]) {
		if (p.temp_p === undefined) { p.prob = 0; continue; }
		p.prob = pSum > 0 ? p.temp_p * (pOrigSum / pSum) : 0;
		if (p.tok_str === token) chosenProb = p.prob;
		delete p.temp_p;
	}
	return { probs: probsArr, prob: chosenProb };
}

const clamp = (num: number, min: number, max: number) => Math.min(Math.max(num, min), max);

/** The logit bias map in the shape the given endpoint expects. */
export function buildLogitBiasParam(logitBias: LogitBiasState, endpointAPI: number) {
	const entries = Object.values(logitBias?.bias ?? {});
	switch (endpointAPI) {
	case API_LLAMA_CPP: {
		// banned tokens go as false, the rest divided by 10 to stay within a reasonable range
		const param: [number, number | false][] = [];
		for (const entry of entries)
			for (const id of entry.ids)
				param.push([Number(id), entry.power < -99 ? false : Number(entry.power) / 10]);
		return param;
	}
	case API_KOBOLD_CPP:
	case API_AI_HORDE: {
		const param: Record<string, number> = {};
		for (const entry of entries)
			for (const id of entry.ids)
				param[Number(id)] = clamp(Number(entry.power), -100, 100);
		return param;
	}
	case API_OPENAI_COMPAT:
	case API_DEEPSEEK: {
		const param: Record<string, number> = {};
		for (const entry of entries)
			for (const id of entry.ids)
				param[String(id)] = Number(clamp(Number(entry.power), -100, 100).toFixed(1));
		return param;
	}
	default:
		return {};
	}
}
