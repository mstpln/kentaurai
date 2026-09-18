# KentaurAI - agent rules

This repository implements the V85/V86 KentaurAI build plan.

## Non-negotiable product rules
- Raw verified source facts are immutable from the AI layer.
- Missing data stays null/unknown. Never invent values.
- Code calculates deterministic metrics; AI interprets structured context.
- The default live analysis workflow is v3: deterministic pre-market pack -> AI Step 1 -> server-sealed Step 1 lock -> optional late-fact revision -> self-contained Step 2 bundle with the exact sealed lock plus verified market data -> AI Step 2 interpretation -> canonical decision persistence -> deterministic code optimizer.
- Step 1 must be server-sealed before current market exposure. New analysis must never rely on reconstructing Step 1 from conversation memory.
- The Step 2 result may interpret market disagreement/value confidence but must not choose decision probabilities, spikes, selections, row counts or budgets. KentaurAI code owns those fields.
- Canonical decision probability is explicitly versioned. Until a calibrated market blend passes its own evidence gate, the live E1/E3 policy keeps decision probability equal to the sealed blind probability.
- New V85/V86 systems are created only by the canonical optimizer and contain exactly three one-horse spike legs in three different legs. Multi-selection legs are never spikes.
- Default optimizer policy is a 150-250 SEK main-system target band with game-specific line price. The optimizer may spend less when extra rows add no probability coverage; budget is a constraint/target, not permission to change the exact-three-spike rule.
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
