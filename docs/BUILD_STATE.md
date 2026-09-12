# Build state

Version: 0.6.0
Updated: 2026-09-12

## Current production state
- Production Worker: `kentaurai-api`.
- D1: `kentaurai`.
- R2: `kentaurai-raw`.
- Actual Worker entrypoint: `src/worker-v064.js`.
- Controlled AI Build E is merged and production-live after GitHub Actions release run `34642352908`.
- Release QA passed with 441 tests and zero failures before production changes.
- Worker deployment, `/health`, `/app/login` and the private analysis-prompt authorization check all passed.
- Deployed Worker version ID from that release: `465768c5-3106-4164-a27c-69ae34d9e6ec`.
- Production D1 reported `No migrations to apply` during that release. Production migration tracking remains current through `0012_trainer_statistics_indexes.sql`; migration `0013_combined_analysis_systems.sql` exists only on open PR #95 and has not been applied to production.
- Build F is merged to source `main` but has not yet been included in a separately authorized production release.
- PR #95 is open and not production-live. It changes the controlled AI workflow to the one-import combined flow described below and must not be merged/deployed without explicit user authorization.
- Official and X-Labs historical backfills use persisted jobs/cursors. Deployments and analysis work must never recreate, reset or silently restart them.

## Statistics programme
### Build A - Trend - merged and production-live
- PR #83 is merged.
- Shared factual metric definitions are used for actual starts, wins/losses, top-three rate, verified-denominator gallop rate and null-safe prize sums.
- Scratched declarations are excluded.
- Trend provides deterministic top-10 rankings for trainers, horses and drivers over the supported rolling periods.
- Ranking tie-break is win rate -> wins -> starts -> stable entity ID.
- Loppnivå, track, race type, breed and start method filters combine with AND semantics.
- Trend rows navigate to canonical entity details and use the approved dark/minimal responsive UI.

### Build B - Horse statistics - merged and production-live
- PR #84 is merged; merge commit `1a4f8731ca83e912bd4c77030b92d7dc60a11a3e`.
- Horse statistics include win/top-three/earnings rankings, placements-only form over the latest up to 10 factual results, verified X-Labs first-200/last-400 pace rankings, and first/second start after at least 60 days of rest.
- X-Labs pace is presented as kilometre pace (`min/km`), not elapsed section seconds.
- Verified official life-statistics Start Points are stored as timestamped source-backed observations with nullable current cache fields. Missing values remain null.
- Start-point history links to a race entry only when exact official race/horse identity proves the relation.
- Archived normalized official source records are reused from private R2 to populate Start Points history; older verified observations remain history and cannot overwrite a newer current cache value.
- Migration `0010_horse_start_points.sql` is part of the production schema.

### Build C - Driver statistics - merged and production-live
- PR #85 is merged from exact reviewed head `e127cfd7d6fd97e77d11474e6e085b014318a09e`.
- Driver statistics include core rankings, placements-only form over the latest up to 30 result starts, annual/average earnings, source-backed lead/death-seat rankings, auto/volt/back-row rankings, and favorite/longshot results.
- Horse sex and age filters are available for driver statistics where relevant.
- Minimum-start thresholds apply to percentage rankings rather than volume/earnings rankings.
- Good volt lanes are deterministically `1`, `6`, `7` within the current volt; verified handicap distance remains a separate dimension.
- Favorite/longshot statistics require source-backed betting snapshots at or before a verified betting stop. Favorite is stored market rank 1; longshot uses the shared threshold `<=5%`; missing evidence fails closed.
- Migration `0011_driver_statistics_indexes.sql` adds only measured query indexes and is part of the production schema.

### Build D - Trainer statistics - merged and production-live
- PR #86 is merged; merge commit `8069026fe1cd5fceb3a11ee1ab6d1e881d82fe2c`.
- Final reviewed Build D head was `96db1f11fa28a9a358a3e87d3d69ab425081cbd1` with 426 tests passing and zero failures.
- Trainer statistics reuse shared factual denominators and provide win/top-three rates, wins, latest-30 placements-only form, annual/average earnings, auto/volt, verified volt-lane/tillägg, home/other-track, distance-profile, favorite/longshot, and first/second start after at least 60 days of rest.
- Trainer home-track statistics require an exact source-backed official external track ID mapping. A matching track name alone is not accepted as identity.
- Migration `0012_trainer_statistics_indexes.sql` adds only the measured trainer query index.

## Controlled AI programme
### Build E - Repair controlled AI export flow - merged and production-live
- PR #87 is merged; merge commit `42901f281eb8405f6aa72cbce104baf77199c6df`.
- Final reviewed branch head was `532d698fbe30e6f8fae6fce2efb606b62f71877e`; CI #551 passed with 441 tests and zero failures before merge.
- Production release run `34642352908` passed the same 441-test QA suite, reported no pending D1 migrations and deployed Worker version `465768c5-3106-4164-a27c-69ae34d9e6ec`.
- The production workflow is still the older parent-bound `pre_market` -> `final` exchange until PR #95 is explicitly merged and deployed.
- Every production export carries the immutable KentaurAI context envelope in `analysis_contexts`: canonical round/race/race-entry identities and exact context fingerprint are supplied by KentaurAI rather than entered by the user.
- Production `pre_market` is market-blind and final analysis is parent-bound. This remains historical/current-production truth only; it is superseded in source by PR #95 when/if that PR is merged.
- Final market context uses `verified-market-at-stop-v1`: betting and odds rows must be source-backed, belong to the exact round/race entry and be observed no later than the verified betting stop/current stable analysis cutoff.
- New analysis submissions accept only canonical `openai` or `anthropic` producer identities; `producer.model` stores the actual model identity.
- No new D1 migration was required by Build E and its production release did not reset or recreate historical backfills.

### Combined AI workflow v2 - open PR #95, reviewed but not merged/deployed
- Branch: `fix/analysis-export-sql-and-combined-flow`.
- Workflow: Step 1 exports market-blind data and runs the canonical strength-analysis prompt; Step 2 exports verified current market into the same AI conversation and runs the value/system prompt; Step 3 creates one final `kentaurai-analysis-v2` `combined` JSON import.
- There is no mandatory intermediate pre-market import. Consequently Step-1 blindness is process-declared rather than independently sealed; KentaurAI stamps `analysisBlindness = declared_unsealed` server-side and the AI is forbidden from supplying that field.
- Combined `legs` must preserve the Step-1 assessment and are checked for canonical identities, complete active-entry coverage, probability sums, ranking/ABCD consistency and market-free text. KentaurAI cannot prove byte identity against an unseen Step-1 response.
- Market-aware information belongs in recommendations/system fields. Verified market observations remain source-backed and cutoff-bound.
- V85 `main` accepts two or three singleton spike legs. A two-spike main requires non-empty `notes` preserving the rationale. Every other V85/V86 system requires exactly three singleton spike legs. The rule is based on authoritative game type plus `system_type`, never budget.
- Migration `0013_combined_analysis_systems.sql` relaxes the storage check to 2/3 spikes and adds `metrics_json`/`notes` while preserving existing systems, selections and post-race reviews.
- Combined persistence is atomic through one D1 batch so a failed import cannot leave a partial reusable submission.
- Context fingerprints ignore time-only market metadata but change when canonical identity or actual market observations change.
- Client numeric fields and `is_spike` use strict JSON types rather than coercive strings/numbers.
- Market-blind validation covers Step-1 leg text, reasoning and `round_summary`, including common Swedish and English market terminology.
- The D1 `too many SQL variables` failure in large horse-pattern context generation is addressed by batching IDs.
- No production migration or deployment is authorized by the PR itself.

## Data inventory and relevant-pattern programme
### Build F - Received-versus-used inventory plus first relevant horse patterns - merged to source main
- PR #88 is merged; merge commit `f7d069f4010e36349fc5743b80a4a9170cc2c38d`.
- Final reviewed Build F branch head was `2a2455f0760a10b550e8174d86f904eaaa5e159c`; its CI passed with 446 tests and zero failures before merge.
- `docs/DATA_INVENTORY.md` traces current official calendar/game/historical-race data, Start Points, X-Labs telemetry, normalized D1 storage, deterministic features and AI exposure.
- `docs/DATA_DICTIONARY.md` is the public field-level companion required by the detailed build plan. It classifies generic fields by source family/path, semantics, type/nullability, normalized target, use status, consumer and provenance rule without real private payload values.
- The inventory distinguishes actual available source facts from schema columns that merely exist but are not reliably populated.
- Build F promotes only already verified facts with clear analytical value: current Start Points plus latest verified change, recent verified X-Labs first-200 pace, last-400 pace and extra travelled distance.
- Horse detail statistics expose these as a compact Swedish `Utveckling & löpstyrka` section with natural labels `Startpoäng`, `Starttempo`, `Avslutning` and `Extra distans`. The section explicitly identifies the values as factual patterns rather than AI judgement and states that its latest-observation summary is independent of the statistics filters above.
- The market-blind Step-1 AI context receives the same factual pattern family. X-Labs history is restricted to races strictly before the target round date, preventing same-day result leakage.
- Start Points are ranked only against non-scratched horses with verified observations in the same current race leg; missing observations remain missing and do not distort the denominator.
- Start Points pattern inputs require a normalized official-provider source record. X-Labs pattern inputs require the verified telemetry quality marker plus the captured race-json source family.
- Higher-risk or not-yet-verified inventory candidates remain deferred: raw 100 m interval/trajectory interpretation, official aggregate snapshots beyond Start Points, structured race-term parsing, equipment-response logic and market `trend` semantics.
- Current official age is not converted into a guessed birth year, and unsupported schema fields remain null rather than inferred.
- Build F changes no model weights, adds no external source, requires no schema migration and does not mutate or reset historical backfills.
- Source completion is separate from production release: Build F is not yet recorded as production-live.

### Build-plan completion audit - active follow-up
- Branch: `feat/build-plan-completion-audit`, based on the merged Build F `main` commit `f7d069f4010e36349fc5743b80a4a9170cc2c38d`.
- `docs/BUILD_PLAN_AUDIT.md` maps the detailed A-F plan and Definition of Done to current implementation and explicitly separates source completion from runtime/release verification and future Build F candidates.
- The audit found no missing A-E functional domain. The material Build F gap was the required field-by-field public data dictionary; that artifact and its contract test are added in this follow-up.
- Exact-width 320/375/430 visual geometry is retained as runtime/browser QA because the repository currently has no real-browser layout engine; CI structural tests are not presented as screenshot/geometry proof.
- This follow-up requires no migration and does not authorize a production deployment or backfill mutation.

## Data and analysis foundation
- GitHub contains public code, schema, tests, configuration and synthetic fixtures only.
- Private raw provider captures and private imports belong in R2/D1, never public GitHub.
- Raw verified facts, deterministic calculated features and AI judgments remain separate layers.
- Unknown factual values remain null and source conflicts are preserved/flagged.
- Official calendar/game/ordinary-race capture and verified normalization are deployed.
- X-Labs remains complementary direct measurement data; missing X-Labs is neutral.
- Current/live official acquisition and recent rolling history jobs continue alongside the persistent multi-year backfills.
- The source workflow proposed by PR #95 is pre-race and provider-neutral: market-blind Step 1, market-aware Step 2 in the same AI conversation, then one final combined import. Production remains on the older workflow until explicit merge/deploy authorization.
- Spike validation in the proposed v2 workflow is game-type/system-type based: V85 `main` may use two or three one-horse spikes, with notes required for two; all other V85/V86 systems require exactly three.
- System row count is the product of selections across all eight legs.
- Post-race learning remains No change / Candidate learning / Confirmed learning; one race never changes model weights automatically.

## Private interface
- `/app` uses `APP_PASSWORD` with a secure HttpOnly session cookie.
- `/app/api/*` remains session-private; operational `/v1/*` routes remain `ADMIN_TOKEN` protected.
- Bottom navigation remains **Trend -> Tränare -> Hästar -> Kuskar -> Bana -> Spel**.
- Entity histories are paginated and private.
- Missing/unsupported fields stay unknown rather than being inferred for display.
- User-facing statistic and pattern labels remain natural Swedish; internal field/provenance names are not exposed as raw UI vocabulary unless technically necessary.

## Production safety
- Never commit real racing payloads, real reference exports, database dumps, secrets or private paid editorial provenance/content.
- Never deploy or apply production migrations unless explicitly authorized.
- Never reset/recreate an existing historical backfill merely because code changes or a release occurs.
