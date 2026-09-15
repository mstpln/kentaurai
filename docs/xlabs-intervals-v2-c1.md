# X-Labs intervals v2 - C1

C1 adds an additive numeric interval layer over already captured X-Labs race telemetry. It does not replace or modify the trusted `xlabs-telemetry-v1` whole-race mapper.

## Contract

- Contract: `kentaurai-xlabs-intervals-v2`
- Mapper/feature version: `xlabs-intervals-v2`
- Raw telemetry remains in private R2.
- D1 stores compact derived 100 m interval rows in `xlabs_intervals`.
- The existing `xlabs_data` table and v1 `quality_status` semantics are unchanged.
- No scheduler, replay or historical backfill is started by this build.

## Local interval eligibility

Each start-anchored 100 m interval is evaluated independently. The initial v2 policy requires:

- at least 90% target-frame presence between the selected interval endpoints;
- each selected endpoint to be within 20 m of the requested distance-to-finish checkpoint;
- measured distance to be between 80% and 120% of the requested interval length;
- positive chronological and distance progression.

Invalid intervals are retained with null numeric pace values plus an explicit eligibility status and coverage metadata. This makes partial coverage observable instead of turning it into horse-strength evidence.

The v1 whole-race 99% frame-coverage gate remains authoritative for v1-only whole-race fields. In particular, C1 derives `extra_distance_pct` only when the same starter is eligible for the trusted v1 whole-race mapper.

## Feature bundle

C1 can derive, per measured race entry:

- first and second 100 m numeric pace;
- opening pace delta (`second100 - first100`, where a negative value means the second 100 m was faster);
- best, median and worst valid 100 m pace;
- 100 m pace variance;
- last 100/200/400 m numeric pace;
- closing-vs-midrace pace delta (`last400 - midrace median`, where a negative value means a faster close);
- extra-distance percentage when the trusted v1 whole-race gate is satisfied.

Every feature carries an A3 evidence envelope with explicit coverage. A direct single-race X-Labs measurement is capped at evidence level B in C1; missing measurements are level D/null. C1 does not convert missing X-Labs data into negative horse evidence.

Field-relative metrics are calculated only over starters measured for that exact feature. Every rank discloses `measured_field_count`, `active_field_size` and `measured_field_share`; unmeasured starters remain unranked.

## Provenance and replay

Bundles carry source-record provenance using the source `fetched_at` timestamp and reject an `as_of` cutoff earlier than source availability. Interval IDs and writes are deterministic and idempotent for the tuple of race entry, source record, interval bounds and mapper version.

Replaying the same immutable raw source with the same mapper version therefore cannot create duplicate interval rows.
