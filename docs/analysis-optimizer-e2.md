# E2: exact-three-spike P8 optimizer v1

E2 moves authoritative V85/V86 system construction into deterministic code.

## Contract

- Contract: `kentaurai-optimizer-v1`
- Optimizer version: `optimizer-p8-exact3-v1-e2`
- Policy version: `v85-v86-exact3-main-v1`
- Canonical probability input: persisted E1 `decision_probability`
- Exact spike count: 3

E2 does not change Step 1, the sealed lock, market data or canonical decision probabilities.

## Preconditions

The optimizer fails closed unless:

- the parent is a persisted E1 decision run for the requested V85/V86 round
- the decision still points to the newest sealed Step 1 lock and matching lock hash
- the current active race-entry field still exactly matches the persisted decision; scratches/additions/removals require a new Step 1/market/decision lineage
- exactly eight ordered legs exist
- every leg has at least one active eligible entry
- every `decision_probability` is finite and between 0 and 1
- each leg sums to 1 within the probability tolerance
- no `race_entry_id` is duplicated across the optimizer input
- line price is explicitly supplied and positive
- max budget is explicitly valid
- policy requires exactly three spikes

The line price is configuration input in E2. It is not inferred from prompt text or silently hardcoded as factual game data.

## Search

For every leg E2 sorts entries by:

1. `decision_probability` descending
2. stable `race_entry_id` ascending for exact ties

It then builds the cumulative top-k frontier. For any fixed k, selecting top-k maximizes that leg's coverage probability.

The search runs over frontier size per leg and tracks:

- row product
- spikes used
- sum of log leg coverage
- stable selection signature

The primary objective is maximum estimated P8 under max budget:

`P8 = product(leg_coverage_probability)`

with:

- exactly three singleton legs
- `row_count = product(selected_count per leg)`
- `cost_sek = row_count * line_price_sek`
- `cost_sek <= max_budget_sek`

The normal 150-250 SEK band is policy metadata. The minimum is not forced: a cheaper system is accepted when extra rows do not improve P8.

For equal primary objective, v1 uses a versioned deterministic secondary tie-break:

1. lower row count/cost
2. stable selection signature

No ownership/value secondary objective is enabled in E2 v1. That avoids introducing an uncalibrated market rule into the authoritative system search.

## Persistence

E2 persists:

- exact E1 decision parent and fingerprint
- optimizer/policy versions
- line price and budget policy
- exact-three-spike count
- row count and cost
- estimated P8
- deterministic search metrics
- normalized selected entries
- canonical optimizer JSON
- optimizer fingerprint

The fingerprint excludes generation time. Retrying the same decision and policy produces the same optimizer fingerprint and reuses the stored canonical result.

Legacy two-spike system rows remain readable in the existing `systems` table. E2 never rewrites them. New E2 output is stored in versioned optimizer tables and always requires exactly three spikes.

## Private routes

ADMIN_TOKEN protected:

- `GET /v1/analysis-optimizer/:roundId?decision_run_id=...&line_price_sek=...&target_budget_min_sek=...&max_budget_sek=...`
- `POST /v1/analysis-optimizer/:roundId?decision_run_id=...&line_price_sek=...&target_budget_min_sek=...&max_budget_sek=...`

Session protected:

- `GET|POST /app/api/settings/analysis-optimizer?round_id=...&decision_run_id=...&line_price_sek=...&target_budget_min_sek=...&max_budget_sek=...`

GET previews the deterministic result. POST persists it idempotently.

## Explicit non-scope

E2 does not:

- let AI construct or alter the authoritative system
- blend market data into E1 probabilities
- force use of the full budget
- force alternative systems to differ
- use ownership as a win probability
- add a value/ownership tie-break before it is separately validated/versioned
- change legacy historical systems
- start replay, learning or backfill jobs
- perform the E3 Step 2 import/final narrative integration
