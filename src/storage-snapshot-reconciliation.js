// Pure fact-level classification for historical snapshot recovery. This module
// never writes, plans an insertion, or assumes current identity mappings existed
// at the original observation time.
const FAMILIES = Object.freeze({
  horse_profile: { collection: 'horseProfiles', kind: 'horse', scope: (f) => 'profile', columns: (f) => ({ age_years: f.ageYears }) },
  horse_stat: { collection: 'horseStats', kind: 'horse', scope: (f) => f.snapshotScope,
    columns: (f) => ({ stat_year: f.statYear, starts: f.starts, earnings_raw: f.earningsRaw,
      wins: f.wins, seconds: f.seconds, thirds: f.thirds, win_percentage_raw: f.winPercentageRaw,
      place_percentage_raw: f.placePercentageRaw, earnings_per_start_raw: f.earningsPerStartRaw,
      start_points: f.startPoints }) },
  horse_record: { collection: 'horseRecords', kind: 'horse',
    scope: (f) => (f.recordScope === 'year' ? 'year:' + f.statYear : f.recordScope) + ':' + f.ordinal,
    columns: (f) => ({ record_scope: f.recordScope, stat_year: f.statYear, record_ordinal: f.ordinal,
      code: f.code, start_method: f.startMethod, distance_group: f.distanceGroup,
      time_minutes: f.timeMinutes, time_seconds: f.timeSeconds, time_tenths: f.timeTenths, place: f.place }) },
  person_stat: { collection: 'personStats', kind: 'person', scope: (f) => String(f.statYear),
    columns: (f) => ({ person_type: f.personType, stat_year: f.statYear, starts: f.starts,
      earnings_raw: f.earningsRaw, wins: f.wins, seconds: f.seconds, thirds: f.thirds,
      win_percentage_raw: f.winPercentageRaw }) }
});

const STATUSES = Object.freeze([
  'represented', 'missing_identity', 'identity_ambiguous', 'missing_unverified_chronology',
  'missing_candidate', 'conflict', 'invalid_evidence'
]);

function normalize(v) { return v == null ? null : v; }
function matchingColumns(record, columns) {
  return Object.entries(columns).every(([key, value]) => Object.is(normalize(record[key]), normalize(value)));
}
function validTime(v) { return typeof v === 'string' && Number.isFinite(Date.parse(v)); }

// Use exactly the same fact columns as the reconciliation classifier when
// comparing a bounded historical predecessor. Missing SQL projections fail
// closed instead of treating undefined as a factual null.
export function snapshotFactMatches(family, record, fact) {
  const definition = FAMILIES[family];
  if (!definition || !record || typeof record !== 'object' || !fact || typeof fact !== 'object') {
    throw new Error('reconciliation_invalid_predecessor');
  }
  const columns = definition.columns(fact);
  if (Object.keys(columns).some((key) => !Object.prototype.hasOwnProperty.call(record, key))) {
    throw new Error('reconciliation_incomplete_projection');
  }
  return matchingColumns(record, columns);
}

// All inputs must be read from verified originals and read-only D1 queries.
// identityEvidence must explicitly establish stable historical mapping; a
// present-day mapping alone never proves the identity used by a legacy import.
export function reconcileSnapshotFacts({
  family, source, facts, identities, direct = [], observations = [],
  referencedSnapshots = [], chronology = [], historicalIdentityVerified = false, chronologyVerified = false,
  onFactClassified = null
}) {
  const definition = FAMILIES[family];
  if (!definition || !(facts instanceof Map)) throw new Error('reconciliation_invalid_family_or_facts');
  if (!source || typeof source.id !== 'string' || !source.id ||
      !validTime(source.fetched_at) || !Array.isArray(direct) || !Array.isArray(observations) ||
      !Array.isArray(referencedSnapshots) || !Array.isArray(chronology) ||
      !(identities instanceof Map)) throw new Error('reconciliation_invalid_input');
  if (onFactClassified != null && typeof onFactClassified !== 'function') throw new Error('reconciliation_invalid_callback');
  if (facts.size > 512 || direct.length > 1024 || observations.length > 1024 ||
      referencedSnapshots.length > 1024 || chronology.length > 2048) {
    throw new Error('reconciliation_budget_exceeded');
  }
  const summary = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let checked = 0;
  const seen = new Set();
  const referenceById = new Map(referencedSnapshots.map((row) => [row.id, row]));
  for (const fact of facts.values()) {
    const identityKey = (definition.kind === 'person' ? fact.personType + ':' : '') + fact.externalId;
    const matches = identities.get(identityKey) || [];
    const mapped = matches.length === 1 ? matches[0] : null;
    const scope = definition.scope(fact);
    const entityKey = mapped ? (definition.kind === 'person' ? fact.personType + ':' : '') + mapped : null;
    const exact = mapped ? direct.filter((row) => row.source_record_id === source.id &&
      row.entity_key === entityKey && row.scope_key === scope) : [];
    const links = mapped ? observations.filter((row) => row.source_record_id === source.id &&
      row.entity_key === entityKey && row.scope_key === scope && row.snapshot_family === family) : [];
    let status;
    if (matches.length > 1) status = 'identity_ambiguous';
    else if (!mapped) status = 'missing_identity';
    else if (seen.has(entityKey + '|' + scope)) status = 'conflict';
    else {
      seen.add(entityKey + '|' + scope);
      const columns = definition.columns(fact);
      const consistentDirect = exact.filter((row) =>
        row.observed_at === source.fetched_at && matchingColumns(row, columns));
      const consistentLinks = links.filter((row) => {
        const ref = referenceById.get(row.snapshot_id) ||
          direct.find((candidate) => candidate.id === row.snapshot_id);
        const expectedChangeMarker = ref?.source_record_id === source.id ? 1 : 0;
        return ref && ref.lineage_verified !== false && row.observed_at === source.fetched_at &&
          ref.entity_key === entityKey && ref.scope_key === scope &&
          (row.factual_changed == null || Number(row.factual_changed) === expectedChangeMarker) &&
          validTime(ref.observed_at) && Date.parse(ref.observed_at) <= Date.parse(source.fetched_at) &&
          matchingColumns(ref, columns);
      });
      if (exact.length + links.length > consistentDirect.length + consistentLinks.length) {
        status = 'conflict';
      } else if (consistentDirect.length + consistentLinks.length > 0) {
        status = 'represented';
      } else if (!historicalIdentityVerified || !chronologyVerified) {
        status = 'missing_unverified_chronology';
      } else {
        const timeline = chronology.filter((row) => row.entity_key === entityKey && row.scope_key === scope);
        if (timeline.some((row) => !validTime(row.observed_at))) status = 'invalid_evidence';
        else if (timeline.some((row) => Date.parse(row.observed_at) >= Date.parse(source.fetched_at))) {
          // A later (or same-time) fact may require historical change-point
          // splitting and as-of equivalence checks before any recovery write.
          status = 'missing_unverified_chronology';
        } else status = 'missing_candidate';
      }
    }
    summary[status]++;
    // Called only from the private Worker: never return this detail or log it.
    if (onFactClassified) onFactClassified({ status, fact, mapped, entityKey, scope });
    // Deliberately omit source IDs, canonical identities, raw keys and values:
    // only classifications are allowed to cross the private endpoint boundary.
    checked++;
  }
  return { family, expectedFacts: facts.size, classifications: summary,
    classificationsComplete: checked === facts.size, repairAuthorized: false };
}

export const SNAPSHOT_RECONCILIATION_STATUSES = STATUSES;
