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


## Historical predecessor hints (new bounded follow-up)

The private sample now performs **at most 24 additional read-only SELECTs**
against direct predecessor snapshots for facts already classified as missing
with today's one-to-one mapping. It checks the nearest **strictly earlier**
direct snapshot in the same entity, family and exact scope (including record
year and ordinal). It then compares every factual field of that predecessor
against the source fact, distinguishing:

- \`earlierCompletedSourceSameFacts\`: nearest earlier direct row has matching
  facts and an official completed-sync source record.
- \`earlierCompletedSourceDifferentFacts\`: that row has different facts.
- \`earlierUnconfirmedSource\`: nearest earlier row exists but the source/sync
  provenance or snapshot quality is not confirmed.
- \`noEarlierDirect\`: no earlier direct row in this index for the **current**
  canonical mapping.
- \`deferred\`: facts not examined due to 24-hint or 40-query hard caps.

These counts are hints for choosing which import/history failure to inspect,
**not confirmation** that the missing representation is an observation rather
than a snapshot. The predecessor's original R2 bytes are not rehashed in this
follow-up, and the lookup does not reconstruct indirect observation events or
historical identity mappings. Both historical-identity and full-chronology
proofs remain false, and no repair is authorized. The endpoint's returned
report remains aggregate-only: no record IDs, horses, raw values or keys.
The same request-level D1 budget and final dataset-revision fence apply.


## Older verified raw source evidence — limited follow-up

For each of the at most 24 missing-fact predecessor hints, the Worker may
also inspect the immutable R2 original for the predecessor's own source.
It reads at most **four distinct predecessor source objects** plus the
current source (five R2 object reads total), with a combined **8 MiB
per request**. D1 remains limited to 40 SELECTs and its existing row
budgets. Missing/oversized originals and exhausted budgets are reported
separately, never interpreted as factual absence.

The source original is SHA-256 checked and parsed using the same official
fact parser as the current source. Identity is matched by *external source
ID, person type and exact scope* (including record year and ordinal), and
all comparable factual columns must equal the older direct snapshot.
Aggregate-only counters distinguish verified older-original facts,
older-original factual contradictions, unverified originals, skipped
read-budget cases and independently hash-verified distinct older originals.

**This does not prove that the historical canonical identity mapping was
unchanged**, that an older snapshot was present in D1 as of the later
source's original observation timestamp, or that no intervening
observation changed its effective as-of value. The output retains
\`historicalIdentityVerified=false\`,
\`completeChronologyVerified=false\` and \`repairAuthorized=false\`.
No historical recovery writes are enabled.

The manual GitHub Actions workflow retries only HTTP 401 for a maximum of
12 requests with short delay to tolerate eventual propagation of a freshly
created temporary Cloudflare credential. Any other non-200 status fails
immediately. Tokens, payloads and raw error responses are not logged.

## Safety and budgets

Each endpoint invocation is bounded to one R2 original (at most **8 MiB**),
a maximum 512 parsed facts, 1,024 source-owned direct rows, 1,024 observations,
1,024 referenced snapshots, 24 predecessor hints and 40 SELECTs. D1 reads are capped at 250,000
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
