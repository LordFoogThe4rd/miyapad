import { describe, it, expect } from 'vitest';
import { isConnectionData, isInstructTemplate, isSamplerPresetData, coerceThemeData } from './validators';

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

describe('coerceThemeData', () => {
  it('passes a complete theme through unchanged', () => {
    expect(coerceThemeData({ order: 3, isDefault: true, className: 'dark', css: 'body{}' }))
      .toEqual({ order: 3, isDefault: true, className: 'dark', css: 'body{}' });
  });

  it('defaults a missing order to 999 and a missing isDefault to false', () => {
    expect(coerceThemeData({ className: 'dark', css: 'body{}' }))
      .toEqual({ order: 999, isDefault: false, className: 'dark', css: 'body{}' });
  });

  it('replaces a wrongly-typed order or isDefault with the defaults', () => {
    expect(coerceThemeData({ className: 'dark', css: '', order: '2', isDefault: 'yes' }))
      .toEqual({ order: 999, isDefault: false, className: 'dark', css: '' });
  });

  it('drops unknown extra properties', () => {
    const result = coerceThemeData({ className: 'dark', css: '', order: 1, isDefault: false, extra: 'nope' });
    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(['className', 'css', 'isDefault', 'order']);
  });

  it('accepts an empty css string and an empty className', () => {
    expect(coerceThemeData({ className: '', css: '' }))
      .toEqual({ order: 999, isDefault: false, className: '', css: '' });
  });

  it('returns null when className or css is missing or not a string', () => {
    expect(coerceThemeData({ css: 'body{}' })).toBeNull();
    expect(coerceThemeData({ className: 'dark' })).toBeNull();
    expect(coerceThemeData({ className: 1, css: 'body{}' })).toBeNull();
    expect(coerceThemeData({ className: 'dark', css: null })).toBeNull();
  });

  it('returns null for non-objects', () => {
    expect(coerceThemeData(null)).toBeNull();
    expect(coerceThemeData(undefined)).toBeNull();
    expect(coerceThemeData('dark')).toBeNull();
    expect(coerceThemeData(42)).toBeNull();
    expect(coerceThemeData([{ className: 'dark', css: '' }])).toBeNull();
  });
});

describe('isConnectionData', () => {
  function makeConnection(): ConnectionData {
    return { id: 'conn-1', name: 'Local', enabled: true, api: 0, endpoint: 'http://localhost:8080' };
  }

  it('accepts a minimal connection with only the required fields', () => {
    expect(isConnectionData(makeConnection())).toBe(true);
  });

  it('accepts every optional field when well typed', () => {
    expect(isConnectionData({
      ...makeConnection(),
      key: 'sk-abc',
      model: 'gpt-4',
      models: ['gpt-4', 'gpt-5'],
      strict: false,
      chatAPI: true,
      postSamplingProbs: false,
    })).toBe(true);
  });

  it('accepts an empty models array', () => {
    expect(isConnectionData({ ...makeConnection(), models: [] })).toBe(true);
  });

  it('rejects a missing required field', () => {
    for (const field of ['id', 'name', 'enabled', 'api', 'endpoint']) {
      const value = clone(makeConnection());
      delete value[field];
      expect(isConnectionData(value), `missing ${field}`).toBe(false);
    }
  });

  it('rejects a required field of the wrong type', () => {
    expect(isConnectionData({ ...makeConnection(), id: 1 })).toBe(false);
    expect(isConnectionData({ ...makeConnection(), enabled: 'yes' })).toBe(false);
    expect(isConnectionData({ ...makeConnection(), api: '0' })).toBe(false);
    expect(isConnectionData({ ...makeConnection(), endpoint: null })).toBe(false);
  });

  it('rejects an optional field of the wrong type', () => {
    expect(isConnectionData({ ...makeConnection(), key: 42 })).toBe(false);
    expect(isConnectionData({ ...makeConnection(), models: 'gpt-4' })).toBe(false);
    expect(isConnectionData({ ...makeConnection(), models: ['gpt-4', 7] })).toBe(false);
    expect(isConnectionData({ ...makeConnection(), strict: 'true' })).toBe(false);
    expect(isConnectionData({ ...makeConnection(), chatAPI: 1 })).toBe(false);
    expect(isConnectionData({ ...makeConnection(), postSamplingProbs: null })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isConnectionData(null)).toBe(false);
    expect(isConnectionData(undefined)).toBe(false);
    expect(isConnectionData('conn')).toBe(false);
    expect(isConnectionData([makeConnection()])).toBe(false);
  });
});

describe('isInstructTemplate', () => {
  function makeTemplate(): InstructTemplate {
    return { sysPre: '<<SYS>>', sysSuf: '<</SYS>>', instPre: '[INST]', instSuf: '[/INST]' };
  }

  it('accepts a template without a FIM template', () => {
    expect(isInstructTemplate(makeTemplate())).toBe(true);
  });

  it('accepts a template with a FIM template', () => {
    expect(isInstructTemplate({ ...makeTemplate(), fimTemplate: '<PRE>{prefix}<SUF>{suffix}<MID>' })).toBe(true);
  });

  it('accepts empty strings for the affixes', () => {
    expect(isInstructTemplate({ sysPre: '', sysSuf: '', instPre: '', instSuf: '' })).toBe(true);
  });

  it('rejects a missing affix', () => {
    for (const field of ['sysPre', 'sysSuf', 'instPre', 'instSuf']) {
      const value = clone(makeTemplate());
      delete value[field];
      expect(isInstructTemplate(value), `missing ${field}`).toBe(false);
    }
  });

  it('rejects an affix that is not a string', () => {
    expect(isInstructTemplate({ ...makeTemplate(), sysPre: null })).toBe(false);
    expect(isInstructTemplate({ ...makeTemplate(), instSuf: 0 })).toBe(false);
  });

  it('rejects a non-string fimTemplate', () => {
    expect(isInstructTemplate({ ...makeTemplate(), fimTemplate: 42 })).toBe(false);
    expect(isInstructTemplate({ ...makeTemplate(), fimTemplate: null })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isInstructTemplate(null)).toBe(false);
    expect(isInstructTemplate(undefined)).toBe(false);
    expect(isInstructTemplate('[INST]')).toBe(false);
    expect(isInstructTemplate([makeTemplate()])).toBe(false);
  });
});
