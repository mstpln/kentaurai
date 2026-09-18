# F1: chronological replay, scoring and feature ablation

F1 builds the evidence layer that KentaurAI will use before any future feature or probability blend is promoted.

## Contracts and versions

- Replay contract: `kentaurai-replay-v1`
- Replay implementation: `replay-calibration-v1-f1`
- Score version: `multiclass-logloss-brier-v1`
- Calibration version: `fixed-bins-v1`
- Walk-forward policy: `expanding-window-v1`

F1 does **not** change live model weights, E1 decision probability, E2 optimizer policy or E3 system output.

## Two evaluation tracks

### 1. Sports/feature track

Suitable settled ordinary races are replayed chronologically.

For every target race:

1. the target timestamp is the historical scheduled race start;
2. current v3 feature builders reconstruct their state as-of that timestamp;
3. no later official snapshot, historical result, X-Labs source or other timestamped source may enter the feature state;
4. a versioned forecast producer receives only the declared active feature families;
5. the forecast is scored only after the factual winner is known.

Current replayable feature-family namespaces are:

- `capacity`
- `form`
- `class_context`
- `development`
- `method_distance`
- `rest_readiness`
- `gallop_risk`
- `equipment_response`
- `person_context`
- `race_priors`
- `xlabs_evidence`

The replay engine does not invent a model that converts features to probabilities. A forecast producer must be explicit and versioned. That keeps F1 as an evaluation system rather than silently introducing a new model.

### 2. V85/V86 decision track

The decision track evaluates stored v3 E1 decision runs only when their historical lineage is valid:

- the exact Step 1 lock exists;
- lock hash matches;
- Step 1 pack as-of is not after market cutoff;
- market cutoff is not after the first race start;
- the stored decision fingerprint metadata matches the decision document;
- each scored leg has exactly one factual winner.

It reports blind and canonical decision probability scores separately. The initial production policy can therefore be measured without pretending that a market blend exists.

## Proper scoring

For every race/leg forecast:

- multiclass log loss uses the factual winner probability;
- multiclass Brier is the sum of squared class errors;
- winner rank and top-1 accuracy are descriptive secondary outputs;
- calibration bins report mean forecast probability vs observed frequency;
- expected calibration error is descriptive and versioned.

Zero winner probability is score-clipped only for finite log-loss calculation. Stored forecast probability remains the original value.

## Walk-forward only

F1 contains no random train/test split.

Targets are sorted chronologically and grouped deterministically. The versioned expanding-window policy produces:

- historical training groups;
- later calibration groups;
- still-later test groups.

Only test groups feed the reported out-of-sample score summaries.

If the cohort is too small to form a valid fold, the replay result is stored as `insufficient_evidence`; it is not promoted into evidence by silently scoring the training rows.

## Ablation

Ablation definitions are declarative and constrained.

Each ablation names exactly one feature family and mode:

- `add`
- `remove`

The engine derives the variant feature set from the baseline itself. Arbitrary replacement feature lists are not accepted, which guarantees that the variant changes only its declared family.

Baseline and candidate are evaluated on the same chronological test targets. F1 records:

- baseline log loss/Brier;
- candidate log loss/Brier;
- score deltas;
- exact feature family and ablation mode;
- forecast producer version;
- feature/version metadata;
- cohort fingerprint.

A negative log-loss/Brier delta means the candidate scored better. Promotion still requires repeated out-of-sample evidence and the existing No change / Candidate learning / Confirmed learning governance.

## Reference round

The private real reference round remains a deterministic regression/no-leak case only.

It must never be committed to GitHub and must not be used as training evidence.

## Persistence

Migration `0024_replay_calibration_v1.sql` adds:

- `replay_runs`
- `forecast_evaluations`
- `replay_ablation_results`

Replay fingerprints are deterministic and exclude persistence timestamps.

Exact retries reuse the same replay run.

## Explicit operational API

ADMIN_TOKEN protected:

- `POST /v1/replay/decision`
- `GET /v1/replay/:replayId`

The POST is an explicit bounded replay request. F1 introduces no scheduler and starts no automatic historical replay/backfill.

Sports-feature replay is a library workflow because it requires an explicit versioned forecast producer. F3 may later expose safe UI/diagnostic controls.

## F1 does not

- train or promote a market blend;
- modify model weights;
- change E1 decision probabilities;
- alter optimizer selections;
- rewrite historical analyses;
- start or reset existing official/X-Labs backfills;
- turn the private reference round into training data;
- treat missing X-Labs as negative evidence.
