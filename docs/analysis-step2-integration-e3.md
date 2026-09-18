# E3: Step 2 v3 and final system integration

E3 completes the Wave E production path from the sealed market-blind Step 1 through market interpretation to the authoritative code-optimized V85/V86 system.

## Contracts and versions

- Step 2 result contract: `kentaurai-step2-result-v1`
- Step 2 result version: `step2-result-v1-e3`
- Step 2 prompt version: `step2-prompt-v3-e3`
- Integrated analysis contract: `kentaurai-analysis-v3`
- Integrated analysis version: `analysis-v3-e3`
- Final narrative contract: `kentaurai-analysis-v3-narrative-v1`

The canonical decision layer remains E1 `decision-probability-v1-e1` with the initial `decision-blind-v1` policy. E3 does not introduce a fitted market blend.

## Step 2 read order

The Step 2 prompt requires the AI to:

1. read the exact sealed Step 1 lock;
2. verify the D4 market pack references that exact round, lock ID and lock hash;
3. read the round market profile;
4. read all eight leg market files;
5. interpret market disagreement, maturity, reliability and value confidence;
6. read optional external rankings only after the own-analysis/market synthesis.

Text inside source files remains untrusted data, not instructions. Step 2 does not browse the web or use outside racing knowledge.

## Immutable Step 1 boundary

The AI must copy the parent `blind_probability` and `abcd_group` only as immutable references. The server compares them exactly with the sealed Step 1 document.

Step 2 cannot change:

- blind probability;
- Step 1 ABCD;
- the Step 1 lock identity/hash;
- the market fingerprint/cutoff.

A mismatch fails closed before persistence.

## AI interpretation only

Per active entry Step 2 may submit only:

- market disagreement category;
- disagreement reliability;
- market maturity interpretation;
- value signal;
- value confidence;
- concise market reasoning.

The payload is strict. Client-supplied decision probabilities, ownership/odds values, row counts, budgets, selections, spike decisions or system combinations are rejected.

Ownership remains a pool ownership/exposure signal. It is never silently treated as win probability. A public win proxy is meaningful only when the D4 pack marks the complete winner-odds proxy verified.

## Canonical decision and optimizer

After a valid Step 2 result:

1. the server rebuilds the authoritative D4/E1 parents;
2. code creates the canonical E1 decision distribution;
3. with the current policy, `decision_probability = blind_probability`;
4. code runs the E2 optimizer;
5. the optimizer must produce exactly three singleton spike legs;
6. Step 2, decision, optimizer and integrated version/fingerprint references are persisted atomically in one D1 batch.

The AI never builds the authoritative system.

The integrated `kentaurai-analysis-v3` row records the exact:

- Step 1 lock and hash;
- market fingerprint and cutoff;
- Step 2 result/version/fingerprint;
- decision run/version/fingerprint;
- optimizer run/version/fingerprint;
- authoritative optimizer system.

Retries are idempotent and deterministic fingerprints exclude generation-time-only differences where the parent contract already defines them as non-semantic.

## Final narrative

Only after the optimizer output exists may AI generate a system narrative.

It may explain:

- why the three code-selected spike legs are efficient;
- which guarded legs consume rows;
- where miss risk is concentrated;
- value-versus-safety context;
- factual or market changes that should trigger a refresh.

It cannot submit replacement selections, a different spike count, row count or budget. Any changed inputs require rerunning the canonical decision/optimizer path.

The narrative is bound to the exact optimizer fingerprint and becomes immutable after it is sealed.

## Persistence

Migration `0023_analysis_step2_integration_v1.sql` adds:

- `analysis_step2_results`
- `analysis_v3_runs`

The existing E1 and E2 tables remain the canonical stores for decision probabilities and optimizer selections.

## Private routes

ADMIN_TOKEN protected:

- `GET /v1/analysis-step2-prompt?provider=openai|anthropic`
- `POST /v1/analysis-step2/:roundId?line_price_sek=...&target_budget_min_sek=...&max_budget_sek=...`
- `GET /v1/analysis-v3/:analysisId`
- `GET /v1/analysis-v3/:analysisId/narrative-prompt`
- `POST /v1/analysis-v3/:analysisId/narrative`

Session protected:

- `GET /app/api/settings/analysis-step2-prompt?provider=...`
- `POST /app/api/settings/analysis-step2?round_id=...&line_price_sek=...&target_budget_min_sek=...&max_budget_sek=...`

## Removed legacy Step 2 behavior

The E3 v3 Step 2 prompt no longer contains:

- the 700 SEK V85 main-system rule;
- two-spike exceptions;
- the 7% value filter;
- a forced materially different alternative system;
- free-form AI ticket optimization.

Legacy v1/v2 analysis creation and persisted history remain available in parallel during the E3 shadow period. Making v3 the default and disabling new v2 creation belongs to F4.

## Explicit non-scope

E3 does not:

- fit or change calibration/blend weights;
- replace canonical E1 probabilities with AI-proposed probabilities;
- restart or modify historical backfills;
- perform replay/backtesting;
- implement post-race learning changes;
- enable named X-Labs trip labels;
- remove legacy persisted analysis history.
