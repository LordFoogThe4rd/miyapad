export function isAbortError(e: unknown): e is Error {
  return e instanceof Error && e.name === 'AbortError';
}
