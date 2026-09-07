import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { normalizeCapturedOfficialGameChunk } from '../src/import/official-live-chunked.js';
import { verifyCapturedOfficialNormalization } from '../src/routes/official-verification.js';

const DATE = '2099-03-10';
const GAME_ID = 'V86_2099-03-10_997_1';
const SOURCE_ID = 'src_verify_synthetic';
const RAW_KEY = 'raw/official_provider/2099-03-08/verify-synthetic.json';

function syntheticGame() {
  return {
    '@type': '.Game',
    id: GAME_ID,
    status: 'bettable',
    pools: {
      V86: {
        id: GAME_ID,
        status: 'bettable',
        timestamp: '2099-03-08 09:00:00',
        turnover: 880000,
        betType: 'V86',
        systemCount: 321
      }
    },
    races: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      const trackId = leg % 2 === 1 ? 905 : 906;
      const volt = leg === 5;
      return {
        id: `${DATE}_${trackId}_${leg}`,
        name: leg === 4 ? undefined : `Verification Race ${leg}`,
        date: DATE,
        number: leg,
        distance: 2140,
        startMethod: volt ? 'volte' : 'auto',
        scheduledStartTime: `${DATE}T20:${String(leg * 5).padStart(2, '0')}:00`,
        track: {
          id: trackId,
          name: trackId === 905 ? 'Synthetic Alpha' : 'Synthetic Beta',
          countryCode: 'SE'
        },
        status: 'upcoming',
        starts: [{
          id: `${DATE}_${trackId}_${leg}_1`,
          number: 1,
          postPosition: 1,
          distance: volt ? 2160 : 2140,
          horse: {
            id: 993000 + leg,
            name: `Verify Horse ${leg}`,
            age: 5,
            sex: 'gelding',
            money: 300000 + leg,
            trainer: { id: 994000 + leg, firstName: 'Verify', lastName: `Trainer${leg}` },
            shoes: { reported: true, front: { hasShoe: false }, back: { hasShoe: true } },
            sulky: { reported: true, type: { code: 'AM', text: 'Amerikansk' } }
          },
          driver: { id: 995000 + leg, firstName: 'Verify', lastName: `Driver${leg}` },
          pools: {
            vinnare: { odds: 1500 + leg },
            plats: { minOdds: 1100 + leg, maxOdds: 1300 + leg },
            V86: { betDistribution: 10000 }
          }
        }]
      };
    }),
    version: 209903100001
  };
}

async function seedAndNormalize(env, db) {
  await env.RAW_BUCKET.put(RAW_KEY, JSON.stringify(syntheticGame()), {
    httpMetadata: { contentType: 'application/json' }
  });
  db.prepare(`
    INSERT INTO source_records
      (id, source_type, external_id, fetched_at, raw_object_key, quality_status)
    VALUES (?, 'official_provider', ?, '2099-03-08T09:00:00.000Z', ?, 'captured_unmapped')
  `).run(SOURCE_ID, `game:${GAME_ID}`, RAW_KEY);

  for (let cursor = 0; cursor < 8; cursor += 1) {
    const step = await normalizeCapturedOfficialGameChunk(env, SOURCE_ID, cursor);
    assert.equal(step.done, false);
  }
  const final = await normalizeCapturedOfficialGameChunk(env, SOURCE_ID, 8);
  assert.equal(final.done, true);
}

test('private verification compares raw capture with normalized D1 facts', async () => {
  const { env, db } = createTestEnv();
  await seedAndNormalize(env, db);

  const report = await verifyCapturedOfficialNormalization(env, SOURCE_ID);
  assert.equal(report.ok, true);
  assert.equal(report.failedCount, 0);
  assert.ok(report.checkCount >= 30);
  assert.equal(report.representative.voltSampleIncluded, true);
  assert.equal(report.checks.find((check) => check.id === 'volt.handicap_m').pass, true);
  assert.equal(report.checks.find((check) => check.id === 'counts.entries').actual, 8);
});

test('private verification reports a normalized/raw mismatch instead of hiding it', async () => {
  const { env, db } = createTestEnv();
  await seedAndNormalize(env, db);

  db.prepare(`
    UPDATE horses
    SET career_earnings_sek = career_earnings_sek + 1
    WHERE id = (SELECT horse_id FROM horse_external_ids WHERE source_type = 'official' AND external_id = '993001')
  `).run();

  const report = await verifyCapturedOfficialNormalization(env, SOURCE_ID);
  assert.equal(report.ok, false);
  const mismatch = report.checks.find((check) => check.id === 'entry.horse_money_sek');
  assert.equal(mismatch.pass, false);
  assert.equal(report.failedCount, 1);
});
