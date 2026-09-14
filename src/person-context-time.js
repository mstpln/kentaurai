export const PERSON_CONTEXT_DAY_MS = 86400000;

export function personContextInstant(value, label = 'asOf') {
  const text = String(value ?? '').trim();
  const ms = Date.parse(text);
  if (!text || !Number.isFinite(ms)) throw new Error(`${label} must be a valid timestamp`);
  return { ms, iso: new Date(ms).toISOString() };
}
