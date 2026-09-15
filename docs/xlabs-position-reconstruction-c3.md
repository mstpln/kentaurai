# C3 X-Labs continuous position reconstruction v1

C3 adds a deterministic, optional trajectory layer on top of stored X-Labs raw telemetry. It does not change the official-data baseline and it does not create canonical named trip positions.

## Contract

- Contract: `kentaurai-xlabs-position-reconstruction-v1`
- Reconstruction version: `xlabs-position-reconstruction-v1`
- Source truth: exact `xlabs_race_json` raw object in private R2 plus its `source_records` row.
- D1 stores only compact derived checkpoints, candidate episodes and per-entry summaries. Raw telemetry frames remain in R2.

## Reconstruction rules

Longitudinal order is based primarily on `distanceToFinish`; lower is ahead. Telemetry is synchronized by frame timestamp. A target missing from one frame or local window is omitted there only, rather than invalidating the whole horse or race.

Short jitter is smoothed locally before checkpoint geometry is derived. Checkpoints are selected at deterministic 100 m leader-progress intervals, with an optional finish checkpoint when telemetry reaches the finish. Each checkpoint can contain rank, meters behind the observed leader, relative lateral offset, position/gap change, observed-field denominator and reconstruction confidence.

Relative lateral offset is projected onto the local movement normal. Its numeric sign is deliberately **not** called inner/outer because track orientation has not passed the manual geometry gate. Absolute lateral displacement may create a `wide_offset_candidate`, but that is only a geometric candidate, not a named trip fact.

Ambiguous longitudinal near-ties abstain from rank. If the observed leader itself is ambiguous, `meters_behind_leader` is null. Missing or weak telemetry therefore becomes missing/low-confidence reconstruction evidence, never a negative horse-strength value.

## Candidate episodes

C3 may emit these deterministic candidate types:

- `lead_change_candidate`
- `forward_movement_candidate`
- `relative_loss_candidate`
- `wide_offset_candidate`

These are compact geometric/movement summaries. C3 does **not** emit leader/pocket/death-seat/second-over/third-over/wide-trip facts and does not write the legacy `race_positions` table. Named trip labels belong to the separate C4 validation gate.

## Schema

Migration `0018_xlabs_position_reconstruction_v1.sql` adds:

- `race_position_checkpoints`
- `race_trajectory_episodes`
- `race_trajectory_summaries`
- `xlabs_position_reconstruction_jobs`

Every persisted reconstruction row is linked to `source_record_id` and `reconstruction_version`. Writes are idempotent.

## Coverage and confidence

Checkpoint rows disclose `observed_field_count`, `active_field_size`, `field_coverage` and local target coverage. Per-entry summaries report raw frame coverage, reconstructed/ranked/lateral checkpoint counts and separate longitudinal/lateral confidence. No X-Labs coverage quantity modifies baseline sports strength.

## Selective historical derivation

The C3 job is a separate, date-bounded cursor over **already stored** X-Labs R2 source records. One explicit step processes at most one source record and advances a source-record cursor. It does not acquire new telemetry, touch `xlabs_backfill_jobs`, resume the stopped `historical_all` job, or run from a scheduler.

Creating or running a production reconstruction job is an explicit operational action and is not a release side effect.

## Release gate

C3 is high-risk geometry work. CI uses synthetic trajectories for deterministic order/gap, partial missingness, lead changes, finish ordering, ambiguity abstention and idempotent persistence. Production activation still requires the master-plan manual geometry/trajectory validation gate on private representative samples. No private telemetry or reference-round payload is committed to GitHub.