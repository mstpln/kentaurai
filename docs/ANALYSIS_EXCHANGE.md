# KentaurAI analysis exchange

KentaurAI is the factual database, deterministic calculation and persistence layer. The interpretation layer is replaceable: ChatGPT, Claude or another authorized AI client may analyze the same structured context and store its own independent submission.

## Contract

The exchange has two explicit stages.

1. `pre_market`: KentaurAI returns current factual race/entry context, verified historical starts and X-Labs measurements, approved deterministic market-blind features, and structured editorial signals. Current betting percentages, odds, turnover and jackpot are excluded. The AI returns its market-blind race assessment: scenarios, ranking, ABCD group, win probability, uncertainty and reasoning for every active entry.
2. `market`: available only after a `pre_market` submission has been stored. KentaurAI returns the current market snapshot linked to that parent. The AI may then return value/system recommendations and one or more systems. The final submission cannot rewrite the stored market-blind probabilities/ranks/ABCD assessment; KentaurAI copies those values from the parent and calculates value ratios from stored market percentages.

Every context carries a SHA-256 fingerprint. A submission is rejected if the relevant context has changed, so an AI cannot unknowingly store an analysis against stale current data.

## Provider neutrality and identity

Each submission records its producer provider/model and its own stable `submission_id`. Different providers can store analyses for the same round without overwriting each other. A final submission references exactly one stored pre-market parent from the same provider.

The exchange does not call an AI model from the Worker and does not require a specific vendor API. The authorized AI client reads/writes through the private API.

## System rules

Every submitted V85/V86 system must cover all eight legs and contain exactly three actual spike legs. A spike is a one-horse leg and must be marked as such; multi-horse legs cannot be marked as spikes. KentaurAI derives row count from the selection product and derives spike count rather than trusting AI-supplied totals.

ABCD remains relative winning strength, not value. Current market percentages are attached only in the market-aware final stage. KentaurAI derives selection probabilities from the stored prediction and market percentages from the stored betting snapshot.

## Private API

All routes below use the existing `ADMIN_TOKEN` bearer authentication and are not browser-public endpoints.

- `GET /v1/analysis/rounds`
- `GET /v1/analysis/rounds/:roundId/context?stage=pre_market`
- `GET /v1/analysis/rounds/:roundId/context?stage=market&pre_market_submission_id=:submissionId`
- `GET /v1/analysis/rounds/:roundId/submissions`
- `POST /v1/analysis/rounds/:roundId/submissions`
- `GET /v1/analysis/rounds/:roundId/submissions/:submissionId`

Submission bodies are JSON and capped at 1 MiB. The public repository contains only code/tests/synthetic data; real analysis payloads remain in private D1.

## Post-race relationship

Stored systems and predictions use the existing KentaurAI analysis/system tables, so the deterministic post-race reviewer can score them after all eight factual winners are available. A miss is evidence to review, not an automatic instruction to change the analysis logic. Learning remains `No change`, `Candidate learning` or `Confirmed learning`, with actual model/rule changes requiring repeated supporting evidence.
