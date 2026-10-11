## Read-only original-data verification for snapshot discrepancies

The completed D1-only investigation found **43,613** missing logical
representations in 13,473 family/source pairs. An independent recount of
80 deficient source/family examples agreed with the audit counters. All
reported shortfalls were in the historical import cohort; raw-object
**references** existed but the actual R2 objects were not yet inspected.

The next safe gate is the private endpoint
\`GET /v1/storage-cleanup/raw-evidence/sample\`. This route requires existing
cleanup/admin authentication, reads the latest settled integrity-failed audit
and checks the stored revision counter (a failed audit's counter is not an
absolute guarantee against later untracked changes), incomplete proof and unsettled audit
pages. It selects at most four deficient sources per family (one without an
audit-ledger representation and three partial discrepancies), verifies R2
objects via bounded head/get, SHA-256 and source metadata, and parses their
original official facts using the production parser. It emits ONLY aggregate
counts by generic data family. No source IDs, hashes, R2 keys, horse names,
individual facts or private payloads are returned.

Maximum **16 R2 objects**, **8 MiB each**, **32 MiB total**, **12 D1 SELECTs**,
**250,000 D1 reads per query**, **1,000,000 D1 reads overall**; D1 rows
written must remain **zero**. The manual GitHub workflow
\`Verify raw snapshot evidence (read-only)\` runs the normal QA, requires the
exact current reviewed production release, uses the existing production lock,
creates and removes a short-lived cleanup-only Worker credential, and
checks health before/after. No recurring automated job is created.

Classification \`rawContainsAtLeastRecordedFacts\` is an **upper-bound
candidate**, NOT proof that mapped canonical entities or exact as-of facts
can be safely reinserted. A later repair design must compare each missing
fact to the immutable original, historically correct canonical identity,
source record and as-of timestamp. Preserve any conflicts, never fabricate
unknown raw facts, and only use idempotent narrowly scoped writes after
separate review, Time Travel backup and explicit approval. Do not run the
destructive cleanup workflow as a substitute for data repair.

No raw-data verification has yet run in production from this proposed branch.
