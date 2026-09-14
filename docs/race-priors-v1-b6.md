# B6 empirical race priors v1

B6 adds a market-blind deterministic prior layer for race context. The public contract is `kentaurai-race-priors-v1` with feature version `race_priors_v1`.

## Inputs and as-of boundary

The feature uses normalized official race entries and official race results already stored in D1. A historical result is eligible only when the race happened before the target cutoff and its source record was fetched no later than that cutoff. The cutoff is the earlier of the requested `asOf` and the target race start. Scratched entries are excluded.

Betting percentages, odds, editorial signals, X-Labs telemetry and `race_positions` are not inputs to this feature.

## Context hierarchy

The base result priors use deterministic backoff in this order:

1. track + start method + distance bucket + field bucket
2. track + start method + distance bucket
3. track + start method
4. start method + distance bucket + field bucket
5. start method + distance bucket
6. start method
7. global

Distance buckets are `<1800`, `1800-2399`, `2400-2999` and `>=3000` metres. Field buckets are `1-8`, `9-12` and `>=13` active non-scratched starters. Start methods are canonically normalized to `auto`, `volt` or the source value/`unknown`.

The existing A3 hierarchical-backoff contract is reused. Effective sample size is the number of distinct historical races, rather than the number of entry rows, so several starters from one race do not create false confidence. The initial A3 minimum ESS and prior-equivalent sample size remain 8.

## Priors

The pack exposes:

- race-context win, top-3 and verified-gallop rates;
- optional race-type/proposition refinements when the target context is source-backed;
- lane, start-tier and handicap profiles for the target entry;
- market-free winner-lane concentration through HHI and normalized entropy.

Every prior reports its direct sample size, effective sample size, selected backoff level, backoff sample sizes, coverage and confidence. Unknown lane/tier/handicap facts remain unavailable rather than becoming zero. A verified zero handicap remains a known zero.

Race type is deterministically classified from normalized race facts. Proposition refinement is used only when B1 has a fully parsed proposition signature; partial/unparsed/ambiguous propositions are not promoted into an exact grouping key.

No continuous-position outcome prior is produced. That remains gated on validated position data in the later X-Labs/position work.

## Operational scope

B6 is derived on demand from existing normalized history. It adds no migration, scheduler, replay, backfill or production data mutation. The stopped historical X-Labs backfill is not touched.
