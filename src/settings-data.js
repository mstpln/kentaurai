import {
  ANALYSIS_SUBMISSION_VERSION
} from './analysis-exchange.js';
import {
  listAnalyzableRounds,
  listRoundAnalysisSubmissions,
  prepareAnalysisContext,
  submitAnalysis
} from './analysis-api.js';

export const KENTAURAI_APP_VERSION = '0.6.0';
export const FULL_EXPORT_VERSION = 'kentaurai-full-export-v1';
const EXPORT_BATCH_SIZE = 500;
const MAX_ANALYSIS_UPLOAD_BYTES = 1024 * 1024;
const MARKET_BLIND_FEATURE_VERSIONS = new Set(['form-v2', 'class-exposure-v2', 'development-v2']);
const EXCLUDED_TABLES = new Set(['d1_migrations']);

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'chatgpt' || provider === 'openai') return 'openai';
  if (provider === 'claude' || provider === 'anthropic') return 'anthropic';
  throw new Error('provider must be openai or anthropic');
}

function providerLabel(provider) {
  return provider === 'anthropic' ? 'Claude' : 'ChatGPT';
}

function exportFileName(provider, exportedAt) {
  const stamp = exportedAt.replace(/[-:]/g, '').replace('.000', '').replace('T', '_').replace('Z', 'Z');
  return `kentaurai-full-export_${provider}_${stamp}.json`;
}

function analysisFileName(provider, exportedAt) {
  return `kentaurai-analysis_${provider}_${exportedAt.slice(0, 10)}.json`;
}

function classifyRun(sourceType) {
  const value = String(sourceType || '').toLowerCase();
  if (value.includes('xlab')) return 'xlabs';
  if (value.includes('post') && value.includes('race')) return 'post_race';
  if (value.includes('editorial')) return 'editorial';
  if (value.includes('reference')) return 'reference';
  if (
    value.includes('official') || value.includes('provider') || value.includes('calendar') ||
    value.includes('live') || value.includes('historical') || value.includes('race_capture')
  ) return 'official';
  return 'other';
}

function runLabel(sourceType) {
  switch (classifyRun(sourceType)) {
    case 'xlabs': return 'X-Labs';
    case 'post_race': return 'Efteranalys';
    case 'editorial': return 'Redaktionell import';
    case 'reference': return 'Referensimport';
    case 'official': return 'Officiell data';
    default: return String(sourceType || 'Körning').replaceAll('_', ' ');
  }
}

function normalizedRunStatus(run) {
  const status = String(run?.status || '').toLowerCase();
  if (Number(run?.error_count || 0) > 0 || status.includes('fail') || status.includes('error')) return 'error';
  if (status.includes('warn') || status.includes('partial') || status.includes('retry')) return 'warning';
  if (status.includes('run') || status.includes('start') || status.includes('pending')) return 'running';
  return 'success';
}

function sourceHealth(family, runs) {
  const run = runs.find((item) => classifyRun(item.source_type) === family);
  if (!run) return { status: 'unknown', lastRunAt: null, message: 'Ingen körning registrerad ännu.' };
  const normalized = normalizedRunStatus(run);
  if (normalized === 'error') {
    return { status: 'error', lastRunAt: run.finished_at || run.started_at, message: 'Senaste körningen hade fel.' };
  }
  if (normalized === 'warning') {
    return { status: 'warning', lastRunAt: run.finished_at || run.started_at, message: 'Senaste körningen slutfördes med varning.' };
  }
  return {
    status: 'working',
    lastRunAt: run.finished_at || run.started_at,
    message: normalized === 'running' ? 'En körning pågår utan registrerat fel.' : 'Senaste körningen slutfördes utan registrerat fel.'
  };
}

export async function getSettingsStatus(env) {
  if (!env.DB) throw new Error('DB is not configured');
  const [trainers, horses, drivers, games, recentRuns] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM trainers').first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM horses').first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM drivers').first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM game_rounds WHERE game_type IN ('V85','V86')").first(),
    env.DB.prepare(`
      SELECT id, source_type, started_at, finished_at, status,
             inserted_count, updated_count, skipped_count, error_count, error_json
      FROM import_runs
      ORDER BY datetime(started_at) DESC, id DESC
      LIMIT 12
    `).all()
  ]);
  const runs = recentRuns.results || [];
  return {
    appVersion: KENTAURAI_APP_VERSION,
    counts: {
      trainers: Number(trainers?.n || 0),
      horses: Number(horses?.n || 0),
      drivers: Number(drivers?.n || 0),
      games: Number(games?.n || 0)
    },
    recentRuns: runs.map((run) => ({
      id: run.id,
      name: runLabel(run.source_type),
      sourceType: run.source_type,
      startedAt: run.started_at,
      finishedAt: run.finished_at || null,
      status: normalizedRunStatus(run),
      inserted: Number(run.inserted_count || 0),
      updated: Number(run.updated_count || 0),
      skipped: Number(run.skipped_count || 0),
      errors: Number(run.error_count || 0),
      hasErrorDetails: Boolean(run.error_json)
    })),
    sources: [
      { id: 'official', name: 'Officiell datakälla', ...sourceHealth('official', runs) },
      { id: 'xlabs', name: 'X-Labs', ...sourceHealth('xlabs', runs) }
    ],
    sourceStatusNote: 'Statusen bygger på de senaste registrerade körningarna och gör inga extra anrop till datakällorna.'
  };
}

async function providerPreMarketRounds(env, provider) {
  const { results } = await env.DB.prepare(`
    SELECT gl.game_round_id
    FROM model_versions mv
    JOIN ai_race_analyses ara ON ara.model_version_id = mv.id
    JOIN game_legs gl ON gl.race_id = ara.race_id
    WHERE mv.feature_version = 'analysis-exchange-v1'
      AND mv.ai_provider = ?
      AND ara.market_blind = 1
    GROUP BY mv.id, gl.game_round_id
    HAVING COUNT(DISTINCT ara.race_id) = 8
  `).bind(provider).all();
  return new Set(results.map((row) => row.game_round_id));
}

async function buildExportPolicy(env, provider, exportedAt) {
  const preMarketRounds = await providerPreMarketRounds(env, provider);
  const { results: openRounds } = await env.DB.prepare(`
    SELECT gr.id
    FROM game_rounds gr
    WHERE gr.game_type IN ('V85','V86')
      AND datetime(COALESCE(
        gr.bet_stop_at,
        gr.scheduled_start_at,
        (SELECT MIN(r.scheduled_start_at)
         FROM game_legs gl
         JOIN races r ON r.id = gl.race_id
         WHERE gl.game_round_id = gr.id)
      )) > datetime(?)
  `).bind(exportedAt).all();
  const guardedRoundIds = new Set(openRounds.map((row) => row.id).filter((id) => !preMarketRounds.has(id)));
  const guardedRaceIds = new Set();
  const guardedEntryIds = new Set();
  const guardedAnalysisIds = new Set();
  const guardedSystemIds = new Set();

  if (guardedRoundIds.size) {
    const placeholders = [...guardedRoundIds].map(() => '?').join(',');
    const { results: rows } = await env.DB.prepare(`
      SELECT gl.race_id, re.id AS race_entry_id
      FROM game_legs gl
      JOIN race_entries re ON re.race_id = gl.race_id
      WHERE gl.game_round_id IN (${placeholders})
    `).bind(...guardedRoundIds).all();
    for (const row of rows) {
      guardedRaceIds.add(row.race_id);
      guardedEntryIds.add(row.race_entry_id);
    }

    if (guardedRaceIds.size) {
      const racePlaceholders = [...guardedRaceIds].map(() => '?').join(',');
      const { results: analyses } = await env.DB.prepare(`SELECT id FROM ai_race_analyses WHERE race_id IN (${racePlaceholders})`).bind(...guardedRaceIds).all();
      for (const row of analyses) guardedAnalysisIds.add(row.id);
    }
    const { results: systems } = await env.DB.prepare(`SELECT id FROM systems WHERE game_round_id IN (${placeholders})`).bind(...guardedRoundIds).all();
    for (const row of systems) guardedSystemIds.add(row.id);
  }

  return { provider, guardedRoundIds, guardedRaceIds, guardedEntryIds, guardedAnalysisIds, guardedSystemIds };
}

function sanitizeExportRow(table, row, policy) {
  if (table === 'game_rounds' && policy.guardedRoundIds.has(row.id)) {
    return { ...row, jackpot_sek: null, turnover_sek: null };
  }
  if (table === 'betting_snapshots' && policy.guardedRoundIds.has(row.game_round_id)) return null;
  if (table === 'odds_snapshots' && policy.guardedEntryIds.has(row.race_entry_id)) return null;
  if (table === 'analysis_features' && policy.guardedEntryIds.has(row.race_entry_id) && !MARKET_BLIND_FEATURE_VERSIONS.has(row.feature_version)) return null;
  if (table === 'ai_race_analyses' && policy.guardedRaceIds.has(row.race_id)) return null;
  if (table === 'ai_horse_predictions' && policy.guardedAnalysisIds.has(row.ai_race_analysis_id)) return null;
  if (table === 'systems' && policy.guardedRoundIds.has(row.game_round_id)) return null;
  if (table === 'system_selections' && policy.guardedSystemIds.has(row.system_id)) return null;
  if (table === 'post_race_reviews' && policy.guardedRoundIds.has(row.game_round_id)) return null;
  if (table === 'model_versions') {
    try {
      const meta = JSON.parse(row.config_json || '{}')?.analysisExchange;
      if (meta?.roundId && policy.guardedRoundIds.has(meta.roundId)) return null;
    } catch {}
  }
  return row;
}

function submissionTemplates(provider) {
  return {
    pre_market: {
      contract_version: ANALYSIS_SUBMISSION_VERSION,
      submission_id: `${provider}-YYYYMMDD-round-1`,
      round_id: 'COPY_FROM_ANALYSIS_CONTEXT',
      stage: 'pre_market',
      context_fingerprint: 'COPY_FROM_ANALYSIS_CONTEXT',
      producer: { provider, model: 'EXACT_MODEL_NAME' },
      round_summary: 'Kort sammanfattning av omgången.',
      legs: [{
        leg_number: 1,
        race_id: 'COPY_FROM_CONTEXT',
        scenarios: [],
        race_shape_summary: 'Bedömd loppbild.',
        conclusion: 'Kort slutsats.',
        data_quality: 'sufficient | limited | unknown',
        predictions: [{
          race_entry_id: 'COPY_FROM_CONTEXT',
          win_probability: 0.0,
          uncertainty_low: null,
          uncertainty_high: null,
          raw_rank: 1,
          abcd_group: 'A | B | C | D',
          scenario_robustness: null,
          reasoning: { summary: 'Kort motivering.' }
        }]
      }]
    },
    final: {
      contract_version: ANALYSIS_SUBMISSION_VERSION,
      submission_id: `${provider}-YYYYMMDD-round-final-1`,
      round_id: 'COPY_FROM_MARKET_CONTEXT',
      stage: 'final',
      parent_submission_id: 'EXACT_PRE_MARKET_SUBMISSION_ID',
      context_fingerprint: 'COPY_FROM_MARKET_CONTEXT',
      producer: { provider, model: 'EXACT_MODEL_NAME' },
      round_summary: 'Slutlig spelbedömning.',
      recommendations: {
        summary: 'Spelidé, värdebedömning och viktiga reservationer.'
      },
      systems: [{
        system_id: 'main',
        system_type: 'main',
        budget_sek: 200,
        line_price_sek: null,
        risk_profile: 'balanced',
        notes: 'Kort systemkommentar.',
        selections: [{
          leg_number: 1,
          race_entry_id: 'COPY_FROM_CONTEXT',
          is_spike: true,
          selection_reason: 'Kort motivering.'
        }]
      }]
    }
  };
}

async function buildAnalysisContexts(env, provider) {
  const analyzable = await listAnalyzableRounds(env, { limit: 100 });
  const contexts = [];
  for (const round of analyzable.rounds) {
    const preMarket = await prepareAnalysisContext(env, round.id, 'pre_market');
    const submissions = await listRoundAnalysisSubmissions(env, round.id);
    const providerParents = submissions.submissions.filter((item) => item.stage === 'pre_market' && item.provider === provider);
    const market = [];
    for (const parent of providerParents) {
      market.push({
        parentSubmissionId: parent.submissionId,
        context: await prepareAnalysisContext(env, round.id, 'market', { preMarketSubmissionId: parent.submissionId })
      });
    }
    contexts.push({ round, preMarket, market });
  }
  return contexts;
}

async function exportTableNames(env) {
  const { results } = await env.DB.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_cf_%'
    ORDER BY name ASC
  `).all();
  return results.map((row) => row.name).filter((name) => !EXCLUDED_TABLES.has(name));
}

export async function createFullDataExportResponse(env, providerValue) {
  if (!env.DB) throw new Error('DB is not configured');
  const provider = normalizeProvider(providerValue);
  const exportedAt = new Date().toISOString();
  const [policy, analysisContexts, tableNames] = await Promise.all([
    buildExportPolicy(env, provider, exportedAt),
    buildAnalysisContexts(env, provider),
    exportTableNames(env)
  ]);
  const templates = submissionTemplates(provider);
  const metadata = {
    contract_version: FULL_EXPORT_VERSION,
    app_version: KENTAURAI_APP_VERSION,
    exported_at: exportedAt,
    target_ai: providerLabel(provider),
    target_provider: provider,
    scope: 'All structured KentaurAI D1 data. Raw R2 source payloads and secrets are intentionally not exported.',
    market_blind_rule: {
      guarded_open_round_ids: [...policy.guardedRoundIds],
      explanation: 'For an upcoming round, current betting percentages, odds, market-derived features and current AI/system judgments stay hidden from this provider until that provider has imported a pre-market analysis. Historical data remains included.'
    },
    ai_instructions: {
      language: 'Swedish',
      role: 'Interpret KentaurAI data. Do not invent missing factual values. Raw facts and deterministic features are inputs; your rankings, probabilities, ABCD groups, value judgments and systems are AI judgments.',
      analysis_order: ['raw facts', 'horse capacity/form/class/development', 'expected race scenario', 'current factors/equipment/editorial signals', 'probability/uncertainty/ranking/ABCD', 'market/value', 'external rankings last'],
      workflow: [
        'Use analysis_contexts[].preMarket for the current round before using market information.',
        'Return one pre_market JSON file using the template below and import it into KentaurAI.',
        'Export all data again for the same provider. The file will then include the market context for that stored parent.',
        'Return one final JSON file with value/recommendations/systems. Do not include legs in a final submission; KentaurAI preserves the stored market-blind strength assessment.',
        'Every V85/V86 system must cover all eight legs and contain exactly three one-horse spike legs.'
      ],
      output_contract: ANALYSIS_SUBMISSION_VERSION,
      recommended_output_filename: analysisFileName(provider, exportedAt),
      templates
    },
    analysis_contexts: analysisContexts
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (value) => controller.enqueue(encoder.encode(value));
      try {
        const { analysis_contexts: _contexts, ...metadataWithoutContexts } = metadata;
        write('{"metadata":');
        write(JSON.stringify(metadataWithoutContexts));
        write(',"analysis_contexts":');
        write(JSON.stringify(analysisContexts));
        write(',"tables":{');
        let firstTable = true;
        for (const table of tableNames) {
          if (!firstTable) write(',');
          firstTable = false;
          write(`${JSON.stringify(table)}:[`);
          let firstRow = true;
          let lastRowId = 0;
          for (;;) {
            const query = `SELECT rowid AS __kentaurai_export_rowid, * FROM ${quoteIdentifier(table)} WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`;
            const { results } = await env.DB.prepare(query).bind(lastRowId, EXPORT_BATCH_SIZE).all();
            if (!results.length) break;
            for (const sourceRow of results) {
              lastRowId = Number(sourceRow.__kentaurai_export_rowid);
              const row = { ...sourceRow };
              delete row.__kentaurai_export_rowid;
              const safeRow = sanitizeExportRow(table, row, policy);
              if (!safeRow) continue;
              if (!firstRow) write(',');
              firstRow = false;
              write(JSON.stringify(safeRow));
            }
            if (results.length < EXPORT_BATCH_SIZE) break;
          }
          write(']');
        }
        write('}}');
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFileName(provider, exportedAt)}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

export async function readAnalysisUpload(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('multipart/form-data')) throw new Error('analysfilen måste laddas upp som multipart/form-data');
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ANALYSIS_UPLOAD_BYTES + 64 * 1024) throw new Error('analysfilen är större än 1 MB');
  const form = await request.formData();
  const files = form.getAll('analysis_file');
  if (files.length !== 1 || typeof files[0]?.text !== 'function') throw new Error('välj exakt en JSON-fil med AI-analysen');
  const file = files[0];
  if (file.size > MAX_ANALYSIS_UPLOAD_BYTES) throw new Error('analysfilen är större än 1 MB');
  if (file.name && !file.name.toLowerCase().endsWith('.json')) throw new Error('analysfilen måste vara en .json-fil');
  const text = await file.text();
  if (new TextEncoder().encode(text).byteLength > MAX_ANALYSIS_UPLOAD_BYTES) throw new Error('analysfilen är större än 1 MB');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('analysfilen innehåller inte giltig JSON');
  }
}

export async function importAnalysisUpload(env, request) {
  const payload = await readAnalysisUpload(request);
  const result = await submitAnalysis(env, payload);
  return {
    ok: true,
    contractVersion: ANALYSIS_SUBMISSION_VERSION,
    submissionId: result.submissionId,
    roundId: result.roundId,
    stage: result.stage,
    provider: result.provider,
    model: result.model,
    reused: result.reused,
    writes: result.writes
  };
}
