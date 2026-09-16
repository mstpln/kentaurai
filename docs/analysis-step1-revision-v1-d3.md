# D3: late-fact Step 1 revision lineage v1

D3 extends the sealed v3 Step 1 workflow so verified pre-race factual changes can be reflected without mutating an existing lock or exposing current market data to the revision pass.

## Lineage and immutability

Every revision creates a new child `kentaurai-step1-lock-v1`. The parent lock remains unchanged and readable. `analysis_step1_lock_revisions` records one immutable parent -> child edge, and database uniqueness prevents branching from the same parent or attaching the same child to multiple parents.

The newest child becomes the only lock eligible for the later market/Step 2 path. `requireCurrentStep1LockV1` rejects an older parent, a lock that already has a child, and a lock whose stored revision basis no longer matches the current material pre-market facts.

D4 must use this current-lock gate when market-pack export is added. D3 does not itself create or expose a market pack.

## Revision basis

When a normal D2 Step 1 lock is imported through the current Worker, D3 captures a compact market-blind revision basis for that exact D1 parent pack. It stores:

- a structural round hash;
- per-leg material and section hashes;
- compact prior race/current-entry facts needed to explain late fact changes;
- exact pack/facts identity.

The basis intentionally does not store current market data or raw R2 telemetry. Existing D2 locks without a captured basis remain readable. If such a lock later has a changed facts fingerprint, D3 fails safe to full-round revision rather than guessing which leg changed.

## Material change detection

D1 `facts_fingerprint` includes `as_of`, so a later timestamp can change the fingerprint without a sporting fact changing. D3 therefore detects the fingerprint change first, then compares market-blind logical leg material with transport/as-of timestamps removed.

A normal material change produces `affected_legs`. A structural round/race identity change promotes the revision to `full_round`. A fingerprint-only/transport-metadata change does not force meaningless AI reanalysis.

Scratch, driver, equipment and other current-fact changes are represented in a deterministic `fact_delta`. Section hashes also identify changes in deterministic features, X-Labs evidence, relevant history or current signals.

## Revision transport

The server-generated input contract is `kentaurai-step1-revision-pack-v1`. It contains only:

- exact parent lock identity/hash;
- exact target D1 pack identity;
- revision scope and affected legs;
- market-blind fact delta;
- current pre-market context for affected legs only (all eight only for a safe full-round fallback);
- previous sealed Step 1 analysis for those affected legs.

The AI output contract is `kentaurai-step1-revision-v1` with prompt version `step1-revision-prompt-v1-d3`. The provider-neutral core prompt supports OpenAI and Anthropic adapters, disables web use, forbids current market/system reasoning and requires output for exactly the affected legs.

The server composes that partial revision with untouched parent legs, validates the full child against the server-generated target D1 pack, then atomically writes the child lock, lineage edge and child revision basis. The stored child lock records the D3 revision prompt version as provenance.

## Private routes

ADMIN_TOKEN protected:

- `GET /v1/analysis-step1-revision/:roundId?as_of=...&parent_lock_id=...`
- `POST /v1/analysis-step1-revision/:roundId`
- `GET /v1/analysis-step1-revision-prompt?provider=openai|anthropic`

Session-protected private app equivalents live under `/app/api/settings/analysis-step1-revision` and `/app/api/settings/analysis-step1-revision-prompt`.

## Operational boundary

Migration `0020_analysis_step1_lock_revisions.sql` is additive and preserves legacy analyses/systems. D3 starts no scheduler, replay, backfill, X-Labs acquisition, market export, optimizer or model-weight update.
