import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeEndpoint, parseEventStream, applyTemperatureToProbs, buildLogitBiasParam } from './common';
import { API_OPENAI_COMPAT, API_KOBOLD_CPP, API_AI_HORDE, API_LLAMA_CPP, API_DEEPSEEK } from '../constants';

describe('normalizeEndpoint', () => {
	describe('OpenAI Compat (strips /v1)', () => {
		it('strips trailing /v1', () => {
			expect(normalizeEndpoint('http://localhost:8080/v1', API_OPENAI_COMPAT)).toBe('http://localhost:8080');
		});

		it('strips trailing /v1/', () => {
			expect(normalizeEndpoint('http://localhost:8080/v1/', API_OPENAI_COMPAT)).toBe('http://localhost:8080');
		});

		it('preserves sub-paths like /v1/completions', () => {
			expect(normalizeEndpoint('http://localhost:8080/v1/completions', API_OPENAI_COMPAT)).toBe('http://localhost:8080/v1/completions');
		});

		it('preserves sub-paths like /v1/chat/completions', () => {
			expect(normalizeEndpoint('http://localhost:8080/v1/chat/completions', API_OPENAI_COMPAT)).toBe('http://localhost:8080/v1/chat/completions');
		});

		it('handles endpoint without /v1', () => {
			expect(normalizeEndpoint('http://localhost:8080/', API_OPENAI_COMPAT)).toBe('http://localhost:8080');
		});
	});

	describe('KoboldCPP (strips /api)', () => {
		it('strips trailing /api', () => {
			expect(normalizeEndpoint('http://localhost:5001/api', API_KOBOLD_CPP)).toBe('http://localhost:5001');
		});

		it('strips trailing /api/', () => {
			expect(normalizeEndpoint('http://localhost:5001/api/', API_KOBOLD_CPP)).toBe('http://localhost:5001');
		});

		it('does not strip /api from middle of path', () => {
			expect(normalizeEndpoint('http://localhost:5001/some/api/other', API_KOBOLD_CPP)).toBe('http://localhost:5001/some/api/other');
		});
	});

	describe('AI Horde (hardcoded URL)', () => {
		it('replaces any endpoint with the AI Horde URL', () => {
			expect(normalizeEndpoint('http://localhost:5000', API_AI_HORDE)).toBe('https://aihorde.net/api');
		});

		it('replaces any endpoint with the AI Horde URL even with trailing slash', () => {
			expect(normalizeEndpoint('http://localhost:5000/', API_AI_HORDE)).toBe('https://aihorde.net/api');
		});
	});

	describe('Other API types (no stripping)', () => {
		it('strips trailing slash only for llama.cpp', () => {
			expect(normalizeEndpoint('http://localhost:8080/', API_LLAMA_CPP)).toBe('http://localhost:8080');
		});

		it('passes endpoint through unchanged when no trailing slash', () => {
			expect(normalizeEndpoint('http://localhost:1234', API_LLAMA_CPP)).toBe('http://localhost:1234');
		});
	});

	describe('DeepSeek (no stripping)', () => {
		it('strips trailing slash only', () => {
			expect(normalizeEndpoint('http://localhost:8080/', API_DEEPSEEK)).toBe('http://localhost:8080');
		});

		it('passes endpoint through unchanged when no trailing slash', () => {
			expect(normalizeEndpoint('http://localhost:1234', API_DEEPSEEK)).toBe('http://localhost:1234');
		});
	});

	describe('error handling', () => {
		it('throws on malformed URL', () => {
			expect(() => normalizeEndpoint('not a url', API_OPENAI_COMPAT)).toThrow();
		});
	});

	describe('general normalization', () => {
		it('normalizes consecutive slashes in pathname', () => {
			expect(normalizeEndpoint('http://localhost:8080//v1', API_OPENAI_COMPAT)).toBe('http://localhost:8080');
		});

		it('normalizes consecutive slashes in pathname independently of API stripping', () => {
			expect(normalizeEndpoint('http://localhost:8080//foo', API_LLAMA_CPP)).toBe('http://localhost:8080/foo');
		});

		it('trims whitespace from endpoint', () => {
			expect(normalizeEndpoint('  http://localhost:8080/v1  ', API_OPENAI_COMPAT)).toBe('http://localhost:8080');
		});
	});
});

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks)
				controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

async function collect<T>(gen: AsyncGenerator<T, void, undefined>): Promise<T[]> {
	const out: T[] = [];
	for await (const value of gen)
		out.push(value);
	return out;
}

describe('parseEventStream', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('yields nothing for a null stream', async () => {
		expect(await collect(parseEventStream(null))).toEqual([]);
	});

	it('parses each data line as its own JSON event', async () => {
		const events = await collect(parseEventStream(streamOf(
			'data: {"content":"a"}\n\ndata: {"content":"b"}\n\n'
		)));
		expect(events).toEqual([{ content: 'a' }, { content: 'b' }]);
	});

	it('accepts a data line with no space after the colon', async () => {
		expect(await collect(parseEventStream(streamOf('data:{"content":"a"}\n\n'))))
			.toEqual([{ content: 'a' }]);
	});

	it('buffers an event split across chunk boundaries', async () => {
		const events = await collect(parseEventStream(streamOf(
			'data: {"con', 'tent":"split"}\n', '\ndata: {"content":"next"}\n\n'
		)));
		expect(events).toEqual([{ content: 'split' }, { content: 'next' }]);
	});

	it('does not emit a spurious event when a CRLF is split across chunks', async () => {
		const events = await collect(parseEventStream(streamOf(
			'data: {"content":"a"}\r', '\ndata: {"content":"b"}\r\n'
		)));
		expect(events).toEqual([{ content: 'a' }, { content: 'b' }]);
	});

	it('skips events whose type is not "message"', async () => {
		const events = await collect(parseEventStream(streamOf(
			'event: ping\ndata: {"content":"ignored"}\n\ndata: {"content":"kept"}\n\n'
		)));
		expect(events).toEqual([{ content: 'kept' }]);
	});

	it('stops yielding at the [DONE] sentinel', async () => {
		const events = await collect(parseEventStream(streamOf(
			'data: {"content":"a"}\n\ndata: [DONE]\n\ndata: {"content":"never"}\n\n'
		)));
		expect(events).toEqual([{ content: 'a' }]);
	});

	it('throws when the payload carries an error message', async () => {
		await expect(collect(parseEventStream(streamOf('data: {"error":{"message":"boom"}}\n\n'))))
			.rejects.toThrow('boom');
	});

	it('skips a malformed payload instead of aborting the stream', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const events = await collect(parseEventStream(streamOf(
			'data: not json\n\ndata: {"content":"after"}\n\n'
		)));
		expect(events).toEqual([{ content: 'after' }]);
		expect(consoleError).toHaveBeenCalled();
	});
});

describe('applyTemperatureToProbs', () => {
	it('converts logprobs to probs and reports the chosen token at temperature 1', () => {
		const probs: ProbItem[] = [{ tok_str: 'a', logprob: Math.log(0.6) }, { tok_str: 'b', logprob: Math.log(0.4) }];
		const { probs: out, prob } = applyTemperatureToProbs(probs, 'b', 1);
		expect(out[0].prob).toBeCloseTo(0.6, 10);
		expect(out[1].prob).toBeCloseTo(0.4, 10);
		expect(prob).toBeCloseTo(0.4, 10);
	});

	it('treats a missing or non-finite temperature as 1', () => {
		const base: ProbItem[] = [{ tok_str: 'a', logprob: Math.log(0.6) }, { tok_str: 'b', logprob: Math.log(0.4) }];
		for (const temperature of [undefined, NaN, Infinity]) {
			const { probs } = applyTemperatureToProbs(structuredClone(base), 'a', temperature);
			expect(probs[0].prob).toBeCloseTo(0.6, 10);
			expect(probs[1].prob).toBeCloseTo(0.4, 10);
		}
	});

	it('leaves an existing prob untouched at temperature 1', () => {
		const { probs, prob } = applyTemperatureToProbs([{ tok_str: 'a', prob: 0.25, logprob: Math.log(0.9) }], 'a', 1);
		expect(probs[0].prob).toBe(0.25);
		expect(prob).toBe(0.25);
	});

	it('returns an undefined prob when the sampled token is absent from the list', () => {
		expect(applyTemperatureToProbs([{ tok_str: 'a', prob: 1 }], 'z', 1).prob).toBeUndefined();
	});

	it('sharpens the distribution below temperature 1 while preserving total mass', () => {
		const { probs, prob } = applyTemperatureToProbs(
			[{ tok_str: 'a', prob: 0.6 }, { tok_str: 'b', prob: 0.4 }], 'a', 0.5);
		expect(probs[0].prob).toBeCloseTo(0.36 / 0.52, 10);
		expect(probs[1].prob).toBeCloseTo(0.16 / 0.52, 10);
		expect(probs[0].prob! + probs[1].prob!).toBeCloseTo(1, 10);
		expect(prob).toBeCloseTo(0.36 / 0.52, 10);
	});

	it('flattens the distribution above temperature 1', () => {
		const { probs } = applyTemperatureToProbs(
			[{ tok_str: 'a', prob: 0.6 }, { tok_str: 'b', prob: 0.4 }], 'a', 2);
		expect(probs[0].prob!).toBeLessThan(0.6);
		expect(probs[1].prob!).toBeGreaterThan(0.4);
		expect(probs[0].prob! + probs[1].prob!).toBeCloseTo(1, 10);
	});

	it('clamps temperature to 0.01 rather than dividing by zero', () => {
		const { probs } = applyTemperatureToProbs(
			[{ tok_str: 'a', prob: 0.6 }, { tok_str: 'b', prob: 0.4 }], 'a', 0);
		expect(probs[0].prob).toBeCloseTo(1, 10);
		expect(probs[1].prob).toBeCloseTo(0, 10);
	});

	it('zeroes entries that carry neither prob nor logprob and drops the temp scratch key', () => {
		const { probs } = applyTemperatureToProbs(
			[{ tok_str: 'a', prob: 0.6 }, { tok_str: 'b' }], 'a', 0.5);
		expect(probs[1].prob).toBe(0);
		expect(probs.every(p => !Object.hasOwn(p, 'temp_p'))).toBe(true);
	});

	it('mutates and returns the array it was given', () => {
		const input: ProbItem[] = [{ tok_str: 'a', logprob: Math.log(0.5) }];
		const { probs } = applyTemperatureToProbs(input, 'a', 1);
		expect(probs).toBe(input);
		expect(input[0].prob).toBeCloseTo(0.5, 10);
	});
});

describe('buildLogitBiasParam', () => {
	const bias = { bias: {
		hello: { ids: [1, 2], strings: ['hello'], power: 55 },
		banned: { ids: [3], strings: ['banned'], power: -100 },
	}, model: 'none' };

	it('sends llama.cpp pairs, banned tokens as false and the rest scaled down', () => {
		expect(buildLogitBiasParam(bias, API_LLAMA_CPP)).toEqual([[1, 5.5], [2, 5.5], [3, false]]);
	});

	it('clamps to KoboldCpp/Horde range keyed by token id', () => {
		expect(buildLogitBiasParam(bias, API_KOBOLD_CPP)).toEqual({ 1: 55, 2: 55, 3: -100 });
		expect(buildLogitBiasParam(bias, API_AI_HORDE)).toEqual({ 1: 55, 2: 55, 3: -100 });
	});

	it('rounds to one decimal for OpenAI-compatible endpoints', () => {
		const odd = { bias: { x: { ids: [7], strings: ['x'], power: 12.345 } }, model: 'none' };
		expect(buildLogitBiasParam(odd, API_OPENAI_COMPAT)).toEqual({ 7: 12.3 });
		expect(buildLogitBiasParam(odd, API_DEEPSEEK)).toEqual({ 7: 12.3 });
	});

	it('is empty when there is no bias set', () => {
		expect(buildLogitBiasParam({ bias: {}, model: 'none' }, API_LLAMA_CPP)).toEqual([]);
		expect(buildLogitBiasParam(bias, -1)).toEqual({});
	});
});
