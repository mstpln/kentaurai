export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function stableId(prefix, ...parts) {
  const body = parts.map(normalizeName).filter(Boolean).join('__');
  if (!body) throw new Error(`Cannot build ${prefix} id from empty parts`);
  return `${prefix}_${body}`;
}

export function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
