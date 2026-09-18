# Analysis workflow v2

> **Legacy compatibility document.** This describes a historical v1/v2 workflow and is not the default creation path after F4. In `ANALYSIS_WORKFLOW_MODE=v3`, new legacy analysis creation is disabled; these contracts remain only for historical reads and controlled rollback compatibility. The live workflow is the sealed v3 pack -> Step 1 lock/revision -> self-contained Step 2 bundle -> canonical decision -> exact-three-spike optimizer path documented in `README.md` and `docs/V3_CUTOVER_RUNBOOK.md`.

KentaurAI uses one AI conversation per V85/V86 round and three user-facing steps:

1. Export market-blind data and run the canonical step-1 strength-analysis prompt.
2. Export current market data into the same conversation and run the canonical step-2 value/system prompt. Step 1 stays unchanged.
3. Copy the combined export prompt and import one `kentaurai-analysis-v2` JSON file back into KentaurAI.

There is no required intermediate AI submission between steps 1 and 2. The server stamps analysis-blindness provenance; the AI must not supply that field.

`is_spike` is descriptive in the export: a singleton leg is `true`, while every selection in a multi-horse leg is `false`. Spike-count validation uses the authoritative round game type plus `system_type`, never budget. V85 `main` may contain two or three singleton spike legs; a two-spike V85 main requires a non-empty `notes` explanation. Every other V85/V86 system requires exactly three singleton spike legs. The export step never rebuilds an already-decided system to satisfy these rules; backend validation accepts or rejects it.

The combined import contains the locked step-1 `legs` plus the final step-2 `systems`. Market-aware information belongs in `recommendations`/system fields, never in the step-1 leg text.
