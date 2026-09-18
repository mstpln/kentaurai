# F1: chronological replay, calibration and feature ablation

F1 builds the evidence layer that decides whether new KentaurAI forecast inputs improve out-of-sample performance. It does not change model weights, promote features automatically or modify historical source data.

## Contract

- Replay contract: `kentaurai-replay-v1`
- Replay version: `replay-calibration-v1-f1`
- Proper scoring version: `proper-scoring-v1`
- Calibration version: `decile-calibration-v1`
- Walk-forward version: `walk-forward-v1`

## Leakage rule

Replay is chronological only.

Random train/test splits are not permitted. A target is scored only from a forecast that existed before the target event. Factual winners are read later and only from official result source records fetched no later than the replay run's fixed `source_data_cutoff`.

For the ordinary sports-feature track, deterministic v3 features are reconstructed at the stored forecast timestamp. Before reconstruction, the target race and entries must still match the latest official normalized observations that were available at that timestamp. If current canonical state reflects a later correction, the target is skipped rather than reconstructed from contaminated state.

Every reconstructed feature provenance reference is checked so `selected_at <= forecast_as_of`.

A replay run never modifies:

- raw source records;
- normalized racing facts;
- E1 decision probabilities;
- E2 optimizer outputs;
- model weights;
- `model_change_log`.

## Two evaluation tracks

### sports_feature

The sports track evaluates stored market-blind `ai_race_analyses` / `ai_horse_predictions`.

For each safe target it records:

- log loss;
- multiclass Brier score;
- top-1 hit;
- top-2 coverage;
- decile calibration observations;
- deterministic v3 feature fingerprint at the forecast as-of;
- explicit feature-family manifest when model metadata declares one;
- historical X-Labs feature coverage bucket.

Old forecasts without explicit `replayEvaluation.featureFamilies` metadata can still be scored, but they cannot be treated as a valid feature-ablation pair merely by inference.

### v85_v86_decision

The decision track evaluates immutable stored E1 distributions for settled V85/V86 rounds:

- `blind_probability`;
- verified complete `market_win_probability_proxy`, when available;
- `decision_probability`.

Ownership percentage is never substituted for a missing public win proxy.

Stored E2 systems tied to the same decision run are evaluated separately for:

- estimated P8;
- actual all-8 coverage;
- covered legs;
- spike misses;
- row count;
- cost.

Exactly-three-spike invariants remain authoritative.

## Reference targets

A configured reference round/race is regression-only.

It is stored with `is_reference=1` and `evidence_eligible=0`. It can expose regressions in code or contracts, but it is excluded from calibration evidence, promotion evidence and system-quality aggregates.

For a historical reference lock that was physically persisted after the event, F1 may use the lock's pre-event `pack_as_of` only when the target is explicitly configured as a reference. That fallback is recorded in source metadata and never becomes training/promotion evidence.

## Walk-forward folds

Each replay run stores:

- `min_train_targets`;
- `fold_size`;
- chronological cursor;
- fixed source-data cutoff.

The fold index is derived only from prior chronologically scored non-reference target groups. No later target can move backward into an earlier fold.

Before the minimum prior target count is reached, forecasts can be recorded for diagnostics but are not `evidence_eligible`.

## Proper scoring and calibration

Log loss uses the factual winner probability with a versioned numerical floor of `1e-15` only to avoid infinite storage values.

Multiclass Brier score is:

`sum((p_i - y_i)^2)`

across the full active field.

Calibration uses ten deterministic probability bins and stores:

- sample count;
- mean predicted probability;
- observed win frequency;
- expected calibration error.

## Feature ablation

A replay run may declare one baseline/candidate forecast pair and exactly one feature family under test.

The ablation guard fails if the pair changes anything outside the declared feature-family membership in the replay feature manifest. Results are paired by chronological target group and reported for:

- all;
- zero X-Labs coverage;
- low;
- mixed;
- high.

A candidate is labelled `candidate_better` only when both mean log loss and mean Brier score improve after the configured minimum paired sample. This is evidence for later review only; F1 never applies a model change.

## Target skips

Fail-closed replay exclusions are stored explicitly, including:

- missing as-of official target observation;
- target canonical state drift;
- future feature-provenance source;
- missing or ambiguous official winner as of the source-data cutoff;
- forecast timestamp not strictly pre-event.

Skipping a contaminated target is preferable to manufacturing historical state.

## Execution model

Replay is deliberately bounded and resumable:

1. create one run;
2. process one chronological target per `step`;
3. repeat steps;
4. when no target remains, code finalizes aggregate scoring, calibration and optional ablation.

F1 does not add an automatic scheduled replay. This avoids accidentally launching a large historical job as part of deployment.

## Private routes

ADMIN_TOKEN protected:

- `POST /v1/replay/start`
- `POST /v1/replay/step`
- `GET /v1/replay/status?run_id=...`

No public or session UI is added in F1. Diagnostics/UI belong to later Wave F work.

## Promotion boundary

F1 only creates evidence.

Promotion/rejection decisions must be based on repeated chronological out-of-sample evidence and remain subject to KentaurAI's learning classes:

- No change
- Candidate learning
- Confirmed learning

A single race or round cannot change model weights.
