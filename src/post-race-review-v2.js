import { stableId } from './ids.js';
import { stableFeatureJson } from './analysis-v3-foundations.js';

export const POST_RACE_REVIEW_V2_VERSION = 'post-race-review-v2-f2';
const LEARNING_EVIDENCE_VERSION = 'post-race-learning-evidence-v1';
const LEARNING_MIN_EVIDENCE_TARGET = 5;

function parseJson(value, field) {
  try { return JSON.parse(value); } catch { throw new Error(`${field} is invalid JSON`); }
}

function asNumber(value) {
  return value == null ? null : Number(value);
}

function exactIso(value, field) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

async function candidateV3Round(env, roundId = null) {
  const filter = roundId ? 'AND gr.id = ?' : '';
  const sql = `
    SELECT
      gr.id,gr.game_type,gr.round_date,
      av3.id AS analysis_v3_id,av3.lock_id,av3.decision_run_id,av3.optimizer_run_id,
      av3.analysis_fingerprint,av3.lock_hash AS analysis_lock_hash,av3.market_cutoff,av3.created_at AS analysis_created_at,
      asl.lock_json,asl.lock_hash,asl.created_at AS lock_created_at,
      adr.decision_json,adr.decision_fingerprint,
      aor.optimizer_json,aor.optimizer_fingerprint
    FROM game_rounds gr
    JOIN analysis_v3_runs av3 ON av3.id = (
      SELECT candidate.id
      FROM analysis_v3_runs candidate
      WHERE candidate.game_round_id = gr.id
        AND datetime(candidate.created_at) < datetime((
          SELECT MIN(COALESCE(r.scheduled_start_at, r.race_date || 'T23:59:59Z'))
          FROM game_legs gl0 JOIN races r ON r.id = gl0.race_id
          WHERE gl0.game_round_id = gr.id
        ))
        AND datetime(candidate.market_cutoff) < datetime((
          SELECT MIN(COALESCE(r.scheduled_start_at, r.race_date || 'T23:59:59Z'))
          FROM game_legs gl0 JOIN races r ON r.id = gl0.race_id
          WHERE gl0.game_round_id = gr.id
        ))
      ORDER BY datetime(candidate.created_at) DESC,candidate.id DESC
      LIMIT 1
    )
    JOIN analysis_step1_locks asl ON asl.id = av3.lock_id
    JOIN analysis_decision_runs adr ON adr.id = av3.decision_run_id
    JOIN analysis_optimizer_runs aor ON aor.id = av3.optimizer_run_id
    WHERE gr.game_type IN ('V85','V86')
      ${filter}
      AND (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id = gr.id) = 8
      AND (SELECT COUNT(*)
           FROM game_legs gl
           WHERE gl.game_round_id = gr.id
             AND (SELECT COUNT(*)
                  FROM race_entries re
                  JOIN race_results rr ON rr.race_entry_id = re.id AND rr.placing = 1
                  WHERE re.race_id = gl.race_id) = 1) = 8
      AND (SELECT COUNT(*) FROM post_race_reviews_v2 pr WHERE pr.analysis_v3_id = av3.id) < 8
    ORDER BY gr.round_date ASC,gr.id ASC
    LIMIT 1
  `;
  return roundId ? env.DB.prepare(sql).bind(roundId).first() : env.DB.prepare(sql).first();
}

function assertLineage(row, lock, decision, optimizer) {
  if (lock.round_id !== row.id || decision.round_id !== row.id || optimizer.round_id !== row.id) {
    throw new Error(`round ${row.id} has cross-round v3 lineage`);
  }
  if (lock.lock_id !== row.lock_id || decision.lock_id !== row.lock_id
    || row.analysis_lock_hash !== row.lock_hash || decision.lock_hash !== row.lock_hash) {
    throw new Error(`round ${row.id} has stale Step 1 lineage`);
  }
  if (decision.decision_fingerprint !== row.decision_fingerprint) {
    throw new Error(`round ${row.id} decision fingerprint mismatch`);
  }
  if (optimizer.decision_run_id !== row.decision_run_id
    || optimizer.decision_fingerprint !== row.decision_fingerprint
    || optimizer.optimizer_fingerprint !== row.optimizer_fingerprint) {
    throw new Error(`round ${row.id} optimizer lineage mismatch`);
  }
}

async function loadRoundFacts(env, row) {
  const { results: winners } = await env.DB.prepare(`
    SELECT gl.leg_number,gl.race_id,winner.id AS winner_entry_id
    FROM game_legs gl
    JOIN race_entries winner ON winner.race_id=gl.race_id
    JOIN race_results rr ON rr.race_entry_id=winner.id AND rr.placing=1
    WHERE gl.game_round_id=?
    ORDER BY gl.leg_number
  `).bind(row.id).all();
  if ((winners || []).length !== 8) throw new Error(`round ${row.id} does not have exactly eight unambiguous winners`);

  const { results: results } = await env.DB.prepare(`
    SELECT gl.leg_number,re.id AS race_entry_id,rr.placing,rr.gallop,rr.disqualified
    FROM game_legs gl
    JOIN race_entries re ON re.race_id=gl.race_id
    LEFT JOIN race_results rr ON rr.race_entry_id=re.id
    WHERE gl.game_round_id=?
    ORDER BY gl.leg_number,re.id
  `).bind(row.id).all();

  const { results: decisionRows } = await env.DB.prepare(`
    SELECT leg_number,race_entry_id,blind_probability,public_win_probability_proxy,public_proxy_quality,decision_probability
    FROM analysis_decision_probabilities
    WHERE decision_run_id=?
    ORDER BY leg_number,race_entry_id
  `).bind(row.decision_run_id).all();

  const { results: optimizerRows } = await env.DB.prepare(`
    SELECT leg_number,race_entry_id,is_spike,decision_probability
    FROM analysis_optimizer_selections
    WHERE optimizer_run_id=?
    ORDER BY leg_number,race_entry_id
  `).bind(row.optimizer_run_id).all();

  const cutoff = exactIso(row.market_cutoff, 'market_cutoff');
  const { results: markets } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT bs.*,ROW_NUMBER() OVER (
        PARTITION BY bs.leg_number,bs.race_entry_id
        ORDER BY julianday(bs.captured_at) DESC,bs.id DESC
      ) AS rn
      FROM betting_snapshots bs
      WHERE bs.game_round_id=? AND julianday(bs.captured_at) <= julianday(?)
    )
    SELECT leg_number,race_entry_id,bet_percent,market_rank,captured_at
    FROM ranked WHERE rn=1
  `).bind(row.id, cutoff).all();

  return {
    winners: new Map((winners || []).map((item) => [Number(item.leg_number), item])),
    results: new Map((results || []).map((item) => [item.race_entry_id, item])),
    decisions: new Map((decisionRows || []).map((item) => [`${item.leg_number}:${item.race_entry_id}`, item])),
    optimizerSelections: new Map(Array.from({ length: 8 }, (_, index) => [index + 1, (optimizerRows || []).filter((item) => Number(item.leg_number) === index + 1)])),
    markets: new Map((markets || []).map((item) => [`${item.leg_number}:${item.race_entry_id}`, item]))
  };
}

function indexPreRace(lock, decision, optimizer) {
  const lockLegs = new Map((lock.legs || []).map((leg) => [Number(leg.leg_number), leg]));
  const decisionLegs = new Map((decision.legs || []).map((leg) => [Number(leg.leg_number), leg]));
  const optimizerLegs = new Map((optimizer.system?.legs || []).map((leg) => [Number(leg.leg_number), leg]));
  if (lockLegs.size !== 8 || decisionLegs.size !== 8 || optimizerLegs.size !== 8) {
    throw new Error('F2 requires complete eight-leg v3 pre-race lineage');
  }
  return { lockLegs, decisionLegs, optimizerLegs };
}

function scenarioDiagnostic(lockLeg) {
  return {
    scenarioMatch: 'unavailable',
    scenarioConfidence: asNumber(lockLeg?.scenario_confidence),
    explanation: 'No canonical observed scenario-outcome contract is available; F2 does not infer scenario realization from the winner alone.'
  };
}

function coverageDiagnostic(lockLeg, winnerPrediction) {
  return {
    status: 'not_structured_in_step1_lock',
    data_quality_summary: lockLeg?.data_quality_summary || null,
    assessment_confidence: asNumber(winnerPrediction?.assessment_confidence),
    scenario_confidence: asNumber(lockLeg?.scenario_confidence)
  };
}

function primaryFailure({ selectedWinner, isSpike, winnerRank, selectedCount, topPickIncident, hasWinnerPrediction }) {
  if (selectedWinner) return null;
  if (!hasWinnerPrediction) return 'data_gap';
  if (topPickIncident) return 'incident';
  if (isSpike) return 'spike';
  if (winnerRank != null && winnerRank > selectedCount) return 'ranking';
  return 'system_allocation';
}

function learningTitle(failureClass) {
  const labels = {
    ranking: 'Repeated post-race ranking misses',
    probability: 'Repeated post-race probability misses',
    scenario: 'Repeated post-race scenario misses',
    system_allocation: 'Repeated post-race system-allocation misses',
    spike: 'Repeated post-race spike misses',
    incident: 'Repeated post-race incident-linked misses',
    data_gap: 'Repeated post-race data-gap misses'
  };
  return labels[failureClass] || 'Repeated post-race diagnostic misses';
}

async function linkCandidateEvidence(env, review) {
  if (review.learningClassification !== 'candidate_learning' || !review.failureClass) return null;
  const hypothesisId = stableId('learning-hypothesis', LEARNING_EVIDENCE_VERSION, review.failureClass);
  const observationId = stableId('learning-observation', LEARNING_EVIDENCE_VERSION, review.id);
  const now = review.createdAt;

  await env.DB.prepare(`
    INSERT OR IGNORE INTO learning_hypotheses
      (id,title,category,hypothesis_text,status,min_evidence_target,created_at,updated_at)
    VALUES (?,?,?,?, 'candidate', ?, ?, ?)
  `).bind(
    hypothesisId,
    learningTitle(review.failureClass),
    `post_race_${review.failureClass}`,
    `Repeated ${review.failureClass} diagnostics should be reviewed as accumulated evidence before any model or rule change.`,
    LEARNING_MIN_EVIDENCE_TARGET,
    now,
    now
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO learning_observations
      (id,hypothesis_id,game_round_id,race_id,direction,strength,observation_text,evidence_json,created_at)
    VALUES (?,?,?,?, 'supporting', NULL, ?, ?, ?)
  `).bind(
    observationId,
    hypothesisId,
    review.roundId,
    review.raceId,
    `F2 recorded a ${review.failureClass} diagnostic; this is candidate evidence only.`,
    stableFeatureJson({
      evidence_version: LEARNING_EVIDENCE_VERSION,
      review_id: review.id,
      analysis_v3_id: review.analysisV3Id,
      pre_race_fingerprint: review.preRaceFingerprint,
      failure_class: review.failureClass
    }),
    now
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO post_race_learning_links (review_id,hypothesis_id,observation_id)
    VALUES (?,?,?)
  `).bind(review.id,hypothesisId,observationId).run();

  return { hypothesisId, observationId };
}

async function persistLegReview(env, row, facts, indexed, legNumber, now) {
  const winner = facts.winners.get(legNumber);
  const lockLeg = indexed.lockLegs.get(legNumber);
  const decisionLeg = indexed.decisionLegs.get(legNumber);
  const optimizerLeg = indexed.optimizerLegs.get(legNumber);
  if (!winner || !lockLeg || !decisionLeg || !optimizerLeg) throw new Error(`F2 leg ${legNumber} lineage is incomplete`);
  if (lockLeg.race_id !== winner.race_id) throw new Error(`F2 leg ${legNumber} race identity mismatch`);

  const winnerPrediction = (lockLeg.predictions || []).find((item) => item.race_entry_id === winner.winner_entry_id) || null;
  const winnerDecisionDocument = (decisionLeg.entries || []).find((item) => item.race_entry_id === winner.winner_entry_id) || null;
  const winnerDecision = facts.decisions.get(`${legNumber}:${winner.winner_entry_id}`) || null;
  if (!winnerDecision || !winnerDecisionDocument
    || Number(winnerDecision.decision_probability) !== Number(winnerDecisionDocument.decision_probability)
    || Number(winnerDecision.blind_probability) !== Number(winnerDecisionDocument.blind_probability)) {
    throw new Error(`F2 leg ${legNumber} canonical decision storage mismatch`);
  }
  const selectedEntries = optimizerLeg.selected_entries || [];
  const storedSelections = facts.optimizerSelections.get(legNumber) || [];
  const expectedSelectionIds = selectedEntries.map((item) => String(item.race_entry_id)).sort();
  const storedSelectionIds = storedSelections.map((item) => String(item.race_entry_id)).sort();
  if (stableFeatureJson(expectedSelectionIds) !== stableFeatureJson(storedSelectionIds)
    || storedSelections.some((item) => Number(item.is_spike) !== (optimizerLeg.is_spike ? 1 : 0))) {
    throw new Error(`F2 leg ${legNumber} canonical optimizer storage mismatch`);
  }
  const selectedWinner = storedSelections.some((item) => item.race_entry_id === winner.winner_entry_id);
  const isSpike = Boolean(optimizerLeg.is_spike);
  const topPick = [...(lockLeg.predictions || [])].sort((a,b) => Number(a.raw_rank) - Number(b.raw_rank))[0] || null;
  const topPickResult = topPick ? facts.results.get(topPick.race_entry_id) : null;
  const topPickIncident = Boolean(topPickResult && (Number(topPickResult.gallop) === 1 || Number(topPickResult.disqualified) === 1));
  const scenario = scenarioDiagnostic(lockLeg);
  const coverage = coverageDiagnostic(lockLeg, winnerPrediction);
  const market = facts.markets.get(`${legNumber}:${winner.winner_entry_id}`) || null;
  const failureClass = primaryFailure({
    selectedWinner,
    isSpike,
    winnerRank: asNumber(winnerPrediction?.raw_rank),
    selectedCount: selectedEntries.length,
    topPickIncident,
    hasWinnerPrediction: Boolean(winnerPrediction && winnerDecision)
  });
  const learningClassification = failureClass ? 'candidate_learning' : 'no_change';
  const id = stableId('post-race-review-v2', POST_RACE_REVIEW_V2_VERSION, row.analysis_v3_id, winner.race_id);
  const diagnostics = {
    review_version: POST_RACE_REVIEW_V2_VERSION,
    immutable_pre_race: {
      analysis_v3_id: row.analysis_v3_id,
      analysis_fingerprint: row.analysis_fingerprint,
      lock_id: row.lock_id,
      decision_run_id: row.decision_run_id,
      optimizer_run_id: row.optimizer_run_id
    },
    outcome: {
      winner_entry_id: winner.winner_entry_id,
      selected_by_optimizer: selectedWinner
    },
    probability: {
      blind_probability: asNumber(winnerPrediction?.blind_probability),
      decision_probability: asNumber(winnerDecision?.decision_probability),
      winner_rank: asNumber(winnerPrediction?.raw_rank),
      assessment_confidence: asNumber(winnerPrediction?.assessment_confidence)
    },
    scenario,
    coverage,
    market: {
      ownership_percent: asNumber(market?.bet_percent),
      market_rank: asNumber(market?.market_rank),
      captured_at: market?.captured_at || null,
      public_win_probability_proxy: asNumber(winnerDecision?.public_win_probability_proxy),
      public_proxy_quality: winnerDecision?.public_proxy_quality || null
    },
    optimizer: {
      selected: selectedWinner,
      is_spike: isSpike,
      selected_count: selectedEntries.length,
      top_pick_entry_id: topPick?.race_entry_id || null,
      top_pick_incident: topPickIncident
    },
    failure_class: failureClass,
    learning_classification: learningClassification
  };

  const write = await env.DB.prepare(`
    INSERT OR IGNORE INTO post_race_reviews_v2 (
      id,game_round_id,race_id,leg_number,winner_entry_id,analysis_v3_id,lock_id,decision_run_id,optimizer_run_id,
      review_version,pre_race_fingerprint,winner_blind_probability,winner_decision_probability,winner_rank,
      winner_assessment_confidence,scenario_match,scenario_confidence,data_quality_summary,coverage_json,
      winner_market_percent,winner_market_rank,public_win_probability_proxy,public_proxy_quality,
      optimizer_selected,optimizer_is_spike,optimizer_selected_count,failure_class,learning_classification,
      diagnostics_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    id,row.id,winner.race_id,legNumber,winner.winner_entry_id,row.analysis_v3_id,row.lock_id,row.decision_run_id,row.optimizer_run_id,
    POST_RACE_REVIEW_V2_VERSION,row.analysis_fingerprint,
    asNumber(winnerPrediction?.blind_probability),asNumber(winnerDecision?.decision_probability),asNumber(winnerPrediction?.raw_rank),
    asNumber(winnerPrediction?.assessment_confidence),scenario.scenarioMatch,scenario.scenarioConfidence,
    lockLeg.data_quality_summary || null,stableFeatureJson(coverage),
    asNumber(market?.bet_percent),asNumber(market?.market_rank),asNumber(winnerDecision?.public_win_probability_proxy),
    winnerDecision?.public_proxy_quality || null,selectedWinner ? 1 : 0,isSpike ? 1 : 0,selectedEntries.length,
    failureClass,learningClassification,stableFeatureJson(diagnostics),now
  ).run();

  const review = {
    id,roundId: row.id,raceId: winner.race_id,analysisV3Id: row.analysis_v3_id,
    preRaceFingerprint: row.analysis_fingerprint,failureClass,learningClassification,createdAt: now
  };
  if (Number(write.meta?.changes || 0) > 0) await linkCandidateEvidence(env, review);
  return Number(write.meta?.changes || 0);
}

export async function runNextPostRaceReviewV2(env, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const row = await candidateV3Round(env, options.roundId || null);
  if (!row) return null;

  const lock = parseJson(row.lock_json, 'Step 1 lock');
  const decision = parseJson(row.decision_json, 'decision');
  const optimizer = parseJson(row.optimizer_json, 'optimizer');
  assertLineage(row, lock, decision, optimizer);

  const facts = await loadRoundFacts(env, row);
  const indexed = indexPreRace(lock, decision, optimizer);
  const now = new Date().toISOString();
  let inserted = 0;
  for (let leg = 1; leg <= 8; leg += 1) inserted += await persistLegReview(env,row,facts,indexed,leg,now);

  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM post_race_reviews_v2 WHERE analysis_v3_id=?')
    .bind(row.analysis_v3_id).first();
  if (Number(count?.count || 0) !== 8) throw new Error(`F2 review for analysis ${row.analysis_v3_id} did not reach eight legs`);

  return {
    status: 'completed',
    reviewVersion: POST_RACE_REVIEW_V2_VERSION,
    roundId: row.id,
    gameType: row.game_type,
    roundDate: row.round_date,
    analysisV3Id: row.analysis_v3_id,
    reviews: inserted
  };
}
