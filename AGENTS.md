# KentaurAI - agent rules

This repository implements the V85/V86 KentaurAI build plan.

## Non-negotiable product rules
- Raw verified source facts are immutable from the AI layer.
- Missing data stays null/unknown. Never invent values.
- Code calculates deterministic metrics; AI interprets structured context.
- The default live workflow is external-AI-first: deterministic market-blind Step 1 export -> analysis in ChatGPT/Claude -> verified-market Step 2 export for the same round -> the same AI conversation completes value analysis and system construction -> later round-scoped registration back into KentaurAI.
- Step 1 is not imported or server-sealed in the normal live workflow. Once market data is shown, its probabilities, ranking and ABCD are treated as the blind baseline and must not be silently rewritten because of the market.
- The external AI may choose final system selections and explain them. KentaurAI code owns strict validation and arithmetic: canonical IDs, exactly three singleton spike legs, row count, line-price cost and stored market/probability metrics.
- Every newly registered V85/V86 system must contain exactly three one-horse spike legs in three different legs. Multi-selection legs are never spikes.
- The normal main-system target remains 150-250 SEK with the game-specific line price; the exact-three-spike rule is mandatory.
- Legacy v1/v2 analysis artifacts remain readable for historical compatibility, but new legacy analysis creation is disabled after F4 cutover. Do not revive combined/declared-unsealed creation paths as the normal workflow.
- ANALYSIS_WORKFLOW_MODE=v3 is the production default. legacy_v2 is an explicit controlled rollback mode only; changing it requires the normal reviewed production release process.
- Manual editorial material is qualitative context, not the quantitative anchor.
- Public code uses only generic editorial-source naming.
- Real imported editorial files and private source metadata must never be committed to this public repository.
- Source provenance and timestamps are mandatory in the private data layer.
- Historical imports must be idempotent.
- Learning happens from repeated evidence, not one surprising result.
- Optional C4 named trip labels remain disabled unless their separate validation gate passes. Continuous X-Labs evidence may be used without promoted named labels.

## Production safety
Do not deploy, create/alter production Cloudflare resources, run production backfills, or mutate production data without explicit approval.
Do not commit API keys, passwords, tokens, provider payloads, database dumps or private import files.
