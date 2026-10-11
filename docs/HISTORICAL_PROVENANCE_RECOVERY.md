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
Neither key/flag is provisioned by a merge or deployment. The separate,
explicitly approved manual `execute` GitHub workflow temporarily provisions
them only after a private verified backup and can then use the gated private
`/restoration/run/apply-step` route. No autonomous schedule is created.

## One-build source-inventory and recovery runner (PR #315)

Migration \`0068_historical_source_provenance_recovery.sql\` introduces private
source-by-source recovery runs, receipts and a versioned D1 epoch. SQLite
triggers fence concurrent changes to official source records, source syncs,
all four snapshot families, observations and official external ID mappings
while a run is active. No additional ongoing trigger writes occur when
recovery is not active.

The recovery interface is private and requires the short-lived cleanup
credential. \`/v1/storage-cleanup/restoration/run/start\`, \`scan-step\`,
\`status\` and \`post-audit-step\` persist bounded progress. It examines
**every source/family with a count deficit**, not just the four original
samples. For each affected source, the live reader recalculates the source
representation count using the current indexed D1 rows rather than a
stale failed-audit ledger, SHA-verifies source originals, checks older
independently verified originals where available, and records eligible and
quarantined counts **in private D1 only**.

A source is quarantined if its SHA-verified original yields either **fewer or
more unique facts** than the completed historical source-sync count.
Eligible candidates must also never exceed the independently measured
representation shortfall; neither mismatch is silently repaired by
changing historical source counts.

Only separately approved \`apply-step\` can add source-owned facts. It
checks the live facts again, revalidates current source hashes and identity,
refuses missing/changed private backups, and atomically checkpoints each
successful fact insertion and associated revision. A lost HTTP response
therefore does not cause silent duplicate writes or missed progress.
\`post-audit-step\` performs a new independent bounded source-count audit
across all four families, reporting a clean finish only if no count
deficits or excesses remain. Otherwise it finishes with an explicit
\`complete_with_quarantine\` status and the remaining counts.

The GitHub Actions workflow
\`.github/workflows/production-historical-recovery.yml\` can run this
from two manually selected modes:

- \`inventory\`: read-only as to existing horse/racing facts, persists only
  private progress/receipt rows, and automatically resumes in small bounded
  intervals. It never enables repair capabilities.
- \`execute\`: requires typed \`RESTORE_VERIFIED_SNAPSHOTS_ONLY\` confirmation,
  a previously completed matching inventory, and creates a complete
  **Cloudflare-only** D1 SQL export to private R2 before any fact writes.
  The Worker itself polls Cloudflare's D1 export REST API and streams the
  signed SQL dump directly into Cloudflare R2; GitHub never downloads it.
  The private backup's source bookmark, R2 ETag and size are verified and
  kept in private D1. Ephemeral restoration capability secrets are only
  installed after backup verification and are removed on all exit paths.
  Production execution is off until explicitly enabled by the manual
  approved workflow.

The same GitHub workflow self-dispatches bounded continuations; it is
not an automatic background cron. Every continuation verifies exact
deployed release SHA, full QA, private auth and final Worker health. Failed
budget/proof/epoch checks stop the chain rather than skipping forward.
No real source IDs, original payloads, hashes, R2 keys, paid sources or
full database dumps are exposed to public logs or CI artifacts.

This build does not add any blanket date-based UPDATE, destructive cleanup,
table replacement, automatic backfill, or AI/model-weight adjustment.

## Backup verification and limitations (2026-10-11 follow-up)

Cloudflare's documented D1 export protocol has a nested completion payload:
`result.status == "complete"` and `result.result.signed_url`. A polling
bookmark on its own is **not** a finished backup. The Worker now requires
the completed status, the **same** export bookmark, a restricted HTTPS
signed URL, a declared download Content-Length between 1 KiB and 5 GiB
(the R2 single-PUT limit), and a private R2 HEAD confirming exactly that
size, ETag and run/bookmark metadata. Pending, errored, inconsistent,
incomplete-length or length-mismatched responses **fail closed**.
No backup bytes, signed URLs, source IDs or SQL are returned to GitHub.

A recovery write capability now also has a separate short expiry. GitHub
Actions provisions it for at most 20 minutes per execution interval and
deletes it on cleanup; **both** the private route and the underlying SQL
write primitive reject missing or expired permission, including after a
cancelled or crashed workflow.

CI tests use *synthetic Cloudflare responses* matching the vendor's nested
API, error/pending/truncated downloads and a test-only SQL dump successfully
re-imported into an isolated in-memory SQLite database. These are
implementation tests, **not an actual Cloudflare production backup or an
independent restore drill using a real private export**. Only a separately
approved private operational rehearsal can establish real-world
restoreability. The export operation can temporarily interrupt D1 queries
while in progress; it must not run as a hidden read-only check or without
explicit production approval. A database larger than the bounded single-PUT
limit is deliberately unsupported and must stop without enabling repairs.

## Production approval and completion contract

The PR **must not be merged or deployed without explicit user approval**.
No source-restoration production run is initiated by merging this PR.
A separate explicit production execution approval is necessary after a
successful source inventory and before backup/restore operations.

"Complete" means the independent post-repair audit's four-family **logical
count** deficits and excesses equal zero. It is not a claim that every
legacy as-of chronology, historical external-ID mapping or raw-original
conflict was recoverable. Such cases must remain quarantined, with exact
aggregated counts and no invented facts. Any discrepancy after the
post-audit means \`complete_with_quarantine\` rather than success.
