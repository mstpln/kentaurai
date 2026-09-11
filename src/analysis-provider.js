export const ALLOWED_ANALYSIS_PROVIDERS = Object.freeze(['openai', 'anthropic']);

export function normalizeAnalysisProvider(value) {
  const provider = String(value ?? '').trim().toLowerCase();
  if (!ALLOWED_ANALYSIS_PROVIDERS.includes(provider)) {
    throw new Error(`producer.provider must be an explicitly allowed provider: ${ALLOWED_ANALYSIS_PROVIDERS.join(' or ')}`);
  }
  return provider;
}

export function normalizeAnalysisModel(value) {
  const model = String(value ?? '').trim();
  if (!model || model.length > 200) throw new Error('producer.model is required and must be at most 200 characters');
  if(/[\u0000-\u001f\u007f]/u.test(model)) throw new Error('producer.model must not contain control characters');
  return model;
}

export function analysisModelSlug(value) {
  const model = normalizeAnalysisModel(value);
  const slug = model
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'model';
}