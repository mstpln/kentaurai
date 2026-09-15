# C2 X-Labs evidence profiles v1

C2 adds a deterministic evidence and coverage layer on top of the optional X-Labs measurements built in C1. It does not alter baseline sports-strength features and it does not award a strength bonus merely because a horse has direct telemetry.

## Contract

- Contract: `kentaurai-xlabs-evidence-profiles-v1`
- Feature version: `xlabs-evidence-profiles-v1`
- C1 interval input: `xlabs-intervals-v2`
- Trusted whole-race input: `xlabs-telemetry-v1`
- Evidence envelope and hierarchical backoff reuse the A3 foundations.

## Feature-level evidence

Evidence is graded separately for each feature. There is deliberately no global "X-Labs horse grade".

The first profile set is:

- opening 100 m kilometer pace from a valid C1 local interval;
- closing 400 m kilometer pace from the trusted whole-race v1 measurement;
- extra-distance percentage from the trusted whole-race v1 measurement.

For each feature the profile reports direct measured starts, recent measured share, relevant-context measured starts/share, same-track depth, same-class depth, A/B/C/D evidence, shrinkage/backoff information and source provenance.

Relevant direct history is the same canonical start method plus B6-compatible distance bucket. If direct evidence is sparse, the deterministic backoff chain uses measured population context for method+distance and then the global measured population. Missing direct X-Labs data therefore widens uncertainty or falls back to contextual evidence; it is not treated as negative performance evidence.

## Field coverage

Field coverage always exposes the measured-subset denominator explicitly. Coverage is reported per feature as measured entries / eligible active entries, plus a tactical `opening OR closing` direct-observation share.

Front-contender coverage is optional caller input. C2 never identifies contenders from odds, betting percentages, editorial ranking or other market information. When a market-blind scenario layer has already identified contender entry IDs, C2 can report the same measured-subset coverage for that subset.

## Population-shift diagnostics

C2 compares the eligible historical population with the directly measured population by:

- year;
- track;
- start method;
- distance bucket;
- class;
- race-type signature;
- field-size bucket.

Each feature receives its own coverage distribution. Total-variation distance is used as a deterministic distribution-shift diagnostic, and target-context buckets are flagged when unseen, sparse or materially under-observed relative to overall coverage. These flags describe measurement selection risk only; they do not change horse strength.

Race type is currently represented by a deterministic sorted signature when a race has multiple verified types, so the diagnostic preserves the exact observed combination rather than double-counting an entry across multiple type buckets.

## As-of and provenance

The DB wrapper caps the feature cutoff at the target race start. Historical results require an official result source record available at or before the cutoff. X-Labs source records are selected with `fetched_at <= cutoff`, using `julianday` comparisons, and the latest eligible measurement is chosen deterministically per historical race entry.

The pure builder is intended for already selected/as-of-safe rows. Production consumers should use `buildXlabsEvidenceProfilesForRace` unless they deliberately provide an equivalent prepared input set.

## Operational boundary

C2 adds no route, scheduler, automatic replay or backfill. It does not restart the stopped historical X-Labs job. It introduces no production data mutation or new migration. The layer is derived on demand from normalized facts and the existing C1/v1 telemetry stores.
