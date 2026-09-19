# KentaurAI - agent rules

This repository implements the V85/V86 KentaurAI build plan.

## Non-negotiable product rules
- Raw verified source facts are immutable from the AI layer.
- Missing data stays null/unknown. Never invent values.
- Code calculates deterministic metrics; AI interprets structured context.
- The default live workflow is external-AI-first: deterministic market-blind Step 1 -> market-only Step 2 -> interviews/external-statistics Step 3 -> user/AI system-building dialogue Step 4 -> separate external-evidence registration Step 5 -> separate system registration Step 6.
- Step 1 is not imported or server-sealed in the normal live workflow. Its probabilities/ranking/ABCD are the blind baseline and must not be rewritten because of market data. Only new sports evidence introduced in Step 3 may justify a separately explained day adjustment.
- The external AI may choose final system selections and explain them. KentaurAI code owns strict validation and arithmetic: canonical IDs, exactly three singleton spike legs, row count, line-price cost and stored market/probability metrics.
- Every newly registered V85/V86 system must contain exactly three one-horse spike legs in three different legs. Multi-selection legs are never spikes.
- The normal main-system target remains 150-250 SEK with the game-specific line price; the exact-three-spike rule is mandatory.
- Historical v1/v2 and sealed-v3 analysis artifacts remain readable for compatibility. In the default mode, all old sealed-v3/optimizer mutation paths are retired; do not create parallel new analysis lineages outside the external workflow.
- ANALYSIS_WORKFLOW_MODE=v3 is the production default. legacy_v2 is an explicit controlled rollback mode only; changing it requires the normal reviewed production release process.
- Manual editorial material enters only in Step 3. External horse statistics may supplement missing/broader factual aggregates; interview content remains contextual evidence rather than the quantitative anchor.
- Public code uses only generic editorial-source naming.
- Real imported editorial files and private source metadata must never be committed to this public repository.
- External statistics from this workflow are stored on horses only. Interviews are linked to horses and trainers/stable context with the actual speaker recorded. No external statistics or interviews from this workflow are stored on drivers.
- Full paid article bodies are not persisted by this workflow; private structured signals and sufficiently complete summaries are stored instead.
- Source provenance and timestamps are mandatory in the private data layer. External horse-stat snapshots and interview records are append-only; prior observations are never overwritten.
- External analysis is explicitly `declared_unsealed`, never represented as a server-proven sealed blind analysis. Registration binds to reproducible Step 1 and Step 2 fingerprints, records server-side import timing, and marks post-deadline registrations `manual_review_required`.
- External registered systems have their own versioned lineage used by Spel, F1 replay and F2 diagnostics. Do not fabricate old Step 1 lock/decision/optimizer lineage for them.
- Historical imports must be idempotent.
- Learning happens from repeated evidence, not one surprising result.
- Optional C4 named trip labels remain disabled unless their separate validation gate passes. Continuous X-Labs evidence may be used without promoted named labels.

## Production safety
Do not deploy, create/alter production Cloudflare resources, run production backfills, or mutate production data without explicit approval.
Do not commit API keys, passwords, tokens, provider payloads, database dumps or private import files.
