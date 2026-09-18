# E1: decision probability and calibration foundation v1

E1 creates the canonical probability handoff between the sealed market-blind Step 1 assessment and the later deterministic system optimizer.

## Contract

- Contract: `kentaurai-decision-probability-v1`
- Decision version: `decision-probability-v1-e1`
- Initial policy: `decision-blind-v1`

The decision snapshot is bound to:

- the newest sealed Step 1 `lock_id` and `lock_hash`
- one D4 `market_fingerprint`
- the D4 market cutoff
- eight exact race/entry identities from the sealed Step 1 lock

Cross-parent or incomplete inputs fail closed.

## Blind, public and decision probabilities

E1 keeps three concepts separate.

`blind_probability` is copied from the immutable Step 1 lock.

`public_win_probability_proxy` is copied only from D4 when that leg has the verified complete winner-odds proxy. If D4 marks the proxy weak or unavailable, this field remains `null`. Ownership percentage is never substituted for a win probability.

`decision_probability` is the one canonical distribution intended for the optimizer. Under the v1 policy it is **exactly equal to `blind_probability`** for every entry. No market blend, Benter alpha/beta, prompt heuristic or editorial adjustment is applied.

Each leg must sum to 1 within the contract tolerance.

## Calibration-ready hooks

Each leg carries descriptive context reliability inputs from D4, including:

- public proxy availability/quality/method
- minimum ownership observation count
- maximum snapshot age across active entries
- explicit `trend_semantics_verified=false`
- explicit `blend_applied=false`

These are hooks for later replay/calibration work. E1 does not fit coefficients or change probabilities from them.

Persistence stores the full canonical decision snapshot plus normalized per-entry rows containing blind, public-proxy and decision probabilities. This allows later scoring/calibration without rewriting the historical decision version.

## Determinism and idempotency

The decision fingerprint includes the sealed Step 1 identity, D4 market fingerprint/cutoff, explicit decision/policy versions and canonical leg distributions. Export generation time is excluded from the fingerprint.

The persisted ID is derived from the decision fingerprint. Retrying the same canonical state reuses the stored decision even if the later request has a different generation timestamp.

## Private routes

ADMIN_TOKEN protected:

- `GET /v1/analysis-decision-probability/:roundId?lock_id=...&lock_hash=...&as_of=...` previews the canonical decision.
- `POST /v1/analysis-decision-probability/:roundId?lock_id=...&lock_hash=...&as_of=...` persists it idempotently.

Session protected:

- `GET|POST /app/api/settings/analysis-decision-probability?round_id=...&lock_id=...&lock_hash=...&as_of=...`

## Explicit non-scope

E1 does not:

- blend blind and market probabilities
- use ownership as a win-probability substitute
- choose calibration coefficients
- implement Step 2 AI interpretation
- construct or optimize a betting system
- change Step 1 probabilities or ABCD
- add scheduler/replay behavior
- use external editorial signals in the canonical decision distribution

E2 consumes the canonical `decision_probability` distribution and implements exact-three-spike deterministic optimization.
