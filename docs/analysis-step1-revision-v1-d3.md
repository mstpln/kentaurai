# D3: late-fact Step 1 revision and lock lineage

D3 extends the sealed v3 Step 1 workflow so verified pre-race facts can change without rewriting an earlier AI judgment or allowing current market data into the revision path.

## Contracts

The server-generated revision input uses `kentaurai-step1-revision-input-v1`. The AI revision output uses `kentaurai-step1-revision-v1`. Every child remains a complete immutable `kentaurai-step1-lock-v1` in `analysis_step1_locks`; lineage is stored separately in `analysis_step1_lock_revisions`.

A revision is allowed only from the newest sealed Step 1 lock for the round. The parent lock is regenerated at its sealed `pack_as_of` and must reproduce the same `pack_id` and `facts_fingerprint`. The new D1 pre-market pack is generated at the requested later as-of time and must have a changed facts fingerprint.

## Affected-leg revision

D3 compares deterministic transport-free leg payloads from the sealed parent pack and the new market-blind pack. Pack timestamps and split metadata do not by themselves make a leg changed. If leg content changes, only those legs are sent for reanalysis. If the overall fingerprint changes but the change cannot be localized safely to a leg, the contract escalates to all eight legs rather than guessing.

The revision input contains:

- parent lock identity and hash
- new pack identity and facts fingerprint
- exact affected leg numbers
- a deterministic fact delta for those legs
- the previous sealed judgment for those legs only
- the current D1 market-blind context for those legs only

The delta is bounded and fails closed if it becomes unexpectedly large; it is never silently truncated.

The AI output contains only the revised affected legs. KentaurAI constructs the full child lock server-side by copying all unaffected legs byte-semantically from the immutable parent and replacing only the server-detected affected legs. The resulting full child lock must pass the same D2 identity, active-entry, probability, rank, ABCD, market-blind and strict-schema validation against the new D1 pack.

## Late-fact examples and safety

Scratch, driver and equipment changes are handled as ordinary factual changes when they appear in the D1 pack. Missing optional evidence stays neutral. Current streck, odds, market ownership, turnover, jackpot, value, external tips/rankings, picks, spikes and systems remain prohibited from both revision input and output.

The parent lock is never mutated. The child lock and its lineage row are persisted atomically. Reusing a revision ID with changed content is rejected. The lineage schema also permits at most one direct child for each parent lock, so concurrent attempts cannot create two competing revision branches from the same sealed state.

## Step 2 gate

D3 provides `requireLatestStep1LockV1`. A future market pack must bind to the newest sealed lock. Supplying an older parent after a child revision exists is rejected as superseded. When an as-of timestamp is supplied, the gate also regenerates the current D1 pre-market pack and rejects the lock if newer facts have changed the fingerprint. This invalidates any attempted market linkage to stale Step 1 facts without deleting history.

## Private routes

ADMIN_TOKEN protected:

- `GET /v1/analysis-step1-revision/:roundId?parent_lock_id=...&as_of=...`
- `POST /v1/analysis-step1-revision/:roundId`
- `GET /v1/analysis-step1-revision-prompt?provider=openai|anthropic`

The private app has equivalent session-protected endpoints under `/app/api/settings/analysis-step1-revision` and `/app/api/settings/analysis-step1-revision-prompt`.

D3 does not add a current-market pack, optimizer, replay/backfill job, scheduler change, source acquisition change or model-weight update.