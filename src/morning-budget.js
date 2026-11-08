/**
 * TravData morning workload policy.
 *
 * These are run-local D1 safeguards, not Cloudflare billing limits. Cloudflare
 * analytics are delayed and include other work. Essential ingestion may not be
 * suppressed solely because analytics are missing or a preceding stage was
 * expensive. Every stage remains bounded and resumable.
 */
export const MORNING_STAGE_BUDGETS = Object.freeze({
  live_capture_morning: Object.freeze({ rowsRead: 12_000_000, rowsWritten: 8_000, durationMs: 120_000, priority: 'essential' }),
  live_normalize_morning: Object.freeze({ rowsRead: 110_000_000, rowsWritten: 45_000, durationMs: 360_000, priority: 'essential' }),
  official_daily_incremental: Object.freeze({ rowsRead: 40_000_000, rowsWritten: 16_000, durationMs: 180_000, priority: 'essential' }),
  post_race_settlement: Object.freeze({ rowsRead: 20_000_000, rowsWritten: 10_000, durationMs: 150_000, priority: 'essential' }),
  xlabs_daily_incremental: Object.freeze({ rowsRead: 40_000_000, rowsWritten: 16_000, durationMs: 180_000, priority: 'essential' }),
  recent_start_points_promotion: Object.freeze({ rowsRead: 12_000_000, rowsWritten: 6_000, durationMs: 90_000, priority: 'supporting' }),
  recent_official_snapshot_promotion: Object.freeze({ rowsRead: 12_000_000, rowsWritten: 6_000, durationMs: 90_000, priority: 'supporting' })
});

export const NORMALIZATION_CHUNK_BUDGET = Object.freeze({
  rowsRead: 25_000_000, rowsWritten: 12_000, durationMs: 120_000
});

export const MORNING_RUN_BUDGET = Object.freeze({
  rowsRead: 230_000_000, rowsWritten: 95_000, durationMs: 600_000
});

export const WORKLOAD_CAPACITY = Object.freeze({
  dailyD1Reads: 600_000_000,
  dailyD1Writes: 1_200_000,
  busyDayD1Reads: 1_000_000_000,
  busyDayD1Writes: 2_000_000,
  monthlyD1Reads: 20_000_000_000,
  monthlyD1Writes: 40_000_000,
  monthlyEmergencyD1Reads: 24_000_000_000,
  monthlyEmergencyD1Writes: 48_000_000,
  monthlyR2ClassA: 800_000,
  monthlyR2ClassB: 8_000_000,
  monthlyWorkersRequests: 8_000_000,
  monthlyWorkersCpuMs: 24_000_000
});

function metric(usage, id) {
  const entry = usage?.metrics?.find((item) => item?.id === id);
  const value = entry?.used;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Billing data may be delayed. A missing field is UNKNOWN, never zero.
 * This read-only decision is deliberately advisory for the bounded current
 * V85/V86 chain; only supporting and ad-hoc expansion can be deferred.
 */
export function evaluateWorkloadPressure(usage, utcDate = new Date()) {
  const reads = metric(usage, 'd1_rows_read');
  const writes = metric(usage, 'd1_rows_written');
  if (reads == null || writes == null || usage?.available === false) {
    return { level: 'unknown', telemetryAvailable: false, allowExpansion: false, allowSupporting: true, reason: 'usage_unavailable' };
  }

  const day = new Date(utcDate).toISOString().slice(0, 10);
  const today = Array.isArray(usage?._dailyUsage) ? usage._dailyUsage.find((row) => row.date === day) : null;
  const dailyReads = typeof today?.rowsRead === 'number' ? today.rowsRead : null;
  const dailyWrites = typeof today?.rowsWritten === 'number' ? today.rowsWritten : null;
  const extraMetrics = [
    ['r2_class_a', WORKLOAD_CAPACITY.monthlyR2ClassA],
    ['r2_class_b', WORKLOAD_CAPACITY.monthlyR2ClassB],
    ['workers_requests', WORKLOAD_CAPACITY.monthlyWorkersRequests],
    ['workers_cpu_ms', WORKLOAD_CAPACITY.monthlyWorkersCpuMs]
  ];
  const extraHigh = extraMetrics.some(([id, limit]) => {
    const used = metric(usage, id);
    return used != null && used >= limit;
  });

  const emergency = reads >= WORKLOAD_CAPACITY.monthlyEmergencyD1Reads
    || writes >= WORKLOAD_CAPACITY.monthlyEmergencyD1Writes;
  const high = reads >= WORKLOAD_CAPACITY.monthlyD1Reads
    || writes >= WORKLOAD_CAPACITY.monthlyD1Writes
    || (dailyReads != null && dailyReads >= WORKLOAD_CAPACITY.busyDayD1Reads)
    || (dailyWrites != null && dailyWrites >= WORKLOAD_CAPACITY.busyDayD1Writes)
    || extraHigh;
  const elevated = high
    || (dailyReads != null && dailyReads >= WORKLOAD_CAPACITY.dailyD1Reads)
    || (dailyWrites != null && dailyWrites >= WORKLOAD_CAPACITY.dailyD1Writes);
  const level = emergency ? 'emergency' : high ? 'high' : elevated ? 'elevated' : 'normal';

  // No unattended historical expansion without a verified same-day baseline.
  const sameDayMeasured = dailyReads != null && dailyWrites != null;
  return {
    level,
    telemetryAvailable: true,
    dailyTelemetryAvailable: sameDayMeasured,
    allowExpansion: level === 'normal' && sameDayMeasured,
    allowSupporting: level !== 'emergency',
    reason: emergency ? 'monthly_emergency_reserve' : high ? 'capacity_high' : elevated ? 'capacity_elevated' : null
  };
}

export function morningStageDecision(name, runSafety, pressure) {
  const budget = MORNING_STAGE_BUDGETS[name];
  if (!budget) throw new Error('unknown morning stage');
  if (budget.priority === 'essential') return { run: true, reason: null, budget };
  if (runSafety?.stopped) return { run: false, reason: runSafety.reason || 'morning_budget_reached', budget };
  if (pressure?.allowSupporting === false) return { run: false, reason: pressure.reason || 'capacity_high', budget };
  return { run: true, reason: null, budget };
}
