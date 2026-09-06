export function assertObject(value, label = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

export function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function optionalNumber(value, label) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be numeric`);
  return n;
}

export function optionalProbability(value, label) {
  const n = optionalNumber(value, label);
  if (n == null) return null;
  if (n < 0 || n > 1) throw new Error(`${label} must be between 0 and 1`);
  return n;
}

export function optionalIsoDate(value, label) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} must be ISO/date parseable`);
  return text;
}
