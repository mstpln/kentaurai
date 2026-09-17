import { stableFeatureJson } from './analysis-v3-foundations.js';
import { createPreMarketAnalysisPackV3 } from './analysis-pack-v3.js';
import { assertAnalysisPackReplaySafe } from './analysis-pack-v3-asof-guard.js';
import { canonicalLegsFromAnalysisPack, requireLatestStep1LockV1 } from './analysis-step1-revision-v1.js';

export const ANALYSIS_MARKET_PACK_V3_CONTRACT = 'kentaurai-market-pack-v3';
export const ANALYSIS_MARKET_PACK_V3_VERSION = 'market-pack-v3-d4';
export const ANALYSIS_MARKET_SOURCE_QUALITY = 'normalized_verified_subset';

const CONTENT_TYPE = 'application/json; charset=utf-8';
const EXTERNAL_RANKING_TYPES = Object.freeze([
  'external_rank', 'external_ranking', 'tip', 'tip_rank', 'tip_ranking', 'pick', 'ranking'
]);

function requiredText(value, field, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function validIso(value) {
  return typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value));
}

function minuteIso(value, field) {
  const text = requiredText(value, field, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return new Date(Math.floor(ms / 60000) * 60000).toISOString();
}

function exactIso(value, field) {
  const text = requiredText(value, field, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundNumber(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function hashValue(value) {
  return sha256Text(stableFeatureJson(value));
}

function stripRoundTransport(payload) {
  const copy = structuredClone(payload || {});
  delete copy.contract_version;
  delete copy.pack_version;
  delete copy.as_of;
  delete copy.contains_current_market;
  return copy;
}

function semanticPackView(pack) {
  const roundFile = (pack?.files || []).find((file) => file?.name === '00_round_pre_market.json');
  if (!roundFile?.payload) throw new Error('analysis pack round context is unavailable');
  const legs = canonicalLegsFromAnalysisPack(pack);
  return {
    round: stripRoundTransport(roundFile.payload),
    legs: Array.from({ length: 8 }, (_, index) => legs.get(index + 1))
  };
}

function contentFile(name, payload) {
  const content = stableFeatureJson(payload);
  return { name, payload, content, bytes: new TextEncoder().encode(content).byteLength };
}

function latestIso(values) {
  const valid = values.filter(validIso);
  if (!valid.length) return null;
  return new Date(Math.max(...valid.map((value) => Date.parse(value)))).toISOString();
}

export async function loadMarketDeadlineV3(env, roundId, asOf = null) {
  if (!env?.DB) throw new Error('DB is not configured');
  const round = requiredText(roundId, 'round_id');
  const row = await env.DB.prepare(`
    SELECT id,game_type,bet_stop_at,scheduled_start_at
    FROM game_rounds
    WHERE id=? AND game_type IN ('V85','V86')
    LIMIT 1
  `).bind(round).first();
  if (!row) throw new Error('V85/V86 round was not found');

  const requestedAsOf = minuteIso(asOf ?? new Date().toISOString(), 'as_of');
  let deadlineAt;
  let deadlineSource;
  let deadlineQuality;
  if (validIso(row.bet_stop_at)) {
    deadlineAt = exactIso(row.bet_stop_at, 'bet_stop_at');
    deadlineSource = 'bet_stop_at';
    deadlineQuality = 'verified';
  } else if (validIso(row.scheduled_start_at)) {
    deadlineAt = exactIso(row.scheduled_start_at, 'scheduled_start_at');
    deadlineSource = 'round_scheduled_start_at';
    deadlineQuality = 'conservative_proxy';
  } else {
    throw new Error('market pack requires a verified betting stop or round start');
  }
  const cutoff = new Date(Math.min(Date.parse(requestedAsOf), Date.parse(deadlineAt))).toISOString();
  return {
    round_id: round,
    requested_as_of: requestedAsOf,
    cutoff,
    deadline_at: deadlineAt,
    deadline_source: deadlineSource,
    deadline_quality: deadlineQuality
  };
}

export async function assertMarketStep1BindingV3(env, { roundId, lockId, lockHash } = {}) {
  const round = requiredText(roundId, 'round_id');
  const id = requiredText(lockId, 'lock_id', 160);
  const hash = requiredText(lockHash, 'lock_hash', 160);
  const lock = await requireLatestStep1LockV1(env, { roundId: round, lockId: id });
  if (lock.lock_hash !== hash) throw new Error('lock_hash does not match the newest sealed Step 1 lock');
  return lock;
}

export async function assertNoLateFactsBeforeMarketV3(env, { roundId, lock, cutoff } = {}) {
  const round = requiredText(roundId, 'round_id');
  if (!lock || lock.round_id !== round) throw new Error('sealed Step 1 lock metadata is required');
  const marketCutoff = exactIso(cutoff, 'cutoff');
  await assertAnalysisPackReplaySafe(env, round, lock.pack_as_of);
  await assertAnalysisPackReplaySafe(env, round, marketCutoff);
  const sealedPack = await createPreMarketAnalysisPackV3(env, round, { asOf: lock.pack_as_of });
  if (sealedPack.manifest.pack_id !== lock.pack_id || sealedPack.manifest.facts_fingerprint !== lock.facts_fingerprint) {
    throw new Error('sealed Step 1 parent pack can no longer be reproduced');
  }
  const cutoffPack = await createPreMarketAnalysisPackV3(env, round, { asOf: marketCutoff });
  if (stableFeatureJson(semanticPackView(sealedPack)) !== stableFeatureJson(semanticPackView(cutoffPack))) {
    throw new Error('new pre-market facts exist after the newest sealed Step 1 lock; create a late-fact revision before market export');
  }
  return cutoffPack;
}

export async function loadVerifiedMarketRowsV3(env, roundId, cutoff) {
  if (!env?.DB) throw new Error('DB is not configured');
  const round = requiredText(roundId, 'round_id');
  const marketCutoff = exactIso(cutoff, 'cutoff');
  const { results: betting } = await env.DB.prepare(`
    SELECT bs.race_entry_id,bs.leg_number,bs.bet_percent,bs.market_rank,bs.captured_at
    FROM betting_snapshots bs
    JOIN source_records sr ON sr.id=bs.source_record_id
    JOIN game_legs gl ON gl.game_round_id=bs.game_round_id AND gl.leg_number=bs.leg_number
    JOIN race_entries re ON re.id=bs.race_entry_id AND re.race_id=gl.race_id
    WHERE bs.game_round_id=?
      AND sr.source_type='official_provider'
      AND sr.quality_status=?
      AND julianday(bs.captured_at)<=julianday(?)
    ORDER BY bs.leg_number,bs.race_entry_id,julianday(bs.captured_at),bs.id
  `).bind(round, ANALYSIS_MARKET_SOURCE_QUALITY, marketCutoff).all();

  const { results: odds } = await env.DB.prepare(`
    SELECT os.race_entry_id,gl.leg_number,lower(os.market_type) AS market_type,os.odds,os.captured_at
    FROM odds_snapshots os
    JOIN source_records sr ON sr.id=os.source_record_id
    JOIN race_entries re ON re.id=os.race_entry_id
    JOIN game_legs gl ON gl.race_id=re.race_id
    WHERE gl.game_round_id=?
      AND sr.source_type='official_provider'
      AND sr.quality_status=?
      AND lower(os.market_type) IN ('win','winner','place')
      AND julianday(os.captured_at)<=julianday(?)
    ORDER BY gl.leg_number,os.race_entry_id,lower(os.market_type),julianday(os.captured_at),os.id
  `).bind(round, ANALYSIS_MARKET_SOURCE_QUALITY, marketCutoff).all();

  return {
    betting: (betting || []).map((row) => ({
      race_entry_id: row.race_entry_id,
      leg_number: Number(row.leg_number),
      market_ownership_percent: finiteOrNull(row.bet_percent),
      market_rank: row.market_rank == null ? null : Number(row.market_rank),
      captured_at: row.captured_at,
      source_quality: ANALYSIS_MARKET_SOURCE_QUALITY
    })),
    odds: (odds || []).map((row) => ({
      race_entry_id: row.race_entry_id,
      leg_number: Number(row.leg_number),
      market_type: row.market_type === 'winner' ? 'win' : row.market_type,
      odds: finiteOrNull(row.odds),
      captured_at: row.captured_at,
      source_quality: ANALYSIS_MARKET_SOURCE_QUALITY
    }))
  };
}

export async function loadExternalRankingsV3(env, roundId, cutoff) {
  if (!env?.DB) throw new Error('DB is not configured');
  const round = requiredText(roundId, 'round_id');
  const marketCutoff = exactIso(cutoff, 'cutoff');
  const placeholders = EXTERNAL_RANKING_TYPES.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT gl.leg_number,ei.race_entry_id,es.signal_type,es.value_text,es.polarity,es.strength,
           es.fact_or_opinion,es.confidence,ei.published_at
    FROM editorial_signals es
    JOIN editorial_items ei ON ei.id=es.editorial_item_id
    JOIN race_entries re ON re.id=ei.race_entry_id
    JOIN game_legs gl ON gl.race_id=re.race_id
    WHERE gl.game_round_id=?
      AND ei.source_record_id IS NOT NULL
      AND ei.rights_status='structured_only'
      AND ei.published_at IS NOT NULL
      AND julianday(ei.published_at)<=julianday(?)
      AND lower(es.signal_type) IN (${placeholders})
    ORDER BY gl.leg_number,ei.race_entry_id,julianday(ei.published_at),es.id
  `).bind(round, marketCutoff, ...EXTERNAL_RANKING_TYPES).all();
  return (results || []).map((row) => ({
    leg_number: Number(row.leg_number),
    race_entry_id: row.race_entry_id,
    signal_type: String(row.signal_type).toLowerCase(),
    value: row.value_text ?? null,
    polarity: row.polarity ?? null,
    strength: finiteOrNull(row.strength),
    fact_or_opinion: row.fact_or_opinion,
    confidence: finiteOrNull(row.confidence),
    published_at: row.published_at
  }));
}

export function marketMaturityV3(history, cutoff) {
  const rows = [...(history || [])].filter((row) => validIso(row?.captured_at)).sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  const percentages = rows.map((row) => finiteOrNull(row.market_ownership_percent)).filter(Number.isFinite);
  const firstAt = rows[0]?.captured_at ?? null;
  const latestAt = rows.at(-1)?.captured_at ?? null;
  const first = percentages.length ? percentages[0] : null;
  const latest = percentages.length ? percentages.at(-1) : null;
  const steps = [];
  for (let index = 1; index < percentages.length; index += 1) steps.push(Math.abs(percentages[index] - percentages[index - 1]));
  return {
    snapshot_count: rows.length,
    ownership_observation_count: percentages.length,
    first_snapshot_at: firstAt,
    latest_snapshot_at: latestAt,
    snapshot_age_minutes: latestAt ? roundNumber(Math.max(0, Date.parse(cutoff) - Date.parse(latestAt)) / 60000, 3) : null,
    ownership_range_pp: percentages.length ? roundNumber(Math.max(...percentages) - Math.min(...percentages), 4) : null,
    first_to_latest_delta_pp: first != null && latest != null ? roundNumber(latest - first, 4) : null,
    mean_abs_step_pp: steps.length ? roundNumber(steps.reduce((sum, value) => sum + value, 0) / steps.length, 4) : null,
    max_abs_step_pp: steps.length ? roundNumber(Math.max(...steps), 4) : null,
    trend_semantics_verified: false,
    trend_label: null
  };
}

function activeLegsFromPack(pack) {
  const canonical = canonicalLegsFromAnalysisPack(pack);
  return Array.from({ length: 8 }, (_, index) => {
    const legNumber = index + 1;
    const leg = canonical.get(legNumber);
    const active = (leg.entries || []).filter((entry) => entry?.current_facts?.analysis_eligible === true);
    return {
      leg_number: legNumber,
      race_id: leg?.race?.race_id ?? null,
      active_entry_ids: active.map((entry) => requiredText(entry.race_entry_id, 'race_entry_id')).sort()
    };
  });
}

function latestBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows || []) map.set(keyFn(row), row);
  return map;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows || []) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function buildLegMarketPayload(leg, bettingRows, oddsRows, cutoff, lock, marketFingerprint) {
  const bettingByEntry = groupBy(bettingRows.filter((row) => row.leg_number === leg.leg_number), (row) => row.race_entry_id);
  const oddsForLeg = oddsRows.filter((row) => row.leg_number === leg.leg_number);
  const oddsLatest = latestBy(oddsForLeg, (row) => `${row.race_entry_id}|${row.market_type}`);
  const completeWinOdds = leg.active_entry_ids.every((entryId) => {
    const value = oddsLatest.get(`${entryId}|win`)?.odds;
    return Number.isFinite(value) && value > 0;
  });
  const inverse = new Map();
  let inverseTotal = 0;
  if (completeWinOdds) {
    for (const entryId of leg.active_entry_ids) {
      const value = 1 / oddsLatest.get(`${entryId}|win`).odds;
      inverse.set(entryId, value);
      inverseTotal += value;
    }
  }
  const entries = leg.active_entry_ids.map((entryId) => {
    const history = bettingByEntry.get(entryId) || [];
    const latestBetting = history.at(-1) || null;
    const winner = oddsLatest.get(`${entryId}|win`) || null;
    const place = oddsLatest.get(`${entryId}|place`) || null;
    return {
      race_entry_id: entryId,
      market_ownership_percent: latestBetting?.market_ownership_percent ?? null,
      market_rank: latestBetting?.market_rank ?? null,
      ownership_snapshot_at: latestBetting?.captured_at ?? null,
      ownership_source_quality: latestBetting?.source_quality ?? null,
      ownership_history: history.map((row) => ({
        captured_at: row.captured_at,
        market_ownership_percent: row.market_ownership_percent,
        market_rank: row.market_rank
      })),
      winner_odds: winner?.odds ?? null,
      winner_odds_snapshot_at: winner?.captured_at ?? null,
      place_odds: place?.odds ?? null,
      place_odds_snapshot_at: place?.captured_at ?? null,
      odds_source_quality: winner?.source_quality ?? place?.source_quality ?? null,
      market_win_probability_proxy: completeWinOdds && inverseTotal > 0 ? roundNumber(inverse.get(entryId) / inverseTotal, 8) : null,
      maturity: marketMaturityV3(history, cutoff)
    };
  });
  return {
    contract_version: ANALYSIS_MARKET_PACK_V3_CONTRACT,
    pack_version: ANALYSIS_MARKET_PACK_V3_VERSION,
    round_id: lock.round_id,
    lock_id: lock.lock_id,
    lock_hash: lock.lock_hash,
    market_fingerprint: marketFingerprint,
    cutoff,
    leg_number: leg.leg_number,
    race_id: leg.race_id,
    proxy_quality: completeWinOdds ? 'verified_complete_winner_odds_v1' : 'unavailable_incomplete_winner_odds',
    proxy_method: completeWinOdds ? 'normalized_inverse_decimal_winner_odds' : null,
    trend_semantics_verified: false,
    entries
  };
}

export async function buildMarketPackV3Files({
  lock,
  deadline,
  currentPack,
  betting = [],
  odds = [],
  externalRankings = [],
  generatedAt = new Date().toISOString()
} = {}) {
  if (!lock?.lock_id || !lock?.lock_hash || !lock?.round_id) throw new Error('sealed Step 1 lock metadata is required');
  const cutoff = exactIso(deadline?.cutoff, 'cutoff');
  const generated = exactIso(generatedAt, 'generated_at');
  const legs = activeLegsFromPack(currentPack);
  const activeIds = new Set(legs.flatMap((leg) => leg.active_entry_ids));
  const safeBetting = betting.filter((row) => activeIds.has(row.race_entry_id) && Date.parse(row.captured_at) <= Date.parse(cutoff));
  const safeOdds = odds.filter((row) => activeIds.has(row.race_entry_id) && Date.parse(row.captured_at) <= Date.parse(cutoff));

  const fingerprintInput = {
    contract_version: ANALYSIS_MARKET_PACK_V3_CONTRACT,
    round_id: lock.round_id,
    lock_id: lock.lock_id,
    lock_hash: lock.lock_hash,
    cutoff,
    deadline_source: deadline.deadline_source,
    betting: safeBetting,
    odds: safeOdds
  };
  const marketFingerprint = await hashValue(fingerprintInput);
  const legPayloads = legs.map((leg) => buildLegMarketPayload(leg, safeBetting, safeOdds, cutoff, lock, marketFingerprint));
  const latestOwnershipAt = latestIso(safeBetting.map((row) => row.captured_at));
  const roundPayload = {
    contract_version: ANALYSIS_MARKET_PACK_V3_CONTRACT,
    pack_version: ANALYSIS_MARKET_PACK_V3_VERSION,
    round_id: lock.round_id,
    lock_id: lock.lock_id,
    lock_hash: lock.lock_hash,
    market_fingerprint: marketFingerprint,
    requested_as_of: deadline.requested_as_of,
    cutoff,
    deadline_at: deadline.deadline_at,
    deadline_source: deadline.deadline_source,
    deadline_quality: deadline.deadline_quality,
    source_quality: ANALYSIS_MARKET_SOURCE_QUALITY,
    pool_maturity: {
      active_entry_count: activeIds.size,
      ownership_snapshot_count: safeBetting.length,
      entries_with_current_ownership: new Set(safeBetting.map((row) => row.race_entry_id)).size,
      latest_ownership_snapshot_at: latestOwnershipAt,
      snapshot_age_minutes: latestOwnershipAt ? roundNumber(Math.max(0, Date.parse(cutoff) - Date.parse(latestOwnershipAt)) / 60000, 3) : null,
      turnover_sek: null,
      system_count: null,
      turnover_quality: 'not_snapshot_verified',
      system_count_quality: 'not_snapshot_verified',
      trend_semantics_verified: false
    }
  };

  const files = [contentFile('00_round_market.json', roundPayload)];
  for (const payload of legPayloads) files.push(contentFile(`${String(payload.leg_number).padStart(2, '0')}_leg_${payload.leg_number}_market.json`, payload));

  let externalRankingsFingerprint = null;
  if (externalRankings.length) {
    const payload = {
      contract_version: ANALYSIS_MARKET_PACK_V3_CONTRACT,
      pack_version: ANALYSIS_MARKET_PACK_V3_VERSION,
      round_id: lock.round_id,
      lock_id: lock.lock_id,
      lock_hash: lock.lock_hash,
      cutoff,
      read_order: 'last',
      source_identity_exposed: false,
      signals: externalRankings
        .filter((row) => activeIds.has(row.race_entry_id) && validIso(row.published_at) && Date.parse(row.published_at) <= Date.parse(cutoff))
        .map((row) => ({
          leg_number: Number(row.leg_number),
          race_entry_id: row.race_entry_id,
          signal_type: row.signal_type,
          value: row.value ?? null,
          polarity: row.polarity ?? null,
          strength: row.strength ?? null,
          fact_or_opinion: row.fact_or_opinion,
          confidence: row.confidence ?? null,
          published_at: row.published_at
        }))
    };
    if (payload.signals.length) {
      externalRankingsFingerprint = await hashValue(payload.signals);
      payload.external_rankings_fingerprint = externalRankingsFingerprint;
      files.push(contentFile('99_external_rankings.json', payload));
    }
  }

  const expectedFiles = [];
  for (const file of files) expectedFiles.push({ name: file.name, bytes: file.bytes, sha256: await sha256Text(file.content) });
  const manifest = {
    contract_version: ANALYSIS_MARKET_PACK_V3_CONTRACT,
    pack_version: ANALYSIS_MARKET_PACK_V3_VERSION,
    round_id: lock.round_id,
    generated_at: generated,
    requested_as_of: deadline.requested_as_of,
    cutoff,
    deadline_source: deadline.deadline_source,
    deadline_quality: deadline.deadline_quality,
    lock: {
      lock_id: lock.lock_id,
      lock_hash: lock.lock_hash,
      pack_id: lock.pack_id,
      pack_as_of: lock.pack_as_of,
      facts_fingerprint: lock.facts_fingerprint,
      sealed: true
    },
    market_fingerprint: marketFingerprint,
    external_rankings_fingerprint: externalRankingsFingerprint,
    read_order: files.map((file) => file.name),
    expected_files: expectedFiles,
    market_only: true,
    trend_semantics_verified: false
  };
  return {
    contractVersion: ANALYSIS_MARKET_PACK_V3_CONTRACT,
    marketFingerprint,
    manifest,
    manifestContent: stableFeatureJson(manifest),
    files
  };
}

export async function createMarketPackV3(env, roundId, { lockId, lockHash, asOf = null, generatedAt = new Date().toISOString() } = {}) {
  const round = requiredText(roundId, 'round_id');
  const deadline = await loadMarketDeadlineV3(env, round, asOf);
  const lock = await assertMarketStep1BindingV3(env, { roundId: round, lockId, lockHash });
  const currentPack = await assertNoLateFactsBeforeMarketV3(env, { roundId: round, lock, cutoff: deadline.cutoff });
  const market = await loadVerifiedMarketRowsV3(env, round, deadline.cutoff);
  const externalRankings = await loadExternalRankingsV3(env, round, deadline.cutoff);
  return buildMarketPackV3Files({ lock, deadline, currentPack, ...market, externalRankings, generatedAt });
}

export async function createMarketPackV3Response(env, roundId, { file = null, lockId, lockHash, asOf = null } = {}) {
  const pack = await createMarketPackV3(env, roundId, { lockId, lockHash, asOf });
  const requested = file == null || file === '' ? 'manifest.json' : requiredText(file, 'file', 160);
  const content = requested === 'manifest.json' ? pack.manifestContent : pack.files.find((item) => item.name === requested)?.content;
  if (content == null) {
    return new Response(stableFeatureJson({ error: 'file_not_found', available_files: ['manifest.json', ...pack.files.map((item) => item.name)] }), {
      status: 404,
      headers: { 'content-type': CONTENT_TYPE, 'cache-control': 'no-store' }
    });
  }
  return new Response(content, {
    status: 200,
    headers: {
      'content-type': CONTENT_TYPE,
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${requested}"`,
      'x-content-type-options': 'nosniff'
    }
  });
}
