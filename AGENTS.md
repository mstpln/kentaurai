# KentaurAI - agent rules

This repository implements the V85/V86 KentaurAI build plan.

## Non-negotiable product rules
- Raw verified source facts are immutable from the AI layer.
- Missing data stays null/unknown. Never invent values.
- Code calculates deterministic metrics; AI interprets context.
- Pre-market analysis must be stored before market data is exposed to the AI analysis pass.
- V85/V86 system generation uses exactly three spikar.
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
