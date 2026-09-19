import { stableId } from './ids.js';
import { stableFeatureJson } from './analysis-v3-foundations.js';

export const EXTERNAL_POST_RACE_REVIEW_VERSION = 'post-race-review-external-v1';
const LEARNING_EVIDENCE_VERSION = 'post-race-learning-evidence-external-v1';
const LEARNING_MIN_EVIDENCE_TARGET = 5;
const PROBABILITY_TOLERANCE = 1e-6;

function requiredText(value, field, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(field + ' is required and must be at most ' + max + ' characters');
  return text;
}

function exactIso(value, field) {
  const text = requiredText(value, field, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(field + ' must be a valid timestamp');
  return new Date(ms).toISOString();
}

function asNumber(value) {
  return value == null ? null : Number(value);
}

function round(value, digits = 12) {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreForecast(entries, winnerEntryId) {
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('external forecast must contain at least two entries');
  const seen = new Set();
  let sum = 0;
  const normalized = entries.map((entry, index) => {
    const id = requiredText(entry?.race_entry_id, 'external forecast entry ' + index, 200);
    if (seen.has(id)) throw new Error('duplicate external forecast entry ' + id);
    seen.add(id);
    const probability = Number(entry?.probability);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('external forecast probability must be 0..1');
    sum += probability;
    return { race_entry_id: id, probability };
  }).sort((a, b) => b.probability - a.probability || a.race_entry_id.localeCompare(b.race_entry_id));
  if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) throw new Error('external forecast probabilities must sum to 1');
  const winner = requiredText(winnerEntryId, 'winner_entry_id', 200);
  const winnerIndex = normalized.findIndex((entry) => entry.race_entry_id === winner);
  if (winnerIndex < 0) throw new Error('external forecast is missing factual winner');
  const winnerProbability = normalized[winnerIndex].probability;
  let brier = 0;
  for (const entry of normalized) {
    const observed = entry.race_entry_id === winner ? 1 : 0;
    brier += (entry.probability - observed) ** 2;
  }
  return {
    score_version: 'multiclass-logloss-brier-v1',
    entry_count: normalized.length,
    winner_entry_id: winner,
    winner_probability: winnerProbability,
    winner_rank: winnerIndex + 1,
    top1_hit: winnerIndex < 1,
    top2_hit: winnerIndex < 2,
    top3_hit: winnerIndex < 3,
    log_loss: round(-Math.log(Math.max(1e-15, winnerProbability))),
    brier_score: round(brier),
    forecast: normalized
  };
}

async function roundEvidence(env, run) {
  const { results: rows } = await env.DB.prepare(`
    SELECT gl.leg_number,gl.race_id,r.scheduled_start_at,re.id AS race_entry_id,re.scratched,
           rr.placing,rr.gallop,rr.disqualified,
           p.win_probability,p.raw_rank,p.scenario_robustness,
           a.data_quality
    FROM game_legs gl
    JOIN races r ON r.id=gl.race_id
    JOIN race_entries re ON re.race_id=r.id
    LEFT JOIN race_results rr ON rr.race_entry_id=re.id
    LEFT JOIN ai_race_analyses a ON a.race_id=gl.race_id AND a.model_version_id=?
    LEFT JOIN ai_horse_predictions p ON p.ai_race_analysis_id=a.id AND p.race_entry_id=re.id
    WHERE gl.game_round_id=?
    ORDER BY gl.leg_number,re.id
  `).bind(run.model_version_id, run.game_round_id).all();

  const { results: selections } = await env.DB.prepare(`
    SELECT leg_number,race_entry_id,is_spike,own_probability,market_percent
    FROM system_selections
    WHERE system_id=?
    ORDER BY leg_number,race_entry_id
  `).bind(run.main_system_id).all();

  const legs = new Map();
  for (const row of rows || []) {
    const legNumber = Number(row.leg_number);
    if (!legs.has(legNumber)) legs.set(legNumber, {
      leg_number: legNumber,
      race_id: row.race_id,
      scheduled_start_at: row.scheduled_start_at,
      entries: []
    });
    legs.get(legNumber).entries.push({
      race_entry_id: row.race_entry_id,
      scratched: Number(row.scratched || 0) === 1,
      placing: row.placing,
      gallop: row.gallop,
      disqualified: row.disqualified,
      win_probability: row.win_probability == null ? null : Number(row.win_probability),
      raw_rank: row.raw_rank == null ? null : Number(row.raw_rank),
      scenario_robustness: row.scenario_robustness == null ? null : Number(row.scenario_robustness),
      data_quality: row.data_quality || null
    });
  }
  const ordered = [...legs.values()].sort((a, b) => a.leg_number - b.leg_number);
  if (ordered.length !== 8 || ordered.some((leg, index) => leg.leg_number !== index + 1)) throw new Error('external evidence requires eight ordered legs');
  const selectionByLeg = new Map(Array.from({ length: 8 }, (_, index) => [
    index + 1,
    (selections || []).filter((item) => Number(item.leg_number) === index + 1)
  ]));
  return { legs: ordered, selectionByLeg };
}

function assertSettledLegs(evidence) {
  const winners = new Map();
  for (const leg of evidence.legs) {
    const active = leg.entries.filter((entry) => !entry.scratched);
    const winnersHere = active.filter((entry) => Number(entry.placing) === 1);
    if (winnersHere.length !== 1) return null;
    if (active.some((entry) => entry.win_probability == null)) throw new Error('external evidence is missing a blind prediction');
    const sum = active.reduce((total, entry) => total + Number(entry.win_probability), 0);
    if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) throw new Error('external blind probabilities do not sum to 1');
    winners.set(leg.leg_number, winnersHere[0].race_entry_id);
  }
  return winners;
}

function systemDiagnostic(run, system, evidence, winners) {
  let coveredLegs = 0;
  let spikeMisses = 0;
  let recomputedP8 = 1;
  let rows = 1;
  let spikes = 0;
  for (const leg of evidence.legs) {
    const selected = evidence.selectionByLeg.get(leg.leg_number) || [];
    if (!selected.length) throw new Error('external main system is missing leg ' + leg.leg_number);
    const isSpike = selected.length === 1;
    if (isSpike) spikes += 1;
    if (selected.some((item) => Number(item.is_spike) !== (isSpike ? 1 : 0))) throw new Error('external stored spike flag mismatch');
    rows *= selected.length;
    const probabilityById = new Map(leg.entries.map((entry) => [entry.race_entry_id, Number(entry.win_probability)]));
    const coverage = selected.reduce((sum, item) => sum + Number(probabilityById.get(item.race_entry_id) || 0), 0);
    recomputedP8 *= coverage;
    const covered = selected.some((item) => item.race_entry_id === winners.get(leg.leg_number));
    if (covered) coveredLegs += 1;
    if (isSpike && !covered) spikeMisses += 1;
  }
  if (spikes !== 3 || rows !== Number(system.row_count)) throw new Error('external system row/spike invariant mismatch');
  return {
    target_group_id: run.game_round_id,
    external_run_id: run.id,
    system_id: run.main_system_id,
    lineage_type: 'external_declared_unsealed',
    row_count: rows,
    cost_sek: Number(system.budget_sek),
    spike_count: 3,
    estimated_p8: round(recomputedP8),
    covered_legs: coveredLegs,
    observed_p8: coveredLegs === 8 ? 1 : 0,
    spike_misses: spikeMisses,
    learning_eligibility: run.learning_eligibility
  };
}

export async function loadExternalDecisionReplayEvidenceV1(env, config = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const from = exactIso(config.from, 'from');
  const to = exactIso(config.to, 'to');
  const maxTargets = Math.max(1, Math.min(200, Number(config.max_targets ?? config.maxTargets ?? 50) || 50));
  const { results } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT aer.*,gr.game_type,
        (SELECT MIN(r.scheduled_start_at) FROM game_legs gl JOIN races r ON r.id=gl.race_id WHERE gl.game_round_id=gr.id) AS first_start_at,
        ROW_NUMBER() OVER (PARTITION BY aer.game_round_id ORDER BY datetime(aer.created_at) DESC,aer.id DESC) AS round_rank
      FROM analysis_external_runs aer
      JOIN game_rounds gr ON gr.id=aer.game_round_id
      WHERE gr.game_type IN ('V85','V86')
        AND datetime((SELECT MIN(r0.scheduled_start_at) FROM game_legs gl0 JOIN races r0 ON r0.id=gl0.race_id WHERE gl0.game_round_id=gr.id)) >= datetime(?)
        AND datetime((SELECT MIN(r1.scheduled_start_at) FROM game_legs gl1 JOIN races r1 ON r1.id=gl1.race_id WHERE gl1.game_round_id=gr.id)) <= datetime(?)
    )
    SELECT * FROM ranked WHERE round_rank=1
    ORDER BY datetime(first_start_at),game_round_id,id
    LIMIT ?
  `).bind(from, to, maxTargets).all();

  const targets = [];
  const systemDiagnostics = [];
  const exclusions = { incomplete_or_unsettled: 0, missing_start_time: 0 };
  for (const run of results || []) {
    const evidence = await roundEvidence(env, run);
    const winners = assertSettledLegs(evidence);
    if (!winners) { exclusions.incomplete_or_unsettled += 1; continue; }
    const starts = evidence.legs.map((leg) => Date.parse(String(leg.scheduled_start_at || '')));
    if (starts.some((value) => !Number.isFinite(value))) { exclusions.missing_start_time += 1; continue; }
    const firstStart = Math.min(...starts);
    const system = await env.DB.prepare('SELECT row_count,budget_sek FROM systems WHERE id=? LIMIT 1').bind(run.main_system_id).first();
    if (!system) throw new Error('external run main system is missing');
    systemDiagnostics.push(systemDiagnostic(run, system, evidence, winners));

    for (const leg of evidence.legs) {
      const active = leg.entries.filter((entry) => !entry.scratched);
      const entries = active.map((entry) => ({ race_entry_id: entry.race_entry_id, probability: Number(entry.win_probability) }));
      const blind = scoreForecast(entries, winners.get(leg.leg_number));
      targets.push({
        target_id: run.game_round_id + ':' + run.id + ':leg:' + leg.leg_number,
        target_group_id: run.game_round_id,
        target_group_at: new Date(firstStart).toISOString(),
        target_at: exactIso(leg.scheduled_start_at, 'leg scheduled_start_at'),
        round_id: run.game_round_id,
        decision_run_id: run.id,
        leg_number: leg.leg_number,
        winner_entry_id: winners.get(leg.leg_number),
        variants: { blind, decision: blind },
        version_metadata: {
          lineage_type: 'external_declared_unsealed',
          external_run_id: run.id,
          system_id: run.main_system_id,
          step1_pack_id: run.step1_pack_id,
          step1_pack_as_of: exactIso(run.step1_pack_as_of, 'step1_pack_as_of'),
          step1_facts_fingerprint: run.step1_facts_fingerprint,
          market_fingerprint: run.step2_market_fingerprint,
          market_cutoff: exactIso(run.step2_market_cutoff, 'step2_market_cutoff'),
          analysis_blindness: run.analysis_blindness,
          import_timing: run.import_timing,
          learning_eligibility: run.learning_eligibility,
          decision_semantics: 'blind_baseline_no_probability_rewrite'
        }
      });
    }
  }
  return { targets, systemDiagnostics, exclusions };
}

async function latestExternalCandidate(env, roundId = null) {
  const filter = roundId ? 'AND gr.id=?' : '';
  const sql = `
    WITH latest AS (
      SELECT aer.*,ROW_NUMBER() OVER (PARTITION BY aer.game_round_id ORDER BY datetime(aer.created_at) DESC,aer.id DESC) AS rn
      FROM analysis_external_runs aer
    )
    SELECT aer.*,gr.game_type,gr.round_date,
      CASE WHEN EXISTS (SELECT 1 FROM reference_round_exports rre WHERE rre.game_round_id=gr.id) THEN 1 ELSE 0 END AS regression_only
    FROM latest aer
    JOIN game_rounds gr ON gr.id=aer.game_round_id
    WHERE aer.rn=1 AND gr.game_type IN ('V85','V86') ${filter}
      AND (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id)=8
      AND (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id
           AND (SELECT COUNT(*) FROM race_entries re JOIN race_results rr ON rr.race_entry_id=re.id AND rr.placing=1 WHERE re.race_id=gl.race_id)=1)=8
      AND (SELECT COUNT(*) FROM post_race_reviews_external_v1 pr WHERE pr.external_run_id=aer.id)<8
    ORDER BY gr.round_date,aer.id
    LIMIT 1
  `;
  return roundId ? env.DB.prepare(sql).bind(roundId).first() : env.DB.prepare(sql).first();
}

function failureClass({ selectedWinner, isSpike, winnerRank, selectedCount, incident, hasPrediction }) {
  if (selectedWinner) return null;
  if (!hasPrediction) return 'data_gap';
  if (incident) return 'incident';
  if (isSpike) return 'spike';
  if (winnerRank != null && winnerRank > selectedCount) return 'ranking';
  return 'system_allocation';
}

async function linkCandidateEvidence(env, review) {
  if (review.learningClassification !== 'candidate_learning' || !review.failureClass) return;
  const hypothesisId = stableId('learning-hypothesis', LEARNING_EVIDENCE_VERSION, review.failureClass);
  const observationId = stableId('learning-observation', LEARNING_EVIDENCE_VERSION, review.id);
  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO learning_hypotheses
        (id,title,category,hypothesis_text,status,min_evidence_target,created_at,updated_at)
      VALUES (?,?,?,?, 'candidate', ?, ?, ?)
    `).bind(
      hypothesisId,
      'Repeated external post-race ' + review.failureClass + ' misses',
      'post_race_external_' + review.failureClass,
      'Repeated external-workflow ' + review.failureClass + ' diagnostics require accumulated evidence before any model or rule change.',
      LEARNING_MIN_EVIDENCE_TARGET,
      review.createdAt,
      review.createdAt
    ),
    env.DB.prepare(`
      INSERT OR IGNORE INTO learning_observations
        (id,hypothesis_id,game_round_id,race_id,direction,strength,observation_text,evidence_json,created_at)
      VALUES (?,?,?,?, 'supporting', NULL, ?, ?, ?)
    `).bind(
      observationId,hypothesisId,review.roundId,review.raceId,
      'External F2 recorded candidate evidence only.',
      stableFeatureJson({
        evidence_version: LEARNING_EVIDENCE_VERSION,
        review_id: review.id,
        external_run_id: review.externalRunId,
        pre_race_fingerprint: review.preRaceFingerprint,
        failure_class: review.failureClass
      }),
      review.createdAt
    ),
    env.DB.prepare('INSERT OR IGNORE INTO post_race_learning_links_external_v1 (review_id,hypothesis_id,observation_id) VALUES (?,?,?)')
      .bind(review.id,hypothesisId,observationId)
  ]);
}

export async function runNextExternalPostRaceReviewV1(env, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const run = await latestExternalCandidate(env, options.roundId || null);
  if (!run) return null;
  const evidence = await roundEvidence(env, run);
  const winners = assertSettledLegs(evidence);
  if (!winners) return null;
  const now = new Date().toISOString();
  let inserted = 0;

  for (const leg of evidence.legs) {
    const winnerId = winners.get(leg.leg_number);
    const winner = leg.entries.find((entry) => entry.race_entry_id === winnerId);
    const topPick = [...leg.entries.filter((entry) => !entry.scratched)]
      .sort((a, b) => Number(a.raw_rank ?? 9999) - Number(b.raw_rank ?? 9999))[0] || null;
    const topPickIncident = Boolean(topPick && (Number(topPick.gallop) === 1 || Number(topPick.disqualified) === 1));
    const selected = evidence.selectionByLeg.get(leg.leg_number) || [];
    const selectedWinner = selected.some((item) => item.race_entry_id === winnerId);
    const isSpike = selected.length === 1;
    const fail = failureClass({
      selectedWinner,
      isSpike,
      winnerRank: asNumber(winner?.raw_rank),
      selectedCount: selected.length,
      incident: topPickIncident,
      hasPrediction: winner?.win_probability != null
    });
    const learningEligible = run.learning_eligibility === 'eligible_by_timing' && Number(run.regression_only) !== 1;
    const learningClassification = fail && learningEligible ? 'candidate_learning' : 'no_change';
    const id = stableId('post-race-review-external-v1', EXTERNAL_POST_RACE_REVIEW_VERSION, run.id, leg.race_id);
    const market = await env.DB.prepare(`
      SELECT bs.bet_percent,bs.market_rank,bs.captured_at
      FROM betting_snapshots bs
      JOIN source_records sr ON sr.id=bs.source_record_id
      WHERE bs.game_round_id=? AND bs.leg_number=? AND bs.race_entry_id=?
        AND sr.source_type='official_provider' AND sr.quality_status='normalized_verified_subset'
        AND julianday(bs.captured_at)<=julianday(?) AND julianday(sr.fetched_at)<=julianday(?)
      ORDER BY julianday(bs.captured_at) DESC,bs.id DESC LIMIT 1
    `).bind(run.game_round_id,leg.leg_number,winnerId,run.step2_market_cutoff,run.step2_market_cutoff).first();

    const coverage = {
      status: 'external_declared_unsealed',
      data_quality_summary: winner?.data_quality || null,
      scenario_robustness: asNumber(winner?.scenario_robustness)
    };
    const diagnostics = {
      review_version: EXTERNAL_POST_RACE_REVIEW_VERSION,
      immutable_pre_race: {
        external_run_id: run.id,
        step1_pack_id: run.step1_pack_id,
        step1_facts_fingerprint: run.step1_facts_fingerprint,
        step2_market_fingerprint: run.step2_market_fingerprint,
        step2_market_cutoff: run.step2_market_cutoff,
        analysis_blindness: run.analysis_blindness,
        import_timing: run.import_timing,
        learning_eligibility: run.learning_eligibility
      },
      outcome: { winner_entry_id: winnerId, selected_by_system: selectedWinner },
      probability: { blind_probability: asNumber(winner?.win_probability), winner_rank: asNumber(winner?.raw_rank) },
      scenario: { scenario_match: 'unavailable', scenario_confidence: null },
      coverage,
      market: {
        ownership_percent: asNumber(market?.bet_percent),
        market_rank: asNumber(market?.market_rank),
        captured_at: market?.captured_at || null
      },
      system: { selected: selectedWinner, is_spike: isSpike, selected_count: selected.length },
      failure_class: fail,
      learning_eligible: learningEligible,
      learning_classification: learningClassification
    };

    const write = await env.DB.prepare(`
      INSERT OR IGNORE INTO post_race_reviews_external_v1 (
        id,game_round_id,race_id,leg_number,winner_entry_id,external_run_id,system_id,review_version,pre_race_fingerprint,
        winner_blind_probability,winner_rank,scenario_match,scenario_confidence,data_quality_summary,coverage_json,
        winner_market_percent,winner_market_rank,system_selected,system_is_spike,system_selected_count,
        failure_class,learning_eligible,learning_classification,diagnostics_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,run.game_round_id,leg.race_id,leg.leg_number,winnerId,run.id,run.main_system_id,EXTERNAL_POST_RACE_REVIEW_VERSION,
      run.payload_digest,asNumber(winner?.win_probability),asNumber(winner?.raw_rank),'unavailable',null,winner?.data_quality || null,
      stableFeatureJson(coverage),asNumber(market?.bet_percent),asNumber(market?.market_rank),selectedWinner?1:0,isSpike?1:0,selected.length,
      fail,learningEligible?1:0,learningClassification,stableFeatureJson(diagnostics),now
    ).run();
    inserted += Number(write.meta?.changes || 0);
    if (learningEligible && learningClassification === 'candidate_learning') {
      await linkCandidateEvidence(env, {
        id,roundId:run.game_round_id,raceId:leg.race_id,externalRunId:run.id,
        preRaceFingerprint:run.payload_digest,failureClass:fail,learningClassification,createdAt:now
      });
    }
  }

  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM post_race_reviews_external_v1 WHERE external_run_id=?').bind(run.id).first();
  if (Number(count?.count || 0) !== 8) throw new Error('external F2 review did not reach eight legs');
  return {
    status: 'completed',
    reviewVersion: EXTERNAL_POST_RACE_REVIEW_VERSION,
    roundId: run.game_round_id,
    gameType: run.game_type,
    roundDate: run.round_date,
    externalRunId: run.id,
    reviews: inserted,
    learningEligibility: run.learning_eligibility
  };
}
