import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MORNING_STAGE_BUDGETS, MORNING_RUN_BUDGET,
  NORMALIZATION_CHUNK_BUDGET, WORKLOAD_CAPACITY,
  evaluateWorkloadPressure, morningStageDecision
} from '../src/morning-budget.js';

const now = '2026-11-08T05:15:00.000Z';
const report = (reads, writes, dailyReads = 0, dailyWrites = 0, extras = []) => ({
  configured:true,
  metrics:[
    { id:'d1_rows_read', used:reads },
    { id:'d1_rows_written', used:writes },
    ...extras
  ],
  _dailyUsage:[{ date:'2026-11-08', rowsRead:dailyReads, rowsWritten:dailyWrites }]
});

test('a real-size normalization does not hit the normal morning limit', () => {
  assert.ok(MORNING_STAGE_BUDGETS.live_normalize_morning.rowsRead > 58_350_000);
  assert.ok(MORNING_STAGE_BUDGETS.live_normalize_morning.rowsWritten > 17_058);
  assert.ok(MORNING_STAGE_BUDGETS.live_normalize_morning.durationMs > 195_000);
  assert.ok(MORNING_RUN_BUDGET.rowsRead > MORNING_STAGE_BUDGETS.live_normalize_morning.rowsRead);
  assert.ok(NORMALIZATION_CHUNK_BUDGET.rowsRead < MORNING_STAGE_BUDGETS.live_normalize_morning.rowsRead);
  assert.ok(NORMALIZATION_CHUNK_BUDGET.durationMs < MORNING_STAGE_BUDGETS.live_normalize_morning.durationMs);
});

test('essential stages retain dedicated reserved budgets after an over-limit stage', () => {
  const stopped = { stopped:true, reason:'abnormal_cost:live_normalize_morning' };
  const high = evaluateWorkloadPressure(report(24_900_000_000, 49_900_000, 1_200_000_000, 2_400_000), now);
  assert.equal(high.level,'emergency');
  for (const name of [
    'live_capture_morning', 'live_normalize_morning',
    'post_race_settlement', 'official_daily_incremental', 'xlabs_daily_incremental'
  ]) assert.equal(morningStageDecision(name, stopped, high).run, true, name);
  for (const name of ['recent_start_points_promotion','recent_official_snapshot_promotion']) {
    assert.deepEqual(morningStageDecision(name, stopped, high).run, false, name);
  }
});

test('unknown or delayed usage is not fabricated as zero and bounded daily work proceeds', () => {
  const decision = evaluateWorkloadPressure({ configured:true, available:false, metrics:[] }, now);
  assert.equal(decision.level,'unknown');
  assert.equal(decision.telemetryAvailable,false);
  assert.equal(decision.allowExpansion,false);
  assert.equal(morningStageDecision('post_race_settlement', { stopped:false }, decision).run,true);
  assert.equal(morningStageDecision('recent_start_points_promotion', { stopped:false }, decision).run,true);
});

test('normal, busy, and emergency D1 days have distinct controls', () => {
  const normal = evaluateWorkloadPressure(report(5_000_000_000, 5_000_000, 100_000_000, 10_000), now);
  assert.equal(normal.level,'normal');
  assert.equal(normal.allowExpansion,true);

  const busy = evaluateWorkloadPressure(report(5_000_000_000, 5_000_000, 650_000_000, 10_000), now);
  assert.equal(busy.level,'elevated');
  assert.equal(busy.allowExpansion,false);
  assert.equal(busy.allowSupporting,true);

  const high = evaluateWorkloadPressure(report(20_100_000_000, 5_000_000, 100_000_000, 10_000), now);
  assert.equal(high.level,'high');
  assert.equal(high.allowSupporting,true);

  const emergency = evaluateWorkloadPressure(report(24_000_000_000, 5_000_000, 100_000_000, 10_000), now);
  assert.equal(emergency.level,'emergency');
  assert.equal(emergency.allowSupporting,false);
});

test('R2 monthly operation indicators prevent unbounded expansion when present', () => {
  const pressure = evaluateWorkloadPressure(report(1_000_000, 1000, 5, 5,
    [{ id:'r2_class_a',used:WORKLOAD_CAPACITY.monthlyR2ClassA }]), now);
  assert.equal(pressure.level,'high');
  assert.equal(pressure.allowExpansion,false);
});

test('missing same-day Cloudflare telemetry never authorizes ad-hoc expansion', () => {
  const usage = report(5, 5, 50, 50);
  usage._dailyUsage[0].date = '2026-11-07';
  const pressure = evaluateWorkloadPressure(usage, now);
  assert.equal(pressure.dailyTelemetryAvailable,false);
  assert.equal(pressure.allowExpansion,false);
});

test('scheduled work keeps one cron, caps individual chunks and prioritizes results', () => {
  const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(config, /"15 5 \* \* \*"/);
  assert.match(config, /"45 5 \* \* \*"/);
  const code = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(code, /getCloudflareUsage\(env,[\s\S]*?includeDailyUsage:true/);
  assert.match(code, /normalizeNextPendingOfficialGame\(chunkEnv, \{ maxSteps:12 \}\)/);
  assert.match(code, /morningStageDecision\(name, safety, pressure\)/);
  assert.ok(code.indexOf("await runStage('post_race_settlement'")
    < code.indexOf("await runStage('recent_start_points_promotion'"));
  assert.ok(code.indexOf("await runStage('xlabs_daily_incremental'")
    < code.indexOf("await runStage('recent_official_snapshot_promotion'"));
});

test('morning recovery checkpoints state and resumes only unfinished essentials', () => {
  const code = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(code, /const MORNING_RECOVERY_CRON = '45 5 \* \* \*'/);
  assert.match(code, /if \(recovery && !saved\) return \{ skipped:true, reason:'no_morning_checkpoint'/);
  assert.match(code, /essential\.every\(name => completed\.has\(name\)\)/);
  assert.match(code, /Date\.now\(\) - lastProgress < RECOVERY_INACTIVE_MS/);
  assert.match(code, /INSERT OR IGNORE INTO import_runs/);
  assert.match(code, /await checkpoint\(\)/);
  assert.match(code, /if \(completed\.has\(name\)\) return/);
  assert.match(code, /if \(recovery && !essential\.includes\(name\)\)/);
});

test('Workers daily and monthly thresholds affect only optional expansion', () => {
  const usage = report(2_000_000, 100, 1_000_000, 100, [
    {id:'workers_requests',used:300_000},
    {id:'workers_cpu_ms',used:1_000_000}
  ]);
  usage._dailyWorkersUsage = {requests:230_000,cpuMs:800_000};
  const elevated=evaluateWorkloadPressure(usage,now);
  assert.equal(elevated.level,'elevated');
  assert.equal(elevated.allowExpansion,false);
  assert.equal(elevated.allowSupporting,true);
  assert.equal(elevated.dailyWorkersCpuTelemetryAvailable,true);
  assert.equal(morningStageDecision('official_daily_incremental',{stopped:true},elevated).run,true);

  usage._dailyWorkersUsage = {requests:500_000,cpuMs:1_300_000};
  const high=evaluateWorkloadPressure(usage,now);
  assert.equal(high.level,'high');
  assert.equal(morningStageDecision('post_race_settlement',{stopped:true},high).run,true);

  usage._dailyWorkersUsage = null;
  usage.metrics.find(x=>x.id==='workers_cpu_ms').used=24_000_001;
  assert.equal(evaluateWorkloadPressure(usage,now).level,'high');
});
