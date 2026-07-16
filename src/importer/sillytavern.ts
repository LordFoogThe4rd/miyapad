interface LlamaCppSamplerOrderEntry {
  order: number;
  priority: number;
  sampler: string;
}

const ST_SAMPLER_MAP: Record<string, string> = {
  temperature: 'temperature',
  dry: 'dry',
  xtc: 'xtc',
  top_k: 'top_k',
  top_p: 'top_p',
  min_p: 'min_p',
  typical_p: 'typical_p',
  tfs_z: 'tfs_z',
};

function getSamplerNames(st: Record<string, unknown>): string[] {
  let raw: string[] | undefined;

  if (Array.isArray(st.samplers)) {
    raw = st.samplers as string[];
  } else if (Array.isArray(st.sampler_priority)) {
    raw = (st.sampler_priority as LlamaCppSamplerOrderEntry[]).map(e => e.sampler);
  } else if (Array.isArray(st.samplers_priorities)) {
    raw = (st.samplers_priorities as LlamaCppSamplerOrderEntry[]).map(e => e.sampler);
  }

  if (!raw) return [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const s of raw) {
    if (s === 'penalties') {
      for (const p of ['rep_pen', 'pres_pen', 'freq_pen']) {
        if (!seen.has(p)) {
          seen.add(p);
          result.push(p);
        }
      }
      continue;
    }
    if (s === 'top_n_sigma' || s === 'adaptive_p' || s === 'typ_p') continue;
    const mapped = ST_SAMPLER_MAP[s];
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      result.push(mapped);
    }
  }

  if (st.dynatemp === true && !seen.has('dynatemp')) {
    result.push('dynatemp');
  }

  return result;
}

export function importSillyTavernPreset(
  st: Record<string, unknown>,
  existingNames: string[],
): Omit<SamplerPresetData, 'id'> {
  const nameBase = typeof st.name === 'string' ? st.name : 'Imported Preset';
  let name = nameBase;
  for (let i = 1; existingNames.includes(name); i++) {
    name = nameBase + (i === 1 ? ' (Imported)' : ` (Imported ${i})`);
  }

  const minTemp = typeof st.min_temp === 'number' ? st.min_temp : 0;
  const maxTemp = typeof st.max_temp === 'number' ? st.max_temp : 0;
  const dynaTempRange = (maxTemp - minTemp) / 2;

  return {
    name,
    enabled: true,
    seed: typeof st.seed === 'number' ? st.seed : -1,
    maxPredictTokens: -1,
    temperature: typeof st.temp === 'number' ? st.temp : 0.7,
    dynaTempRange,
    dynaTempExp: typeof st.dynatemp_exponent === 'number' ? st.dynatemp_exponent : 1,
    repeatPenalty: typeof st.rep_pen === 'number' ? st.rep_pen : 1.1,
    repeatLastN: typeof st.rep_pen_range === 'number' ? st.rep_pen_range : 256,
    penalizeNl: false,
    presencePenalty: typeof st.presence_pen === 'number' ? st.presence_pen : 0,
    frequencyPenalty: typeof st.freq_pen === 'number' ? st.freq_pen : 0,
    topK: typeof st.top_k === 'number' ? st.top_k : 40,
    topP: typeof st.top_p === 'number' ? st.top_p : 0.95,
    typicalP: typeof st.typical_p === 'number' ? st.typical_p : 1,
    minP: typeof st.min_p === 'number' ? st.min_p : 0,
    tfsZ: typeof st.tfs === 'number' ? st.tfs : 1,
    mirostat: typeof st.mirostat_mode === 'number' ? st.mirostat_mode : 0,
    mirostatTau: typeof st.mirostat_tau === 'number' ? st.mirostat_tau : 5.0,
    mirostatEta: typeof st.mirostat_eta === 'number' ? st.mirostat_eta : 0.1,
    xtcThreshold: typeof st.xtc_threshold === 'number' ? st.xtc_threshold : 0.1,
    xtcProbability: typeof st.xtc_probability === 'number' ? st.xtc_probability : 0,
    dryMultiplier: typeof st.dry_multiplier === 'number' ? st.dry_multiplier : 0,
    dryBase: typeof st.dry_base === 'number' ? st.dry_base : 1.75,
    dryAllowedLength: typeof st.dry_allowed_length === 'number' ? st.dry_allowed_length : 2,
    dryPenaltyRange: typeof st.dry_penalty_last_n === 'number' ? st.dry_penalty_last_n : 1024,
    drySequenceBreakers: typeof st.dry_sequence_breakers === 'string' ? st.dry_sequence_breakers : '["\\n",":","\\"","*"]',
    bannedTokens: typeof st.banned_tokens === 'string' ? st.banned_tokens : '[]',
    ignoreEos: false,
    enabledSamplers: getSamplerNames(st),
    grammar: '',
  };
}
