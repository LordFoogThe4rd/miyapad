import { describe, expect, it } from 'vitest';
import { ManifestValidationError, parseManifest } from './manifest';

describe('parseManifest', () => {
	const base = () => ({
		id: 'date-plugin_1',
		name: 'Date in prompts',
		version: '1.4.0',
	});

	it('parses required fields and fills defaults for order and api', () => {
		expect(parseManifest(base())).toEqual({
			id: 'date-plugin_1',
			name: 'Date in prompts',
			version: '1.4.0',
			order: 0,
			api: 1,
		});
	});

	it('accepts all optional metadata, bounds, timeouts and requires, ignoring unknown fields', () => {
		expect(parseManifest({
			...base(),
			description: 'Replaces {{date}} in the prompt.',
			author: 'Miyapad',
			homepage: 'https://github.com/example/plugin',
			minMiyapad: '2.9.0',
			maxMiyapad: '2.11',
			order: -10,
			startTimeout: 3,
			hookTimeout: 25,
			api: 2,
			requires: ['server', 'server'],
			futureField: { nested: true },
		})).toEqual({
			id: 'date-plugin_1',
			name: 'Date in prompts',
			version: '1.4.0',
			description: 'Replaces {{date}} in the prompt.',
			author: 'Miyapad',
			homepage: 'https://github.com/example/plugin',
			minMiyapad: '2.9.0',
			maxMiyapad: '2.11',
			order: -10,
			startTimeout: 3,
			hookTimeout: 25,
			api: 2,
			requires: ['server'],
		});
	});

	it('rejects non-objects and missing required fields', () => {
		for (const bad of [null, undefined, 'x', 42, []]) {
			expect(() => parseManifest(bad)).toThrow(ManifestValidationError);
		}
		for (const field of ['id', 'name', 'version'] as const) {
			const raw = base() as Record<string, unknown>;
			delete raw[field];
			expect(() => parseManifest(raw), `missing ${field}`).toThrow(ManifestValidationError);
		}
		expect(() => parseManifest({ ...base(), name: '   ' })).toThrow(ManifestValidationError);
	});

	it('enforces the lowercase id regex and length limit', () => {
		expect(parseManifest({ ...base(), id: 'a' }).id).toBe('a');
		expect(parseManifest({ ...base(), id: 'a' + '0'.repeat(63) }).id).toHaveLength(64);

		for (const badId of ['', 'Date', '-date', '_date', 'a/b', 'a.b', 'a b', 'a' + '0'.repeat(64)]) {
			expect(() => parseManifest({ ...base(), id: badId }), `id=${badId}`).toThrow(ManifestValidationError);
		}
	});

	it('enforces plain numeric versions on version, minMiyapad and maxMiyapad', () => {
		expect(parseManifest({ ...base(), version: '2.10' }).version).toBe('2.10');
		for (const badVer of ['', 'v1.0.0', '1.0.0-beta', '1..0', 'abc']) {
			expect(() => parseManifest({ ...base(), version: badVer })).toThrow(ManifestValidationError);
			expect(() => parseManifest({ ...base(), minMiyapad: badVer })).toThrow(ManifestValidationError);
			expect(() => parseManifest({ ...base(), maxMiyapad: badVer })).toThrow(ManifestValidationError);
		}
	});

	it('validates order as a finite safe integer', () => {
		expect(parseManifest({ ...base(), order: -5 }).order).toBe(-5);
		expect(parseManifest({ ...base(), order: 0 }).order).toBe(0);
		expect(parseManifest({ ...base(), order: 42 }).order).toBe(42);

		for (const badOrder of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', null]) {
			expect(() => parseManifest({ ...base(), order: badOrder })).toThrow(ManifestValidationError);
		}
	});

	it('validates requires and rejects unknown capabilities or bad field types', () => {
		expect(parseManifest({ ...base(), requires: [] }).requires).toBeUndefined();
		expect(() => parseManifest({ ...base(), requires: 'server' })).toThrow(ManifestValidationError);
		expect(() => parseManifest({ ...base(), requires: ['gpu'] })).toThrow(ManifestValidationError);
		expect(() => parseManifest({ ...base(), requires: [1] })).toThrow(ManifestValidationError);
		expect(() => parseManifest({ ...base(), description: 123 })).toThrow(ManifestValidationError);
		expect(() => parseManifest({ ...base(), author: false })).toThrow(ManifestValidationError);
		expect(() => parseManifest({ ...base(), homepage: 'javascript:alert(1)' })).toThrow(ManifestValidationError);
		expect(() => parseManifest({ ...base(), startTimeout: 0 })).toThrow(ManifestValidationError);
		expect(() => parseManifest({ ...base(), hookTimeout: 1.5 })).toThrow(ManifestValidationError);
		expect(() => parseManifest({ ...base(), api: 0 })).toThrow(ManifestValidationError);
	});
});
