import { describe, it, expect } from 'vitest';
import { importSillyTavernPreset } from './sillytavern';

describe('importSillyTavernPreset', () => {
  it('full mapping: copies all 1:1 fields', () => {
    const st = {
      name: 'My ST Preset',
      seed: 42,
      temp: 0.8,
      dynatemp_exponent: 2,
      rep_pen: 1.2,
      rep_pen_range: 512,
      presence_pen: 0.1,
      freq_pen: 0.2,
      top_k: 50,
      top_p: 0.9,
      typical_p: 0.8,
      min_p: 0.1,
      tfs: 0.5,
      mirostat_mode: 1,
      mirostat_tau: 3.0,
      mirostat_eta: 0.2,
      xtc_threshold: 0.2,
      xtc_probability: 0.5,
      dry_multiplier: 1.0,
      dry_base: 2.0,
      dry_allowed_length: 4,
      dry_penalty_last_n: 2048,
      dry_sequence_breakers: '["\\n",";"]',
      banned_tokens: '["bad"]',
      samplers: ['temperature'],
    };
    const result = importSillyTavernPreset(st, []);
    expect(result.name).toBe('My ST Preset');
    expect(result.seed).toBe(42);
    expect(result.temperature).toBe(0.8);
    expect(result.dynaTempExp).toBe(2);
    expect(result.repeatPenalty).toBe(1.2);
    expect(result.repeatLastN).toBe(512);
    expect(result.presencePenalty).toBe(0.1);
    expect(result.frequencyPenalty).toBe(0.2);
    expect(result.topK).toBe(50);
    expect(result.topP).toBe(0.9);
    expect(result.typicalP).toBe(0.8);
    expect(result.minP).toBe(0.1);
    expect(result.tfsZ).toBe(0.5);
    expect(result.mirostat).toBe(1);
    expect(result.mirostatTau).toBe(3.0);
    expect(result.mirostatEta).toBe(0.2);
    expect(result.xtcThreshold).toBe(0.2);
    expect(result.xtcProbability).toBe(0.5);
    expect(result.dryMultiplier).toBe(1.0);
    expect(result.dryBase).toBe(2.0);
    expect(result.dryAllowedLength).toBe(4);
    expect(result.dryPenaltyRange).toBe(2048);
    expect(result.drySequenceBreakers).toBe('["\\n",";"]');
    expect(result.bannedTokens).toBe('["bad"]');
  });

  it('enabledSamplers from samplers: penalties expands to 3, typ_p skipped', () => {
    const st = {
      samplers: ['temperature', 'penalties', 'dry', 'xtc', 'top_k', 'typ_p', 'top_p', 'min_p', 'typical_p', 'tfs_z'],
    };
    const result = importSillyTavernPreset(st, []);
    expect(result.enabledSamplers).toEqual([
      'temperature', 'rep_pen', 'pres_pen', 'freq_pen', 'dry', 'xtc',
      'top_k', 'top_p', 'min_p', 'typical_p', 'tfs_z',
    ]);
  });

  it('enabledSamplers fallback: sampler_priority', () => {
    const st = {
      sampler_priority: [
        { order: 0, priority: 10, sampler: 'temperature' },
        { order: 1, priority: 9, sampler: 'top_k' },
      ],
    };
    const result = importSillyTavernPreset(st, []);
    expect(result.enabledSamplers).toEqual(['temperature', 'top_k']);
  });

  it('enabledSamplers fallback: samplers_priorities', () => {
    const st = {
      samplers_priorities: [
        { order: 0, priority: 10, sampler: 'min_p' },
      ],
    };
    const result = importSillyTavernPreset(st, []);
    expect(result.enabledSamplers).toEqual(['min_p']);
  });

  it('dynatemp boolean adds dynatemp to enabledSamplers', () => {
    const st = {
      samplers: ['temperature'],
      dynatemp: true,
    };
    const result = importSillyTavernPreset(st, []);
    expect(result.enabledSamplers).toContain('dynatemp');
  });

  it('dynaTempRange conversion', () => {
    const st = { min_temp: 0.5, max_temp: 1.5, samplers: [] };
    expect(importSillyTavernPreset(st, []).dynaTempRange).toBe(0.5);

    const st2 = { samplers: [] };
    expect(importSillyTavernPreset(st2, []).dynaTempRange).toBe(0);
  });

  it('name collision appends (Imported)', () => {
    const st = { name: 'Preset', samplers: [] };
    const result = importSillyTavernPreset(st, ['Preset']);
    expect(result.name).toBe('Preset (Imported)');
  });

  it('name collision with existing (Imported) does not loop forever', () => {
    const st = { name: 'Preset', samplers: [] };
    const result = importSillyTavernPreset(st, ['Preset', 'Preset (Imported)']);
    expect(result.name).toBe('Preset (Imported 2)');
  });

  it('bannedTokens/drySequenceBreakers pass-through', () => {
    const st = { banned_tokens: '["a"]', dry_sequence_breakers: '["b"]', samplers: [] };
    const result = importSillyTavernPreset(st, []);
    expect(result.bannedTokens).toBe('["a"]');
    expect(result.drySequenceBreakers).toBe('["b"]');
  });

  it('unmapped fields get defaults', () => {
    const st = { samplers: [] };
    const result = importSillyTavernPreset(st, []);
    expect(result.maxPredictTokens).toBe(-1);
    expect(result.penalizeNl).toBe(false);
  });
});
