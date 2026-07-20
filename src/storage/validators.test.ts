import { describe, it, expect } from 'vitest';
import { isSamplerPresetData } from './validators';

function makeValid(): SamplerPresetData {
  return {
    id: 'abc-123',
    name: 'Test Preset',
    enabled: true,
    seed: -1,
    maxPredictTokens: -1,
    temperature: 0.7,
    dynaTempRange: 0,
    dynaTempExp: 1,
    repeatPenalty: 1.1,
    repeatLastN: 256,
    penalizeNl: false,
    presencePenalty: 0,
    frequencyPenalty: 0,
    topK: 40,
    topP: 0.95,
    typicalP: 1,
    minP: 0,
    tfsZ: 1,
    mirostat: 0,
    mirostatTau: 5.0,
    mirostatEta: 0.1,
    xtcThreshold: 0.1,
    xtcProbability: 0,
    dryMultiplier: 0,
    dryBase: 1.75,
    dryAllowedLength: 2,
    dryPenaltyRange: 1024,
    drySequenceBreakers: '["\\n",":","\\"","*"]',
    bannedTokens: '[]',
    ignoreEos: false,
    enabledSamplers: [],
    grammar: '',
  };
}

function clone<T extends object>(obj: T): Record<string, unknown> {
  return structuredClone(obj) as Record<string, unknown>;
}

describe('isSamplerPresetData', () => {
  it('valid complete object', () => {
    expect(isSamplerPresetData(makeValid())).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isSamplerPresetData(null)).toBe(false);
    expect(isSamplerPresetData(undefined)).toBe(false);
    expect(isSamplerPresetData(42)).toBe(false);
    expect(isSamplerPresetData('foo')).toBe(false);
    expect(isSamplerPresetData([])).toBe(false);
  });

  it('rejects missing required fields', () => {
    const valid = makeValid();
    const fields = Object.keys(valid);
    for (const field of fields) {
      const missing = clone(valid);
      delete missing[field];
      expect(isSamplerPresetData(missing)).toBe(false);
    }
  });

  it('rejects wrong types per field', () => {
    const valid = makeValid();
    const numberFields: (keyof SamplerPresetData)[] = [
      'seed', 'maxPredictTokens', 'temperature', 'dynaTempRange', 'dynaTempExp',
      'repeatPenalty', 'repeatLastN', 'presencePenalty', 'frequencyPenalty',
      'topK', 'topP', 'typicalP', 'minP', 'tfsZ', 'mirostat', 'mirostatTau',
      'mirostatEta', 'xtcThreshold', 'xtcProbability', 'dryMultiplier', 'dryBase',
      'dryAllowedLength', 'dryPenaltyRange',
    ];
    for (const field of numberFields) {
      const bad = clone(valid);
      bad[field] = 'not-a-number';
      expect(isSamplerPresetData(bad)).toBe(false);
    }

    const stringFields: (keyof SamplerPresetData)[] = ['id', 'name', 'drySequenceBreakers', 'bannedTokens', 'grammar'];
    for (const field of stringFields) {
      const bad = clone(valid);
       bad[field] = 42;
      expect(isSamplerPresetData(bad)).toBe(false);
    }

    const boolFields: (keyof SamplerPresetData)[] = ['enabled', 'penalizeNl', 'ignoreEos'];
    for (const field of boolFields) {
      const bad = clone(valid);
       bad[field] = 'true';
      expect(isSamplerPresetData(bad)).toBe(false);
    }

    const badSamplers = clone(valid);
    badSamplers.enabledSamplers = ['top_p', 1];
    expect(isSamplerPresetData(badSamplers)).toBe(false);

    const validSamplers = makeValid();
    validSamplers.enabledSamplers = ['top_p'];
    expect(isSamplerPresetData(validSamplers)).toBe(true);
  });

  it('accepts edge values', () => {
    const edge = makeValid();
    edge.seed = 0;
    edge.maxPredictTokens = -1;
    edge.temperature = 0;
    edge.enabledSamplers = [];
    edge.bannedTokens = '[]';
    edge.grammar = '';
    expect(isSamplerPresetData(edge)).toBe(true);
  });


});
