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
| Manual system settlement | 12m | 6k | 90k | Essential |
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

## Implemented in this PR (not yet deployed)

- One scheduled morning chain remains. Current official imports, 3-day
  official results, post-race settlement, manual-system settlement and daily
  X-Labs have independent measured budgets and cannot be skipped merely
  because normalization had a high read count.
- Normalization stops between saved-source chunks, retaining the existing
  durable cursor. Budget observations are advisory *after each operation*;
  they do not interrupt SQL mid-statement or guarantee a billing cap.
- Optional manually dispatched historical/repair steps require verified
  Cloudflare D1 usage headroom; they return a controlled 429 rather than
  starting on unknown billing telemetry. The old cleanup/restoration
  authorization gates remain separate and unchanged.
- Dedicated private D1 tables: travdata_horse_notes,
  travdata_manual_systems, travdata_personal_tombstones.
  APP_PASSWORD-session-authenticated GET/POST sync endpoints are limited
  and isolated from old external-AI systems. No public provider payloads,
  private paid material, or article bodies are added.
- Browser local copies are retained. Initial and resumed-app reads merge
  D1 and local records; failed sync retries later. Tombstones prevent
  deleted notes or systems from being resurrected by another device.
- New manual systems accept arbitrary singleton-spike counts, validate all
  eight legs and canonical round IDs, and calculate rows and stake on
  the server. Historical legacy analysis/system validation is unchanged.
- Official post-race job discovery recognizes manual-only systems.
  A separate bounded settlement step calculates theoretical standard
  stake payouts from verified final official tiers and unique winners.
  Missing payouts, selected scratches/reserves and ambiguous winners
  stay unresolved for manual review (never invented). There is no
  assertion that a ticket was actually purchased or paid.
- The user's INSATS card now sums stakes of all registered systems while
  RESULTAT is calculated from settled systems only.

## Remaining verification and second-build tasks

1. Verify private production D1 Query Insights and the measured morning
   stage costs without mutating data. Identify and optimize the largest
   SQL scans with EXPLAIN QUERY PLAN and synthetic scale testing. No
   artificial omission of legitimate historic starts is acceptable.
2. Confirm source coverage and frontend behavior against private real
   data *after* approved deployment and migration 0070. No real payload
   enters the public repository or CI.
3. Observe several morning runs and check whether each bounded step
   meets its coverage SLA. Calibrate per-stage limits from actual data.
4. Extend account-wide authoritative telemetry to Workers requests/CPU
   and R2 Class A/B. D1-only measurements and estimated billing
   allocations must never be misrepresented as hard account caps.
5. Review Trend/statistics read paths and historic data coverage.
   Backfill remains independently, explicitly authorized and cost-gated.
   Any source-provenance restoration requires its separate approvals.
6. When no new UI function relies on the legacy external AI backend,
   deactivate obsolete AI routes without deleting old private analysis,
   editorial or historical source data.

## Remaining limitations / safety caveats

- Paid Cloudflare usage metrics can lag. An internal budget cannot
  guarantee zero Cloudflare overage when other apps share the account.
- The existing per-connection APP_PASSWORD protects personal data
  through a 30-day cookie; losing that password does not back up local
  data. No local browser data is deleted during the sync.
- Manual settlements are theoretical standard-wager calculations. The
  provider's scratch/reserve and special payout semantics can require
  human review; do not present them as confirmed financial receipts.
- An individual SQL statement can consume more than a soft quota
  before its D1 meta is returned. Query-plan inspection is required.

## Release gates

- Preserve the existing one-cron schedule and the known-stable UI.
- No public repository commits of real paid material, private racing payloads
  or Cloudflare identifiers/credentials beyond existing public config.
- Unit and integration tests for busy-day and late-billing cases.
- Full repository QA, review exact final head, PR, merge/deploy only on approval.
- Observe multiple real mornings after release, compare actual billed daily
  usage and query patterns, then recalibrate budgets.
