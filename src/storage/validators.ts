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

export function isThemeData(value: unknown): value is ThemeData {
  if (!isRecord(value)) return false;
  return (
    typeof value.className === 'string' &&
    typeof value.css === 'string' &&
    typeof value.order === 'number' &&
    typeof value.isDefault === 'boolean'
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
