import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import {
  ANALYSIS_MARKET_PACK_V3_CONTRACT,
  ANALYSIS_MARKET_SOURCE_QUALITY,
  assertMarketCutoffAfterStep1V3,
  assertMarketStep1BindingV3,
  buildMarketPackV3Files,
  loadMarketDeadlineV3,
  loadVerifiedMarketRowsV3,
  loadExternalRankingsV3,
  marketMaturityV3,
  normalizeMarketPackOptionsV3,
  sanitizeExternalRankingSignalV3
} from '../src/analysis-market-pack-v3.js';

globalThis.crypto ??= webcrypto;

function syntheticCurrentPack() {
  return {
    files: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      return {
        name: `${String(leg).padStart(2, '0')}_leg_${leg}.json`,
        payload: {
          contract_version: 'kentaurai-analysis-pack-v3',
          pack_version: 'analysis-pack-v3-d1',
          as_of: '2099-05-01T13:50:00.000Z',
          contains_current_market: false,
          leg_number: leg,
          race: { race_id: `race-${leg}` },
          entries: [
            { race_entry_id: `entry-${leg}-a`, current_facts: { analysis_eligible: true } },
            { race_entry_id: `entry-${leg}-b`, current_facts: { analysis_eligible: true } },
            { race_entry_id: `entry-${leg}-scratched`, current_facts: { analysis_eligible: false } }
          ]
        }
      };
    })
  };
}

function syntheticLock() {
  return {
    lock_id: 'lock-d4',
    round_id: 'round-d4',
    pack_id: 'pack-d4',
    pack_as_of: '2099-05-01T13:40:00.000Z',
    facts_fingerprint: 'sha256:facts-d4',
    lock_hash: 'sha256:lock-d4',
    created_at: '2099-05-01T13:41:00.000Z',
    sealed: true
  };
}

function syntheticDeadline() {
  return {
    round_id: 'round-d4',
    requested_as_of: '2099-05-01T14:00:00.000Z',
    cutoff: '2099-05-01T13:55:00.000Z',
    deadline_at: '2099-05-01T13:55:00.000Z',
    deadline_source: 'bet_stop_at',
    deadline_quality: 'verified'
  };
}

function syntheticSystemPolicy() {
  return {
    game_type: 'V85',
    line_price_sek: 0.5,
    target_budget_min_sek: 150,
    max_budget_sek: 250,
    exact_spike_count: 3,
    system_type: 'main'
  };
}

function syntheticMarketRows() {
  const betting = [];
  const odds = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    for (const [suffix, percent, rank, winOdds] of [['a', 60, 1, 2.0], ['b', 40, 2, 4.0]]) {
      const entry = `entry-${leg}-${suffix}`;
      betting.push({
        race_entry_id: entry,
        leg_number: leg,
        market_ownership_percent: percent - 2,
        market_rank: rank,
        captured_at: '2099-05-01T13:40:00.000Z',
        source_quality: ANALYSIS_MARKET_SOURCE_QUALITY
      });
      betting.push({
        race_entry_id: entry,
        leg_number: leg,
        market_ownership_percent: percent,
        market_rank: rank,
        captured_at: '2099-05-01T13:54:00.000Z',
        source_quality: ANALYSIS_MARKET_SOURCE_QUALITY
      });
      odds.push({
        race_entry_id: entry,
        leg_number: leg,
        market_type: 'win',
        odds: winOdds,
        captured_at: '2099-05-01T13:54:30.000Z',
        source_quality: ANALYSIS_MARKET_SOURCE_QUALITY
      });
    }
  }
  return { betting, odds };
}

test('D4 deadline prefers bet stop, clamps after-stop requests, and documents scheduled-start fallback', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,bet_stop_at,scheduled_start_at) VALUES ('round-d4','V85','2099-05-01','2099-05-01T13:55:00Z','2099-05-01T14:00:00Z')").run();

  const verified = await loadMarketDeadlineV3(env, 'round-d4', '2099-05-01T14:03:21Z');
  assert.equal(verified.cutoff, '2099-05-01T13:55:00.000Z');
  assert.equal(verified.deadline_source, 'bet_stop_at');
  assert.equal(verified.deadline_quality, 'verified');

  db.prepare("UPDATE game_rounds SET bet_stop_at=NULL WHERE id='round-d4'").run();
  const fallback = await loadMarketDeadlineV3(env, 'round-d4', '2099-05-01T14:03:21Z');
  assert.equal(fallback.cutoff, '2099-05-01T14:00:00.000Z');
  assert.equal(fallback.deadline_source, 'round_scheduled_start_at');
  assert.equal(fallback.deadline_quality, 'conservative_proxy');

  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('deadline-track','Deadline Track')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at) VALUES ('deadline-race','deadline-track','2099-05-01',1,'2099-05-01T14:01:00Z')").run();
  db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('round-d4',1,'deadline-race')").run();
  db.prepare("UPDATE game_rounds SET scheduled_start_at=NULL WHERE id='round-d4'").run();
  const firstLeg = await loadMarketDeadlineV3(env, 'round-d4', '2099-05-01T14:03:21Z');
  assert.equal(firstLeg.cutoff, '2099-05-01T14:01:00.000Z');
  assert.equal(firstLeg.deadline_source, 'first_leg_start');
  assert.equal(firstLeg.deadline_quality, 'conservative_proxy');
});

test('D4 refuses a market cutoff before the newest sealed Step 1 lock', () => {
  const lock = syntheticLock();
  assert.equal(assertMarketCutoffAfterStep1V3(lock, lock.created_at), lock.created_at);
  assert.equal(assertMarketCutoffAfterStep1V3(lock, '2099-05-01T13:41:00.001Z'), '2099-05-01T13:41:00.001Z');
  assert.throws(
    () => assertMarketCutoffAfterStep1V3(lock, '2099-05-01T13:40:59.999Z'),
    /market cutoff cannot precede/
  );
});

test('D4 validates explicit Step 1 binding options before any database access', () => {
  assert.throws(() => normalizeMarketPackOptionsV3({}), /lock_id is required/);
  assert.throws(() => normalizeMarketPackOptionsV3({ lockId: 'lock-d4' }), /lock_hash is required/);
  const normalized = normalizeMarketPackOptionsV3({
    lockId: 'lock-d4', lockHash: 'sha256:lock-d4', asOf: '2099-05-01T13:54:12.345Z'
  });
  assert.equal(normalized.lockId, 'lock-d4');
  assert.equal(normalized.lockHash, 'sha256:lock-d4');
  assert.equal(normalized.asOf, '2099-05-01T13:54:12.345Z');
});

test('D4 verified market loader excludes post-cutoff, unnormalized and cross-round snapshots', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-d4','Synthetic D4')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date) VALUES ('round-d4','V85','2099-05-01'),('round-other','V85','2099-05-01')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number) VALUES ('race-d4','track-d4','2099-05-01',1),('race-other','track-d4','2099-05-01',2)").run();
  db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('round-d4',1,'race-d4'),('round-other',1,'race-other')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-d4','Horse D4'),('horse-other','Horse Other')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number) VALUES ('entry-d4','race-d4','horse-d4',1),('entry-other','race-other','horse-other',1)").run();
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('source-ok','official_provider','2099-05-01T13:50:00Z','normalized_verified_subset'),('source-unverified','official_provider','2099-05-01T13:50:00Z','captured_unmapped'),('source-late','official_provider','2099-05-01T13:56:00Z','normalized_verified_subset')").run();
  db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES ('ok','round-d4',1,'entry-d4','2099-05-01T13:54:00Z',35,1,'source-ok'),('after','round-d4',1,'entry-d4','2099-05-01T13:56:00Z',80,1,'source-ok'),('bad-quality','round-d4',1,'entry-d4','2099-05-01T13:53:00Z',70,1,'source-unverified'),('late-fetched','round-d4',1,'entry-d4','2099-05-01T13:54:30Z',75,1,'source-late'),('other','round-other',1,'entry-other','2099-05-01T13:54:00Z',90,1,'source-ok')").run();
  db.prepare("INSERT INTO odds_snapshots (id,race_entry_id,captured_at,market_type,odds,source_record_id) VALUES ('win-ok','entry-d4','2099-05-01T13:54:30Z','win',3.5,'source-ok'),('win-after','entry-d4','2099-05-01T13:56:30Z','win',1.2,'source-ok'),('place-bad','entry-d4','2099-05-01T13:54:00Z','place',1.4,'source-unverified'),('late-fetched-win','entry-d4','2099-05-01T13:54:45Z','win',1.1,'source-late'),('other-win','entry-other','2099-05-01T13:54:00Z','win',2.0,'source-ok')").run();

  const result = await loadVerifiedMarketRowsV3(env, 'round-d4', '2099-05-01T13:55:00Z');
  assert.equal(result.betting.length, 1);
  assert.equal(result.betting[0].market_ownership_percent, 35);
  assert.equal(result.odds.length, 1);
  assert.equal(result.odds[0].odds, 3.5);
  assert.equal(result.odds[0].market_type, 'win');
});

test('D4 exact Step 1 binding rejects a mismatched lock hash', async () => {
  const latest = {
    id: 'lock-d4', game_round_id: 'round-d4', pack_id: 'pack-d4', pack_as_of: '2099-05-01T13:40:00.000Z',
    facts_fingerprint: 'sha256:facts-d4', provider: 'openai', model: 'synthetic', prompt_version: 'step1-prompt-v3-d2',
    lock_hash: 'sha256:lock-d4', created_at: '2099-05-01T13:41:00.000Z'
  };
  const env = { DB: { prepare() { return { bind() { return { first: async () => latest }; } }; } } };
  await assert.rejects(
    () => assertMarketStep1BindingV3(env, { roundId: 'round-d4', lockId: 'lock-d4', lockHash: 'sha256:wrong' }),
    /lock_hash does not match/
  );
  const lock = await assertMarketStep1BindingV3(env, { roundId: 'round-d4', lockId: 'lock-d4', lockHash: 'sha256:lock-d4' });
  assert.equal(lock.lock_id, 'lock-d4');
});

test('D4 maturity is deterministic and never invents trend semantics', () => {
  const maturity = marketMaturityV3([
    { captured_at: '2099-05-01T13:40:00Z', market_ownership_percent: 30 },
    { captured_at: '2099-05-01T13:50:00Z', market_ownership_percent: 35 },
    { captured_at: '2099-05-01T13:54:00Z', market_ownership_percent: 33 }
  ], '2099-05-01T13:55:00Z');
  assert.equal(maturity.snapshot_count, 3);
  assert.equal(maturity.snapshot_age_minutes, 1);
  assert.equal(maturity.ownership_range_pp, 5);
  assert.equal(maturity.first_to_latest_delta_pp, 3);
  assert.equal(maturity.mean_abs_step_pp, 3.5);
  assert.equal(maturity.max_abs_step_pp, 5);
  assert.equal(maturity.trend_semantics_verified, false);
  assert.equal(maturity.trend_label, null);
});

test('D4 external ranking sanitizer never exports source identity, excerpts or arbitrary free text', () => {
  const rank = sanitizeExternalRankingSignalV3({
    leg_number: 1, race_entry_id: 'entry-1-a', signal_type: 'external_ranking', value: '2',
    polarity: 'positive', strength: 0.8, fact_or_opinion: 'opinion', confidence: 0.7,
    published_at: '2099-05-01T13:53:00Z', source_name: 'private-provider', source_url: 'https://private.invalid',
    evidence_excerpt: 'private excerpt', summary_text: 'private summary'
  });
  assert.equal(rank.rank, 2);
  assert.equal(Object.hasOwn(rank, 'value'), false);
  assert.equal(Object.hasOwn(rank, 'source_name'), false);
  assert.equal(Object.hasOwn(rank, 'source_url'), false);
  assert.equal(Object.hasOwn(rank, 'evidence_excerpt'), false);

  const pick = sanitizeExternalRankingSignalV3({
    leg_number: 1, race_entry_id: 'entry-1-a', signal_type: 'pick', value: 'DO NOT EXPORT THIS TEXT',
    fact_or_opinion: 'opinion', published_at: '2099-05-01T13:53:00Z'
  });
  assert.equal(pick.rank, null);
  assert.doesNotMatch(JSON.stringify(pick), /DO NOT EXPORT THIS TEXT/);
});

test('D4 market pack fails closed without verified server-owned system policy', async () => {
  const market = syntheticMarketRows();
  await assert.rejects(
    () => buildMarketPackV3Files({
      lock: syntheticLock(),
      deadline: syntheticDeadline(),
      currentPack: syntheticCurrentPack(),
      ...market,
      generatedAt: '2099-05-01T13:55:10Z'
    }),
    /verified system_policy is required/
  );
});

test('D4 pack is market-only, deterministic by market state and input order, odds-normalized only with complete coverage, and reads external rankings last', async () => {
  const market = syntheticMarketRows();
  market.betting.push({
    race_entry_id: 'entry-1-a', leg_number: 1, market_ownership_percent: 99, market_rank: 1,
    captured_at: '2099-05-01T13:56:00.000Z', source_quality: ANALYSIS_MARKET_SOURCE_QUALITY
  });
  const args = {
    lock: syntheticLock(),
    deadline: syntheticDeadline(),
    currentPack: syntheticCurrentPack(),
    ...market,
    systemPolicy: syntheticSystemPolicy(),
    externalRankings: [{
      leg_number: 1, race_entry_id: 'entry-1-b', signal_type: 'external_ranking', value: '2', polarity: 'positive',
      strength: 0.8, fact_or_opinion: 'opinion', confidence: 0.7, published_at: '2099-05-01T13:53:00.000Z',
      source_name: 'must-not-leak', source_url: 'https://private.invalid', evidence_excerpt: 'must-not-leak'
    }]
  };
  const first = await buildMarketPackV3Files({ ...args, generatedAt: '2099-05-01T13:55:10Z' });
  const second = await buildMarketPackV3Files({ ...args, generatedAt: '2099-05-01T13:59:10Z' });
  const shuffled = await buildMarketPackV3Files({
    ...args,
    betting: [...args.betting].reverse(),
    odds: [...args.odds].reverse(),
    externalRankings: [...args.externalRankings].reverse(),
    generatedAt: '2099-05-01T13:59:10Z'
  });

  assert.equal(first.manifest.contract_version, ANALYSIS_MARKET_PACK_V3_CONTRACT);
  assert.equal(first.marketFingerprint, second.marketFingerprint);
  assert.equal(first.marketFingerprint, shuffled.marketFingerprint);
  assert.notEqual(first.manifest.generated_at, second.manifest.generated_at);
  assert.equal(first.manifest.read_order.at(-1), '99_external_rankings.json');
  assert.equal(first.manifest.market_only, true);
  const roundMarket = first.files.find((file) => file.name === '00_round_market.json').payload;
  assert.deepEqual(roundMarket.system_policy, {
    game_type: 'V85',
    line_price_sek: 0.5,
    budget_min_sek: 150,
    budget_max_sek: 250,
    target_budget_sek: [150, 250],
    exactly_three_spikes: true,
    allowed_system_types: ['main'],
    policy_source: 'server_config'
  });
  assert.deepEqual(
    first.files.map((file) => [file.name, file.content]),
    shuffled.files.map((file) => [file.name, file.content])
  );

  const leg1 = first.files.find((file) => file.name === '01_leg_1_market.json').payload;
  assert.equal(leg1.entries[0].market_ownership_percent, 60);
  assert.equal(leg1.proxy_quality, 'verified_complete_winner_odds_v1');
  assert.equal(leg1.entries[0].market_win_probability_proxy, 0.66666667);
  assert.equal(leg1.entries[1].market_win_probability_proxy, 0.33333333);
  assert.equal(leg1.entries.some((entry) => entry.race_entry_id.includes('scratched')), false);

  const external = first.files.find((file) => file.name === '99_external_rankings.json').content;
  assert.doesNotMatch(external, /must-not-leak|private\.invalid|source_name|source_url|evidence_excerpt/);
  assert.match(external, /"rank":2/);

  const incomplete = structuredClone(market);
  incomplete.odds = incomplete.odds.filter((row) => !(row.leg_number === 1 && row.race_entry_id === 'entry-1-b' && row.market_type === 'win'));
  const withoutCompleteOdds = await buildMarketPackV3Files({
    lock: syntheticLock(), deadline: syntheticDeadline(), currentPack: syntheticCurrentPack(), ...incomplete,
    systemPolicy: syntheticSystemPolicy(),
    generatedAt: '2099-05-01T13:55:10Z'
  });
  const incompleteLeg1 = withoutCompleteOdds.files.find((file) => file.name === '01_leg_1_market.json').payload;
  assert.equal(incompleteLeg1.proxy_quality, 'unavailable_incomplete_winner_odds');
  assert.equal(incompleteLeg1.entries[0].market_win_probability_proxy, null);
  assert.equal(incompleteLeg1.entries[1].market_win_probability_proxy, null);
});


test('D4 external rankings require cutoff-safe manual structured provenance', async () => {
  const { db, env } = createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('rank-track','Rank Track')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date) VALUES ('rank-round','V85','2099-05-01')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number) VALUES ('rank-race','rank-track','2099-05-01',1)").run();
  db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('rank-round',1,'rank-race')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('rank-horse','Rank Horse')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number) VALUES ('rank-entry','rank-race','rank-horse',1)").run();
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('rank-ok','editorial_manual','2099-05-01T13:50:00Z','manual_structured'),('rank-late','editorial_manual','2099-05-01T13:56:00Z','manual_structured'),('rank-bad','editorial_manual','2099-05-01T13:50:00Z','captured_unmapped')").run();
  for (const [id, source] of [['ok','rank-ok'],['late','rank-late'],['bad','rank-bad']]) {
    db.prepare("INSERT INTO editorial_items (id,race_entry_id,horse_id,published_at,source_name,rights_status,source_record_id) VALUES (?,?,?,'2099-05-01T13:53:00Z','Synthetic','structured_only',?)")
      .run('rank-item-' + id,'rank-entry','rank-horse',source);
    db.prepare("INSERT INTO editorial_signals (id,editorial_item_id,signal_type,value_text,fact_or_opinion) VALUES (?,?,'external_ranking','1','opinion')")
      .run('rank-signal-' + id,'rank-item-' + id);
  }
  const rows = await loadExternalRankingsV3(env,'rank-round','2099-05-01T13:55:00Z');
  assert.equal(rows.length,1);
  assert.equal(rows[0].race_entry_id,'rank-entry');
  assert.equal(rows[0].rank,1);
});
