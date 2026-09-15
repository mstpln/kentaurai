import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXlabsEvidenceProfiles,
  buildXlabsPopulationShiftDiagnostics,
  parseXlabsKilometerTime,
  xlabsDistanceBucket
} from '../src/xlabs-evidence-profiles-v1.js';

const AS_OF = '2026-09-15T06:00:00.000Z';

function aggregateRows({ skew = false } = {}) {
  const buckets = [
    ['overall', 'all', 100, 40],
    ['method_distance', 'auto|middle', 40, 20],
    ['method_distance', 'volt|middle', 20, 2],
    ['year', '2025', 50, skew ? 5 : 20],
    ['year', '2026', 50, skew ? 35 : 20],
    ['track', 'track-a', 50, 30],
    ['track', 'track-b', 50, 10],
    ['method', 'auto', 80, 38],
    ['method', 'volt', 20, 2],
    ['distance', 'middle', 80, 38],
    ['distance', 'long', 20, 2],
    ['class', 'bronze', 20, 2],
    ['class', 'silver', 80, 38],
    ['race_type', 'mares', 20, 2],
    ['race_type', 'unclassified', 80, 38],
    ['field_size', 'medium', 80, 38],
    ['field_size', 'large', 20, 2]
  ];
  return buckets.map(([dimension, bucket, eligible, measured]) => ({
    dimension,
    bucket,
    eligible,
    opening_100_km_pace_ms_measured: measured,
    opening_100_km_pace_ms_mean: 74_000,
    closing_400_km_pace_ms_measured: measured,
    closing_400_km_pace_ms_mean: 72_000,
    extra_distance_pct_measured: measured,
    extra_distance_pct_mean: 1.2
  }));
}

function historyRow({
  entryId,
  horseId,
  date,
  method = 'auto',
  distance = 2140,
  track = 'track-a',
  stlClass = 'bronze',
  opening = null,
  closing = null,
  extra = null,
  source = 'src-1'
}) {
  return {
    race_entry_id: entryId,
    horse_id: horseId,
    race_date: date,
    scheduled_start_at: `${date}T12:00:00.000Z`,
    track_id: track,
    start_method: method,
    distance_m: distance,
    main_class: null,
    stl_class: stlClass,
    race_types: '',
    field_size: 10,
    opening_100_km_pace_ms: opening,
    closing_400_km_pace_ms: closing,
    extra_distance_pct: extra,
    opening_source_record_id: opening == null ? null : source,
    opening_source_selected_at: opening == null ? null : `${date}T14:00:00.000Z`,
    v1_source_record_id: closing == null && extra == null ? null : source,
    v1_source_selected_at: closing == null && extra == null ? null : `${date}T14:00:00.000Z`
  };
}

function input(overrides = {}) {
  return {
    target: {
      id: 'race-target',
      race_date: '2026-09-20',
      scheduled_start_at: '2026-09-20T13:00:00.000Z',
      track_id: 'track-a',
      start_method: 'auto',
      distance_m: 2140,
      main_class: null,
      stl_class: 'bronze',
      race_types: 'mares'
    },
    entries: [
      { race_entry_id: 'target-1', horse_id: 'horse-1', start_number: 1, scratched: 0 },
      { race_entry_id: 'target-2', horse_id: 'horse-2', start_number: 2, scratched: 0 },
      { race_entry_id: 'target-3', horse_id: 'horse-3', start_number: 3, scratched: 0 }
    ],
    historyRows: [
      historyRow({ entryId: 'h1-a', horseId: 'horse-1', date: '2026-09-01', opening: 73_000, closing: 71_000, extra: 1.0, source: 's1' }),
      historyRow({ entryId: 'h1-b', horseId: 'horse-1', date: '2026-08-10', opening: 75_000, closing: 73_000, extra: 1.4, source: 's2' }),
      historyRow({ entryId: 'h1-c', horseId: 'horse-1', date: '2026-07-10', opening: 74_000, closing: 72_000, extra: 1.2, source: 's3' }),
      historyRow({ entryId: 'h2-a', horseId: 'horse-2', date: '2026-09-02', opening: null, closing: 74_000, extra: null, source: 's4' }),
      historyRow({ entryId: 'h2-b', horseId: 'horse-2', date: '2026-08-02', opening: null, closing: null, extra: null, source: 's5' }),
      historyRow({ entryId: 'h3-a', horseId: 'horse-3', date: '2026-09-03', method: 'volt', opening: null, closing: null, extra: null, source: 's6' })
    ],
    populationAggregates: aggregateRows(),
    frontContenderEntryIds: ['target-1', 'target-2'],
    asOf: AS_OF,
    ...overrides
  };
}

test('parses deterministic X-Labs kilometer time and distance buckets', () => {
  assert.equal(parseXlabsKilometerTime('1.12,3 min/km'), 72_300);
  assert.equal(parseXlabsKilometerTime('bad'), null);
  assert.equal(xlabsDistanceBucket(1640), 'short');
  assert.equal(xlabsDistanceBucket(2140), 'middle');
  assert.equal(xlabsDistanceBucket(2640), 'long');
  assert.equal(xlabsDistanceBucket(3140), 'stayer');
});

test('builds feature-level evidence without a global X-Labs horse grade', () => {
  const result = buildXlabsEvidenceProfiles(input());
  const horse1 = result.profiles.find((row) => row.horse_id === 'horse-1');
  const horse2 = result.profiles.find((row) => row.horse_id === 'horse-2');

  assert.equal(horse1.features.opening_100_km_pace_ms.evidence_level, 'A');
  assert.equal(horse1.features.closing_400_km_pace_ms.evidence_level, 'A');
  assert.equal(horse1.features.extra_distance_pct.evidence_level, 'A');

  assert.equal(horse2.features.opening_100_km_pace_ms.evidence_level, 'C');
  assert.equal(horse2.features.opening_100_km_pace_ms.sample_size, 0);
  assert.equal(horse2.features.closing_400_km_pace_ms.evidence_level, 'B');
  assert.equal(Object.prototype.hasOwnProperty.call(horse2, 'evidence_level'), false);
});

test('uses measured subset denominators for field and front-contender coverage', () => {
  const result = buildXlabsEvidenceProfiles(input());

  assert.equal(result.coverage.field.eligible_entries, 3);
  assert.equal(result.coverage.field.features.opening_100_km_pace_ms.measured_entries, 1);
  assert.equal(result.coverage.field.features.opening_100_km_pace_ms.measured_share, 1 / 3);
  assert.equal(result.coverage.field.features.closing_400_km_pace_ms.measured_entries, 2);
  assert.equal(result.coverage.front_contenders.status, 'available');
  assert.equal(result.coverage.front_contenders.eligible_entries, 2);
  assert.equal(result.coverage.front_contenders.features.opening_100_km_pace_ms.measured_share, 0.5);
  assert.equal(result.coverage.front_contenders.features.closing_400_km_pace_ms.measured_share, 1);
});

test('missing X-Labs only changes optional evidence, never baseline strength', () => {
  const withHistory = buildXlabsEvidenceProfiles(input());
  const withoutHistory = buildXlabsEvidenceProfiles(input({ historyRows: [] }));

  assert.deepEqual(withHistory.separation, withoutHistory.separation);
  assert.equal(withoutHistory.separation.baseline_strength_modified, false);
  assert.equal(withoutHistory.separation.direct_data_bonus_applied, false);
  assert.equal(withoutHistory.profiles.every((profile) =>
    Object.values(profile.features).every((feature) => feature.sample_size === 0)
  ), true);
});

test('population shift diagnostics are deterministic and flag selection bias', () => {
  const target = input().target;
  const rows = aggregateRows({ skew: true });
  const first = buildXlabsPopulationShiftDiagnostics(rows, target, 10);
  const second = buildXlabsPopulationShiftDiagnostics(rows, target, 10);

  assert.deepEqual(first, second);
  assert.equal(first.population_shift_risk, true);
  assert.equal(first.risk_flags.some((flag) => flag.includes('year:distribution_shift')), true);
  assert.equal(first.risk_flags.some((flag) => flag.includes('class:target_bucket_underobserved')), true);
});

test('same input and cutoff replays exactly', () => {
  const first = buildXlabsEvidenceProfiles(input());
  const second = buildXlabsEvidenceProfiles(input());
  assert.deepEqual(first, second);
});

test('front-contender coverage is market-blind caller input and optional', () => {
  const result = buildXlabsEvidenceProfiles(input({ frontContenderEntryIds: [] }));
  assert.equal(result.coverage.front_contenders.status, 'not_provided');
  assert.equal(result.coverage.front_contenders.selection_source, null);
  assert.equal(result.coverage.front_contenders.eligible_entries, 0);
});
