import { describe, it, expect } from 'vitest';
import { importNaiPreset } from './nai';

describe('importNaiPreset', () => {
  it('full mapping: copies all 1:1 fields', () => {
    const nai = {
      name: 'My NAI Preset',
      presetVersion: 1,
      id: 'abc',
      remoteId: 'def',
      model: 'kayra',
      parameters: {
        textGenerationSettingsVersion: 3,
        temperature: 0.8,
        max_length: 500,
        min_length: 1,
        top_k: 100,
        top_p: 0.9,
        top_a: 0,
        typical_p: 0.7,
        tail_free_sampling: 0.8,
        repetition_penalty: 1.2,
        repetition_penalty_range: 512,
        repetition_penalty_slope: 0,
        repetition_penalty_frequency: 0.1,
        repetition_penalty_presence: 0.2,
        repetition_penalty_default_whitelist: false,
        cfg_scale: 1,
        cfg_uc: '',
        phrase_rep_pen: 'none',
        top_g: 0,
        mirostat_tau: 0,
        mirostat_lr: 0.05,
        math1_temp: 0,
        math1_quad: 0,
        math1_quad_entropy_scale: 0,
        min_p: 0.05,
        order: [],
      },
    };
    const result = importNaiPreset(nai, []);
    expect(result.name).toBe('My NAI Preset');
    expect(result.maxPredictTokens).toBe(500);
    expect(result.temperature).toBe(0.8);
    expect(result.topK).toBe(100);
    expect(result.topP).toBe(0.9);
    expect(result.typicalP).toBe(0.7);
    expect(result.tfsZ).toBe(0.8);
    expect(result.repeatPenalty).toBe(1.2);
    expect(result.repeatLastN).toBe(512);
    expect(result.frequencyPenalty).toBe(0.1);
    expect(result.presencePenalty).toBe(0.2);
    expect(result.minP).toBe(0.05);
    expect(result.mirostatEta).toBe(0.05);
    expect(result.mirostatTau).toBe(0);
    expect(result.mirostat).toBe(0);
  });

  it('order -> enabledSamplers: disabled entries excluded', () => {
    const nai = {
      name: 'test',
      parameters: {
        temperature: 0.7, repetition_penalty: 0, repetition_penalty_frequency: 0,
        repetition_penalty_presence: 0, phrase_rep_pen: 'none', mirostat_tau: 0,
        order: [
          { id: 'temperature', enabled: true },
          { id: 'top_k', enabled: true },
          { id: 'mirostat', enabled: false },
        ],
      },
    };
    const result = importNaiPreset(nai, []);
    expect(result.enabledSamplers).toEqual(['temperature', 'top_k']);
  });

  it('secondary sampler enablement: rep_pen if repetition_penalty > 0', () => {
    const nai = {
      name: 'test',
      parameters: {
        temperature: 0.7, repetition_penalty: 1.1, repetition_penalty_frequency: 0,
        repetition_penalty_presence: 0, phrase_rep_pen: 'none', mirostat_tau: 0,
        order: [],
      },
    };
    const result = importNaiPreset(nai, []);
    expect(result.enabledSamplers).toContain('rep_pen');
  });

  it('secondary sampler enablement: freq_pen and pres_pen when > 0', () => {
    const nai = {
      name: 'test',
      parameters: {
        temperature: 0.7, repetition_penalty: 0, repetition_penalty_frequency: 0.1,
        repetition_penalty_presence: 0.1, phrase_rep_pen: 'none', mirostat_tau: 0,
        order: [],
      },
    };
    const result = importNaiPreset(nai, []);
    expect(result.enabledSamplers).toContain('freq_pen');
    expect(result.enabledSamplers).toContain('pres_pen');
  });

  it('phrase_rep_pen -> dryMultiplier', () => {
    const cases: [string, number][] = [
      ['none', 0],
      ['light', 0.4],
      ['medium', 0.8],
      ['aggressive', 1.2],
      ['very_aggressive', 1.6],
    ];
    for (const [val, expected] of cases) {
      const nai = {
        name: 'test',
        parameters: {
          temperature: 0.7, repetition_penalty: 0, repetition_penalty_frequency: 0,
          repetition_penalty_presence: 0, phrase_rep_pen: val, mirostat_tau: 0,
          order: [],
        },
      };
      expect(importNaiPreset(nai, []).dryMultiplier).toBe(expected);
    }
  });

  it('penalizeNl inversion', () => {
    const nai = {
      name: 'test',
      parameters: {
        temperature: 0.7, repetition_penalty: 0, repetition_penalty_frequency: 0,
        repetition_penalty_presence: 0, phrase_rep_pen: 'none', mirostat_tau: 0,
        repetition_penalty_default_whitelist: true,
        order: [],
      },
    };
    expect(importNaiPreset(nai, []).penalizeNl).toBe(false);

    const nai2: Record<string, unknown> = {
      name: 'test',
      parameters: {
        temperature: 0.7, repetition_penalty: 0, repetition_penalty_frequency: 0,
        repetition_penalty_presence: 0, phrase_rep_pen: 'none', mirostat_tau: 0,
        repetition_penalty_default_whitelist: false,
        order: [],
      },
    };
    expect(importNaiPreset(nai2, []).penalizeNl).toBe(true);
  });

  it('mirostat detection: tau > 0 -> mirostat: 1', () => {
    const nai = {
      name: 'test',
      parameters: {
        temperature: 0.7, repetition_penalty: 0, repetition_penalty_frequency: 0,
        repetition_penalty_presence: 0, phrase_rep_pen: 'none', mirostat_tau: 5.0,
        order: [],
      },
    };
    const result = importNaiPreset(nai, []);
    expect(result.mirostat).toBe(1);
    expect(result.mirostatTau).toBe(5.0);
  });

  it('mirostat detection: order entry enabled -> mirostat: 1', () => {
    const nai = {
      name: 'test',
      parameters: {
        temperature: 0.7, repetition_penalty: 0, repetition_penalty_frequency: 0,
        repetition_penalty_presence: 0, phrase_rep_pen: 'none', mirostat_tau: 0,
        order: [{ id: 'mirostat', enabled: true }],
      },
    };
    expect(importNaiPreset(nai, []).mirostat).toBe(1);
  });

  it('name collision appends (Imported)', () => {
    const nai = {
      name: 'Preset',
      parameters: {
        temperature: 0.7, repetition_penalty: 0, repetition_penalty_frequency: 0,
        repetition_penalty_presence: 0, phrase_rep_pen: 'none', mirostat_tau: 0,
        order: [],
      },
    };
    const result = importNaiPreset(nai, ['Preset']);
    expect(result.name).toBe('Preset (Imported)');
  });

  it('unmapped fields get defaults', () => {
    const nai = {
      name: 'test',
      parameters: {
        temperature: 0.7, repetition_penalty: 0, repetition_penalty_frequency: 0,
        repetition_penalty_presence: 0, phrase_rep_pen: 'none', mirostat_tau: 0,
        order: [],
      },
    };
    const result = importNaiPreset(nai, []);
    expect(result.seed).toBe(-1);
    expect(result.dynaTempRange).toBe(0);
    expect(result.xtcProbability).toBe(0);
    expect(result.grammar).toBe('');
    expect(result.ignoreEos).toBe(false);
  });

  it('phrase_rep_pen disabled in order excludes dry from enabledSamplers', () => {
    const nai = {
      name: 'test',
      parameters: {
        temperature: 0.7, repetition_penalty: 0, repetition_penalty_frequency: 0,
        repetition_penalty_presence: 0, phrase_rep_pen: 'aggressive', mirostat_tau: 0,
        order: [
          { id: 'temperature', enabled: true },
          { id: 'phrase_rep_pen', enabled: false },
        ],
      },
    };
    const result = importNaiPreset(nai, []);
    expect(result.enabledSamplers).not.toContain('dry');
  });
});
