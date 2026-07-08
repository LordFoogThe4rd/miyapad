import { describe, it, expect } from 'vitest';
import {
	API_LLAMA_CPP,
	API_KOBOLD_CPP,
	API_OPENAI_COMPAT,
	API_AI_HORDE,
	API_DEEPSEEK,
} from './constants';

describe('API type constants', () => {
	it('are all non-negative integers', () => {
		for (const value of [API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE, API_DEEPSEEK]) {
			expect(Number.isInteger(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(0);
		}
	});

	it('are all distinct', () => {
		const values = [API_LLAMA_CPP, API_KOBOLD_CPP, API_OPENAI_COMPAT, API_AI_HORDE, API_DEEPSEEK];
		expect(new Set(values).size).toBe(values.length);
	});
});
