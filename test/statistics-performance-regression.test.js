import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createTestEnv } from './helpers/d1.js';
import { getHorseRankings } from '../src/statistics/horses-complete.js';
import { getTrainerRankings } from '../src/statistics/trainers.js';
import { getDriverRankings } from '../src/statistics/drivers.js';

function capturePreparedQueries(env) {
  const originalPrepare = env.DB.prepare.bind(env.DB);
  const captures = [];
  env.DB.prepare = (sql) => {
    captures.push(String(sql));
    return originalPrepare(sql);
  };
  return captures;
}

test('statistics core endpoints avoid repeated ranking scans', async () => {
  {
    const { env } = createTestEnv();
    const captures = capturePreparedQueries(env);
    await getHorseRankings(env, { mode:'core', period:'1y', asOfDate:'2026-09-20', minStarts:'3' });
    assert.equal(captures.length, 3, 'horse core should be shared core aggregate + Form + opening speed');
    assert.equal(captures.filter((sql) => sql.includes('WITH horse_stats AS MATERIALIZED')).length, 1);
    assert.equal(captures.some((sql) => sql.includes('horse_start_points')), false, 'Start Points must stay out of the fast horse core response');
  }
  {
    const { env } = createTestEnv();
    const captures = capturePreparedQueries(env);
    await getTrainerRankings(env, { mode:'core', period:'1y', asOfDate:'2026-09-20', minStarts:'10' });
    assert.equal(captures.length, 2, 'trainer core should aggregate the three basic rankings in one scan plus Form');
    assert.equal(captures.filter((sql) => sql.includes('WITH trainer_stats AS MATERIALIZED')).length, 1);
  }
  {
    const { env } = createTestEnv();
    const captures = capturePreparedQueries(env);
    await getDriverRankings(env, { mode:'core', period:'1y', asOfDate:'2026-09-20', minStarts:'10' });
    assert.equal(captures.length, 2, 'driver core should aggregate the three basic rankings in one scan plus Form');
    assert.equal(captures.filter((sql) => sql.includes('WITH driver_stats AS MATERIALIZED')).length, 1);
  }
});

test('statistics extended endpoints consolidate expensive ranking families', async () => {
  {
    const { env } = createTestEnv();
    const captures = capturePreparedQueries(env);
    await getHorseRankings(env, { mode:'extended', period:'1y', asOfDate:'2026-09-20', minStarts:'3' });
    assert.equal(captures.length, 4, 'horse extended should use earnings + closing speed + combined rest + Start Points');
    assert.equal(captures.filter((sql) => sql.includes('ranking_kind')).length, 1);
  }
  {
    const { env } = createTestEnv();
    const captures = capturePreparedQueries(env);
    await getTrainerRankings(env, { mode:'extended', period:'1y', asOfDate:'2026-09-20', minStarts:'10' });
    assert.equal(captures.length, 7, 'trainer extended should collapse performance, home, distance, market and rest ranking families');
    assert.equal(captures.some((sql) => sql.includes("'goodVolt'")), true);
    assert.equal(captures.some((sql) => sql.includes("'favorite'")), true);
  }
  {
    const { env } = createTestEnv();
    const captures = capturePreparedQueries(env);
    await getDriverRankings(env, { mode:'extended', period:'1y', asOfDate:'2026-09-20', minStarts:'10' });
    assert.equal(captures.length, 4, 'driver extended should collapse performance and market ranking families');
    assert.equal(captures.some((sql) => sql.includes("'backRow'")), true);
    assert.equal(captures.some((sql) => sql.includes("'longshot'")), true);
  }
});

test('statistics UIs overlap core and extended reads while keeping core paint first', () => {
  for (const [file, mergeName] of [
    ['../src/horse-statistics-ui.js','mergeHorseRankingPayload'],
    ['../src/trainer-statistics-ui.js','tMergeRankingPayload'],
    ['../src/driver-statistics-ui.js','dMergeRankingPayload']
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /const corePromise=api\([^;]+mode=core/);
    assert.match(source, /const extendedPromise=new Promise\(\(resolve,reject\)=>setTimeout\(\(\)=>api\([^;]+mode=extended/);
    assert.match(source, /const core=await corePromise/);
    assert.ok(source.includes('const data='+mergeName+'(core,extended)'));
  }
});

test('entity detail statistics overlap lazy secondary reads and prewarm the real default scope', () => {
  const detail = fs.readFileSync(new URL('../src/entity-detail-statistics-ui-v2.js', import.meta.url), 'utf8');
  const performance = fs.readFileSync(new URL('../src/app-performance-v1.js', import.meta.url), 'utf8');
  assert.match(detail, /function delayedRequest\(path,token,delay=75\)/);
  assert.match(detail, /const corePromise=request\(base\+'\/calendar-statistics\?'/);
  assert.match(detail, /const specialtiesPromise=delayedRequest\(base\+'\/calendar-specialties\?'/);
  assert.match(detail, /const formPromise=delayedRequest\(base\+'\/calendar-form\?'/);
  assert.match(performance, /race_scope:'high_prize'/);
  assert.match(performance, /defaultRankingPath\(page,'core'\)/);
  assert.match(performance, /horses\|trainers\|drivers/);
});
