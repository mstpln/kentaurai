import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { normalizeCapturedOfficialGame, normalizeOfficialGame, validateOfficialGamePayload } from '../src/import/official-live.js';

const DATE = '2099-01-15';
const GAME_ID = 'V86_2099-01-15_999_1';

function start(leg, suffix, trackId, distance, distribution) {
  const horseId = (suffix === 1 ? 970000 : 980000) + leg;
  return {
    id: `${DATE}_${trackId}_${leg}_${suffix}`,
    number: suffix,
    postPosition: leg === 5 ? 1 : suffix,
    distance,
    horse: {
      id: horseId,
      name: `Synthetic Horse ${leg}${suffix}`,
      age: suffix === 1 ? 5 : 4,
      sex: suffix === 1 ? 'gelding' : 'mare',
      nationality: suffix === 2 ? 'FI' : undefined,
      money: (suffix === 1 ? 754000 : 111000) + leg,
      color: suffix === 1 ? 'brun' : undefined,
      trainer: { id: 950000 + (leg * 10) + suffix, firstName: 'Synthetic', lastName: `Trainer${leg}${suffix}` },
      shoes: suffix === 1
        ? { reported: true, front: { hasShoe: false, changed: false }, back: { hasShoe: true, changed: true } }
        : { reported: true, front: { hasShoe: true }, back: { hasShoe: false } },
      sulky: suffix === 1
        ? { reported: true, type: { code: 'AM', text: 'Amerikansk', changed: true }, colour: { code: 'BL', text: 'Blå', changed: false } }
        : { reported: true, type: { code: 'VA', text: 'Vanlig', changed: false }, colour: { code: 'GU', text: 'Gul', changed: false } },
      pedigree: { father: { name: 'Synthetic Sire' }, mother: { name: 'Synthetic Dam' }, grandfather: { name: 'Synthetic Damsire' } }
    },
    driver: { id: 960000 + (leg * 10) + suffix, firstName: 'Synthetic', lastName: `Driver${leg}${suffix}` },
    pools: {
      vinnare: { odds: suffix === 1 ? 1722 : 4386 },
      plats: { minOdds: suffix === 1 ? 1602 : 1921, maxOdds: suffix === 1 ? 1802 : 2221 },
      V86: { betDistribution: distribution, trend: suffix === 1 ? 0.1 : -0.1 }
    }
  };
}

function syntheticGame() {
  return {
    '@type': '.Game',
    id: GAME_ID,
    status: 'bettable',
    pools: { V86: { id: GAME_ID, status: 'bettable', timestamp: '2099-01-13 10:00:00', turnover: 12345600, betType: 'V86', systemCount: 1234 } },
    races: Array.from({ length: 8 }, (_, i) => {
      const leg = i + 1;
      const volt = leg === 5;
      const trackId = leg % 2 === 1 ? 901 : 902;
      const baseDistance = volt ? 2140 : 1640;
      return {
        id: `${DATE}_${trackId}_${leg}`,
        name: leg === 3 ? undefined : `Synthetic Race ${leg}`,
        date: DATE,
        number: leg,
        distance: baseDistance,
        startMethod: volt ? 'volte' : 'auto',
        startTime: `${DATE}T20:${String(leg * 5).padStart(2, '0')}:00`,
        scheduledStartTime: `${DATE}T20:${String(leg * 5).padStart(2, '0')}:00`,
        prize: 'Synthetic prize text',
        terms: ['Synthetic terms'],
        sport: 'trot',
        track: { id: trackId, name: trackId === 901 ? 'Synthetic South' : 'Synthetic North', countryCode: 'SE' },
        status: 'upcoming',
        starts: [start(leg, 1, trackId, baseDistance, 6000), start(leg, 2, trackId, volt ? 2160 : baseDistance, 4000)]
      };
    }),
    version: 209901150001
  };
}

function insertSource(db, id = 'src_synthetic_game_1', fetchedAt = '2099-01-13T10:00:00.000Z', rawObjectKey = null) {
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at, raw_object_key, quality_status)
    VALUES (?, 'official_provider', ?, ?, ?, 'captured_unmapped')`)
    .run(id, `game:${GAME_ID}`, fetchedAt, rawObjectKey);
  return id;
}

test('validator requires exactly eight V85/V86 races', () => {
  const payload = syntheticGame();
  assert.equal(validateOfficialGamePayload(payload).races.length, 8);
  payload.races.pop();
  assert.throws(() => validateOfficialGamePayload(payload), /exactly eight races/);
});

test('normalizer maps verified facts and preserves provenance', async () => {
  const { env, db } = createTestEnv();
  const sourceRecordId = insertSource(db);
  const result = await normalizeOfficialGame(env, syntheticGame(), { sourceRecordId });
  assert.equal(result.gameRoundId, GAME_ID);
  assert.equal(result.raceCount, 8);
  assert.equal(result.entryCount, 16);
  assert.equal(result.bettingSnapshotCount, 16);
  assert.equal(result.oddsSnapshotCount, 48);
  assert.equal(result.equipmentSnapshotCount, 16);
  assert.equal(result.scratchSemanticsVerified, false);

  const round = db.prepare('SELECT game_type, round_date, primary_track_id, status FROM game_rounds WHERE id = ?').get(GAME_ID);
  assert.equal(round.game_type, 'V86');
  assert.equal(round.round_date, DATE);
  assert.equal(round.primary_track_id, null);
  assert.equal(round.status, 'bettable');

  const voltRaceId = `${DATE}_901_5`;
  const voltEntry = db.prepare(`SELECT re.actual_lane, re.actual_start_distance_m, re.handicap_m, re.start_tier, re.scratched, re.data_quality
    FROM race_entries re JOIN horse_external_ids hei ON hei.horse_id = re.horse_id
    WHERE re.race_id = ? AND hei.source_type = 'official' AND hei.external_id = ?`).get(voltRaceId, '980005');
  assert.equal(voltEntry.actual_lane, 1);
  assert.equal(voltEntry.actual_start_distance_m, 2160);
  assert.equal(voltEntry.handicap_m, 20);
  assert.equal(voltEntry.start_tier, 2);
  assert.equal(voltEntry.scratched, 0);
  assert.match(voltEntry.data_quality, /scratch_unverified/);

  const horse = db.prepare(`SELECT h.career_earnings_sek, h.birth_year FROM horses h
    JOIN horse_external_ids hei ON hei.horse_id = h.id WHERE hei.source_type = 'official' AND hei.external_id = '970001'`).get();
  assert.equal(horse.career_earnings_sek, 754001);
  assert.equal(horse.birth_year, null);

  const market = db.prepare(`SELECT bs.bet_percent, bs.market_rank, bs.source_record_id FROM betting_snapshots bs
    JOIN race_entries re ON re.id = bs.race_entry_id JOIN horse_external_ids hei ON hei.horse_id = re.horse_id
    WHERE hei.source_type = 'official' AND hei.external_id = '970001'`).get();
  assert.equal(market.bet_percent, 60);
  assert.equal(market.market_rank, 1);
  assert.equal(market.source_record_id, sourceRecordId);

  const odds = db.prepare(`SELECT market_type, odds FROM odds_snapshots os JOIN race_entries re ON re.id = os.race_entry_id
    JOIN horse_external_ids hei ON hei.horse_id = re.horse_id WHERE hei.source_type = 'official' AND hei.external_id = '970001'
    ORDER BY market_type`).all();
  assert.deepEqual(odds.map((row) => [row.market_type, row.odds]), [['plats_max', 18.02], ['plats_min', 16.02], ['vinnare', 17.22]]);
  assert.equal(db.prepare('SELECT quality_status FROM source_records WHERE id = ?').get(sourceRecordId).quality_status, 'normalized_verified_subset');
  assert.ok(db.prepare('SELECT count(*) AS n FROM normalized_observations WHERE source_record_id = ?').get(sourceRecordId).n > 0);
});

test('captured normalizer reads the archived R2 object used by the private endpoint', async () => {
  const { env, db } = createTestEnv();
  const rawObjectKey = 'raw/official_provider/2099-01-13/synthetic.json';
  const sourceRecordId = insertSource(db, 'src_synthetic_r2', '2099-01-13T10:00:01.000Z', rawObjectKey);
  await env.RAW_BUCKET.put(rawObjectKey, JSON.stringify(syntheticGame()), { httpMetadata: { contentType: 'application/json' } });

  const result = await normalizeCapturedOfficialGame(env, sourceRecordId);
  assert.equal(result.gameRoundId, GAME_ID);
  assert.equal(result.sourceRecordId, sourceRecordId);
  assert.equal(result.reused, false);
});

test('canonical name conflicts preserve the canonical value and flag the new source observation', async () => {
  const { env, db } = createTestEnv();
  const firstSource = insertSource(db);
  await normalizeOfficialGame(env, syntheticGame(), { sourceRecordId: firstSource });

  const changed = syntheticGame();
  changed.races[0].starts[0].horse.name = 'Conflicting Synthetic Name';
  const secondSource = insertSource(db, 'src_synthetic_game_2', '2099-01-13T10:05:00.000Z');
  await normalizeOfficialGame(env, changed, { sourceRecordId: secondSource });

  const horse = db.prepare(`SELECT h.id, h.canonical_name FROM horses h
    JOIN horse_external_ids hei ON hei.horse_id = h.id
    WHERE hei.source_type = 'official' AND hei.external_id = '970001'`).get();
  assert.equal(horse.canonical_name, 'Synthetic Horse 11');

  const observation = db.prepare(`SELECT quality_status, fields_json FROM normalized_observations
    WHERE entity_type = 'horse' AND entity_id = ? AND source_record_id = ?`).get(horse.id, secondSource);
  assert.equal(observation.quality_status, 'source_conflict');
  assert.equal(JSON.parse(observation.fields_json).nameConflict, true);
});

test('same captured source record normalizes only once', async () => {
  const { env, db } = createTestEnv();
  const sourceRecordId = insertSource(db);
  assert.equal((await normalizeOfficialGame(env, syntheticGame(), { sourceRecordId })).reused, false);
  const count = db.prepare('SELECT count(*) AS n FROM betting_snapshots').get().n;
  assert.equal((await normalizeOfficialGame(env, syntheticGame(), { sourceRecordId })).reused, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM betting_snapshots').get().n, count);
});

test('normalizer rejects source-record provenance mismatches', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status)
    VALUES ('src_wrong', 'official_provider', 'game:V86_synthetic_wrong', '2099-01-13T10:00:00.000Z', 'captured_unmapped')`).run();
  await assert.rejects(() => normalizeOfficialGame(env, syntheticGame(), { sourceRecordId: 'src_wrong' }), /does not match/);
  const run = db.prepare("SELECT status, error_count FROM import_runs WHERE source_type = 'official_provider_normalize' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(run.status, 'failed');
  assert.equal(run.error_count, 1);
});
