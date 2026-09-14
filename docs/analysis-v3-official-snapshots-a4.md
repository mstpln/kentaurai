# Analysis v3 A4 — official entity snapshots

Status: foundation data promotion for future analysis v3 context. This build does not change AI weighting, probabilities, system construction or learning rules.

## Purpose

A4 promotes already archived and normalized official horse/person information into timestamped first-class D1 facts. It does not refetch the source and it does not infer facts that the source did not provide.

The promoted families are:

- horse age at observation time
- structured current horse record
- annual and lifetime horse aggregate snapshots
- annual driver aggregate snapshots
- annual trainer aggregate snapshots
- annual/lifetime horse record rows by method/distance when present

Every promoted row carries `observed_at` and `source_record_id`. Historical reads must select only rows whose observation time is at or before the requested `as_of`.

## Fact boundaries

Age is stored only as `age_years` in `horse_profile_snapshots`. A4 never converts age into `horses.birth_year`.

A4 does not infer breed.

Official aggregate statistics remain separate from KentaurAI's own granular race history. Own normalized starts/results remain primary for form, class and segmented statistics. Provider aggregates are a timestamped fallback and coverage cross-check.

The official aggregate source exposes some numeric fields whose public unit contract is not yet strong enough to convert safely. A4 therefore preserves `earnings`, `earningsPerStart`, `winPercentage` and `placePercentage` in explicitly named `*_raw` columns. This avoids silently inventing SEK/percentage unit semantics. A later deterministic feature build can normalize them only after the unit contract is verified and versioned.

`start_points` can appear inside the lifetime aggregate mirror, but the existing dedicated `horse_start_points` timeline remains the canonical analytical Start Points source. A4 must not create a second weighted Start Points signal.

## Tables

Migration `0015_official_snapshot_promotion.sql` adds:

- `horse_profile_snapshots`
- `horse_stat_snapshots`
- `horse_record_snapshots`
- `person_stat_snapshots`
- `official_snapshot_source_sync`

Stable IDs are built from the mapped entity, archived source record and snapshot scope. Replaying the same source is idempotent.

## Archived-source replay

`src/import/official-snapshots.js` reads only already archived official raw objects whose source record has reached `normalized_verified_subset`. It never performs a source fetch.

The scheduled worker processes at most one previously unsynchronized archived source record per scheduler invocation. This is independent of the failed X-Labs historical backfill and does not resume or modify that job.

Unmapped official participant IDs are skipped rather than name-matched. A non-positive/missing official participant ID therefore stays unmapped.

If the same archived source contains conflicting duplicate facts for one entity/snapshot scope, A4 fails closed and records the source synchronization as failed instead of silently choosing one value. Different source records may disagree; both timestamped snapshots remain preserved.

## As-of API for later packs

The module exports:

- `getOfficialHorseSnapshotsAsOf`
- `getOfficialPersonAnnualSnapshotsAsOf`

These return only observations known at the requested cutoff. Horse output contains age, current record, current-year/lifetime official aggregates, source provenance and an own-history-vs-official start-count comparison.

The coverage comparison counts only granular results whose own source record was already fetched by the requested `as_of`. It is a diagnostic cross-check, not a replacement statistic.

## Acceptance invariants

1. A future official snapshot never enters a past as-of read.
2. Re-importing the same source record is a no-op.
3. Missing raw fields remain null; numeric zero remains zero.
4. Age never mutates or infers `horses.birth_year`.
5. Official aggregates remain separate from own calculated statistics.
6. Changed facts from later source records do not overwrite earlier snapshots.
7. Source-level duplicate conflicts fail closed.
8. Replay uses private archived R2 content only; no source refetch is introduced.
9. No AI/model weighting or legacy analysis runtime semantics are changed by A4.