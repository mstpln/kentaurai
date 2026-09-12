import {
  listAnalyzableRounds,
  listRoundAnalysisSubmissions,
  prepareAnalysisContext
} from './analysis-api.js';

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'chatgpt' || provider === 'openai') return 'openai';
  if (provider === 'claude' || provider === 'anthropic') return 'anthropic';
  throw new Error('provider must be openai or anthropic');
}

export async function getAnalysisPromptContext(env, providerValue) {
  const provider = normalizeProvider(providerValue);
  const analyzable = await listAnalyzableRounds(env, { limit: 1 });
  const round = analyzable.rounds[0];
  if (!round) return null;

  const submissions = await listRoundAnalysisSubmissions(env, round.id);
  const parents = submissions.submissions.filter((item) => item.stage === 'pre_market' && item.provider === provider);
  const parent = parents.length ? parents[parents.length - 1] : null;

  if (!parent) {
    const context = await prepareAnalysisContext(env, round.id, 'pre_market');
    return {
      export_stage: 'pre_market',
      provider,
      round_id: round.id,
      parent_submission_id: null,
      context
    };
  }

  const context = await prepareAnalysisContext(env, round.id, 'market', {
    preMarketSubmissionId: parent.submissionId
  });
  return {
    export_stage: 'final',
    provider,
    round_id: round.id,
    parent_submission_id: parent.submissionId,
    context
  };
}
