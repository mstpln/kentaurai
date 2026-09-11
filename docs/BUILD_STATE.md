# Build state

Version: 0.6.0
Updated: 2026-09-11

## Current production state
- Production Worker: `kentaurai-api`.
- D1: `kentaurai`.
- R2: `kentaurai-raw`.
- Actual Worker entrypoint: `src/worker-v064.js`.
- Controlled AI Build E is merged and production-live after GitHub Actions release run `34642352908`.
- Release QA passed with 441 tests and zero failures before production changes.
- Worker deployment, `/health`, `/app/login` and the private analysis-prompt authorization check all passed.
- Deployed Worker version ID from that release: `465768c5-3106-4164-a27c-69ae34d9e6ec`.
- Production D1 reported `No migrations to apply` during that release. Repository migration tracking remains current through `0012_trainer_statistics_indexes.sql`.
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
- The existing provider-neutral analysis exchange remains the single AI pipeline; Build E hardens its export/import contract rather than introducing autonomous model execution in the Worker.
- Every export carries the immutable KentaurAI context envelope in `analysis_contexts`: canonical round/race/race-entry identities and exact context fingerprint are supplied by KentaurAI rather than entered by the user.
- `pre_market` is market-blind. Current betting percentages, odds, turnover and jackpot remain excluded until that provider has a stored pre-market analysis.
- Final analysis is parent-bound and cannot rewrite stored probability/rank/ABCD strength.
- Final market context uses `verified-market-at-stop-v1`: betting and odds rows must be source-backed, belong to the exact round/race entry and be observed no later than the verified betting stop/current stable analysis cutoff.
- Supported final submissions write analysis, predictions, systems and selections through the dedicated verified final importer using the already verified market object as the sole market input.
- New analysis submissions accept only canonical `openai` or `anthropic` producer identities at this version; `producer.model` stores the actual model identity.
- Output filename guidance includes provider, actual-model slug and phase, while JSON producer fields remain authoritative.
- Server-side validation rejects stale fingerprints, wrong/missing parents, wrong/missing race-entry identities, post-deadline pre-market creation, invalid spike structure and changed content under an existing submission ID. Exact retries remain idempotent no-ops.
- No new D1 migration was required by Build E and the release did not reset or recreate historical backfills.

## Data inventory programme
### Build F - Full received-versus-used data inventory - active feature branch
- Branch: `feat/data-inventory-build-f`, based on the post-Build-E production-release main commit `5ba8cb154b65da14bc7c71845549236198f0bfb0`.
- `docs/DATA_INVENTORY.md` traces current official calendar/game/historical-race data, Start Points, X-Labs telemetry, normalized D1 storage, deterministic features and AI exposure.
- The inventory distinguishes actual available source facts from schema columns that merely exist but are not reliably populated.
- Highest-value received-but-underused findings include X-Labs 100 m interval/trajectory data, official horse record and aggregate statistics beyond Start Points, Start Points history/dynamics, structured race terms, driver-horse combinations, trainer-relative form and equipment-response history.
- Current official marking-pool `trend`, turnover and system-count fields are treated as market-stage candidates only; exact trend semantics must be verified before normalization.
- Current official age must not be converted into a guessed birth year, and unsupported breed/position/equipment fields remain null.
- Build F is inventory/prioritization only. It does not silently promote unverified raw fields into model logic and does not change production schema or backfills.

## Data and analysis foundation
- GitHub contains public code, schema, tests, configuration and synthetic fixtures only.
- Private raw provider captures and private imports belong in R2/D1, never public GitHub.
- Raw verified facts, deterministic calculated features and AI judgments remain separate layers.
- Unknown factual values remain null and source conflicts are preserved/flagged.
- Official calendar/game/ordinary-race capture and verified normalization are deployed.
- X-Labs remains complementary direct measurement data; missing X-Labs is neutral.
- Current/live official acquisition and recent rolling history jobs continue alongside the persistent multi-year backfills.
- External AI analysis exchange remains pre-race, provider-neutral and split into market-blind and market-aware stages.
- Every saved V85/V86 system must contain exactly three one-horse spikar in three different legs; row count is the product of selections across all eight legs.
- Post-race learning remains No change / Candidate learning / Confirmed learning; one race never changes model weights automatically.

## Private interface
- `/app` uses `APP_PASSWORD` with a secure HttpOnly session cookie.
- `/app/api/*` remains session-private; operational `/v1/*` routes remain `ADMIN_TOKEN` protected.
- Bottom navigation remains **Trend -> Tränare -> Hästar -> Kuskar -> Bana -> Spel**.
- Entity histories are paginated and private.
- Missing/unsupported fields stay unknown rather than being inferred for display.

## Production safety
- Never commit real racing payloads, real reference exports, database dumps, secrets or private paid editorial provenance/content.
- Never deploy or apply production migrations unless explicitly authorized.
- Never reset/recreate an existing historical backfill merely because code changes or a release occurs.
