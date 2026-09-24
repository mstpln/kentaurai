import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { normalizeCapturedOfficialGameChunk } from '../src/import/official-live-chunked.js';
import { stableId } from '../src/ids.js';

const DATE = '2099-02-20';
const GAME_ID = 'V86_2099-02-20_998_1';
const SOURCE_ID = 'src_chunked_synthetic';
const RAW_KEY = 'raw/official_provider/2099-02-18/chunked-synthetic.json';

function syntheticGame() {
  return {
    '@type': '.Game',
    id: GAME_ID,
    status: 'bettable',
    pools: {
      V86: {
        id: GAME_ID,
        status: 'bettable',
        timestamp: '2099-02-18 10:00:00',
        turnover: 1200000,
        betType: 'V86',
        systemCount: 250
      }
    },
    races: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      const trackId = leg % 2 === 1 ? 903 : 904;
      const startMethod = leg === 5 ? 'volte' : 'auto';
      return {
        id: `${DATE}_${trackId}_${leg}`,
        date: DATE,
        number: leg,
        distance: 2140,
        startMethod,
        scheduledStartTime: `${DATE}T20:${String(leg * 5).padStart(2, '0')}:00`,
        track: { id: trackId, name: trackId === 903 ? 'Synthetic West' : 'Synthetic East', countryCode: 'SE' },
        status: 'upcoming',
        starts: [{
          id: `${DATE}_${trackId}_${leg}_1`,
          number: 1,
          postPosition: 1,
          distance: leg === 5 ? 2160 : 2140,
          horse: {
            id: 990000 + leg,
            name: `Chunk Horse ${leg}`,
            age: 5,
            sex: 'gelding',
            money: 200000 + leg,
            trainer: { id: 991000 + leg, firstName: 'Chunk', lastName: `Trainer${leg}` },
            shoes: { reported: true, front: { hasShoe: true }, back: { hasShoe: true } },
            sulky: { reported: true, type: { code: 'VA', text: 'Vanlig' } }
          },
          driver: { id: 992000 + leg, firstName: 'Chunk', lastName: `Driver${leg}` },
          pools: {
            vinnare: { odds: 2000 + leg },
            plats: { minOdds: 1200 + leg, maxOdds: 1400 + leg },
            V86: { betDistribution: 10000 }
          }
        }]
      };
    }),
    version: 209902200001
  };
}

async function seedCapturedGame(env, db) {
  await env.RAW_BUCKET.put(RAW_KEY, JSON.stringify(syntheticGame()), {
    httpMetadata: { contentType: 'application/json' }
  });
  db.prepare(`
    INSERT INTO source_records
      (id, source_type, external_id, fetched_at, raw_object_key, quality_status)
    VALUES (?, 'official_provider', ?, '2099-02-18T10:00:00.000Z', ?, 'captured_unmapped')
  `).run(SOURCE_ID, `game:${GAME_ID}`, RAW_KEY);
}

test('captured game normalization can be completed across bounded Worker invocations', async () => {
  const { env, db } = createTestEnv();
  await seedCapturedGame(env, db);

  for (let cursor = 0; cursor < 8; cursor += 1) {
    const result = await normalizeCapturedOfficialGameChunk(env, SOURCE_ID, cursor);
    assert.equal(result.done, false);
    assert.equal(result.cursor, cursor);
    assert.equal(result.nextCursor, cursor + 1);
    assert.equal(result.totalEntries, 8);
    assert.equal(db.prepare('SELECT quality_status FROM source_records WHERE id = ?').get(SOURCE_ID).quality_status, 'captured_unmapped');
  }

  const final = await normalizeCapturedOfficialGameChunk(env, SOURCE_ID, 8);
  assert.equal(final.done, true);
  assert.equal(final.reused, false);
  assert.equal(final.gameRoundId, GAME_ID);
  assert.equal(final.raceCount, 8);
  assert.equal(final.entryCount, 8);
  assert.equal(final.bettingSnapshotCount, 8);
  assert.equal(final.oddsSnapshotCount, 24);
  assert.equal(final.equipmentSnapshotCount, 8);
  assert.equal(final.qualityStatus, 'normalized_verified_subset');

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_legs WHERE game_round_id = ?').get(GAME_ID).n, 8);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM betting_snapshots WHERE game_round_id = ?').get(GAME_ID).n, 8);
  assert.equal(db.prepare('SELECT quality_status FROM source_records WHERE id = ?').get(SOURCE_ID).quality_status, 'normalized_verified_subset');

  const retry = await normalizeCapturedOfficialGameChunk(env, SOURCE_ID, 0);
  assert.equal(retry.done, true);
  assert.equal(retry.reused, true);
});


test('chunked final normalization prefers canonical horse identity when source-start ids are remapped', async () => {
  const { env, db } = createTestEnv();
  const payload=syntheticGame();
  const race=payload.races[0];
  const first=race.starts[0];
  const second={
    ...first,
    id:`${race.id}_2`,
    number:2,
    postPosition:2,
    horse:{ ...first.horse, id:990101, name:'Chunk Horse Remap B' },
    driver:{ ...first.driver, id:992101, lastName:'DriverRemapB' }
  };
  race.starts=[first,second];
  race.starts[0].pools.V86.betDistribution=5000;
  race.starts[1].pools.V86.betDistribution=5000;

  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('track_chunk_remap','Synthetic West','SE')").run();
  db.prepare(`
    INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,status,source_quality)
    VALUES (?,'track_chunk_remap',?,1,2140,'auto','results','normalized_verified_subset')
  `).run(race.id,DATE);

  const firstHorse=stableId('horse','official',String(first.horse.id));
  const secondHorse=stableId('horse','official',String(second.horse.id));
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run(firstHorse,first.horse.name);
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run(secondHorse,second.horse.name);
  db.prepare("INSERT INTO horse_external_ids (horse_id,source_type,external_id) VALUES (?,'official',?)").run(firstHorse,String(first.horse.id));
  db.prepare("INSERT INTO horse_external_ids (horse_id,source_type,external_id) VALUES (?,'official',?)").run(secondHorse,String(second.horse.id));

  const firstStoredStart=`${race.id}_1`;
  const secondStoredStart=`${race.id}_2`;
  const firstEntry=stableId('entry','official',race.id,firstStoredStart);
  const secondEntry=stableId('entry','official',race.id,secondStoredStart);
  db.prepare(`
    INSERT INTO race_entries
      (id,race_id,horse_id,source_start_id,declared_horse_name,start_number,scratched,data_quality)
    VALUES (?,?,?,?,?,1,0,'official_declared_start_scratch_unverified')
  `).run(firstEntry,race.id,firstHorse,firstStoredStart,first.horse.name);
  db.prepare(`
    INSERT INTO race_entries
      (id,race_id,horse_id,source_start_id,declared_horse_name,start_number,scratched,data_quality)
    VALUES (?,?,?,?,?,2,0,'official_declared_start_scratch_unverified')
  `).run(secondEntry,race.id,secondHorse,secondStoredStart,second.horse.name);

  race.starts[0].id=secondStoredStart;
  race.starts[1].id=firstStoredStart;
  payload.status='results';
  payload.pools.V86.status='results';

  const sourceId='src_chunked_remap_final';
  const key='raw/official_provider/2099-02-20/chunked-remap-final.json';
  await env.RAW_BUCKET.put(key,JSON.stringify(payload),{httpMetadata:{contentType:'application/json'}});
  db.prepare(`
    INSERT INTO source_records
      (id,source_type,external_id,fetched_at,raw_object_key,quality_status)
    VALUES (?,'official_provider',?,'2099-02-20T23:00:00.000Z',?,'captured_unmapped')
  `).run(sourceId,`game:${GAME_ID}`,key);

  const one=await normalizeCapturedOfficialGameChunk(env,sourceId,0);
  assert.equal(one.done,false);
  const two=await normalizeCapturedOfficialGameChunk(env,sourceId,1);
  assert.equal(two.done,false);

  const storedA=db.prepare('SELECT id,horse_id,source_start_id FROM race_entries WHERE id=?').get(firstEntry);
  const storedB=db.prepare('SELECT id,horse_id,source_start_id FROM race_entries WHERE id=?').get(secondEntry);
  assert.equal(storedA.horse_id,firstHorse);
  assert.equal(storedA.source_start_id,firstStoredStart);
  assert.equal(storedB.horse_id,secondHorse);
  assert.equal(storedB.source_start_id,secondStoredStart);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_entries WHERE race_id=?').get(race.id).n,2);
});
