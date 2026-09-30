import { describe, it, expect } from 'vitest';
import { importPreset } from './SamplerPresetManagerModal';

function native(): Record<string, unknown> {
	return {
		id: 'abc-123', name: 'Mine', enabled: true, seed: -1, maxPredictTokens: -1, temperature: 0.42,
		dynaTempRange: 0, dynaTempExp: 1, repeatPenalty: 1.1, repeatLastN: 256, penalizeNl: false,
		presencePenalty: 0, frequencyPenalty: 0, topK: 40, topP: 0.95, typicalP: 1, minP: 0, tfsZ: 1,
		mirostat: 0, mirostatTau: 5, mirostatEta: 0.1, xtcThreshold: 0.1, xtcProbability: 0,
		dryMultiplier: 0, dryBase: 1.75, dryAllowedLength: 2, dryPenaltyRange: 1024,
		drySequenceBreakers: '[]', bannedTokens: '[]', ignoreEos: false, enabledSamplers: ['top_k'], grammar: '',
	};
}

// Each importer names an unnamed preset its own way and reads temperature from its own field.
describe('importPreset', () => {
	it('reads a preset with a numeric presetVersion as NovelAI, even with SillyTavern fields', () => {
		const preset = importPreset({ presetVersion: 3, samplers: [], temp: 0.2, parameters: { temperature: 1.3 } }, []);

		expect(preset).toMatchObject({ name: 'Imported NAI Preset', temperature: 1.3 });
	});

	it.each(['samplers', 'sampler_priority', 'samplers_priorities'])('reads a preset with %s as SillyTavern', key => {
		const preset = importPreset({ [key]: [], temp: 0.2, parameters: { temperature: 1.3 } }, []);

		expect(preset).toMatchObject({ name: 'Imported Preset', temperature: 0.2 });
	});

	it('does not take a presetVersion that is not a number as NovelAI', () => {
		expect(importPreset({ presetVersion: '3', samplers: [] }, [])).toMatchObject({ name: 'Imported Preset' });
	});

	it('keeps a native preset as it is, name included, when the name is free', () => {
		expect(importPreset(native(), ['Other'])).toEqual(native());
	});

	it('renames a native preset whose name is taken to "(Imported)", then "(Imported 2)" and on', () => {
		expect(importPreset(native(), ['Mine'])?.name).toBe('Mine (Imported)');
		expect(importPreset(native(), ['Mine', 'Mine (Imported)'])?.name).toBe('Mine (Imported 2)');
		expect(importPreset(native(), ['Mine', 'Mine (Imported)', 'Mine (Imported 2)'])?.name).toBe('Mine (Imported 3)');
	});

	it('returns null for anything else', () => {
		expect(importPreset({}, [])).toBeNull();
		expect(importPreset({ ...native(), temperature: '0.42' }, [])).toBeNull();
	});
});
