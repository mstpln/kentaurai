# Legacy AI/editorial cleanup — first stage (2026-11-08)

## User-approved target, not a blanket deletion approval for shared rows

The modern TravData product should no longer retain obsolete private AI analyses,
probability/ranking runs, AI-built system drafts, interview/editorial signals,
old analysis packs, and related legacy learning/replay records solely for their
own sake. Keep complete official racing history and sources, X-Labs telemetry,
market snapshots, results, and user-created horse notes and registered systems.

**Do not assume every row in a legacy-labeled table is disposable.** In
particular `systems` and `system_selections` can contain user-registered
systems as well as legacy generated artifacts. They are protected until
provenance/ownership and every dependent link can be resolved, including
post-race outcomes. Preserve game-round final results and the current
`travdata_manual_systems`/`travdata_horse_notes` content.

## This PR: inventory only

The new manual workflow `production-legacy-data-inventory.yml` performs
read-only aggregate counts in the private production D1 using the existing
credential and bounded query client. It does **not** inspect R2, fetch private
records, run migrations, deploy, create/delete secrets, create a backup, or
delete records. GitHub logs show only table names, counts and read-cost
metadata. Source IDs, article content, horse data and object keys remain private.

The inventory separates:

- Candidate legacy areas: editorial items/signals, external horse statistics,
  legacy AI predictions, v3 decision/optimizer runs, external AI exports,
  replay/forecast evidence and AI-specific post-race/learning records.
- Manual decision areas: `reference_round_exports`,
  `reference_observations`, `model_versions`, `post_race_reviews`.
- Protected user assets: `systems`, `system_selections`,
  `travdata_manual_systems`, `travdata_horse_notes`.
- Protected racing/reference data: official records, verified snapshots,
  event history, statistics/features, provenance and X-Labs.

Rows in candidate tables are **not automatically deletion-safe**. Shared
`source_records` and raw R2 objects are NEVER purge targets in this phase;
some raw records can support both retained official data and old reference
exports. Deleting a source record may destroy required provenance.

## Required gates before deletion

1. Execute the read-only inventory from an independently approved main.
2. Confirm actual table counts, column dependencies, foreign keys, triggers
   and current application readers/writers. Invalidate or retire only unused
   legacy import routes, respecting deployed legacy compatibility and tests.
3. Identify every user-created or registered legacy system and protect its
   selections, corresponding review, and results even if associated with an
   old AI run. Unknown ownership => quarantine, never delete.
4. Obtain and independently verify a **private full production D1 backup**
   in Cloudflare R2 and a separate recoverable backup of any R2 objects
   selected later. The historical-provenance repair and cleanup constraints
   remain in force.
5. Build a distinct, bounded, idempotent, revision-fenced deletion workflow
   with a zero-write dry-run, dependency/membership checks, expected row
   counts, source invariants, and exact post-deletion verification.
6. Run complete CI and exact-head review. Obtain explicit approval for merge
   and a separate production execution gate. Stop if any required proof fails.

No deletion is performed, scheduled, or authorized by the new inventory
workflow. Do **not** reuse the historic generic snapshot cleanup executor for
this obsolete AI/editorial data cleanup: it targets different tables and a
prior production execution lost source representations.

## Read-only production inventory evidence — 2026-11-08

The operator manually ran inventory on deployed main f688bcf7ead9e3ff257ee73e91b188416a5547fd,
GitHub Actions run 42512133295 (success). SQL read 4,140 rows, wrote zero.

| Area | D1 rows |
|---|---:|
| Editorial items | 268 |
| Editorial structured signals | 1,137 |
| Manually imported external horse-stat snapshots | 1,674 |
| Old AI race analyses | 48 |
| Old AI horse predictions | 546 |
| Old external analysis exports | 8 |
| External registered analysis runs | 3 |
| External post-race reviews | 24 |
| External post-race learning links | 8 |
| Learning hypotheses | 4 |
| Learning observations | 8 |
| **All candidate categories** | **3,728** |

Other legacy workflow and replay candidate tables were empty. Protected
\`systems\` contained **9** rows and \`system_selections\` **208**.
\`travdata_manual_systems\` and \`travdata_horse_notes\` were both **0 in D1 at
inventory time**; client-local personal data is NOT thereby proven absent.
\`post_race_reviews\` contained 72 and reference-round tables had 1 export and
116 observations. All these ambiguous/protected rows remain untouched.

**Critical new finding:** \`src/routes/games.js\` resolves a historical round's
primary saved system through \`analysis_external_runs.main_system_id\` before
falling back to the \`systems\` table. Deleting linked external analysis rows
without separately verifying fallback/UI behavior can change displayed saved
system history even if the selections are still present. Consequently the 3
external runs, 24 external reviews, 8 links and all model/learning references
are excluded from the **first** potential delete set.

## Next build: dependency preflight and backup-only tool

A second, separate read-only dependency report evaluates only six narrower
potential first-stage tables: 3,681 rows at the prior snapshot (actual counts
must be re-read before deletion). It reports official source and personal
system counts, legacy link overlap, reference-round overlap, and orphan
indicators. The report is **not** a row-deletion proof, cannot see dynamic
JSON consumer references, and contains no write action. If an orphan exists,
pause and investigate rather than deleting blindly.

The backup-only Cloudflare route:
- Requires a **dedicated** temporary `LEGACY_BACKUP_TOKEN` credential **and**
  a separate `LEGACY_BACKUP_ENABLED` switch. Neither `ADMIN_TOKEN` nor
  `STORAGE_CLEANUP_TOKEN` can authorize backup endpoints; the backup token
  cannot authorize legacy cleanup, provenance restoration or other routes.
- Uses Cloudflare D1 export polling; **the SQL body is streamed from Cloudflare
  directly to private Cloudflare R2**, never GitHub, ChatGPT or a user device.
- Stores in-progress export bookmark and progress **only in private R2**,
  without querying locked D1. Only after a completed Cloudflare export,
  it stores a separate immutable receipt in `legacy_cleanup_backups`,
  binding bookmark, private R2 key/size/ETag and the deployed commit.
  A temporarily unavailable D1 after export completion can be retried
  without downloading or duplicating the private SQL file.
- Verifies Cloudflare-signed HTTPS URL host, content type, expected byte length,
  object metadata and R2 HEAD; mismatches stop without marking verified.
- Does not delete data, restore databases, enable cleanup, modify official
  racing facts, or schedule a task.
- Has an explicit manual GitHub Actions typed \`BACKUP_D1_ONLY\` approval,
  serial production-operation lock, full QA and exact deployment validation.
  Short-lived secrets are removed even if backup fails.

**Limit:** A single R2 PUT currently refuses a SQL export larger than 5 GiB.
This is fail-closed, not proof that the full production database fits. Large
exports require a separately reviewed Cloudflare-side multipart flow. A
size/ETag-verified R2 copy is NOT yet independently proven restorable in a
separate database. No destructive cleanup is authorized until that independent
recovery gate, fresh dependency counts, code reader/writer audit and exact
zero-write delete rehearsal have passed.

Only after this PR is reviewed and explicitly approved for merge/deploy can
the operator run the extended read-only inventory and separately click the
backup-only workflow. **No auto-backup or auto-delete on merge.**


**Operational caution:** Cloudflare's D1 export API can make the source
D1 unavailable for queries while a large export is in progress. Run the
manual backup outside the morning pipeline or other active processing.
The 5 GiB R2 single-PUT limit remains in force and fails closed.

## Size-first export safety gate (next scoped PR, 2026-11-08)

Before *any* manual backup begins, obtain the size of the production D1
database from the authenticated **read-only Cloudflare D1 database metadata**
endpoint (GET only; no SELECT, export or database lock). The existing
read-only legacy inventory also reports this size.

The current single-PUT backup is **refused before temporary backup secrets
are installed** when D1's database file size is **4 GiB or larger**. This
is an intentionally conservative operational gate below R2's hard 5 GiB
single-upload limit. Because a SQL dump may be larger than its backing D1
database file, passing this metadata gate is *not* proof that the final
SQL export fits in R2. The existing SQL content-length and R2 receipt guards
remain active and fail closed.

If metadata is missing, unverified or oversized, do **not** run a full
D1 export, retry with different credentials, bypass the gate, or attempt
a partial delete. First design and independently review a private,
resumable **multipart** export with verified recovery, or use a separately
validated equivalent backup method. A snapshot or Time Travel bookmark
alone is not an independently verified off-database archive.

The size gate does not change application facts, registered systems,
personal notes, X-Labs data or source provenance. No automatic backup or
deletion is introduced. The safe inventory and manual backup still require
separate operator actions; no live data was altered while adding this gate.

## Large D1 backup: private multipart design (2026-11-08, review required)

Read-only production inventory run 42515861630, pinned to deployed main
1d10401721a1b3df84bcd474976b253cd523be3e, measured the D1 source at
5,711,183,872 bytes (5.32 GiB). This exceeds the 5-GiB R2 single-PUT
limit and the earlier 4-GiB safety guard. No large export has yet occurred.

The verified aggregate data scope remains: 3,728 candidate legacy rows, 3,681
first-stage potential rows, 9 protected systems and 208 selections. Three saved
systems have registered analysis links; 24 external and 72 legacy reviews
reference systems. Six editorial and eight AI race analysis records overlap
the protected reference context. No direct orphans were found in five checks,
but application-level links and source provenance are not thereby cleared.

The new private multipart backup is separate from the small-backup workflow:
- New dedicated LEGACY_MULTIPART_BACKUP_TOKEN and independent enable switch;
  old admin, cleanup and single-backup credentials cannot access it.
- A manually approved GitHub workflow, strict deployed-SHA validation,
  full QA, production-operation lock, and temporary credential removal.
  resume_only is the default; a new export requires explicit start_or_resume.
- Cloudflare D1 polling export with a fixed bookmark. It may pause D1 queries:
  only run in a quiet window; abandoned exports may be cancelled.
- In-progress state and temporary signed download URLs stay inside private R2.
  No SQL, URL or R2 object key is logged or returned to GitHub.
- Each large D1 signed URL must accept an exact 206 HTTP byte-range probe.
  D1's public export documentation does NOT explicitly guarantee this.
  Non-206 responses and missing or changed source ETags stop safely.
- Fixed 16 MiB R2 multipart chunks. Every chunk has exact source byte range,
  SHA-256 digest and R2 uploaded-part ETag recorded privately. Last chunk may
  be shorter, all other chunks meet the 5 MiB R2 minimum.
- Maximum source D1 metadata size 32 GiB; maximum SQL export size 64 GiB;
  no more than 4,096 chunks. Buffers are bounded below 128 MiB Worker memory.
- On ambiguous part upload, the same part number may be retried. An explicit
  resumed run can request a refreshed signed URL only if bookmark and original
  URL object path match; otherwise the operation blocks.
- R2 completed-object size, metadata and ETag are verified before recording a
  completed D1 backup receipt, only AFTER D1 finishes exporting. If D1 receipt
  fails, resume without uploading raw SQL again.
- The original small backup continues to fail closed above its 4-GiB guard.

Limits: Cloudflare signed export URL is available for one hour. Incomplete
R2 multipart uploads normally expire after seven days. An uncertain export
start, changed signed-source identity or ambiguous creation must be reviewed.
A completed R2 upload and D1 receipt are NOT proof that the archive can be
restored in a separate database. Before any destructive cleanup, a separate
private **independent restore verification** must validate source facts,
schema, provenance, protected systems and linked reference data.

No production backup, restore, DELETE, migration, cleanup or automatically
scheduled export is performed by this PR. Explicit approval for merge/deploy
is separate from approval to start a potentially disruptive D1 export.

## 2026-11-08 failed manual multipart start: inspect state before retry

GitHub Actions run 42518434915, on deployed main
c8e5469eb771a2a4ad693af080c4a4a1283c4b67, failed at the first
multipart start request with a generic private Worker HTTP 409. Full QA,
source D1 size, ephemeral authorization/cleanup and Worker health passed.

This 409 was generated by the Worker's generic catch clause. It is not
proof of a Cloudflare 409 or an R2 conflict. It is unknown whether the
private starting marker exists, or whether D1 export POST began before
the failure. No completed backup is verified. Do not blindly rerun export,
reset the private control object or remove unfinished R2 multipart uploads.

The new separately approved GET-only diagnostic scope reads only private R2
state and reports: state enum, whether the marker exists, deployment match,
bookmark presence, uncertain export-start state, and uploaded-part count.
No source IDs, SQL, signed URLs, R2 object keys, paid editorial data or
Cloudflare response bodies leave the Worker. The diagnostic never queries
D1, starts/polls an export, changes R2 or enables deletion. A new deployment
can inspect an old marker even if its source SHA differs, without resuming
the prior operation.

Future start errors now return an allowlisted stage and safe HTTP status
category. Cloudflare D1 export requires D1 Write API permission because
export can lock D1; missing scope is a hypothesis, not a confirmed cause.
Independent private restore verification remains mandatory before cleanup.

## 2026-11-08 read-only inspection and safe GitHub error visibility

- The owner-triggered, GET-only diagnostic run 42520399131 succeeded on the exact deployed release.
  It found no private multipart progress marker, no bookmark and zero uploaded parts.
  This shows no persisted reservation and no completed backup; it does not independently
  prove why the original start failed, or certify that a full D1 backup exists.
- The backup implementation persists a private R2 `starting` marker *before* the D1 export POST.
  Missing progress is consistent with a failure during binding/state/metadata checks
  or marker reservation rather than a recorded in-progress export. Do not attribute
  the original HTTP 409 to missing D1 Write permission without stage evidence.
- PR-only safety fix: on a future explicitly authorized first start, the GitHub runner
  may display two pre-allowlisted Worker enums (failure stage and reason) for the multipart
  start HTTP 409. Raw response bodies and unknown fields are always discarded. No 409
  retry, full backup start, R2 state reset, restoration or deletion is authorized by this change.
- The source D1 SQL export can interrupt production queries. A new export attempt requires
  separate explicit owner approval after release review; a successful upload still needs
  an independent private restore verification before any legacy cleanup.
