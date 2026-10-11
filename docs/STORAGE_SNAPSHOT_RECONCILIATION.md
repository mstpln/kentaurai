# Historical snapshot fact reconciliation — foundation

This stage adds a **pure, read-only, source-bound fact classifier**. It is
intentionally not an R2/D1 production scanner, a repair plan or a write path.
The existing completed storage-cleanup integrity proof remains failed closed.

## Inputs and limits

A caller must validate an original R2 object against source metadata and
SHA-256, extract deterministic source facts with
`collectOfficialSnapshotFacts`, and query source-owned direct snapshots,
source-linked observations, their referenced snapshots, historical identity
evidence and relevant chronology using bounded read-only queries.

The classifier accepts at most 512 logical facts, 1,024 direct rows,
1,024 observations, 1,024 referenced rows and 2,048 chronological rows per
invocation. Data must be projected into the private internal structure:
`entity_key`, `scope_key`, `source_record_id`, `observed_at`, followed by
the family-specific factual columns; identities map source external IDs to
canonical entity IDs.

Missing current mapping and ambiguous mapping are classified separately.
A present-day canonical identity alone **never** proves which identity a legacy
import used. Only individually established historical identity evidence can
set `historicalIdentityVerified`. Even with that flag, later or same-time
chronological changes require further proof of as-of correctness.

A direct record belongs to a fact only when source, entity, scope, timestamp
and factual columns agree. A source observation requires a matching referenced
snapshot from the same entity/scope, no later than the source observation.
Contradictory representations are conflicts, not repair candidates.

## Output

Only aggregate family classifications and counts are returned; source IDs,
hashes, raw payloads, names, canonical identities and original facts are never
included in the returned object. `repairAuthorized` is always false.

Classification `missing_candidate` is **not** authorization to insert data.
It means the supplied read-only inputs contain no representation, the caller
has separately verified historical identity, and no known later timeline
precludes a simple recovery. An exhaustive source-specific as-of comparison
is still required before any safe repair design.

## Next gate

Add a bounded private source-by-source R2/D1 adapter, with immutable original
verification, stable cursoring, explicit D1 read budgets and aggregate-only
workflow output. Confirm that its evidence captures the full relevant
timeline and historical mapping rather than trusting a current identity
lookup. Expand synthetic tests and CI before invoking a manual read-only
production preview.

**Do not merge without permission. No production repair, cleanup or
deployment is authorized by this foundation.**
