### Raw reference planning is bounded even for highly shared objects

A key shared by hundreds of thousands of source records must not trigger a
global COUNT. The planner now uses two covering raw-key index samples,
each capped at 26 rows; `legacyReferences`/`canonicalReferences` in the
dry-run report are **lower bounds** whenever `referenceCountsTruncated`
is true, not invented exact totals. Physical R2 deletion is disabled, so a
truncated count is not used to authorize object deletion. The rewrite still
returns at most 25 source IDs per batch; reference conflicts are rejected.
The number of references therefore increases pages rather than per-request
reads. The worker retains D1's actual cost safety stop as final authority.

## Pre-production D1/R2 consistency and revision hardening

Physical deletion of legacy R2 objects is **deferred**. D1 and R2 do not
share an atomic transaction. The cleanup executor now verifies/copies the
canonical object and completes guarded source-reference normalization plus
audit/session revision rebase in **one D1 transaction**. Legacy R2 objects
remain available even when no references remain. No R2 byte savings are
claimed; a separately reviewed, reference-fenced garbage collector is
required before any R2 objects may be physically removed.

All relevant revision triggers now increment the global singleton only
while at least one current, unexpired audit proof is at the current revision.
The first mutation invalidates all such proofs; additional imports into the
already-invalidated dataset avoid repeated hot-row revision writes. A single
guarded cleanup batch moves the revision once and rebases only its session
before committing. Unknown external writes cannot enter a distinct D1
transaction midway through this operation.

# Storage cleanup cost-safety audit

## Verified baseline and incident evidence

The investigated baseline is production release commit
`b0a847dcf070b72f9e68c5bd303675c5090536f7`; it contains PR #300 merge
`2c64f8303ac4393fdc0e478fb3a38365be9ff78c`. Production cleanup run #13
failed closed before planning with 436,499 D1 rows read and zero writes. Its
`horse_profile` breakdown was 173,941 representation reads, 232 observation
reads and 262,326 direct-timeline reads. The temporary cleanup credential was
removed and the following health check passed.

PR #297 replaced a global representation `UNION` and added access indexes, but
kept global observation/timeline scans and did not prove later planning stages.
PR #299 only recovered the timed-out multi-index migration by splitting it; it
did not change runtime reads. PR #300 changed the representation aggregate to
correlated per-source lookups. That reduced the first failure from 582,304 to
436,499 reads, but its work still grew with all completed sources and all their
representations, while the direct timeline remained a full-history scan.

## Root-cause matrix

| Operation | Previous SQL/access pattern | Previous scaling and evidence | Bounded correction |
| --- | --- | --- | --- |
| Representation/direct, all four families | For every completed sync source, correlated `COUNT(*)` through a source index | Grows with completed sources plus their snapshots; one source can still make one request unbounded. `horse_profile` used 173,941 reads in run #13. | Keyset-stream direct rows by `(source_record_id,id)`, at most 5,000 rows per request, into per-audit source counts. |
| Representation/observation, all four families | Correlated observation count plus snapshot anti-join per completed source | Same ceiling as direct counts and repeats snapshot lookups. | Keyset-stream the family/source observation index in 5,000-row pages; exclude the source-owned snapshot exactly as before and accumulate counts. |
| Representation comparison | Global aggregate or correlated lookup over all history | PR #297 scaled with all representations; PR #300 scaled with all sources and representations. | Compare at most 5,000 completed sync rows per page against persisted audit counts. Missing/excess counts remain exact. |
| Observation integrity, all four families | One family-wide left join to snapshot and source tables | Linear full-family scan. Current profile happened to cost only 232 reads, but growth was unbounded. | Keyset pages of 5,000 observations using `(snapshot_family,source_record_id,entity_key,scope_key,...)`; preserve dangling, identity and `julianday` timestamp checks. |
| Direct timeline, all four families | Full snapshot-table scan, source PK join and `julianday` comparison | Linear full-history scan; `horse_profile` cost 262,326 reads in run #13. The function is a comparison cost, not an indexable filter. | Keyset pages of 5,000 snapshot IDs; perform the same source-existence and `julianday` equality checks within each page. |
| Operational batches | Full grouped scan plus a second full scan and raw-reference anti-join | Grows with all cleanup history. | Keyset pages of 5,000 batch IDs; count started and stranded raw batches incrementally. |
| Operational sessions | Full grouped scan | Grows with all session history; informational statuses were not an authorization invariant. | Keyset pages of 5,000 session IDs. |
| Snapshot planning, all four families | Join from completed sync rows, then global `ORDER BY`; SQLite reported `USE TEMP B-TREE FOR ORDER BY` | Can read/sort the full family to return 26 rows, so it was a hidden next failure after the audit. Filtering before `LIMIT` would also remain unbounded across a long run of failed-source snapshots. | Page at most 26 rows directly from a family-specific order index, perform one covering complete-source lookup per row, and ignore failed-source facts in the dedupe state while still advancing the cursor. `EXPLAIN QUERY PLAN` has no temp sort. |
| Raw-object planning | `(source_type,content_hash,id)` keyset scan, then indexed two-key reference count and a 25-reference fetch | Bounded by 26 candidate rows and 25 rewrites. The reference count scales only with the selected legacy/canonical keys. | Retained; now planning is gated by a complete, current audit proof. |
| Plan/execute authorization | Authentication protected routes, but plan/execute did not require the persisted audit/session proof | A caller with cleanup auth could reach planning or execution without proving that the current dataset passed audit. | Every plan requires a completed audit proof; every execute additionally requires a running source-bound session whose audit revision is current. |

## Architecture and consistency boundary

Migration `0057` adds resumable audit runs, per-target progress, accumulated
source counts and a monotonic dataset revision. Migration `0067` closes the
proof boundary over every D1 table that can change representation, provenance,
planning or operational-integrity results: source records, all four snapshot
tables, observations, source sync and cleanup batches. A running audit captures
that revision. Every page application and final transition verifies the same
revision; any unrelated mutation makes the run stale.

Each page now has an immutable UUID and monotonic target version. The page read
is cost-observed without changing proof state. Its receipt, source-count delta
and cursor/counters are then written in one `env.DB.batch()` guarded by the
expected cursor, page version and dataset revision. Cloudflare documents D1
batched statements as transactions that execute sequentially and roll back the
entire sequence on failure:
https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
The receipt remains `pending` until the combined read-and-commit cost is known.
Only cost acceptance clears the pending marker and can finalize the run. A
crash with an ambiguous pending receipt fails the audit closed on its next use.
Concurrent/replayed pages either win the unique version once or apply nothing.

An audit has 22 deterministic targets: five checks for each of the four
families plus bounded batch/session checks. Progress is idempotent, keyset
based, expires after 24 hours and allows at most 48 explicitly resumed workflow
runs. A `complete` audit means every target finished at one unchanged revision
and every anomaly count is zero. A failed, stale, expired, exhausted or merely
running audit cannot authorize planning. Execute binding additionally records
the exact audit run and revision on the cleanup session.

The workflow still enforces 250,000 reads/25,000 writes/45 seconds per request
and 1,000,000 reads/100,000 writes per workflow run. Per-continuation measured
cost is persisted with the audit. Before another page, the backend reserves a
full per-operation allowance; if that could exceed the workflow ceiling it
leaves the audit running and requires an explicit continuation, which resets
only the continuation counters. A page that trips read, write, duration or
cumulative settlement is rejected and the persisted run cannot authorize
cleanup. No threshold was raised.

## Mutation-to-revision matrix

| Mutation path/table | Integrity or plan impact | Revision action | Authorized cleanup handling |
| --- | --- | --- | --- |
| Raw capture / `source_records` insert | Adds provenance and possibly a raw-object candidate | Insert trigger advances the fence immediately, even without official sync | Not a cleanup mutation; old audits become stale. |
| `source_records.raw_object_key` or other source update/delete | Changes raw references, source timestamps or provenance joins | Update/delete trigger advances the fence | Raw executor starts with an in-transaction authorization guard; a verified completed rewrite rebases only its bound audit/session. |
| Four snapshot tables insert/update/delete | Changes representation, timeline and snapshot plan state | Per-row trigger advances the fence, including partial imports | Snapshot cleanup is one guarded D1 transaction and rebases only after observations, deletion and batch completion all succeed. |
| `official_snapshot_observations` insert/update/delete | Changes representation and observation integrity | Per-row trigger advances the fence | Authorized rewiring occurs inside the same guarded snapshot transaction. |
| `official_snapshot_source_sync` insert/update/delete | Changes expected counts and completed-source eligibility | Existing 0057 triggers advance the fence | Cleanup never edits sync facts. |
| `storage_cleanup_batches` insert/update/delete | Changes started/stranded operational integrity | Trigger advances the fence | Completed snapshot batches rebase atomically. Raw multi-phase work rebases only at a verified safe checkpoint; an interrupted final rewrite remains stale and visible. |
| Audit/session bookkeeping | Changes proof state, not racing/provenance facts | Does not advance the dataset fence | Receipt/version/status guards control this lineage directly. |
| R2 object copy/delete | Physical storage state; D1 references determine plan eligibility | No independent D1 revision is possible | Body/hash/metadata are reverified; D1 guard surrounds reference changes, and a failed final delete cannot rebase an authorization proof. |

The executor guard is the first statement in its mutation batch. It checks the
current global revision, exact completed audit, running session and persisted
session/audit binding. Trigger-driven revision changes from the authorized
batch are then rebased to that one audit/session only after the operation has
reached a verified safe state. A concurrent import changes the expected
revision and aborts the whole mutation batch.

## Bounded-access inventory

These are logical access bounds, not claims about D1's provider-specific
`rows_read` multiplier. Every audit target uses a 5,000-row keyset page.

| Target | Driving index | Logical work per request |
| --- | --- | --- |
| Direct representation stream | `idx_cleanup_<family>_source_page` | At most 5,000 snapshot rows for the boundary plus the same bounded range for grouped accumulation. |
| Observation representation stream | `idx_cleanup_observation_source_page` | At most 5,000 observations, with at most one snapshot-PK anti-lookup per row. |
| Source-count comparison | `idx_official_snapshot_source_sync_status_source` and audit-count PK | At most 5,000 completed sources and one accumulated-count lookup each. |
| Observation integrity | `idx_cleanup_observation_source_page` beginning with family/source/entity/scope | At most 5,000 observations from the selected family and one snapshot/source lookup each; unrelated-family prefixes are not scanned. |
| Direct timeline integrity | Snapshot table PK | At most 5,000 snapshots and one source lookup each. |
| Operational batches/sessions | Each table PK | At most 5,000 metadata rows; raw stranded-state lookup occurs only for rows in that page. |
| Snapshot planning | `idx_cleanup_<family>_order` plus `idx_official_snapshot_source_sync_status_source` | At most 26 indexed snapshot rows and 26 covering sync lookups, including arbitrarily long failed-source prefixes across separate pages. |
| Raw-object planning | Existing `(source_type,content_hash,id)` and raw-key indexes | At most 26 candidates, a two-key reference count, and at most 25 reference IDs. |

History growth increases the number of resumable pages, never the logical size
of one request. The workflow's unchanged one-million-read cumulative breaker
limits how many pages one invocation may consume; unfinished audit state then
requires an explicit later invocation and cannot authorize planning.

## Query-plan and synthetic evidence

Before the planning fix, all four snapshot families produced the pattern:

```text
SEARCH source_sync USING ... (status=?)
SEARCH snapshot USING ... (source_record_id=?)
USE TEMP B-TREE FOR ORDER BY
```

Afterward each family produces an order-index scan plus a point sync lookup,
with no temp B-tree:

```text
SCAN snapshot USING INDEX idx_cleanup_<family>_order
SEARCH source_sync EXISTS USING COVERING INDEX
  idx_official_snapshot_source_sync_status_source (status=? AND source_record_id=?)
```

The family-selectivity regression adds 50,000 observations in one family,
100,000 in another, one in a sparse family and none in the fourth. SQLite uses
`idx_cleanup_observation_source_page` with `snapshot_family=?` and a composite
cursor and reports no temporary sort. It verifies limits 4,999/5,000/5,001,
repeated reads, identical source IDs with distinct entity/scope keys and exact
multi-page identity coverage.

The main scale regression creates only synthetic data: 50,000 rows in each snapshot
family plus 50,000 repeated observation-backed representations (250,000 stored
representations total), distributed across 2,500 non-empty completed sources.
It also includes 25 completed zero-count sources and 25 failed sync sources.
The complete audit performs 510,100 logical row checks in exactly 122 resumable
steps. No page checks more than 5,000 source rows. Adversarial tests inject a
failure after a source-count statement but before progress, race two commits,
replay the same page, change revision between read and commit, and leave a
post-commit receipt unsettled. The D1 transaction either rolls back every
change or commits exactly one pending receipt; only accepted receipts can
finish a proof. Separate tests verify stale invalidation across raw capture,
source reference, snapshot, observation and cleanup-batch mutations.

Local SQLite cannot reproduce Cloudflare D1's provider `rows_read` accounting.
The tests therefore prove bounded access plans and hard logical page sizes,
while production continues to use D1's actual per-request metadata and the
cumulative circuit breaker. The remaining uncertainty is the exact D1
amplification factor for index probes and joins. The smallest safe production
verification is one separately approved, non-destructive dry-run after merge
and release; it is verification of bounded pages, not an experiment against an
unbounded query.
