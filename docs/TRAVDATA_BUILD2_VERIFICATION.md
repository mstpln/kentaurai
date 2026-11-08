# TravData backend build 2 — performance and usage verification

Baseline: merged production main e66d481ebba56024de9be2265624fbf91f690a7d
Work branch: feat/travdata-backend-2-performance-telemetry-20261108

## Scope and operational boundary

Do not merge or deploy until the owner explicitly authorizes this PR.
Do not perform production historical backfills, cleanup, R2 deletion,
D1 restore, real racing payload upload, or private editorial import.
Production D1 and Cloudflare account metrics are not accessible to this
GitHub-only review without private runtime credentials; code tests and
synthetic query plans are **not** proof of actual production consumption.

## High-value changes

1. Live upcoming leg horse form uses existing batch calculator instead
   of separately querying each entry's calendar-year history. The same
   deterministic algorithm, five-most-recent-start form definitions,
   as-of cutoff, nullable values and ordering remain intact. Tests
   compare results with the original per-horse calculation across a
   multi-horse synthetic leg and quantify prepared-query reductions.
2. Drift's **optional** read-only Workers account analytics shows total
   requests and CPU time for all scripts sharing the Cloudflare account.
   Raw GraphQL samples can lag/omit CPU; the UI explicitly labels
   these values approximate and refuses to substitute zero or a
   percentile-derived CPU total. Source: Cloudflare
   workersInvocationsAdaptive, with schema-compatible no-CPU fallback.
3. Capacity policy now considers observed current-day and monthly
   Workers usage when available, with separate normal/busy-day
   thresholds. Essential current-data imports and personal writes are
   never disabled because optional account telemetry is absent.
   Historical expansion is already manual and retains D1-based
   guarded headroom. These are **soft** protections, not billing caps.
4. Read-only daily R2 operations are observed across all R2 buckets for
   the UTC day. They inform normal/busy-day pressure alongside monthly
   billed Class A/B quantities, but R2 action types are **never** guessed
   into a billable class and missing datasets remain unknown.
5. Workflow health is now calculated from the exact latest morning
   orchestration log. Successful metadata alone is insufficient: a
   missing, failed or skipped essential stage is reported as such.
   The existing Drift section receives only a small text status
   using its original styling, not a redesign.

## Current-data vs legacy workflows

The only active cron remains 05:15 UTC once daily. No independent old
AI scheduler has been identified in the current worker entrypoint.
Legacy external-analysis HTTP routes and historical data are retained
as dormant compatibility because the public AGENTS policy and release
checks still reference them, and removal without consumer proof would
create avoidable risk. They are **not** automatically called by this
build or used for background AI work.

Cleanup of legacy compatibility code is not worth a risky broad deletion
while the modern TravData app is functioning. A later separately reviewed
removal can be considered after a complete call-graph/feature audit.

## Known limitations that should remain visible

- Full production Cloudflare Query Insights, real daily consumption,
  optional R2 operation telemetry and exact billed CPU are **not**
  independently verified from public GitHub. The new Workers metrics are advisory,
  sampled and account-scoped, not precise billable request totals.
- The existing R2 billing Class A and Class B monthly quantities
  remain displayed only when Cloudflare makes those records available.
  No class is inferred from raw R2 action text.
- A single expensive SQL query is measured only after completion. Hard
  per-query cost limits require bounded SQL and Cloudflare-level limits;
  no Worker code can guarantee invoice thresholds.
- Historical coverage and date/provenance gaps are not filled
  synthetically. No backfills are authorized by the code rollout.
- A full billing cycle of observations is necessary before adjusting
  manual job budgets or setting aggressive absolute caps.

## Verification gates

- Original and batched form results are identical for a synthetic
  multi-horse leg; query count is substantially reduced.
- Workers GraphQL success, missing CPU fallback, malformed responses,
  truncated observations and absent permissions have regression tests.
- Current-day Workers warning/stop signals leave essential tasks open.
- Morning status detects missing, skipped, failed and stale stages.
- Existing D1/R2 usage and Drift routes remain working without Workers
  metrics. Private API routes remain authenticated.
- Full CI, exact head review, create PR, **no merge or deploy** until
  owner approval. After approval compare actual Drift and Query Insights
  across several morning runs and confirm budget margins.
