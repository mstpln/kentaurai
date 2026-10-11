# Historical snapshot reconciliation — read-only production preview

The completed integrity audit #42 reported **43,613 missing logical source
representations** in 13,473 source/family comparisons, not a verified count
of uniquely lost racing facts. The independently verified original-data
sample established 13/13 intact R2 originals. Neither result authorized
restoration.

## What the new PR implements

1. A deterministic classifier for four official snapshot families:
   \`horse_profile\`, \`horse_stat\`, \`horse_record\`, \`person_stat\`.
2. An authenticated read-only endpoint:
   \`GET /v1/storage-cleanup/reconciliation/page?family=horse_profile\`
   (optional encrypted \`cursor\` query parameter).
3. A separate manual GitHub Actions workflow
   \`.github/workflows/production-storage-fact-reconciliation.yml\`.
   It will only work after a separately authorized, reviewed deployment of
   exactly the same \`main\` SHA; no workflow starts automatically.

The Worker selects at most **one source** with a deficient completed
source-sync counter from the persisted settled audit. It verifies the original
R2 object by size, SHA-256 and available source metadata; extracts real
family-level facts using the production official parser; reads source-owned
direct snapshots, source-linked observations and their referenced snapshots
from D1; then matches individual factual columns, scope, entity key and
timestamps. Nulls are compared as facts, not estimated values.

For representation counts, source-owned direct snapshots are counted once,
and a same-source observation pointing to that direct row is not double
counted. The computed representation count is compared with the persisted
audit ledger; disagreement fails closed. Factual conflicts, unknown
identity, invalid originals and ambiguous cases remain separate categories.

The cursor is AES-GCM encrypted with a key derived from the existing private
ADMIN_TOKEN. The plaintext source ID remains within the Worker; changing the
token invalidates old cursors. The cursor binds to the family, exact failed
audit ID and dataset revision. The private response contains only generic
classifications and an opaque cursor; the Actions log omits the cursor.

## Safety and budgets

Each endpoint invocation is bounded to one R2 original (at most **8 MiB**),
a maximum 512 parsed facts, 1,024 source-owned direct rows, 1,024 observations,
1,024 referenced snapshots and 40 SELECTs. D1 reads are capped at 250,000
per query and 1,000,000 per request, and any D1 writes fail closed. No
D1/R2 write/delete path exists in this stage.

The manual one-click workflow samples at most one deficient source for each
family, with a cumulative 1,000,000-D1-read/32-MiB-R2 budget and a reserve
stop before more families. It uses a short-lived cleanup-scoped Worker secret,
serializes via the production operation lock, runs full QA, verifies the exact
deployed SHA and health, and deletes the temporary secret in an \`always()\`
cleanup step. It emits only generic per-family aggregate classifications.
No source IDs, R2 keys, original payloads, hashes or private names appear in
public logs or artifacts.

A SHA match verifies the original content **at the instant it is read**, not
immutability forever. The existing dataset revision counter has coverage
limitations and is not proof that historical identity tables or R2 objects
were never modified.

## Important limits — not a repair inventory yet

The lookup of \`horse_external_ids\`, \`driver_external_ids\` and
\`trainer_external_ids\` is a **current mapping**. Those tables do not prove
what identity a legacy import used at the original observation time.
Consequently this production adapter intentionally always passes
\`historicalIdentityVerified=false\` and \`chronologyVerified=false\`.
Potentially missing facts remain **missing_unverified_chronology**, not
automatically repairable. \`missing_candidate\` is never returned from the
production adapter, even though the pure classifier supports it for a
future verified stage.

The workflow's four small samples are **not** representative estimates of
all 43,613 discrepancies. Exact historical entity matching, earlier/later
change-point timelines, source coverage, independent as-of equivalence
checks, and a durable private cross-run checkpoint still require further
work before a complete recovery inventory or any safe write can be designed.
Hash-verified originals with fewer extracted facts than a legacy source
counter are reported separately as counter discrepancies, not corrupt files.

## Next gate and permissions

Review and merge the PR only with user approval. Production release/deploy
is also separately gated. After an approved deployment, request approval for
a bounded **read-only** production preview before triggering the manual
workflow. Keep the destructive cleanup executor disabled. No historical
repair, retry, backfill or deletion may start from these findings.
