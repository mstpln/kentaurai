import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { normalizeCapturedOfficialGameChunk } from '../src/import/official-live-chunked.js';

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
