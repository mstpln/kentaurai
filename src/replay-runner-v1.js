import { stableFeatureJson } from './analysis-v3-foundations.js';
import {
  PERFORMANCE_FEATURE_CONTRACT_VERSION,
  buildPerformanceFeaturesV3ForEntries,
  getPerformanceFeatureVersionRegistry
} from './performance-features-v3.js';
import { assertFeatureProvenanceAsOfV1, assertRaceTargetStateAsOfV1 } from './replay-asof-v1.js';
import {
  REPLAY_CONTRACT_VERSION,
  REPLAY_VERSION,
  coverageBucketV1,
  scoreProbabilityDistributionV1,
  summarizeCalibrationV1,
  summarizePairedAblationV1
} from './replay-scoring-v1.js';

export const REPLAY_TRACKS = Object.freeze(['sports_feature', 'v85_v86_decision']);
export const REPLAY_WALK_FORWARD_VERSION = 'walk-forward-v1';

const TRACKS = new Set(REPLAY_TRACKS);
const DEFAULT_MIN_TRAIN_TARGETS = 20;
const DEFAULT_FOLD_SIZE = 20;

function requiredText(value, field, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function isoInstant(value, field) {
  const text = requiredText(value, field, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

function isoDate(value, field) {
  const text = requiredText(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
  return text;
}

function positiveInteger(value, field, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 100000) throw new Error(`${field} must be a positive integer`);
  return number;
}

function parseJson(text, field) {
  try { return JSON.parse(text || '{}'); } catch { throw new Error(`stored ${field} is invalid JSON`); }
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function idFromFingerprint(prefix, fingerprint) {
  const match = /^sha256:([0-9a-f]{64})$/.exec(String(fingerprint || ''));
  if (!match) throw new Error('fingerprint must be sha256');
  return `${prefix}_${match[1].slice(0, 32)}`;
}

function normalizeReferenceTargets(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('reference_targets must be an array');
  return [...new Set(value.map((item, index) => requiredText(item, `reference_targets[${index}]`, 200)))].sort();
}

function normalizeAblation(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ablation must be an object');
  return {
    declared_feature_family: requiredText(value.declared_feature_family, 'ablation.declared_feature_family', 160),
    baseline_forecast_key: requiredText(value.baseline_forecast_key, 'ablation.baseline_forecast_key', 240),
    candidate_forecast_key: requiredText(value.candidate_forecast_key, 'ablation.candidate_forecast_key', 240),
    min_pairs: positiveInteger(value.min_pairs, 'ablation.min_pairs', 20)
  };
}

export async function normalizeReplayConfigV1(input = {}) {
  const track = requiredText(input.track, 'track', 40);
  if (!TRACKS.has(track)) throw new Error('track must be sports_feature or v85_v86_decision');
  const startDate = isoDate(input.start_date ?? input.startDate, 'start_date');
  const endDate = isoDate(input.end_date ?? input.endDate, 'end_date');
  if (startDate > endDate) throw new Error('start_date must be <= end_date');
  const sourceDataCutoff = isoInstant(input.source_data_cutoff ?? input.sourceDataCutoff ?? new Date().toISOString(), 'source_data_cutoff');
  const walkForward = {
    version: REPLAY_WALK_FORWARD_VERSION,
    min_train_targets: positiveInteger(input.walk_forward?.min_train_targets ?? input.min_train_targets, 'walk_forward.min_train_targets', DEFAULT_MIN_TRAIN_TARGETS),
    fold_size: positiveInteger(input.walk_forward?.fold_size ?? input.fold_size, 'walk_forward.fold_size', DEFAULT_FOLD_SIZE),
    split_method: 'chronological_target_groups_only',
    random_split_allowed: false
  };
  const referenceTargets = normalizeReferenceTargets(input.reference_targets ?? input.referenceTargets);
  const ablation = normalizeAblation(input.ablation);
  if (ablation && track !== 'sports_feature') throw new Error('feature ablation is supported only on sports_feature replay track');
  const config = {
    contract_version: REPLAY_CONTRACT_VERSION,
    replay_version: REPLAY_VERSION,
    track,
    start_date: startDate,
    end_date: endDate,
    source_data_cutoff: sourceDataCutoff,
    walk_forward: walkForward,
    reference_targets: referenceTargets,
    ablation
  };
  return { ...config, config_fingerprint: await sha256Text(stableFeatureJson(config)) };
}

function replayMetadata(row) {
  return {
    id: row.id,
    contract_version: row.contract_version,
    replay_version: row.replay_version,
    track: row.track,
    status: row.status,
    start_date: row.start_date,
    end_date: row.end_date,
    source_data_cutoff: row.source_data_cutoff,
    config_fingerprint: row.config_fingerprint,
    cursor_event_at: row.cursor_event_at || null,
    cursor_target_id: row.cursor_target_id || null,
    processed_targets: Number(row.processed_targets || 0),
    scored_forecasts: Number(row.scored_forecasts || 0),
    skipped_targets: Number(row.skipped_targets || 0),
    summary: row.summary_json ? parseJson(row.summary_json, 'summary_json') : null,
    calibration: row.calibration_json ? parseJson(row.calibration_json, 'calibration_json') : null,
    run_fingerprint: row.run_fingerprint || null,
    last_error: row.last_error || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function createReplayRunV1(env, input = {}, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const config = await normalizeReplayConfigV1(input);
  const id = idFromFingerprint('replay', config.config_fingerprint);
  const existing = await env.DB.prepare('SELECT * FROM replay_runs WHERE id=? LIMIT 1').bind(id).first();
  if (existing) {
    if (existing.config_fingerprint !== config.config_fingerprint) throw new Error('replay id collision');
    return { ...replayMetadata(existing), reused: true };
  }
  const now = isoInstant(options.createdAt ?? new Date().toISOString(), 'created_at');
  await env.DB.prepare(`
    INSERT INTO replay_runs (
      id,contract_version,replay_version,track,status,start_date,end_date,source_data_cutoff,
      walk_forward_policy_json,config_json,config_fingerprint,reference_targets_json,
      processed_targets,scored_forecasts,skipped_targets,created_at,updated_at
    ) VALUES (?,?,?,?, 'running',?,?,?,?,?,?,?,0,0,0,?,?)
  `).bind(
    id,REPLAY_CONTRACT_VERSION,REPLAY_VERSION,config.track,config.start_date,config.end_date,config.source_data_cutoff,
    stableFeatureJson(config.walk_forward),stableFeatureJson(config),config.config_fingerprint,
    stableFeatureJson(config.reference_targets),now,now
  ).run();
  const row = await env.DB.prepare('SELECT * FROM replay_runs WHERE id=? LIMIT 1').bind(id).first();
  return { ...replayMetadata(row), reused: false };
}

async function loadRun(env, runId) {
  const row = await env.DB.prepare('SELECT * FROM replay_runs WHERE id=? LIMIT 1').bind(requiredText(runId, 'run_id', 160)).first();
  if (!row) throw new Error('replay run was not found');
  return { row, config: parseJson(row.config_json, 'config_json') };
}

function eventExpression(alias = 'r') {
  return `COALESCE(${alias}.scheduled_start_at,${alias}.race_date || 'T23:59:59Z')`;
}

async function nextSportsTarget(env, row) {
  const cursorEvent = row.cursor_event_at || '0000-01-01T00:00:00Z';
  const cursorId = row.cursor_target_id || '';
  const event = eventExpression('r');
  return env.DB.prepare(`
    SELECT ara.id AS target_id,ara.race_id,ara.model_version_id,ara.data_snapshot_at,ara.created_at AS analysis_created_at,
           mv.feature_version,mv.prompt_version,mv.config_json,mv.ai_provider,mv.ai_model,
           r.race_date,${event} AS event_at
    FROM ai_race_analyses ara
    JOIN model_versions mv ON mv.id=ara.model_version_id
    JOIN races r ON r.id=ara.race_id
    WHERE ara.market_blind=1
      AND r.race_date BETWEEN ? AND ?
      AND julianday(ara.data_snapshot_at)<julianday(${event})
      AND julianday(${event})<=julianday(?)
      AND (
        julianday(${event})>julianday(?)
        OR (julianday(${event})=julianday(?) AND ara.id>?)
      )
    ORDER BY julianday(${event}),ara.id
    LIMIT 1
  `).bind(row.start_date,row.end_date,row.source_data_cutoff,cursorEvent,cursorEvent,cursorId).first();
}

async function nextDecisionTarget(env, row) {
  const cursorEvent = row.cursor_event_at || '0000-01-01T00:00:00Z';
  const cursorId = row.cursor_target_id || '';
  return env.DB.prepare(`
    SELECT adr.id AS target_id,adr.game_round_id,adr.lock_id,adr.lock_hash,adr.market_cutoff,adr.created_at AS decision_created_at,
           adr.decision_fingerprint,adr.decision_json,adr.decision_probability_version,
           asl.created_at AS lock_created_at,asl.pack_as_of,
           gr.round_date,
           COALESCE(
             (SELECT MIN(r.scheduled_start_at) FROM game_legs gl JOIN races r ON r.id=gl.race_id WHERE gl.game_round_id=gr.id),
             gr.scheduled_start_at,
             gr.round_date || 'T23:59:59Z'
           ) AS event_at
    FROM analysis_decision_runs adr
    JOIN analysis_step1_locks asl ON asl.id=adr.lock_id
    JOIN game_rounds gr ON gr.id=adr.game_round_id
    WHERE gr.game_type IN ('V85','V86')
      AND gr.round_date BETWEEN ? AND ?
      AND julianday(COALESCE(
        (SELECT MIN(r.scheduled_start_at) FROM game_legs gl JOIN races r ON r.id=gl.race_id WHERE gl.game_round_id=gr.id),
        gr.scheduled_start_at,
        gr.round_date || 'T23:59:59Z'
      ))<=julianday(?)
      AND (
        julianday(COALESCE(
          (SELECT MIN(r.scheduled_start_at) FROM game_legs gl JOIN races r ON r.id=gl.race_id WHERE gl.game_round_id=gr.id),
          gr.scheduled_start_at,
          gr.round_date || 'T23:59:59Z'
        ))>julianday(?)
        OR (
          julianday(COALESCE(
            (SELECT MIN(r.scheduled_start_at) FROM game_legs gl JOIN races r ON r.id=gl.race_id WHERE gl.game_round_id=gr.id),
            gr.scheduled_start_at,
            gr.round_date || 'T23:59:59Z'
          ))=julianday(?) AND adr.id>?
        )
      )
    ORDER BY julianday(event_at),adr.id
    LIMIT 1
  `).bind(row.start_date,row.end_date,row.source_data_cutoff,cursorEvent,cursorEvent,cursorId).first();
}

async function uniqueWinnerAsOf(env, raceId, sourceCutoff) {
  const { results } = await env.DB.prepare(`
    SELECT re.id AS race_entry_id,rr.source_record_id,sr.fetched_at,sr.source_type
    FROM race_entries re
    JOIN race_results rr ON rr.race_entry_id=re.id
    JOIN source_records sr ON sr.id=rr.source_record_id
    WHERE re.race_id=? AND rr.placing=1 AND rr.result_status='official'
      AND sr.source_type='official_provider'
      AND julianday(sr.fetched_at)<=julianday(?)
    ORDER BY re.id
  `).bind(String(raceId),sourceCutoff).all();
  if ((results || []).length !== 1) return null;
  return results[0];
}

async function priorScoredGroups(env, runId, eventAt) {
  const row = await env.DB.prepare(`
    SELECT COUNT(DISTINCT target_group_id) AS n
    FROM forecast_evaluations
    WHERE replay_run_id=? AND is_reference=0 AND julianday(event_at)<julianday(?)
  `).bind(runId,eventAt).first();
  return Number(row?.n || 0);
}

function walkForwardState(config, priorCount, isReference) {
  return {
    fold_index: Math.floor(priorCount / config.walk_forward.fold_size),
    evidence_eligible: !isReference && priorCount >= config.walk_forward.min_train_targets
  };
}

function safeReplayEvaluationConfig(modelConfigText) {
  let config = {};
  try { config = JSON.parse(modelConfigText || '{}'); } catch { return {}; }
  const replay = config?.replayEvaluation;
  return replay && typeof replay === 'object' && !Array.isArray(replay) ? replay : {};
}

function sportsFeatureManifest(modelConfigText) {
  const replay = safeReplayEvaluationConfig(modelConfigText);
  const families = Array.isArray(replay.featureFamilies)
    ? [...new Set(replay.featureFamilies.map(String).filter(Boolean))].sort()
    : [];
  return {
    contract_version: 'kentaurai-replay-feature-manifest-v1',
    deterministic_feature_contract: PERFORMANCE_FEATURE_CONTRACT_VERSION,
    deterministic_feature_registry: getPerformanceFeatureVersionRegistry(),
    evaluation_invariant: replay.invariantConfig ?? null,
    declared_feature_families: families
  };
}

function sportsForecastKey(target) {
  const replay = safeReplayEvaluationConfig(target.config_json);
  return String(replay.forecastKey || `model:${target.model_version_id}`);
}

async function sportsDistribution(env, target) {
  const { results } = await env.DB.prepare(`
    SELECT ahp.race_entry_id,ahp.win_probability
    FROM ai_horse_predictions ahp
    JOIN race_entries re ON re.id=ahp.race_entry_id
    WHERE ahp.ai_race_analysis_id=? AND re.scratched=0
    ORDER BY ahp.race_entry_id
  `).bind(target.target_id).all();
  return (results || []).map((item) => ({ race_entry_id: item.race_entry_id, probability: Number(item.win_probability) }));
}

function orderedFeatureDocuments(featureMap) {
  return [...featureMap.entries()]
    .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([raceEntryId,document]) => ({ race_entry_id: raceEntryId, document }));
}

function featureCoverage(featureMap) {
  const values = [];
  for (const document of featureMap.values()) {
    const value = document?.families?.form?.metrics?.xlabs_start_coverage_rate?.value;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) values.push(value);
  }
  return values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
}

async function buildSportsEvaluation(env, run, config, target) {
  const eventAt = isoInstant(target.event_at, 'event_at');
  const forecastAsOf = isoInstant(target.data_snapshot_at, 'forecast_as_of');
  const referenceTargets = new Set(config.reference_targets || []);
  const isReference = referenceTargets.has(target.race_id) || referenceTargets.has(target.target_id);
  if (Date.parse(forecastAsOf) >= Date.parse(eventAt)) throw new Error('forecast_not_strictly_pre_event');
  const analysisCreatedAt = isoInstant(target.analysis_created_at, 'analysis_created_at');
  if (!isReference && Date.parse(analysisCreatedAt) >= Date.parse(eventAt)) throw new Error('forecast_record_not_pre_event');
  await assertRaceTargetStateAsOfV1(env,target.race_id,forecastAsOf);

  const distribution = await sportsDistribution(env,target);
  const winner = await uniqueWinnerAsOf(env,target.race_id,run.source_data_cutoff);
  if (!winner) throw new Error('unique_official_winner_unavailable_as_of_source_cutoff');

  const entryIds = distribution.map((item)=>item.race_entry_id);
  const features = await buildPerformanceFeaturesV3ForEntries(env,entryIds,forecastAsOf);
  for (const document of features.values()) await assertFeatureProvenanceAsOfV1(document,forecastAsOf);
  const featureDocuments = orderedFeatureDocuments(features);
  const featureFingerprint = await sha256Text(stableFeatureJson(featureDocuments));
  const manifest = sportsFeatureManifest(target.config_json);
  const coverage = featureCoverage(features);
  const score = scoreProbabilityDistributionV1(distribution,winner.race_entry_id);
  const prior = await priorScoredGroups(env,run.id,eventAt);
  const wf = walkForwardState(config,prior,isReference);

  return {
    track:'sports_feature',
    target_id:target.target_id,
    target_group_id:target.race_id,
    event_at:eventAt,
    forecast_as_of:forecastAsOf,
    fold_index:wf.fold_index,
    evidence_eligible:wf.evidence_eligible,
    is_reference:isReference,
    forecast_key:sportsForecastKey(target),
    forecast_version:target.prompt_version || target.feature_version || 'stored-market-blind-forecast',
    model_version_id:target.model_version_id,
    score,
    feature_fingerprint:featureFingerprint,
    feature_manifest:manifest,
    coverage_bucket:coverageBucketV1(coverage),
    probability_json:distribution,
    source_metadata:{
      outcome_source_record_id:winner.source_record_id,
      outcome_source_fetched_at:winner.fetched_at,
      forecast_provider:target.ai_provider || null,
      forecast_model:target.ai_model || null,
      deterministic_feature_as_of:forecastAsOf,
      historical_xlabs_feature_coverage:coverage
    }
  };
}

async function decisionRoundWinners(env, roundId, sourceCutoff) {
  const { results } = await env.DB.prepare(`
    SELECT gl.leg_number,gl.race_id,re.id AS winner_entry_id,rr.source_record_id,sr.fetched_at
    FROM game_legs gl
    JOIN race_entries re ON re.race_id=gl.race_id
    JOIN race_results rr ON rr.race_entry_id=re.id
    JOIN source_records sr ON sr.id=rr.source_record_id
    WHERE gl.game_round_id=? AND rr.placing=1 AND rr.result_status='official'
      AND sr.source_type='official_provider'
      AND julianday(sr.fetched_at)<=julianday(?)
    ORDER BY gl.leg_number,re.id
  `).bind(roundId,sourceCutoff).all();
  const byLeg = new Map();
  for (const item of results || []) {
    const leg=Number(item.leg_number);
    if (!byLeg.has(leg)) byLeg.set(leg,[]);
    byLeg.get(leg).push(item);
  }
  if (byLeg.size !== 8 || [...byLeg.values()].some((items)=>items.length!==1)) return null;
  return new Map([...byLeg.entries()].map(([leg,items])=>[leg,items[0]]));
}

function parseDecisionDocument(target) {
  const decision = parseJson(target.decision_json,'decision_json');
  if (!Array.isArray(decision.legs) || decision.legs.length!==8) throw new Error('stored decision must contain exactly eight legs');
  return decision;
}

function decisionDistribution(leg,key) {
  if (key === 'public_win_probability_proxy'
    && (leg?.public_proxy_quality !== 'verified_complete_winner_odds_v1'
      || leg?.public_proxy_method !== 'normalized_inverse_decimal_winner_odds')) {
    return null;
  }
  const entries=(leg.entries || []).map((entry)=>({
    race_entry_id:String(entry.race_entry_id),
    probability: entry[key]
  }));
  if (entries.some((entry)=>typeof entry.probability!=='number')) return null;
  return entries;
}

async function buildDecisionEvaluations(env, run, config, target) {
  const eventAt=isoInstant(target.event_at,'event_at');
  const winners=await decisionRoundWinners(env,target.game_round_id,run.source_data_cutoff);
  if (!winners) throw new Error('eight_unique_official_winners_unavailable_as_of_source_cutoff');
  const decision=parseDecisionDocument(target);
  const references=new Set(config.reference_targets || []);
  const isReference=references.has(target.game_round_id) || references.has(target.target_id);
  const decisionCreatedAt=isoInstant(target.decision_created_at,'decision_created_at');
  if (!isReference && Date.parse(decisionCreatedAt)>=Date.parse(eventAt)) throw new Error('decision_run_not_pre_event');
  const prior=await priorScoredGroups(env,run.id,eventAt);
  const wf=walkForwardState(config,prior,isReference);

  const lockCreated=isoInstant(target.lock_created_at,'lock_created_at');
  const packAsOf=isoInstant(target.pack_as_of,'pack_as_of');
  let blindAsOf=lockCreated;
  let blindReferenceFallback=false;
  if (Date.parse(blindAsOf)>=Date.parse(eventAt)) {
    if (!isReference || Date.parse(packAsOf)>=Date.parse(eventAt)) throw new Error('sealed_blind_forecast_not_pre_event');
    blindAsOf=packAsOf;
    blindReferenceFallback=true;
  }
  const marketAsOf=isoInstant(target.market_cutoff,'market_cutoff');
  if (Date.parse(marketAsOf)>=Date.parse(eventAt)) throw new Error('market_decision_forecast_not_pre_event');

  const evaluations=[];
  for (const leg of decision.legs) {
    const legNumber=Number(leg.leg_number);
    const winner=winners.get(legNumber);
    if (!winner) throw new Error(`winner_missing_for_leg_${legNumber}`);
    const specs=[
      ['blind_probability','blind_probability',blindAsOf],
      ['market_win_probability_proxy','public_win_probability_proxy',marketAsOf],
      ['decision_probability','decision_probability',marketAsOf]
    ];
    for (const [forecastKey,entryKey,forecastAsOf] of specs) {
      const distribution=decisionDistribution(leg,entryKey);
      if (!distribution) {
        if (forecastKey==='market_win_probability_proxy') continue;
        throw new Error(`${forecastKey}_distribution_unavailable`);
      }
      const score=scoreProbabilityDistributionV1(distribution,winner.winner_entry_id);
      evaluations.push({
        track:'v85_v86_decision',
        target_id:`${target.target_id}:leg:${legNumber}`,
        target_group_id:target.game_round_id,
        event_at:eventAt,
        forecast_as_of:forecastAsOf,
        fold_index:wf.fold_index,
        evidence_eligible:wf.evidence_eligible,
        is_reference:isReference,
        forecast_key:forecastKey,
        forecast_version:target.decision_probability_version || 'decision-probability',
        model_version_id:null,
        score,
        feature_fingerprint:null,
        feature_manifest:null,
        coverage_bucket:null,
        probability_json:distribution,
        source_metadata:{
          decision_run_id:target.target_id,
          leg_number:legNumber,
          lock_id:target.lock_id,
          lock_hash:target.lock_hash,
          outcome_source_record_id:winner.source_record_id,
          outcome_source_fetched_at:winner.fetched_at,
          reference_pack_as_of_fallback:blindReferenceFallback
        }
      });
    }
  }
  return { evaluations,winners,isReference,eventAt };
}

async function buildSystemEvaluations(env, run, target, winners, isReference, eventAt) {
  const { results }=await env.DB.prepare(`
    SELECT * FROM analysis_optimizer_runs
    WHERE decision_run_id=?
    ORDER BY created_at,id
  `).bind(target.target_id).all();
  const out=[];
  for (const row of results || []) {
    const optimizer=parseJson(row.optimizer_json,'optimizer_json');
    const legs=optimizer?.system?.legs;
    if (!Array.isArray(legs) || legs.length!==8 || Number(optimizer?.system?.spike_count)!==3) {
      throw new Error('stored optimizer violates exact-three-spike invariant');
    }
    let covered=0;
    let spikeMisses=0;
    const details=[];
    for (const leg of legs) {
      const legNumber=Number(leg.leg_number);
      const winner=winners.get(legNumber)?.winner_entry_id;
      const selected=(leg.selected_entries || []).map((entry)=>String(entry.race_entry_id));
      const hit=selected.includes(winner);
      if (hit) covered+=1;
      if (leg.is_spike===true && !hit) spikeMisses+=1;
      details.push({leg_number:legNumber,winner_entry_id:winner,selected_entries:selected,is_spike:leg.is_spike===true,covered:hit});
    }
    out.push({
      game_round_id:target.game_round_id,
      optimizer_run_id:row.id,
      event_at:eventAt,
      is_reference:isReference,
      estimated_p8:Number(row.estimated_p8),
      actual_all_covered:covered===8,
      covered_legs:covered,
      spike_misses:spikeMisses,
      row_count:Number(row.row_count),
      cost_sek:Number(row.cost_sek),
      details
    });
  }
  return out;
}

async function persistEvaluation(env,runId,evaluation,createdAt) {
  const base={
    replay_run_id:runId,
    target_id:evaluation.target_id,
    forecast_key:evaluation.forecast_key,
    forecast_as_of:evaluation.forecast_as_of,
    score:evaluation.score,
    feature_fingerprint:evaluation.feature_fingerprint
  };
  const fp=await sha256Text(stableFeatureJson(base));
  const id=idFromFingerprint('forecast_eval',fp);
  const statements=[
    env.DB.prepare(`
      INSERT OR IGNORE INTO forecast_evaluations (
        id,replay_run_id,track,target_id,target_group_id,event_at,forecast_as_of,fold_index,evidence_eligible,
        is_reference,forecast_key,forecast_version,model_version_id,winner_entry_id,winner_probability,log_loss,
        brier_score,top1_hit,top2_coverage,entry_count,feature_fingerprint,feature_manifest_json,coverage_bucket,
        probability_json,source_metadata_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,runId,evaluation.track,evaluation.target_id,evaluation.target_group_id,evaluation.event_at,evaluation.forecast_as_of,
      evaluation.fold_index,evaluation.evidence_eligible?1:0,evaluation.is_reference?1:0,evaluation.forecast_key,
      evaluation.forecast_version,evaluation.model_version_id,evaluation.score.winner_entry_id,evaluation.score.winner_probability,
      evaluation.score.log_loss,evaluation.score.brier_score,evaluation.score.top1_hit?1:0,evaluation.score.top2_coverage?1:0,
      evaluation.score.entry_count,evaluation.feature_fingerprint,
      evaluation.feature_manifest?stableFeatureJson(evaluation.feature_manifest):null,evaluation.coverage_bucket,
      stableFeatureJson(evaluation.probability_json),stableFeatureJson(evaluation.source_metadata),createdAt
    )
  ];
  for (const observation of evaluation.score.probability_observations) {
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO forecast_probability_observations (
        evaluation_id,race_entry_id,probability,won,calibration_bin
      ) VALUES (?,?,?,?,?)
    `).bind(id,observation.race_entry_id,observation.probability,observation.won?1:0,observation.calibration_bin));
  }
  await env.DB.batch(statements);
  return id;
}

async function persistSystemEvaluation(env,runId,item,createdAt) {
  const fp=await sha256Text(stableFeatureJson({run_id:runId,optimizer_run_id:item.optimizer_run_id}));
  const id=idFromFingerprint('system_eval',fp);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO replay_system_evaluations (
      id,replay_run_id,game_round_id,optimizer_run_id,event_at,is_reference,estimated_p8,actual_all_covered,
      covered_legs,spike_misses,row_count,cost_sek,details_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    id,runId,item.game_round_id,item.optimizer_run_id,item.event_at,item.is_reference?1:0,item.estimated_p8,
    item.actual_all_covered?1:0,item.covered_legs,item.spike_misses,item.row_count,item.cost_sek,
    stableFeatureJson(item.details),createdAt
  ).run();
}

async function persistSkip(env,run,target,reason,createdAt) {
  const fp=await sha256Text(stableFeatureJson({run_id:run.id,target_id:target.target_id,reason}));
  const id=idFromFingerprint('replay_skip',fp);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO replay_target_skips (
      id,replay_run_id,track,target_id,event_at,reason_code,details_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?)
  `).bind(
    id,run.id,run.track,target.target_id,target.event_at||null,String(reason).split(':')[0].slice(0,160),
    stableFeatureJson({message:String(reason).slice(0,2000)}),createdAt
  ).run();
}

async function advanceCursor(env,run,target,{scored,skipped},updatedAt) {
  await env.DB.prepare(`
    UPDATE replay_runs
    SET cursor_event_at=?,cursor_target_id=?,processed_targets=processed_targets+1,
        scored_forecasts=scored_forecasts+?,skipped_targets=skipped_targets+?,updated_at=?,last_error=NULL
    WHERE id=? AND status='running'
  `).bind(target.event_at,target.target_id,scored,skipped,updatedAt,run.id).run();
}

function averageRows(rows,field) {
  const values=rows.map((row)=>Number(row[field])).filter(Number.isFinite);
  return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
}

async function finalizeAblation(env,run,config,createdAt) {
  if (!config.ablation) return [];
  const a=config.ablation;
  const { results }=await env.DB.prepare(`
    SELECT target_group_id,forecast_key,log_loss,brier_score,coverage_bucket,feature_manifest_json
    FROM forecast_evaluations
    WHERE replay_run_id=? AND evidence_eligible=1
      AND forecast_key IN (?,?)
    ORDER BY target_group_id,forecast_key
  `).bind(run.id,a.baseline_forecast_key,a.candidate_forecast_key).all();
  const byTarget=new Map();
  for (const row of results||[]) {
    if (!byTarget.has(row.target_group_id)) byTarget.set(row.target_group_id,new Map());
    byTarget.get(row.target_group_id).set(row.forecast_key,row);
  }
  const pairs=[];
  for (const [targetId,items] of byTarget) {
    const baseline=items.get(a.baseline_forecast_key);
    const candidate=items.get(a.candidate_forecast_key);
    if (!baseline||!candidate) continue;
    if (baseline.coverage_bucket!==candidate.coverage_bucket) throw new Error(`ablation coverage bucket mismatch for ${targetId}`);
    pairs.push({
      target_group_id:targetId,
      coverage_bucket:baseline.coverage_bucket,
      baseline_log_loss:Number(baseline.log_loss),
      candidate_log_loss:Number(candidate.log_loss),
      baseline_brier:Number(baseline.brier_score),
      candidate_brier:Number(candidate.brier_score),
      baseline_feature_manifest:parseJson(baseline.feature_manifest_json,'baseline feature_manifest_json'),
      candidate_feature_manifest:parseJson(candidate.feature_manifest_json,'candidate feature_manifest_json')
    });
  }
  const summaries=[];
  for (const bucket of ['all','zero','low','mixed','high']) {
    const summary=summarizePairedAblationV1({
      pairs,
      declaredFeatureFamily:a.declared_feature_family,
      coverageBucket:bucket,
      minPairs:a.min_pairs
    });
    const fp=await sha256Text(stableFeatureJson({run_id:run.id,bucket,ablation:a}));
    await env.DB.prepare(`
      INSERT OR REPLACE INTO replay_ablation_results (
        id,replay_run_id,declared_feature_family,baseline_forecast_key,candidate_forecast_key,coverage_bucket,
        paired_target_count,baseline_log_loss,candidate_log_loss,delta_log_loss,baseline_brier,candidate_brier,
        delta_brier,evidence_status,details_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      idFromFingerprint('ablation',fp),run.id,a.declared_feature_family,a.baseline_forecast_key,a.candidate_forecast_key,
      bucket,summary.paired_target_count,summary.baseline_log_loss,summary.candidate_log_loss,summary.delta_log_loss,
      summary.baseline_brier,summary.candidate_brier,summary.delta_brier,summary.evidence_status,
      stableFeatureJson({walk_forward_only:true,reference_targets_excluded:true}),createdAt
    ).run();
    summaries.push(summary);
  }
  return summaries;
}

async function finalizeReplay(env,run,config,updatedAt) {
  const { results: rows }=await env.DB.prepare(`
    SELECT forecast_key,log_loss,brier_score,top1_hit,top2_coverage
    FROM forecast_evaluations
    WHERE replay_run_id=? AND evidence_eligible=1
    ORDER BY forecast_key,target_group_id,target_id
  `).bind(run.id).all();
  const keys=[...new Set((rows||[]).map((row)=>row.forecast_key))].sort();
  const forecasts={};
  const calibration={};
  for (const key of keys) {
    const group=rows.filter((row)=>row.forecast_key===key);
    forecasts[key]={
      target_count:group.length,
      mean_log_loss:averageRows(group,'log_loss'),
      mean_brier_score:averageRows(group,'brier_score'),
      top1_hit_rate:averageRows(group,'top1_hit'),
      top2_coverage_rate:averageRows(group,'top2_coverage')
    };
    const { results: observations }=await env.DB.prepare(`
      SELECT fpo.probability,fpo.won
      FROM forecast_probability_observations fpo
      JOIN forecast_evaluations fe ON fe.id=fpo.evaluation_id
      WHERE fe.replay_run_id=? AND fe.evidence_eligible=1 AND fe.forecast_key=?
      ORDER BY fe.event_at,fe.target_id,fpo.race_entry_id
    `).bind(run.id,key).all();
    calibration[key]=summarizeCalibrationV1((observations||[]).map((item)=>({probability:Number(item.probability),won:Number(item.won)===1})));
  }
  const { results: systemRows }=await env.DB.prepare(`
    SELECT estimated_p8,actual_all_covered,covered_legs,spike_misses,row_count,cost_sek
    FROM replay_system_evaluations WHERE replay_run_id=? AND is_reference=0
    ORDER BY event_at,optimizer_run_id
  `).bind(run.id).all();
  const systemSummary={
    evaluated_systems:systemRows.length,
    actual_p8_rate:averageRows(systemRows,'actual_all_covered'),
    mean_estimated_p8:averageRows(systemRows,'estimated_p8'),
    mean_covered_legs:averageRows(systemRows,'covered_legs'),
    mean_spike_misses:averageRows(systemRows,'spike_misses'),
    mean_row_count:averageRows(systemRows,'row_count'),
    mean_cost_sek:averageRows(systemRows,'cost_sek')
  };
  const ablation=await finalizeAblation(env,run,config,updatedAt);
  const summary={
    track:run.track,
    walk_forward_only:true,
    random_split_used:false,
    reference_targets_excluded_from_evidence:true,
    forecasts,
    system_quality:systemSummary,
    ablation
  };
  const runFingerprint=await sha256Text(stableFeatureJson({
    config_fingerprint:run.config_fingerprint,
    summary,
    calibration
  }));
  await env.DB.prepare(`
    UPDATE replay_runs
    SET status='completed',summary_json=?,calibration_json=?,run_fingerprint=?,updated_at=?,last_error=NULL
    WHERE id=? AND status='running'
  `).bind(stableFeatureJson(summary),stableFeatureJson(calibration),runFingerprint,updatedAt,run.id).run();
}

export async function stepReplayRunV1(env,runId,options={}) {
  if (!env?.DB?.batch) throw new Error('DB batch support is required');
  const { row:run,config }=await loadRun(env,runId);
  if (run.status==='completed') return { ...replayMetadata(run), reused:true, step_status:'completed' };
  if (run.status!=='running') throw new Error('replay run is not runnable');
  const now=isoInstant(options.updatedAt??new Date().toISOString(),'updated_at');
  const target=run.track==='sports_feature'
    ? await nextSportsTarget(env,run)
    : await nextDecisionTarget(env,run);
  if (!target) {
    await finalizeReplay(env,run,config,now);
    const finalRow=await env.DB.prepare('SELECT * FROM replay_runs WHERE id=? LIMIT 1').bind(run.id).first();
    return { ...replayMetadata(finalRow), reused:false, step_status:'completed' };
  }

  let scored=0;
  try {
    if (run.track==='sports_feature') {
      const evaluation=await buildSportsEvaluation(env,run,config,target);
      await persistEvaluation(env,run.id,evaluation,now);
      scored=1;
    } else {
      const built=await buildDecisionEvaluations(env,run,config,target);
      for (const evaluation of built.evaluations) {
        await persistEvaluation(env,run.id,evaluation,now);
        scored+=1;
      }
      const systems=await buildSystemEvaluations(env,run,target,built.winners,built.isReference,built.eventAt);
      for (const system of systems) await persistSystemEvaluation(env,run.id,system,now);
    }
    await advanceCursor(env,run,target,{scored,skipped:0},now);
    return { run_id:run.id,step_status:'scored',target_id:target.target_id,scored_forecasts:scored };
  } catch (error) {
    const reason=String(error?.message||error);
    const failClosedReasons=[
      'missing_asof_','replay_target_state_drift','future_source_row_in_feature_provenance',
      'unique_official_winner_unavailable_as_of_source_cutoff',
      'eight_unique_official_winners_unavailable_as_of_source_cutoff',
      'sealed_blind_forecast_not_pre_event','market_decision_forecast_not_pre_event',
      'forecast_not_strictly_pre_event','forecast_record_not_pre_event','decision_run_not_pre_event'
    ];
    if (!failClosedReasons.some((prefix)=>reason.startsWith(prefix))) {
      await env.DB.prepare('UPDATE replay_runs SET last_error=?,updated_at=? WHERE id=?').bind(reason.slice(0,2000),now,run.id).run();
      throw error;
    }
    await persistSkip(env,run,target,reason,now);
    await advanceCursor(env,run,target,{scored:0,skipped:1},now);
    return { run_id:run.id,step_status:'skipped',target_id:target.target_id,reason };
  }
}

export async function getReplayRunV1(env,runId) {
  const { row }=await loadRun(env,runId);
  const { results: skips }=await env.DB.prepare(`
    SELECT target_id,event_at,reason_code,details_json,created_at
    FROM replay_target_skips WHERE replay_run_id=? ORDER BY event_at,target_id
  `).bind(row.id).all();
  const { results: ablation }=await env.DB.prepare(`
    SELECT declared_feature_family,baseline_forecast_key,candidate_forecast_key,coverage_bucket,paired_target_count,
           baseline_log_loss,candidate_log_loss,delta_log_loss,baseline_brier,candidate_brier,delta_brier,evidence_status
    FROM replay_ablation_results WHERE replay_run_id=? ORDER BY coverage_bucket
  `).bind(row.id).all();
  return {
    ...replayMetadata(row),
    skips:(skips||[]).map((item)=>({...item,details:parseJson(item.details_json,'skip details_json'),details_json:undefined})),
    ablation_results:ablation||[]
  };
}
