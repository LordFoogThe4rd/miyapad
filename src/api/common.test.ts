import { describe, it, expect } from 'vitest';
import { normalizeEndpoint } from './common';
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
