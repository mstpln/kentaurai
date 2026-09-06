import { randomId } from '../ids.js';
import { assertObject, requireString } from '../validation.js';

export async function createHypothesis(env, body) {
  assertObject(body, 'body');
  const id = randomId('hyp');
  const now = new Date().toISOString();
  const title = requireString(body.title, 'title');
  const category = requireString(body.category, 'category');
  const hypothesisText = requireString(body.hypothesis_text, 'hypothesis_text');
  const minEvidenceTarget = body.min_evidence_target == null ? null : Number(body.min_evidence_target);
  if (minEvidenceTarget != null && (!Number.isInteger(minEvidenceTarget) || minEvidenceTarget < 1)) {
    throw new Error('min_evidence_target must be a positive integer');
  }
  await env.DB.prepare(`
    INSERT INTO learning_hypotheses
      (id, title, category, hypothesis_text, status, min_evidence_target, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'candidate', ?, ?, ?)
  `).bind(id, title, category, hypothesisText, minEvidenceTarget, now, now).run();
  return { id, title, category, hypothesis_text: hypothesisText, status: 'candidate', min_evidence_target: minEvidenceTarget };
}
