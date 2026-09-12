# Analysis workflow v2

KentaurAI uses one AI conversation per V85/V86 round and three user-facing steps:

1. Export market-blind data and run the canonical step-1 strength-analysis prompt.
2. Export current market data into the same conversation and run the canonical step-2 value/system prompt. Step 1 stays unchanged.
3. Copy the combined export prompt and import one `kentaurai-analysis-v2` JSON file back into KentaurAI.

There is no required intermediate AI submission between steps 1 and 2. The server stamps analysis-blindness provenance; the AI must not supply that field.

System validation is keyed by game type plus `system_type`: V85 `main` may contain two or three singleton spike legs; a two-spike V85 main requires a non-empty `notes` explanation. All other V85/V86 systems require exactly three singleton spike legs.

The combined import contains the locked step-1 `legs` plus the final step-2 `systems`. Market-aware information belongs in `recommendations`/system fields, never in the step-1 leg text.
