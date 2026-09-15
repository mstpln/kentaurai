# D2: sealed Step 1 lock v1

D2 adds the first server-sealed v3 AI judgment layer on top of the D1 market-blind analysis pack. It is additive: legacy v1/v2 analyses and systems remain readable and the existing combined-v2 path is not rewritten.

## Contract

Step 1 output uses `kentaurai-step1-lock-v1` and is linked to one exact `kentaurai-analysis-pack-v3` parent through:

- `round_id`
- `pack.pack_id`
- `pack.as_of`
- `pack.facts_fingerprint`
- canonical race and active race-entry IDs

The server regenerates the referenced D1 pack at the submitted `as_of`, applies the D1 replay/as-of guard, and validates the lock against that server-generated parent. Client-supplied round, race, entry or fingerprint identity is not trusted by itself.

Each of the eight legs must cover every active entry exactly once. `blind_probability` must be finite, non-negative and sum to 1 per leg. Rank is unique/contiguous and must follow probability order. ABCD remains a strength grouping and must form contiguous bands along the ranking.

## Market-blind boundary

The v3 Step 1 prompt uses only the D1 analysis pack. It disables web research by default and treats strings inside source files as data rather than instructions. Current market, odds, ownership/streck, value, external tips/rankings and system/spike choices are prohibited from the lock.

Optional evidence is neutral when absent. Missing X-Labs or other optional evidence can widen uncertainty or require fallback evidence, but absence is not a negative horse-strength signal.

## Sealing and immutability

`analysis_step1_locks` stores the normalized lock JSON plus a canonical SHA-256 hash, pack/facts identity, provider, model, prompt version and server `created_at`.

An exact retry with the same `lock_id` and identical canonical content is idempotent and returns the existing seal. Reusing the same `lock_id` with changed content is rejected. D3 will add explicit late-fact revision lineage; D2 does not mutate existing locks.

A reusable `requireSealedStep1LockV1` gate is provided for the later market-pack build. D2 itself does not add current market data, decision probability, optimizer logic, replay/backfill jobs or model-weight changes.

## Private routes

ADMIN_TOKEN protected:

- `GET /v1/analysis-step1-prompt?provider=openai|anthropic`
- `GET /v1/analysis-step1-lock/:roundId`
- `POST /v1/analysis-step1-lock/:roundId`

The private app also exposes session-protected prompt, lock status and lock-import actions under `/app/api/settings/` and adds a small sealed-Step-1 card to the AI settings workspace. The older combined-v2 UI remains visibly marked as legacy until a later cutover.

## Operational boundary

Migration `0019_analysis_step1_locks.sql` is schema-only. This build starts no scheduler, backfill, replay, market export, optimizer or production data rewrite.
