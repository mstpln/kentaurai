# Build state

Version: 0.6.0
Updated: 2026-09-11

## Current production state
- Production Worker: `kentaurai-api`.
- D1: `kentaurai`.
- R2: `kentaurai-raw`.
- Actual Worker entrypoint: `src/worker-v064.js`.
- Statistics Build C is merged and production-live after GitHub Actions release run `34631237134`.
- Release QA passed with 411 tests and zero failures before production changes.
- Worker deployment, `/health`, `/app/login` and the private analysis-prompt authorization check all passed.
- Deployed Worker version ID from that release: `e6619d15-554c-475f-ab0b-fbfeb89f854a`.
- Production D1 reported `No migrations to apply` during that release. Repository migrations through `0011_driver_statistics_indexes.sql` were therefore already registered/applied at release time.
- Official and X-Labs historical backfills use persisted jobs/cursors. Deployments and statistics work must never recreate, reset or silently restart them.

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

### Build D - Trainer statistics - active feature branch
- Branch: `feat/trainer-statistics-build-d`.
- Scope follows the detailed statistics plan and reuses the shared core, market, volt-lane, handicap and rest semantics established by Builds A-C.
- Planned rankings include win/top-three rates, wins, latest-30 placements-only form, annual/average earnings, auto/volt, volt-lane/tillägg, verified home/other track performance, distance profile, favorite/longshot, and first/second start after at least 60 days of rest.
- Trainer home-track statistics must use verified official home-track observations rather than inferred location/name relationships.
- No production migration/deployment or backfill mutation is part of Build D until separately released after review and explicit merge authorization.

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
