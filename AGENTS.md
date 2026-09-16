# KentaurAI - agent rules

This repository implements the V85/V86 KentaurAI build plan.

## Non-negotiable product rules
- Raw verified source facts are immutable from the AI layer.
- Missing data stays null/unknown. Never invent values.
- Code calculates deterministic metrics; AI interprets context.
- V3 analysis is a sealed two-stage workflow: market-blind Step 1 is imported, validated, hashed and persisted before any current market pack may be exposed to the AI analysis pass.
- A changed verified pre-race fact never rewrites a sealed Step 1 lock. It creates an immutable child revision from market-blind facts; the newest valid child is the only lock eligible for later market/Step 2 processing.
- Legacy v1/v2 combined or declared-unsealed analyses remain readable during cutover but are not the target contract for new v3 analysis.
- Every new V85/V86 v3 system contains exactly three singleton spike legs in three different legs. Historical legacy two-spike systems remain readable but must not be rewritten as v3.
- Default main-system budget is 150-250 SEK unless a later explicit user instruction changes it.
- Manual editorial material is qualitative context, not the quantitative anchor.
- Public code uses only generic editorial-source naming.
- Real imported editorial files and private source metadata must never be committed to this public repository.
- Source provenance and timestamps are mandatory in the private data layer.
- Historical imports must be idempotent.
- Learning happens from repeated evidence, not one surprising result.

## Production safety
Do not deploy, create/alter production Cloudflare resources, run production backfills, or mutate production data without explicit approval.
Do not commit API keys, passwords, tokens, provider payloads, database dumps or private import files.
