# Analysis v3 B2 — relevant history union and full-history aggregates

Status: deterministic sports-layer foundation. This build does not change model weights, probabilities, prompts, system construction, legacy v2 analysis behavior or production schedules.

## Purpose

B2 replaces the assumption that a short displayed history window is the horse's complete evidence. The v3 integration surface carries two representations in parallel:

1. `fullHistoryAggregates` over every as-of-safe official result start available to KentaurAI.
2. `relevantHistoryUnion`, a bounded deterministic row-level union selected for AI interpretation.

Contract version: `kentaurai-relevant-history-v1`.
Selection version: `kentaurai-relevant-history-selection-v1`.

## Safety boundary

A historical start is eligible only when:

- it belongs to the same canonical horse,
- the entry was not scratched,
- the result is official and source-backed,
- the race happened before the target cutoff,
- the result source was observed no later than the target cutoff.

The target cutoff is the earlier of the requested `asOf` and the target race start. When a race has no exact start timestamp, the selector uses a conservative date boundary so same-day ordering is never guessed.

Equipment, X-Labs and proposition context are independently filtered by observation time. Later observations cannot leak into an earlier target analysis.

## Full-history aggregates

Aggregates use all safe starts, including rows omitted from the bounded union. The initial aggregate contract exposes:

- safe start count,
- wins/seconds/thirds/top-3 and their known denominators,
- win and top-3 rates,
- prize sum and known-prize denominator,
- gallop and disqualification counts/rates with explicit denominators,
- km-time coverage,
- X-Labs start count,
- equipment-known start count,
- start-method counts,
- first/latest safe start timestamps.

`null` remains unknown. Missing optional X-Labs or equipment never becomes a negative performance value.

## Relevant-history inclusion reasons

Every included row has at least one explicit `inclusionReason`. Version 1 supports:

- `recent`
- `same_start_method`
- `similar_distance`
- `same_track_context`
- `similar_proposition`
- `same_equipment`
- `same_driver`
- `xlabs_representative`
- `rest_comparable`
- `error_pattern`

The initial engineering policy keeps five recent safe starts as the baseline source, then adds the strongest missing semantic dimensions, deduplicates by race-entry identity and fills remaining capacity only from rows with an explicit relevance reason. Default maximum is 16 rows per horse. Policy parameters are returned in the result and are configurable without changing stored facts.

An older start can therefore enter the union ahead of a newer but contextually irrelevant start. Row order remains chronological-recency order for stable AI consumption; selection itself is deterministic.

## Proposition matching

B1 proposition facts are used only when both target and historical propositions have `parseStatus = parsed`. The comparison is exact over non-null structured facts. Partial, ambiguous or unparsed proposition wording does not create a proposition-match reason.

## Coverage and official reference

Each target returns:

- `counts.totalSafe`
- `counts.included`
- `counts.omitted`
- `officialHistoryReference`

The official reference comes from the A4 as-of snapshot service and can expose the provider lifetime-start count versus KentaurAI's own known result history. It is coverage context, not a performance score.

## Runtime boundary

B2 is an additive v3 service. It deliberately does not rewrite `analysis-exchange.js` or its legacy latest-five output. The future v3 analysis-pack build consumes this service instead of treating legacy `recentStarts` as complete history.

B2 requires no schema migration and starts no backfill. It does not resume or alter any historical collection job.

## Acceptance invariants

1. Full-history aggregates include safe rows even when row-level history omits them.
2. Every row in `relevantHistoryUnion` has one or more explicit inclusion reasons.
3. Selection is deterministic and deduplicated.
4. Older relevant starts can outrank newer irrelevant starts for bounded inclusion.
5. `totalSafe = included + omitted`.
6. Post-target races and results observed after the target cutoff are excluded.
7. Later equipment, X-Labs and proposition observations are excluded.
8. Missing optional data stays null and never creates a negative strength signal.
9. No market percentage, odds snapshot, external tip or previous AI judgment is read by this service.
10. Legacy v2 output remains unchanged.
11. No production backfill or scheduler change is introduced by B2.
