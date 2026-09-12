# KentaurAI - agent rules

This repository implements the V85/V86 KentaurAI build plan.

## Non-negotiable product rules
- Raw verified source facts are immutable from the AI layer.
- Missing data stays null/unknown. Never invent values.
- Code calculates deterministic metrics; AI interprets context.
- Analysis uses a two-step conversation flow: first a market-blind strength analysis, then a market-aware value/system pass in the same AI conversation. There is no mandatory intermediate import between those steps.
- The final AI-to-KentaurAI import is a single `combined` submission containing the locked step-1 `legs` plus the final step-2 `systems`; server-side provenance records that the blind analysis was declared but not separately sealed unless KentaurAI has evidence of a sealed pre-market parent.
- Spike validation is keyed by authoritative game type plus `system_type`, never by budget: V85 `main` may contain two or three singleton spike legs; if it contains two, `notes` must be non-empty and preserve the reason. Every other V85/V86 system must contain exactly three singleton spike legs. Multi-selection legs are never spikes.
- Default main-system budget is 150-250 SEK unless a later explicit user instruction changes it. The current V85 analysis method explicitly uses a larger shared main system; validation must follow the active product method rather than infer system type from budget.
- Manual editorial material is qualitative context, not the quantitative anchor.
- Public code uses only generic editorial-source naming.
- Real imported editorial files and private source metadata must never be committed to this public repository.
- Source provenance and timestamps are mandatory in the private data layer.
- Historical imports must be idempotent.
- Learning happens from repeated evidence, not one surprising result.

## Production safety
Do not deploy, create/alter production Cloudflare resources, run production backfills, or mutate production data without explicit approval.
Do not commit API keys, passwords, tokens, provider payloads, database dumps or private import files.
