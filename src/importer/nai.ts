interface NaiOrderEntry {
  id: string;
  enabled: boolean;
}

const NAI_SAMPLER_MAP: Record<string, string> = {
  temperature: 'temperature',
  top_k: 'top_k',
  top_p: 'top_p',
  min_p: 'min_p',
  typical_p: 'typical_p',
  tfs: 'tfs_z',
  mirostat: 'mirostat',
  phrase_rep_pen: 'dry',
};

const NAI_DRY_MAP: Record<string, number> = {
  none: 0,
  light: 0.4,
  medium: 0.8,
  aggressive: 1.2,
  very_aggressive: 1.6,
};

function getNaiSamplers(params: Record<string, unknown>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const order = params.order as NaiOrderEntry[] | undefined;
  let dryExplicitlyDisabled = false;
  if (Array.isArray(order)) {
    for (const entry of order) {
      if (entry.id === 'phrase_rep_pen' && !entry.enabled) {
        dryExplicitlyDisabled = true;
      }
      if (!entry.enabled) continue;
      const mapped = NAI_SAMPLER_MAP[entry.id];
      if (mapped && !seen.has(mapped)) {
        seen.add(mapped);
        result.push(mapped);
      }
    }
  }

  if (typeof params.repetition_penalty === 'number' && params.repetition_penalty > 0 && !seen.has('rep_pen')) {
    seen.add('rep_pen');
    result.push('rep_pen');
  }
  if (typeof params.repetition_penalty_presence === 'number' && params.repetition_penalty_presence > 0 && !seen.has('pres_pen')) {
    seen.add('pres_pen');
    result.push('pres_pen');
  }
  if (typeof params.repetition_penalty_frequency === 'number' && params.repetition_penalty_frequency > 0 && !seen.has('freq_pen')) {
    seen.add('freq_pen');
    result.push('freq_pen');
  }
  if (!dryExplicitlyDisabled && typeof params.phrase_rep_pen === 'string' && params.phrase_rep_pen !== 'none' && !seen.has('dry')) {
    seen.add('dry');
    result.push('dry');
  }

  return result;
}

export function importNaiPreset(
  nai: Record<string, unknown>,
  existingNames: string[],
): Omit<SamplerPresetData, 'id'> {
  const params = (nai.parameters ?? {}) as Record<string, unknown>;
  const nameBase = typeof nai.name === 'string' ? nai.name : 'Imported NAI Preset';
  let name = nameBase;
  for (let i = 1; existingNames.includes(name); i++) {
    name = nameBase + (i === 1 ? ' (Imported)' : ` (Imported ${i})`);
  }

  const tau = typeof params.mirostat_tau === 'number' ? params.mirostat_tau : 0;
  let mirostat = 0;
  if (tau > 0) {
    mirostat = 1;
  } else {
    const order = params.order as NaiOrderEntry[] | undefined;
    if (Array.isArray(order)) {
      const miroEntry = order.find(e => e.id === 'mirostat');
      if (miroEntry && miroEntry.enabled) mirostat = 1;
    }
  }

  const whitelist = params.repetition_penalty_default_whitelist === true;

  const phraseRepPen = typeof params.phrase_rep_pen === 'string' ? params.phrase_rep_pen : 'none';
  const dryMultiplier = NAI_DRY_MAP[phraseRepPen] ?? 0;

  return {
    name,
    enabled: true,
    seed: -1,
    maxPredictTokens: typeof params.max_length === 'number' ? params.max_length : -1,
    temperature: typeof params.temperature === 'number' ? params.temperature : 0.7,
    dynaTempRange: 0,
    dynaTempExp: 1,
    repeatPenalty: typeof params.repetition_penalty === 'number' ? params.repetition_penalty : 1.1,
    repeatLastN: typeof params.repetition_penalty_range === 'number' ? params.repetition_penalty_range : 256,
    penalizeNl: !whitelist,
    presencePenalty: typeof params.repetition_penalty_presence === 'number' ? params.repetition_penalty_presence : 0,
    frequencyPenalty: typeof params.repetition_penalty_frequency === 'number' ? params.repetition_penalty_frequency : 0,
    topK: typeof params.top_k === 'number' ? params.top_k : 40,
    topP: typeof params.top_p === 'number' ? params.top_p : 0.95,
    typicalP: typeof params.typical_p === 'number' ? params.typical_p : 1,
    minP: typeof params.min_p === 'number' ? params.min_p : 0,
    tfsZ: typeof params.tail_free_sampling === 'number' ? params.tail_free_sampling : 1,
    mirostat,
    mirostatTau: tau,
    mirostatEta: typeof params.mirostat_lr === 'number' ? params.mirostat_lr : 0.1,
    xtcThreshold: 0.1,
    xtcProbability: 0,
    dryMultiplier,
    dryBase: 1.75,
    dryAllowedLength: 2,
    dryPenaltyRange: 1024,
    drySequenceBreakers: '["\\n",":","\\"","*"]',
    bannedTokens: '[]',
    ignoreEos: false,
    enabledSamplers: getNaiSamplers(params),
    grammar: '',
  };
}
