import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { getFilteredEntityStatBreakdowns } from '../src/routes/entity-stat-breakdowns.js';
import { getTrendLeaderboard } from '../src/statistics/trend.js';
import { trendDateWindow } from '../src/statistics/core.js';

function insertTrack(db, id, name) {
  db.prepare('INSERT INTO tracks (id, canonical_name) VALUES (?, ?)').run(id, name);
}

function insertHorse(db, id, name, breed = 'varmblodig travare') {
  db.prepare('INSERT INTO horses (id, canonical_name, breed) VALUES (?, ?, ?)').run(id, name, breed);
}

function insertPerson(db, table, id, name) {
  db.prepare(`INSERT INTO ${table} (id, canonical_name) VALUES (?, ?)`).run(id, name);
}

function insertRace(db, { id, trackId = 'track-a', date, method = 'auto', prize = 50000, name = 'Vanligt lopp' }) {
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method, first_prize_sek, race_name, source_quality)
    VALUES (?, ?, ?, ?, 2140, ?, ?, ?, 'verified')`).run(id, trackId, date, Number(id.replace(/\D/g, '').slice(-3)) || 1, method, prize, name);
}

function insertEntry(db, {
  id, raceId, horseId, driverId = 'driver-a', trainerId = 'trainer-a', scratched = 0,
  placing = 4, placingText = null, prize = 0, gallop = 0, disqualified = 0, withResult = true
}) {
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, scratched, data_quality)
    VALUES (?, ?, ?, ?, ?, ?, 'verified')`).run(id, raceId, horseId, driverId, trainerId, scratched);
  if (withResult) {
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, placing_text, prize_sek, gallop, disqualified, result_status)
      VALUES (?, ?, ?, ?, ?, ?, 'official')`).run(id, placing, placingText, prize, gallop, disqualified);
  }
}

function setupCoreFixture() {
  const { db, env } = createTestEnv();
  insertTrack(db, 'track-a', 'Bana A');
  insertTrack(db, 'track-b', 'Bana B');
  insertPerson(db, 'drivers', 'driver-a', 'Kusk A');
  insertPerson(db, 'drivers', 'driver-b', 'Kusk B');
  insertPerson(db, 'trainers', 'trainer-a', 'Tränare A');
  insertPerson(db, 'trainers', 'trainer-b', 'Tränare B');
  for (const [id, name, breed] of [
    ['horse-a', 'Häst A', 'varmblodig travare'],
    ['horse-b', 'Häst B', 'kallblodig travare'],
    ['horse-missing', 'Häst Missing', 'varmblodig travare'],
    ['horse-scratch', 'Häst Scratch', 'varmblodig travare'],
    ['horse-null', 'Häst Null', 'varmblodig travare'],
    ['horse-dq', 'Häst DQ', 'varmblodig travare'],
    ['horse-deadheat', 'Häst Dead Heat', 'varmblodig travare']
  ]) insertHorse(db, id, name, breed);

  insertRace(db, { id: 'race-101', date: '2026-09-10', trackId: 'track-a', method: 'auto', prize: 50000, name: 'Vanligt lopp' });
  insertRace(db, { id: 'race-102', date: '2026-09-05', trackId: 'track-b', method: 'volt', prize: 150000, name: 'Montélopp' });
  insertRace(db, { id: 'race-103', date: '2026-08-01', trackId: 'track-a', method: 'auto', prize: 50000, name: 'Äldre lopp' });

  insertEntry(db, { id: 'entry-a1', raceId: 'race-101', horseId: 'horse-a', placing: 1, prize: null, gallop: null });
  insertEntry(db, { id: 'entry-a2', raceId: 'race-102', horseId: 'horse-a', placing: 2, prize: 5000, gallop: 1 });
  insertEntry(db, { id: 'entry-a3', raceId: 'race-103', horseId: 'horse-a', placing: 1, prize: 7000, gallop: 0 });
  insertEntry(db, { id: 'entry-b1', raceId: 'race-101', horseId: 'horse-b', driverId: 'driver-b', trainerId: 'trainer-b', placing: 1, prize: 9000, gallop: 0 });
  insertEntry(db, { id: 'entry-missing', raceId: 'race-101', horseId: 'horse-missing', withResult: false });
  insertEntry(db, { id: 'entry-scratch', raceId: 'race-101', horseId: 'horse-scratch', scratched: 1, placing: 1, prize: 99999, gallop: 1 });
  insertEntry(db, { id: 'entry-null', raceId: 'race-101', horseId: 'horse-null', placing: 5, prize: null, gallop: null });
  insertEntry(db, { id: 'entry-dq', raceId: 'race-101', horseId: 'horse-dq', placing: null, placingText: 'd', prize: 0, gallop: 1, disqualified: 1 });
  insertEntry(db, { id: 'entry-dead', raceId: 'race-101', horseId: 'horse-deadheat', placing: 1, placingText: '1=', prize: 12000, gallop: 0 });
  return { db, env };
}

test('rolling Trend periods use deterministic inclusive boundaries', () => {
  assert.deepEqual(trendDateWindow('2w', '2026-09-11'), { period: '2w', startDate: '2026-08-29', endDate: '2026-09-11' });
  assert.deepEqual(trendDateWindow('4w', '2026-09-11'), { period: '4w', startDate: '2026-08-15', endDate: '2026-09-11' });
  assert.deepEqual(trendDateWindow('3m', '2026-09-11'), { period: '3m', startDate: '2026-06-11', endDate: '2026-09-11' });
  assert.deepEqual(trendDateWindow('6m', '2026-09-11'), { period: '6m', startDate: '2026-03-11', endDate: '2026-09-11' });
  assert.deepEqual(trendDateWindow('1y', '2026-09-11'), { period: '1y', startDate: '2025-09-11', endDate: '2026-09-11' });
  assert.throws(() => trendDateWindow('bad', '2026-09-11'), /period must be/);
});

test('Trend core metrics are scratch-safe and preserve null semantics', async () => {
  const { env } = setupCoreFixture();
  const data = await getTrendLeaderboard(env, { category: 'horses', period: '2w', asOfDate: '2026-09-11' });
  const horse = data.items.find((item) => item.id === 'horse-a');
  assert.ok(horse);
  assert.equal(horse.starts, 2);
  assert.equal(horse.resultStarts, 2);
  assert.equal(horse.wins, 1);
  assert.equal(horse.losses, 1);
  assert.equal(horse.winRate, 0.5);
  assert.equal(horse.top3, 2);
  assert.equal(horse.top3Rate, 1);
  assert.equal(horse.gallops, 1);
  assert.equal(horse.gallopVerifiedStarts, 1);
  assert.equal(horse.gallopRate, 1);
  assert.equal(horse.prizeVerifiedStarts, 1);
  assert.equal(horse.prizeSek, 5000);
  assert.equal(data.items.some((item) => item.id === 'horse-missing'), false, 'missing result does not prove an actual start');
  assert.equal(data.items.some((item) => item.id === 'horse-scratch'), false, 'scratched entry is never a start');

  const nullPrize = data.items.find((item) => item.id === 'horse-null');
  assert.equal(nullPrize.prizeVerifiedStarts, 0);
  assert.equal(nullPrize.prizeSek, null, 'unknown prize remains null rather than becoming zero');
  assert.equal(nullPrize.gallopRate, null, 'unknown gallop status remains unknown');

  const dq = data.items.find((item) => item.id === 'horse-dq');
  assert.equal(dq.starts, 1);
  assert.equal(dq.losses, 1);
  assert.equal(dq.top3Rate, 0);
  assert.equal(dq.disqualifications, 1);

  const deadHeat = data.items.find((item) => item.id === 'horse-deadheat');
  assert.equal(deadHeat.wins, 1, 'official numeric placing 1 counts as a win even with dead-heat text');
});

test('Trend applies period, race level, track, race type, breed and start method with AND semantics', async () => {
  const { env } = setupCoreFixture();

  const twoWeeks = await getTrendLeaderboard(env, { category: 'horses', period: '2w', asOfDate: '2026-09-11' });
  assert.equal(twoWeeks.items.find((item) => item.id === 'horse-a').starts, 2);
  const threeMonths = await getTrendLeaderboard(env, { category: 'horses', period: '3m', asOfDate: '2026-09-11' });
  assert.equal(threeMonths.items.find((item) => item.id === 'horse-a').starts, 3);

  const highPrize = await getTrendLeaderboard(env, { category: 'horses', period: '2w', raceScope: 'high_prize', asOfDate: '2026-09-11' });
  assert.deepEqual(highPrize.items.map((item) => item.id), ['horse-a']);
  assert.equal(highPrize.items[0].starts, 1);

  const weekday = await getTrendLeaderboard(env, { category: 'horses', period: '2w', raceScope: 'weekday', asOfDate: '2026-09-11' });
  assert.equal(weekday.items.some((item) => item.id === 'horse-b'), true);
  assert.equal(weekday.items.find((item) => item.id === 'horse-a').starts, 1);

  const track = await getTrendLeaderboard(env, { category: 'horses', period: '2w', trackId: 'track-b', asOfDate: '2026-09-11' });
  assert.deepEqual(track.items.map((item) => item.id), ['horse-a']);

  const monte = await getTrendLeaderboard(env, { category: 'horses', period: '2w', raceType: 'monte', asOfDate: '2026-09-11' });
  assert.deepEqual(monte.items.map((item) => item.id), ['horse-a']);
  const sulky = await getTrendLeaderboard(env, { category: 'horses', period: '2w', raceType: 'sulky', asOfDate: '2026-09-11' });
  assert.equal(sulky.items.some((item) => item.id === 'horse-b'), true);
  assert.equal(sulky.items.find((item) => item.id === 'horse-a').starts, 1);

  const cold = await getTrendLeaderboard(env, { category: 'horses', period: '2w', breedType: 'coldblood', asOfDate: '2026-09-11' });
  assert.deepEqual(cold.items.map((item) => item.id), ['horse-b']);
  const volt = await getTrendLeaderboard(env, { category: 'horses', period: '2w', startMethod: 'volt', asOfDate: '2026-09-11' });
  assert.deepEqual(volt.items.map((item) => item.id), ['horse-a']);

  const combined = await getTrendLeaderboard(env, {
    category: 'horses', period: '2w', raceScope: 'high_prize', trackId: 'track-b', raceType: 'monte', breedType: 'warmblood', startMethod: 'volt', asOfDate: '2026-09-11'
  });
  assert.deepEqual(combined.items.map((item) => item.id), ['horse-a']);
});

test('horse Trend uses canonical Form-eligible starts for minStarts without dropping factual core starts', async () => {
  const { db, env } = createTestEnv();
  insertTrack(db, 'track-a', 'Bana A');
  insertPerson(db, 'drivers', 'driver-a', 'Kusk A');
  insertPerson(db, 'trainers', 'trainer-a', 'Tränare A');
  insertHorse(db, 'horse-form-eligibility', 'Formhäst');
  for (let i = 0; i < 3; i += 1) insertRace(db, { id: `race-form-${i + 1}`, date: `2026-09-0${i + 1}` });
  insertEntry(db, { id:'form-e1', raceId:'race-form-1', horseId:'horse-form-eligibility', placing:1 });
  insertEntry(db, { id:'form-e2', raceId:'race-form-2', horseId:'horse-form-eligibility', placing:4 });
  insertEntry(db, { id:'form-e3', raceId:'race-form-3', horseId:'horse-form-eligibility', placing:null, disqualified:0 });

  const strict = await getTrendLeaderboard(env, { category:'horses', period:'3m', asOfDate:'2026-09-11', minStarts:'3' });
  assert.equal(strict.items.some((item) => item.id === 'horse-form-eligibility'), false, 'unknown placing is not a Form-eligible start');

  const relaxed = await getTrendLeaderboard(env, { category:'horses', period:'3m', asOfDate:'2026-09-11', minStarts:'2' });
  const row = relaxed.items.find((item) => item.id === 'horse-form-eligibility');
  assert.ok(row);
  assert.equal(row.formUsedStarts, 2);
  assert.equal(row.starts, 3, 'supporting core statistics preserve the factual result-row count');
  assert.equal(row.recentPlacings.includes(null), false, 'Form history contains only canonical eligible starts');
});

test('Trend supports the same deterministic metrics for trainers and drivers', async () => {
  const { env } = setupCoreFixture();
  const trainers = await getTrendLeaderboard(env, { category: 'trainers', period: '2w', asOfDate: '2026-09-11' });
  const drivers = await getTrendLeaderboard(env, { category: 'drivers', period: '2w', asOfDate: '2026-09-11' });
  const trainerA = trainers.items.find((item) => item.id === 'trainer-a');
  const driverA = drivers.items.find((item) => item.id === 'driver-a');
  assert.ok(trainerA);
  assert.ok(driverA);
  assert.equal(trainerA.starts, driverA.starts);
  assert.equal(trainerA.wins, driverA.wins);
  assert.equal(trainerA.losses, trainerA.starts - trainerA.wins);
  assert.equal(driverA.losses, driverA.starts - driverA.wins);
});

test('Trend and entity statistics share core metric semantics', async () => {
  const { env } = setupCoreFixture();
  const trend = await getTrendLeaderboard(env, { category: 'horses', period: '1y', asOfDate: '2026-09-11' });
  const detail = await getFilteredEntityStatBreakdowns(env, 'horses', 'horse-a', { year: '2026', raceScope: 'all' });
  const item = trend.items.find((row) => row.id === 'horse-a');
  for (const key of ['starts', 'resultStarts', 'wins', 'losses', 'top3', 'gallops', 'gallopVerifiedStarts', 'prizeVerifiedStarts', 'prizeSek', 'winRate', 'top3Rate', 'gallopRate']) {
    assert.equal(item[key], detail.summary[key], key);
  }
});

test('Trend rejects unknown enums and track IDs instead of silently ignoring them', async () => {
  const { env } = setupCoreFixture();
  const base = { category: 'horses', period: '2w', asOfDate: '2026-09-11' };
  await assert.rejects(() => getTrendLeaderboard(env, { ...base, category: 'jockeys' }), /category must be/);
  await assert.rejects(() => getTrendLeaderboard(env, { ...base, raceScope: 'premium' }), /race_scope must be/);
  await assert.rejects(() => getTrendLeaderboard(env, { ...base, raceType: 'unknown' }), /race_type must be/);
  await assert.rejects(() => getTrendLeaderboard(env, { ...base, breedType: 'unknown' }), /breed_type must be/);
  await assert.rejects(() => getTrendLeaderboard(env, { ...base, startMethod: 'flying' }), /start_method must be/);
  await assert.rejects(() => getTrendLeaderboard(env, { ...base, trackId: 'not-stored' }), /track_id does not identify/);
});

test('horse Trend orders canonical Form deterministically and returns exactly top 10', async () => {
  const { db, env } = createTestEnv();
  insertTrack(db, 'track-a', 'Bana A');
  insertPerson(db, 'drivers', 'driver-a', 'Kusk A');
  insertPerson(db, 'trainers', 'trainer-a', 'Tränare A');

  for (let i = 0; i < 30; i += 1) insertRace(db, { id: `race-${200 + i}`, date: '2026-09-10' });
  const addHorseStarts = (horseId, placings) => {
    insertHorse(db, horseId, horseId);
    for (let i = 0; i < placings.length; i += 1) insertEntry(db, { id: `${horseId}-e${i}`, raceId: `race-${200 + i}`, horseId, placing: placings[i], prize: 0, gallop: 0 });
  };
  addHorseStarts('horse-a', [4, 1]);
  addHorseStarts('horse-b', [1, 1, 4, 4]);
  addHorseStarts('horse-c', [1, 1, 4, 4]);
  for (let i = 0; i < 10; i += 1) addHorseStarts(`horse-z${i}`, [13]);

  const data = await getTrendLeaderboard(env, { category: 'horses', period: '2w', asOfDate: '2026-09-11' });
  assert.equal(data.items.length, 10);
  assert.equal(data.items[0].id, 'horse-a', 'recent strong form outranks horses with more wins at the same win rate');
  assert.equal(data.items[0].winRate, 0.5);
  assert.ok(data.items[0].formScore > data.items.find((item) => item.id === 'horse-b').formScore);
  assert.deepEqual(
    data.items.filter((item) => item.id === 'horse-b' || item.id === 'horse-c').map((item) => item.id),
    ['horse-b', 'horse-c'],
    'equal Form uses the stable ID tie-break'
  );
});
