# TravData workflows and backend rollout — 2026-11-08

Scope: preserve the current TravData UI and existing D1/R2 facts. No bulk
historical imports, Cloudflare account changes, D1 restore, or cleanup execution
are authorized by this document. Production deployment requires review and
separate approval.

## Observed implementation (main at ee24fa28894a753657a69e5724a1603be8573ad5)

- Worker main: src/worker-v079.js, chained to src/index.js.
- Exactly one cron: 15 5 * * * UTC.
- Daily stages: 7 calendar dates of upcoming V85/V86, pending game
  normalization, three-day official results, start points, official snapshots,
  post-race settlement, and three-day bounded X-Labs catch-up.
- Multiyear official and X-Labs backfills are explicitly manual.
- D1 provenance-recovery inventory and private restoration remain separately
  authorized; old destructive cleanup APIs are disabled.
- The phase-one frontend reads existing authenticated APIs. Browser-local
  horse notes and manual systems currently do not sync with D1.
- The manual builder permits arbitrary spike counts; it is distinct from
  legacy AI system registration with exactly three spikes.
- The new manual systems have no authoritative settlement yet.

## Why this change is necessary

The generic D1 safety observer (250,000 reads, 25,000 writes, 45 s elapsed)
was originally intended as an abnormal-operation detector. Reusing it as the
single morning stop condition allowed a valid normalization to exhaust the
observer and skip later current-data jobs. Changing this globally would weaken
independent storage/recovery safeguards; **do not change the generic default**.

## This build: staged limits (advisory after each bounded chunk)

D1 rows read / written and elapsed operation time are measured from D1 meta.
These are **not** Worker CPU milliseconds. A single SQL statement may still
exceed a predicted cost before D1 returns its meta, so expensive SQL must
also have indexes, bounded input and separate query-plan tests.

| Morning stage | Read rows | Written rows | Elapsed ms | Priority |
| --- | ---: | ---: | ---: | --- |
| Upcoming capture | 12m | 8k | 120k | Essential |
| Live normalization | 110m | 45k | 360k | Essential |
| Final results/settlement | 20m | 10k | 150k | Essential |
| Recent official results | 40m | 16k | 180k | Essential |
| Recent X-Labs | 40m | 16k | 180k | Essential |
| Start-point promotion | 12m | 6k | 90k | Supporting |
| Official profile promotion | 12m | 6k | 90k | Supporting |

A normalization sub-chunk uses at most 12 entries with a **measured**
25m-read/12k-write/120s warning. Stop scheduling additional chunks if the
chunk or stage budget is crossed. Durable importer progress is preserved.
The whole morning warning budget is 230m reads / 95k writes / 600s measured
elapsed work. When reached, supporting promotions can defer; the essential
stages retain their separate budgets.

Production-budget signals are based on Cloudflare's existing read-only
billing-period and database-scoped D1 analytics. A day at 600m reads or
1.2m writes is elevated, at 1b / 2m high; monthly 20b / 40m is high,
24b / 48m emergency. The policy leaves existing daily essential jobs
available, but does not permit expanding historical processing on unknown
or stale analytics. These are resource *planning* budgets, **not** hard
Cloudflare billing caps. Other Cloudflare applications share account limits.

## Next implementation in the same backend program

1. Verify production D1 Query Insights and stage costs without modifying data.
   Tune any pathological read queries with EXPLAIN QUERY PLAN and realistic
   synthetic scale. Do not hide missing data or reduce result coverage.
2. Create separate, authenticated D1 models for TravData personal horse notes
   and manually entered systems. Migrate existing browser-local records with
   idempotency, revision-aware conflict resolution, deletion tombstones, and
   an offline-safe retry path. Never erase the local originals until the
   server confirms durable persistence.
3. Integrate settled winners and official payouts into those manual systems.
   Support past rounds, multi-system rounds, scratches/reserves, non-unique
   winners and exact wager payout tiers. Unverified payout stays null; never
   equate covered winners with a paid dividend.
4. Verify Trend/statistics read paths, historic coverage and X-Labs readiness.
   Run optional historical expansion only after explicit approval and safe
   account-level headroom; provenance recovery remains separate.
5. Once the new frontend is entirely decoupled, disable obsolete AI routes
   and old background dependencies without destroying retained historical
   facts or paid/private provenance.
6. Add account-level Workers request/CPU and R2 operation telemetry from
   authoritative Cloudflare sources. Missing metrics must be shown as
   unavailable, not zero, and cannot be represented as enforced caps.

## Release gates

- Preserve the existing one-cron schedule and the known-stable UI.
- No public repository commits of real paid material, private racing payloads
  or Cloudflare identifiers/credentials beyond existing public config.
- Unit and integration tests for busy-day and late-billing cases.
- Full repository QA, review exact final head, PR, merge/deploy only on approval.
- Observe multiple real mornings after release, compare actual billed daily
  usage and query patterns, then recalibrate budgets.
