# Selective storage cleanup: production safety gate

This branch introduces a **read-only** per-source/family eligibility preview. It
does not re-enable production deletion or claim that historical provenance is
recovered. The old global audit remains strict.

## Why a global "skip errors" switch is unsafe
- A September cleanup lost source-owned observations. Equal snapshot values
  alone do not prove that original source provenance is preserved.
- Failed, partial or deficient source histories are **barriers** in a
  chronological series. Never bridge an A-B-A (including null) change point.
- Unknown counts, malformed links, mismatched identity/timestamps, missing
  source SHA or missing raw object reference are quarantined.
- A scoped preview is not authorization to execute. Batch execution remains
  disabled for **every credential** until a separate fully reviewed guarded
  execution implementation and explicit production approval.
- R2 reference rewriting does not physically delete old R2 objects. The D1
  size must be measured from Cloudflare after any future cleanup; row counts
  alone cannot prove GB savings.

## Next execution gate (not delivered by this preview)
1. Run full read-only evidence/coverage forecast and independently confirm it
   can realistically reduce D1 below 5 GB.
2. Add scoped revision-fenced D1 transactions, transactional expected/actual
   deletion guards, post-batch source representation audit and durable
   quarantine/checkpoint reporting.
3. Separately authorize a verified **private** recovery point and the
   time-limited production execution capability; do not rely on ADMIN_TOKEN.
4. Run small bounded batches with measured D1 reads/writes, explicit rollback
   procedure and read-only post-audit, while stopping on systemic errors.
5. Keep R2 deletion disabled until full-object reference ownership and
   checksum checks are separately reviewed.

## Original one-click preflight (superseded October 12)
The original manual `production-storage-selective-preview.yml` action was
read-only and attempted at most 250 pages of 25 snapshot rows per family,
with 20-minute and 1,000,000-row D1 read caps. It suppressed private IDs and
cursor content in public logs. That larger scan is now replaced by the
single-page cost diagnostic described below. Neither a partial preview nor
the new diagnostic is a whole-database savings forecast.

An actual production preview also checks R2 HEAD existence, positive object
length and matching content-hash/source-type metadata. A missing object or
metadata conflict quarantines that source. R2 transport errors abort the
preview; they must not be treated as evidence that a file is bad.

## Verified limitations before any deletion
- A source with missing representation may have **no surviving direct row** in
  the affected entity timeline. An eligible-looking adjacent A-A pair can
  therefore conceal a missing A-B-A fact. The read-only preview treats
  incomplete **visible** sources as barriers, but cannot prove that **invisible
  missing** intermediate source facts are irrelevant. Its count is only a
  preliminary upper bound, **never permission to delete**.
- Before execute mode, cross-check candidate entity/family histories against
  the original versioned R2 facts (actual bytes+SHA, not just HEAD metadata);
  either prove there is no intervening unrepresented original fact or
  quarantine the **entire affected timeline segment**.
- Preview HEAD metadata existence/provenance is intentionally weaker than the
  byte-level fact/hash proof required for deletion.
- Current read-only preview lacks a durable full-coverage checkpoint; completion
  is only certified if the workflow reports all four families fully scanned.
  An unfinished sample cannot predict total cleanup size.
- A verified R2 object can still contain conflicting original data; preserving
  that ambiguity is mandatory. Any database or R2 transport ambiguity is a
  system-level stop and must not be recoded as a quarantinable file error.

## October 12 read-budget diagnostic

The first production selective preview (run 38258157427) safely stopped after
exceeding the 1,000,000 D1 rows-read budget. No facts were changed; ephemeral
credentials were removed and exact-deployment health passed. The old script did
not emit candidate totals before this stop, so its results cannot support a
storage savings estimate.

The next manually dispatched workflow is intentionally **diagnostic only**:
at most one page of 25 rows per family, 100,000 cumulative reported D1 rows
read, and five minutes of scanning. It reports aggregate per-page D1 reads
and R2 HEAD request counts immediately. The final summary is allowed to be
partial. Do not equate a successful diagnostic run with completion of the
four-family inventory, and do not authorize deletion from this diagnostic.
The D1 row-read budget is checked after each API response (a single response
can exceed the remaining global budget), with the existing per-operation
cost safety also in force. Even when the Worker cost safety stops a request,
its validated aggregate query-cost breakdown is logged before aborting.

Investigate the measured query hotspot before any larger scan. No execute
routes, backup, restoration or historical recovery behavior changes.
