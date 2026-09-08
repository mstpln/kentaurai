import { deriveCapturedXlabsMeasurements, XLABS_TELEMETRY_VERSION } from '../import/xlabs-telemetry.js';

const NORMALIZED_QUALITY = 'normalized_verified_subset';
const REPRESENTATIVE_FIELDS = [
  ['first_200_time', 'first200Time'],
  ['last_200_time', 'last200Time'],
  ['actual_distance_m', 'actualDistanceM'],
  ['extra_distance_m', 'extraDistanceM'],
  ['converted_km_time', 'convertedKmTime']
];
const ALL_FIELDS = [
  ...REPRESENTATIVE_FIELDS,
  ['last_400_time', 'last400Time'],
  ['last_500_time', 'last500Time'],
  ['last_800_time', 'last800Time'],
  ['last_1000_time', 'last1000Time'],
  ['slipstream_m', 'slipstreamM'],
  ['quality_status', 'qualityStatus']
];

function valuesEqual(expected, actual) {
  if (typeof expected === 'number' && typeof actual === 'number') return Math.abs(expected - actual) < 1e-9;
  return expected === actual;
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

export async function verifyCapturedXlabsNormalization(env, sourceRecordId) {
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');
  const derived = await deriveCapturedXlabsMeasurements(env, id);
  const { results: normalized } = await env.DB.prepare(`
    SELECT x.*, re.start_number
    FROM xlabs_data x
    JOIN race_entries re ON re.id = x.race_entry_id
    WHERE x.source_record_id = ?
    ORDER BY re.start_number, x.id
  `).bind(id).all();
  const byEntry = new Map(normalized.map((row) => [row.race_entry_id, row]));
  const fieldMismatches = [];
  let fieldComparisons = 0;

  for (const expected of derived.rows) {
    const actual = byEntry.get(expected.raceEntryId);
    for (const [column, property] of ALL_FIELDS) {
      fieldComparisons += 1;
      const actualValue = actual?.[column] ?? null;
      if (!valuesEqual(expected[property], actualValue)) {
        fieldMismatches.push({ startNumber: expected.startNumber, field: column, expected: expected[property], actual: actualValue });
      }
    }
    fieldComparisons += 1;
    const expectedSegments = canonicalJson(expected.segments);
    const actualSegments = canonicalJson(parseJson(actual?.segments_json));
    if (expectedSegments !== actualSegments) {
      fieldMismatches.push({ startNumber: expected.startNumber, field: 'segments_json', expected: expectedSegments, actual: actualSegments });
    }
  }

  const representativeChecks = [];
  for (const expected of derived.rows.slice(0, 4)) {
    const actual = byEntry.get(expected.raceEntryId);
    for (const [column, property] of REPRESENTATIVE_FIELDS) {
      representativeChecks.push({
        id: `start_${expected.startNumber}.${column}`,
        pass: valuesEqual(expected[property], actual?.[column] ?? null),
        expected: expected[property],
        actual: actual?.[column] ?? null
      });
    }
  }

  const checks = [
    {
      id: 'source.quality_status',
      pass: derived.source.quality_status === NORMALIZED_QUALITY,
      expected: NORMALIZED_QUALITY,
      actual: derived.source.quality_status
    },
    {
      id: 'normalized.row_count',
      pass: normalized.length === derived.rows.length,
      expected: derived.rows.length,
      actual: normalized.length
    },
    {
      id: 'telemetry.frame_count',
      pass: derived.frameCount > 0,
      expected: 'positive',
      actual: derived.frameCount
    },
    {
      id: 'normalized.source_provenance',
      pass: normalized.every((row) => row.source_record_id === id),
      expected: id,
      actual: normalized.every((row) => row.source_record_id === id) ? id : 'mismatch'
    }
  ];
  const passed = checks.every((check) => check.pass)
    && representativeChecks.length >= 10
    && representativeChecks.every((check) => check.pass)
    && fieldMismatches.length === 0;

  return {
    sourceRecordId: id,
    raceId: derived.race.id,
    mapperVersion: XLABS_TELEMETRY_VERSION,
    passed,
    checkCount: checks.length + representativeChecks.length + fieldComparisons,
    mismatchCount: checks.filter((check) => !check.pass).length
      + representativeChecks.filter((check) => !check.pass).length
      + fieldMismatches.length,
    checks,
    representativeFieldCheckCount: representativeChecks.length,
    representativeChecks,
    fieldComparisons,
    fieldMismatchCount: fieldMismatches.length,
    fieldMismatches: fieldMismatches.slice(0, 20),
    normalizedRows: normalized.length,
    skippedEntries: derived.skipped.length,
    verifiedSemantics: ALL_FIELDS.map(([column]) => column)
      .filter((column) => column !== 'quality_status' && column !== 'slipstream_m')
      .concat('segments_json'),
    unmappedSemantics: ['slipstream_m (raw telemetry has no lane field; stored null)']
  };
}
