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
