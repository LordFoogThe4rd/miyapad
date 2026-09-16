import { describe, it, expect } from 'vitest';
import { koboldCppConvertOptions } from './koboldcpp';

const LOCAL = 'http://localhost:5001';
const HORDE = 'https://aihorde.net/api';

describe('koboldCppConvertOptions', () => {
	it('renames llama.cpp sampler keys to their Kobold equivalents', () => {
		const out = koboldCppConvertOptions({
			n_ctx: 4096,
			n_predict: 256,
			n_probs: 10,
			repeat_penalty: 1.1,
			repeat_last_n: 320,
			tfs_z: 0.95,
			typical_p: 0.9,
			seed: 42,
			stop: ['\n'],
			ignore_eos: true,
		}, LOCAL);

		expect(out).toEqual({
			max_context_length: 4096,
			max_length: 256,
			logprobs: 10,
			rep_pen: 1.1,
			rep_pen_range: 320,
			tfs: 0.95,
			typical: 0.9,
			sampler_seed: 42,
			stop_sequence: ['\n'],
			use_default_badwordsids: true,
		});
	});

	it('leaves keys that have no Kobold alias alone', () => {
		expect(koboldCppConvertOptions({ temperature: 0.7, top_p: 0.95, prompt: 'hi', n_predict: 64 }, LOCAL))
			.toEqual({ temperature: 0.7, top_p: 0.95, prompt: 'hi', max_length: 64 });
	});

	it('only renames a key that is present, rather than inventing it', () => {
		const out = koboldCppConvertOptions({ n_predict: 64 }, LOCAL);
		expect(Object.hasOwn(out, 'max_context_length')).toBe(false);
		expect(Object.hasOwn(out, 'rep_pen')).toBe(false);
	});

	it('defaults an absent token budget to 1024 for a local endpoint', () => {
		expect(koboldCppConvertOptions({}, LOCAL).max_length).toBe(1024);
	});

	it('defaults an absent token budget to 512 for the horde', () => {
		expect(koboldCppConvertOptions({}, HORDE).max_length).toBe(512);
	});

	it('treats an unlimited (-1) token budget as the endpoint default', () => {
		expect(koboldCppConvertOptions({ n_predict: -1 }, LOCAL).max_length).toBe(1024);
		expect(koboldCppConvertOptions({ n_predict: -1 }, HORDE).max_length).toBe(512);
	});

	it('raises a horde request below the 16 token floor', () => {
		expect(koboldCppConvertOptions({ n_predict: 8 }, HORDE).max_length).toBe(16);
		expect(koboldCppConvertOptions({ n_predict: 0 }, HORDE).max_length).toBe(16);
	});

	it('leaves a small token budget alone for a local endpoint', () => {
		expect(koboldCppConvertOptions({ n_predict: 8 }, LOCAL).max_length).toBe(8);
	});

	it('applies the horde rules to horde subdomains too', () => {
		expect(koboldCppConvertOptions({ n_predict: 8 }, 'https://stablehorde.aihorde.net/api').max_length).toBe(16);
	});

	it('does not mistake a lookalike host for the horde', () => {
		expect(koboldCppConvertOptions({ n_predict: 8 }, 'https://notaihorde.net/api').max_length).toBe(8);
		expect(koboldCppConvertOptions({}, 'https://aihorde.net.example.com').max_length).toBe(1024);
	});

	it('falls back to the local defaults when the endpoint is not a valid URL', () => {
		expect(koboldCppConvertOptions({}, 'not a url').max_length).toBe(1024);
	});

	it('mutates and returns the options object it was given', () => {
		const options = { n_ctx: 2048, n_predict: 64 };
		const out = koboldCppConvertOptions(options, LOCAL);
		expect(out).toBe(options);
		expect(Object.hasOwn(options, 'n_ctx')).toBe(false);
	});
});
