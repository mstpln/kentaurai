# Historical snapshot source-provenance incident — 2026-10-11

## Executive finding

The completed read-only integrity audit identified **43,613 missing logical
source representations** across 13,473 mismatched source/family comparisons.
This count is **not** a count of lost distinct factual values and does not
prove that every discrepancy has one root cause.

The code used in two successful production cleanup executions on
2026-09-27 (GitHub Actions IDs 36317442527 and 36318615718) had a
source-provenance defect:

1. Repoint existing \`official_snapshot_observations\` that referenced a
   soon-to-be-deleted duplicate snapshot.
2. Delete the duplicate snapshot if nothing referenced its old ID.
3. **Never insert an observation for the deleted snapshot's own source
   record** when that source did not already have an observation.

Those two runs logged 18,717 removed direct snapshot rows in total:

| Family | Run 36317442527 | Run 36318615718 | Total removed |
|---|---:|---:|---:|
| horse_profile | 961 | 4,787 | 5,748 |
| horse_stat | 353 | 1,623 | 1,976 |
| horse_record | 954 | 4,709 | 5,663 |
| person_stat | 907 | 4,423 | 5,330 |
| **All families** | **3,175** | **15,542** | **18,717** |

The old DELETE statement could therefore erase a source-owned direct
representation even when it had no corresponding logical source observation.
A later code fix added the missing INSERT before deletion. Destructive
cleanup HTTP routes are now disabled for all credentials, including admin.

**Do not equate the 18,717 deleted rows with 18,717 proven unresolved
deficits.** Some may already have had surviving observations. Conversely,
the full 43,613 deficit is larger; silent ignored inserts or other historical
data states need independent classification. Do not extrapolate sample results.

## Independently verified source evidence

GitHub Actions run 38151111458 (release
932ebf4be4ea98846c5d56db464f94c0b96013ef) succeeded with zero
D1 writes, temporary credential removal, and production health verified.
One deficient source/family was checked for each of the four families.

- 226 individual source facts were extracted from four SHA-256-verified R2
  original files.
- 201 facts already had exact source representations in D1.
- 25 facts had no source representation.
- **All 25** had identical values in an older direct D1 snapshot **and in
  that snapshot's independently SHA-256-verified older R2 original**.
- Zero factual conflicts, zero unknown mappings under the *current* maps,
  and zero source hash conflicts were found within these samples.
- Historical mapping stability and complete as-of chronology remain
  unverified. This is a sample, not a full inventory.

## Why restoring the entire D1 database is unsafe

Cloudflare D1 Time Travel overwrites a database in place rather than
making a production-safe fork. Rewinding production to September would
discard later legitimate updates. Do not use D1 Time Travel on the live
database to repair this incident. Do not run old cleanup execute routes.

## Selective, verified, non-destructive recovery strategy

Reconstruct only an individual source's missing **direct** snapshot from
its own verified raw fact. This retains exact as-of source provenance even
when an intervening change-point is not fully reconstructable. It is safer
than guessing that the later source was an unchanged observation.

Every restore candidate must satisfy:

- Current source and older predecessor originals were both read and
  independently SHA-256 verified against private \`source_records\`.
- Original source-native entity ID, family and exact record/year/ordinal
  scope match between the two raw originals.
- Older source's verified D1 direct snapshot matches both original factual
  projections and its verified source timestamp, identity and scope.
- Today's official external-ID mapping uniquely resolves to the same
  canonical entity as that verified predecessor snapshot.
- The current source has no represented snapshot/observation for the
  intended identity/scope and still has an immutable source record.
- The chosen target snapshot ID is the original importer-compatible stable
  ID, observed exactly at the later source's archived fetch timestamp.

This PR adds a guarded, idempotent restoration primitive. For a
separately authorized recovery it INSERTs only the verified direct
source-owned snapshot; it never updates/deletes existing racing facts or
R2 files. The insertion and the D1 audit revision advance are in the same
transaction. A source with an existing identical restored row is a safe
no-op; any conflicting source or mapping is a hard stop. Synthetic tests
reproduce the 2026-09-27 bad delete and prove restoration of exact
source counts for all four snapshot families.

The new authenticated preview
\`GET /v1/storage-cleanup/restoration/preview?family=horse_profile\`
exposes aggregate-only verified candidate counts and an opaque cursor.
It has no execution method. No raw source ID, canonical ID, original value,
object key or source hash is in its response.

**Production execution is NOT enabled by this PR.** The internal guarded
executor also requires a separate explicit approval, a short-lived
\`HISTORICAL_REPAIR_TOKEN\` and \`HISTORICAL_REPAIR_ENABLED=true\`.
Neither key/flag is provisioned by this change, and no HTTP execution route
or scheduled repair task is created.

## Full recovery gates, before any production modification

1. Independently export/secure a private current-production recovery point
   in private Cloudflare storage, without exposing contents in GitHub.
2. Implement and review the cost-capped, source-by-source private recovery
   orchestration with resilient encrypted cursors, bounded per-run D1/R2
   budgets, and a durable revision-aware checkpoint. **Do not** execute
   a page and then silently reuse the stale failed-audit proof as if it
   were still current: the deliberate revision bump invalidates it.
3. Validate all 43,613 historic representation anomalies by origin, source
   native identity, immutable R2 content and as-of conflict rules.
   Quarantine missing/unverifiable originals, drifted identity mappings,
   contradictory values and all out-of-budget cases.
4. Obtain separate explicit operator approval for the reviewed,
   restore-only execution flow, including production backup and rollback.
5. Apply safe candidates in transactions, never re-enable destructive
   cleanup, preserve conflict provenance and rerun a **new** complete
   source-bound integrity audit. The acceptance criterion is zero proven
   missing representations for recoverable sources, with all exclusions
   explicitly counted, rather than an invented "all data fixed" claim.

No code in this PR automatically executes production recovery or
authorizes a merge. Keep the PR open pending exact-head CI/review and
explicit approval.
