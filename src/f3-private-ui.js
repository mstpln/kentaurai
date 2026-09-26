import { createPreMarketAnalysisPackV3 } from './analysis-pack-v3.js';
import { persistAnalysisFormSnapshots } from './analysis-form-snapshot-v1.js';
import { requireLatestStep1LockV1 } from './analysis-step1-revision-v1.js';
import { buildDataCoverageReport } from './data-coverage-v2.js';
import { recordExternalAnalysisExport } from './external-analysis-flow-v1.js';

export const F3_PRIVATE_UI_VERSION = 'private-ui-observability-v1-f3';

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers
    }
  });
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cleanReason(error) {
  const text = String(error?.message || error || '');
  if (text.includes('new pre-market facts exist')) return 'late_facts_require_revision';
  if (text.includes('newest sealed Step 1 lock')) return 'older_lock_superseded';
  if (text.includes('valid sealed Step 1 lock')) return 'step1_lock_required';
  return 'market_gate_not_ready';
}

export async function listF3AnalysisRounds(env) {
  const { results } = await env.DB.prepare(`
    SELECT gr.id,gr.game_type,gr.round_date,gr.scheduled_start_at,
      (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id) AS leg_count,
      (SELECT COUNT(*) FROM analysis_step1_locks asl WHERE asl.game_round_id=gr.id) AS lock_count,
      (SELECT COUNT(*) FROM analysis_v3_runs av3 WHERE av3.game_round_id=gr.id) AS analysis_count
    FROM game_rounds gr
    WHERE gr.game_type IN ('V85','V86')
      AND (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id)=8
    ORDER BY gr.round_date DESC,
      CASE WHEN gr.scheduled_start_at IS NULL THEN 1 ELSE 0 END,
      gr.scheduled_start_at DESC,gr.id
    LIMIT 80
  `).all();
  return (results || []).map((row) => ({
    id: row.id,
    gameType: row.game_type,
    roundDate: row.round_date,
    scheduledStartAt: row.scheduled_start_at || null,
    legCount: Number(row.leg_count || 0),
    hasStep1Lock: Number(row.lock_count || 0) > 0,
    hasV3Analysis: Number(row.analysis_count || 0) > 0
  }));
}

export async function buildF3WorkflowState(env, roundId, now = new Date().toISOString()) {
  if (!env?.DB) throw new Error('DB is not configured');
  const round = await env.DB.prepare(`
    SELECT gr.id,gr.game_type,gr.round_date,gr.scheduled_start_at,
      (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id) AS leg_count
    FROM game_rounds gr WHERE gr.id=? AND gr.game_type IN ('V85','V86') LIMIT 1
  `).bind(roundId).first();
  if (!round) return null;
  if (Number(round.leg_count) !== 8) throw new Error('v3 workflow requires exactly eight legs');

  const lock = await env.DB.prepare(`
    SELECT id,lock_hash,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,created_at
    FROM analysis_step1_locks WHERE game_round_id=?
    ORDER BY datetime(created_at) DESC,id DESC LIMIT 1
  `).bind(roundId).first();

  let marketGate = { ready: false, reason: lock ? 'market_gate_not_ready' : 'step1_lock_required' };
  if (lock) {
    try {
      await requireLatestStep1LockV1(env, { roundId, lockId: lock.id, asOf: now });
      marketGate = { ready: true, reason: null };
    } catch (error) {
      marketGate = { ready: false, reason: cleanReason(error) };
    }
  }

  const analysis = lock ? await env.DB.prepare(`
    SELECT id,analysis_version,step2_result_id,decision_run_id,optimizer_run_id,
      analysis_fingerprint,narrative_fingerprint,created_at
    FROM analysis_v3_runs
    WHERE game_round_id=? AND lock_id=?
    ORDER BY datetime(created_at) DESC,id DESC LIMIT 1
  `).bind(roundId,lock.id).first() : null;

  const decision = analysis ? await env.DB.prepare(`
    SELECT id,decision_probability_version,policy_version,market_cutoff,market_fingerprint,created_at
    FROM analysis_decision_runs
    WHERE id=? AND game_round_id=? AND lock_id=?
    LIMIT 1
  `).bind(analysis.decision_run_id,roundId,lock.id).first() : null;

  const optimizer = analysis ? await env.DB.prepare(`
    SELECT id,optimizer_version,policy_version,spike_count,row_count,cost_sek,estimated_p8,optimizer_json,created_at
    FROM analysis_optimizer_runs
    WHERE id=? AND game_round_id=? AND decision_run_id=?
    LIMIT 1
  `).bind(analysis.optimizer_run_id,roundId,analysis.decision_run_id).first() : null;

  const step2 = analysis ? await env.DB.prepare(`
    SELECT id,step2_version,prompt_version,market_cutoff,result_fingerprint,created_at
    FROM analysis_step2_results
    WHERE id=? AND game_round_id=? AND lock_id=?
    LIMIT 1
  `).bind(analysis.step2_result_id,roundId,lock.id).first() : null;

  if (analysis && (!decision || !optimizer || !step2)) {
    throw new Error('persisted v3 analysis has incomplete canonical lineage');
  }

  const optimizerDocument = parseJson(optimizer?.optimizer_json, null);
  const system = analysis ? (optimizerDocument?.system || null) : null;
  const completed = Boolean(analysis && decision && optimizer && step2);

  return {
    contract_version: F3_PRIVATE_UI_VERSION,
    generated_at: new Date(now).toISOString(),
    round: {
      id: round.id,
      game_type: round.game_type,
      round_date: round.round_date,
      scheduled_start_at: round.scheduled_start_at || null,
      leg_count: Number(round.leg_count)
    },
    market_gate: marketGate,
    steps: {
      analysis_pack: { status: lock ? 'completed' : 'ready' },
      step1_lock: { status: lock ? 'completed' : 'ready', lock: lock ? {
        id: lock.id, created_at: lock.created_at, provider: lock.provider, prompt_version: lock.prompt_version
      } : null },
      market_pack: { status: completed ? 'completed' : (marketGate.ready ? 'ready' : 'blocked'), reason: marketGate.reason },
      step2_import: { status: completed ? 'completed' : (marketGate.ready ? 'ready' : 'blocked'), reason: marketGate.reason },
      optimized_system: { status: completed ? 'completed' : 'blocked' }
    },
    persisted: {
      decision_run_id: decision?.id || null,
      optimizer_run_id: optimizer?.id || null,
      step2_result_id: step2?.id || null,
      analysis_v3_id: analysis?.id || null
    },
    system: system ? {
      spike_count: Number(system.spike_count ?? optimizer.spike_count),
      row_count: Number(system.row_count ?? optimizer.row_count),
      cost_sek: Number(system.cost_sek ?? optimizer.cost_sek),
      estimated_p8: Number(system.estimated_p8 ?? optimizer.estimated_p8),
      legs: (system.legs || []).map((leg) => ({
        leg_number: Number(leg.leg_number),
        is_spike: Boolean(leg.is_spike),
        selected_count: Array.isArray(leg.selected_entries) ? leg.selected_entries.length : 0
      }))
    } : null
  };
}

export async function createF3AnalysisPackBundleResponse(env, roundId, { asOf = null } = {}) {
  function logStage(result){
    console.info(JSON.stringify({
      event:'step1_export_stage',
      stage:result.stage,
      duration_ms:result.duration_ms,
      ok:result.ok,
      error_class:result.error_class||null
    }));
  }
  async function stage(name,action){
    const started=Date.now();
    try{
      const value=await action();
      logStage({stage:name,duration_ms:Date.now()-started,ok:true});
      return value;
    }catch(error){
      logStage({stage:name,duration_ms:Date.now()-started,ok:false,error_class:error?.name||'Error'});
      throw error;
    }
  }
  const pack = await stage('analysis_pack',()=>createPreMarketAnalysisPackV3(env, roundId, { asOf, onStage:logStage }));
  const files = [
    { name: 'manifest.json', content: parseJson(pack.manifestContent, {}) },
    ...(pack.files || []).map((file) => ({ name: file.name, content: parseJson(file.content, {}) }))
  ];
  const activeByLeg = new Map();
  for (const file of pack.files || []) {
    const payload = file.payload || parseJson(file.content, {});
    const legNumber = Number(payload?.leg_number);
    if (!Number.isInteger(legNumber) || legNumber < 1 || legNumber > 8) continue;
    if (!activeByLeg.has(legNumber)) {
      activeByLeg.set(legNumber, { leg_number: legNumber, race_id: payload?.race?.race_id || null, entry_ids: [] });
    }
    const target = activeByLeg.get(legNumber);
    for (const entry of payload?.entries || []) {
      if (entry?.current_facts?.analysis_eligible === true) target.entry_ids.push(String(entry.race_entry_id));
    }
  }
  await stage('form_snapshots',()=>persistAnalysisFormSnapshots(env, pack));
  await stage('export_registration',()=>recordExternalAnalysisExport(env, {
    stage: 'step1',
    roundId,
    artifactId: pack.manifest.pack_id,
    artifactFingerprint: pack.manifest.facts_fingerprint,
    asOf: pack.manifest.as_of,
    generatedAt: pack.manifest.generated_at,
    artifact: {
      active_legs: [...activeByLeg.values()]
        .sort((a, b) => a.leg_number - b.leg_number)
        .map((leg) => ({ ...leg, entry_ids: [...new Set(leg.entry_ids)].sort() }))
    }
  }));
  const body = {
    transport_contract: 'kentaurai-analysis-pack-v3-ui-bundle',
    analysis_contract: pack.manifest?.contract_version || 'kentaurai-analysis-pack-v3',
    pack_id: pack.manifest?.pack_id || null,
    facts_fingerprint: pack.manifest?.facts_fingerprint || null,
    file_count: files.length,
    files
  };
  const safeRound = String(roundId).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return jsonResponse(body, 200, {
    'content-disposition': `attachment; filename="kentaurai-analysis-pack-v3_${safeRound}.json"`
  });
}

export async function buildF3OperationalStatus(env, now = new Date().toISOString()) {
  const report = await buildDataCoverageReport(env, now);
  return {
    contract_version: F3_PRIVATE_UI_VERSION,
    generated_at: report.generated_at || now,
    coverage_contract_version: report.contract_version,
    current_round: report.coverage?.current_round_participants || { status: 'not_available' },
    contextual_eligibility: report.coverage?.contextual_eligibility || null,
    backfills: report.backfills?.diagnostics || {
      read_only: true,
      historical_official: [],
      xlabs: [],
      failed_job_count: 0,
      failed_error_categories: []
    },
    raw_source_data_included: false
  };
}
