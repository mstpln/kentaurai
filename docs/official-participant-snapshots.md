# Official participant snapshots

Status: A4 foundation for analysis v3. These tables promote verified official participant facts from already archived raw captures into timestamped D1 snapshots. They do not change the current analysis workflow or model weights.

## Purpose

The snapshot layer answers a historical question safely: what official participant facts had KentaurAI observed by a given cutoff?

Every promoted row keeps the source record and its observation time. A later capture remains a later observation and must not enter an earlier as-of view.

## Promoted facts

Horse snapshots can preserve:

- age at observation time
- current official record code, start method, distance group and time components
- lifetime starts, placements and source-native aggregate statistics
- annual starts, placements and source-native aggregate statistics
- annual official records by method/distance

Driver and trainer snapshots can preserve annual official aggregate statistics when the source provides them.

These official aggregates stay separate from KentaurAI's own statistics calculated from normalized historical races. They are source facts and cross-check/context inputs, not replacements for calculated history.

## Semantics and null safety

Unknown or absent values stay `NULL`. Explicit numeric zero remains zero.

Age is stored as `age_years` at `observed_at`. It is never converted into a guessed birth year.

Fields whose upstream unit is not yet promoted to a stronger semantic contract are deliberately named `*_raw`. Percentage fields observed in source-native hundredths are stored as `*_percentage_hundredths`. No silent SEK, decimal or percentage conversion occurs in A4.

Record components are stored structurally rather than flattened to display text.

## Identity and provenance

Participant snapshots require an exact existing official external-ID mapping. A missing, zero or otherwise unusable external identity is skipped; the importer does not infer identity from names.

Every snapshot includes `source_record_id` and `observed_at`. Stable IDs plus source-scoped uniqueness make exact source replay idempotent.

If the same source contains conflicting values for the same exact participant identity, promotion fails closed for that source instead of selecting one value silently.

## As-of behavior

`getOfficialHorseSnapshotAsOf` selects only observations with `observed_at <= asOf` and deterministically takes the latest eligible observation. Annual rows are likewise selected from eligible observations only.

This is the required primitive for later replay-safe v3 feature work. A future capture cannot become evidence in a past feature simply because it exists in the database today.

## Import scheduling

The Worker can promote one newest unsynced normalized official raw source per scheduled invocation. The promotion reads the already archived R2 object; it does not refetch the provider.

A completed source is never repeated. A failed source is recorded as failed and is not automatically retried by the pending-source selector. This A4 scheduler does not start, resume or mutate any historical backfill job.

## Tables

Migration `0015_official_participant_snapshots.sql` adds:

- `horse_official_snapshots`
- `horse_official_year_snapshots`
- `horse_official_record_snapshots`
- `driver_official_year_snapshots`
- `trainer_official_year_snapshots`
- `official_participant_snapshot_source_sync`

The snapshot layer is factual storage only. It does not yet change v2 exports, AI prompts, Step-1 locking, probabilities, ABCD, value assessment or system construction.
