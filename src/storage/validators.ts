import { isHttpUrl, isValidPluginId, isValidPluginVersion } from '../plugins/manifest';

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function isConnectionData(value: unknown): value is ConnectionData {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.api === 'number' &&
    typeof value.endpoint === 'string' &&
    isOptionalString(value.key) &&
    isOptionalString(value.model) &&
    (value.models === undefined || (Array.isArray(value.models) && value.models.every(m => typeof m === 'string'))) &&
    (value.strict === undefined || typeof value.strict === 'boolean') &&
    (value.chatAPI === undefined || typeof value.chatAPI === 'boolean') &&
    (value.postSamplingProbs === undefined || typeof value.postSamplingProbs === 'boolean')
  );
}

export function isInstructTemplate(value: unknown): value is InstructTemplate {
  if (!isRecord(value)) return false;
  return (
    typeof value.sysPre === 'string' &&
    typeof value.sysSuf === 'string' &&
    typeof value.instPre === 'string' &&
    typeof value.instSuf === 'string' &&
    isOptionalString(value.fimTemplate)
  );
}

function hasStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

export function isSamplerPresetData(value: unknown): value is SamplerPresetData {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.seed === 'number' &&
    typeof value.maxPredictTokens === 'number' &&
    typeof value.temperature === 'number' &&
    typeof value.dynaTempRange === 'number' &&
    typeof value.dynaTempExp === 'number' &&
    typeof value.repeatPenalty === 'number' &&
    typeof value.repeatLastN === 'number' &&
    typeof value.penalizeNl === 'boolean' &&
    typeof value.presencePenalty === 'number' &&
    typeof value.frequencyPenalty === 'number' &&
    typeof value.topK === 'number' &&
    typeof value.topP === 'number' &&
    typeof value.typicalP === 'number' &&
    typeof value.minP === 'number' &&
    typeof value.tfsZ === 'number' &&
    typeof value.mirostat === 'number' &&
    typeof value.mirostatTau === 'number' &&
    typeof value.mirostatEta === 'number' &&
    typeof value.xtcThreshold === 'number' &&
    typeof value.xtcProbability === 'number' &&
    typeof value.dryMultiplier === 'number' &&
    typeof value.dryBase === 'number' &&
    typeof value.dryAllowedLength === 'number' &&
    typeof value.dryPenaltyRange === 'number' &&
    typeof value.drySequenceBreakers === 'string' &&
    typeof value.bannedTokens === 'string' &&
    typeof value.ignoreEos === 'boolean' &&
    hasStringArray(value.enabledSamplers) &&
    typeof value.grammar === 'string'
  );
}

export function coerceThemeData(value: unknown): ThemeData | null {
  if (!isRecord(value)) return null;
  if (typeof value.className !== 'string' || typeof value.css !== 'string') return null;
  return {
    order: typeof value.order === 'number' ? value.order : 999,
    isDefault: typeof value.isDefault === 'boolean' ? value.isDefault : false,
    className: value.className,
    css: value.css,
  };
}

function coerceStoredManifest(value: unknown, fallbackId?: string): PluginManifest | null {
  if (!isRecord(value)) return null;
  const id = isValidPluginId(value.id) ? value.id : isValidPluginId(fallbackId) ? fallbackId : undefined;
  if (!id) return null;
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return null;
  if (!isValidPluginVersion(value.version)) return null;

  const manifest: PluginManifest = {
    id,
    name: value.name,
    version: value.version,
    order: typeof value.order === 'number' && Number.isSafeInteger(value.order) ? value.order : 0,
    api: typeof value.api === 'number' && Number.isSafeInteger(value.api) && value.api >= 1 ? value.api : 1,
  };
  if (typeof value.description === 'string') manifest.description = value.description;
  if (typeof value.author === 'string') manifest.author = value.author;
  if (typeof value.homepage === 'string' && isHttpUrl(value.homepage)) manifest.homepage = value.homepage;
  if (isValidPluginVersion(value.minMiyapad)) manifest.minMiyapad = value.minMiyapad;
  if (isValidPluginVersion(value.maxMiyapad)) manifest.maxMiyapad = value.maxMiyapad;
  for (const key of ['startTimeout', 'hookTimeout'] as const) {
    const field = value[key];
    if (typeof field === 'number' && Number.isFinite(field) && field > 0) manifest[key] = field;
  }
  if (Array.isArray(value.requires)) {
    const reqs = Array.from(new Set(value.requires.filter((r): r is PluginCapability => r === 'server')));
    if (reqs.length > 0) manifest.requires = reqs;
  }
  return manifest;
}

export function coercePluginRecord(value: unknown, key?: string): PluginRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.code !== 'string' || typeof value.enabled !== 'boolean') return null;

  const manifest = coerceStoredManifest(value.manifest, key);
  if (!manifest) return null;

  const record: PluginRecord = {
    code: value.code,
    enabled: value.enabled,
    manifest,
  };
  for (const fieldKey of ['allowedVersion', 'url', 'source', 'changelog'] as const) {
    const field = value[fieldKey];
    if (typeof field === 'string') record[fieldKey] = field;
  }
  return record;
}
