# B5 Person context v1

B5 adds a market-blind deterministic person-context feature family for drivers, trainers and driver-horse combinations.

The build is additive and on-demand. It adds no migration, scheduler change, replay or backfill.

Own verified history is primary. Provider annual person snapshots are fallback/completeness evidence and never replace safer granular history. Missing data remains unknown.

Driver and trainer context exposes 14/30/90/365-day form, relative-to-own-365-day baseline deltas, guarded method/distance/track/tier segments, sample sizes, confidence and provenance. Market-conditioned favorite/longshot/odds metrics are excluded.

Driver-horse context keeps together-history separate from the same horse with other drivers and uses the correct denominator for each. Optional first-200 pace is included only when verified X-Labs telemetry exists.

Trainer equipment-change response remains owned by B4 `equipment_response_v1` and is not duplicated here.

All history and provider observations are selected as-of the target cutoff. The family emits no composite score and no causal claims.