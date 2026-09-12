import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getCombinedPromptContext, listAnalysisRounds } from '../src/analysis-workflow-v2.js';

function isoDay(offsetDays) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return date.toISOString().slice(0, 10);
}

function isoAt(offsetDays, hour = 14) {
  return `${isoDay(offsetDays)}T${String(hour).padStart(2, '0')}:00:00Z`;
}

function seedRound(db, id, gameType, offsetDays) {
  const date = isoDay(offsetDays);
  const start = isoAt(offsetDays);
  const trackId = `track-${id}`;
  db.prepare('INSERT INTO tracks (id, canonical_name, country_code) VALUES (?, ?, ?)').run(trackId, `Track ${id}`, 'SE');
  db.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date, scheduled_start_at, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, gameType, date, start, offsetDays < 0 ? 'finished' : 'upcoming');
  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `race-${id}-${leg}`;
    const horseId = `horse-${id}-${leg}`;
    const entryId = `entry-${id}-${leg}`;
    db.prepare(`
      INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, status)
      VALUES (?, ?, ?, ?, ?, 2140, 'auto', ?)
    `).run(raceId, trackId, date, leg, start, offsetDays < 0 ? 'finished' : 'upcoming');
    db.prepare('INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, ?, ?)').run(id, leg, raceId);
    db.prepare('INSERT INTO horses (id, canonical_name) VALUES (?, ?)').run(horseId, `Horse ${id} ${leg}`);
    db.prepare('INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched) VALUES (?, ?, ?, 1, 0)').run(entryId, raceId, horseId);
  }
}

test('analysis round list exposes both upcoming and recent historical complete rounds', async () => {
  const { env, db } = createTestEnv();
  seedRound(db, 'round-past-v86', 'V86', -1);
  seedRound(db, 'round-future-v85', 'V85', 1);

  const rounds = await listAnalysisRounds(env, { pastDays: 2, futureDays: 2 });
  const past = rounds.find((round) => round.id === 'round-past-v86');
  const future = rounds.find((round) => round.id === 'round-future-v85');

  assert.equal(past.gameType, 'V86');
  assert.equal(past.phase, 'past');
  assert.equal(future.gameType, 'V85');
  assert.equal(future.phase, 'upcoming');
});

test('combined export prompt context stays bound to explicitly selected historical round', async () => {
  const { env, db } = createTestEnv();
  seedRound(db, 'round-past-v86', 'V86', -1);
  seedRound(db, 'round-future-v85', 'V85', 1);

  const historical = await getCombinedPromptContext(env, 'anthropic', 'round-past-v86');
  assert.equal(historical.round_id, 'round-past-v86');
  assert.equal(historical.context.round.gameType, 'V86');
  assert.equal(historical.import_timing, 'post_race_recovery');
  assert.equal(historical.learning_eligibility, 'manual_review_required');

  const upcoming = await getCombinedPromptContext(env, 'anthropic', 'round-future-v85');
  assert.equal(upcoming.round_id, 'round-future-v85');
  assert.equal(upcoming.context.round.gameType, 'V85');
  assert.equal(upcoming.import_timing, 'pre_race');
  assert.equal(upcoming.learning_eligibility, 'eligible_by_timing');
});
