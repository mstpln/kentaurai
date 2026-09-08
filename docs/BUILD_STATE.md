# Build state

Version: 0.5.0
Phase: verified official live/historical foundation with X-Labs scheduled acquisition/backfill build
Status: official live acquisition is merged, deployed and production-smoke-tested; the official multi-year backfill is running; a real X-Labs race object has been captured and normalized in production; PR #41 implements scheduled current V85/V86 X-Labs catch-up plus a separate resumable historical X-Labs backfill and awaits merge/deployment authorization

## Verified foundation
- D1 core schema, indexes and reference-round extension migrations are provisioned in production through migration 0005.
- R2/raw snapshot abstraction preserves exact private source payloads with source/import-run provenance.
- Manual editorial structured import and `kentaurai-reference-v1` import paths are implemented with public/private separation.
- Official-provider calendar/day and game capture are implemented with strict HTTPS/host/redirect/content validation.
- Conservative official-game normalization maps only verified field semantics and leaves unknown facts null.
- Betting, odds and equipment are immutable timestamped snapshots tied to source records.
- Source-name conflicts are preserved and flagged instead of silently replacing canonical names.
- Multi-track rounds do not invent a primary track.
- Live scratch semantics remain explicitly unverified.
- Production normalization is cursor/chunk based to stay within Worker request budgets.
- Raw-vs-normalized verification passed 60/60 checks on the accepted official vertical slice in test coverage.
- Official ordinary-race production capture/normalization has been exercised successfully on representative records.
- A one-day official historical production job completed 28 races with zero errors.
- The production official backfill for 2023-09-08 through 2026-09-07 has been created and observed advancing from its persisted checkpoint with zero errors at the verification point.
- A real X-Labs race object was captured successfully in production, normalized successfully, and stored as `normalized_verified_subset` with 10 normalized rows covering 10 race entries. The verification endpoint also completed with HTTP 200; the Cloudflare test panel did not expose its response body, so the internal `passed` field was not independently visible in that UI.
- Automatic official live acquisition has been production-smoke-tested: a new V86 snapshot was captured through `/v1/live/capture` and the minute scheduler automatically advanced its first normalization checkpoint.

## Automatic official live acquisition
- `15 5 * * *` captures the current UTC date plus the next seven dates and discovers only verified V85/V86 eight-leg games.
- `15 17 * * *` captures upcoming dates but excludes the current date, preserving race-day morning as the final automatic same-day pre-race refresh.
- `* * * * *` continues one official historical backfill checkpoint and one pending live-normalization checkpoint per invocation.
- Calendar discovery requires a matching date, V85/V86 game identity, exactly eight race ids and same-date race identities before a game is fetched.
- Raw calendar and game snapshots are archived before any normalization.
- Partial capture failures are surfaced as failed import/orchestrator runs rather than reported as success.
- Live normalization resumes only from successful contiguous entry checkpoints. A partially written entry, duplicate successful retry, or checkpoint gap cannot silently advance or stall the cursor.
- Admin-only manual live capture/normalize endpoints remain available for explicit refreshes and operational recovery.

## X-Labs scheduled acquisition and backfill in PR #41
- Migration 0006 adds a separate `xlabs_backfill_jobs` checkpoint table with leases, date/race cursors, unavailable-coverage counters and bounded consecutive-error handling.
- Historical X-Labs jobs use scope `historical_all`, run newest-first for up to 1,096 days and wait until the matching official-history date is complete before attempting that date.
- Daily current-data jobs use scope `daily_v85_v86` and target only stored V85/V86 game legs from the previous UTC date. They therefore do not mistake a partially populated ordinary-race day for complete historical coverage.
- `30 4 * * *` creates/reuses the previous-day V85/V86 X-Labs catch-up job. Daily jobs have priority over the long historical X-Labs job.
- The existing minute orchestrator advances at most one X-Labs race checkpoint per invocation in addition to the existing official-history/live-normalization work.
- Date page plus the verified script context are archived/reused before new race-object acquisition; raw race telemetry is archived before normalization.
- Race/date HTTP 404 is classified as neutral unavailable X-Labs coverage and advances the X-Labs checkpoint without contaminating official facts or model state.
- Structural, provenance, host/path, payload identity, timeout and normalization failures remain fail-closed and stop at the same checkpoint after three consecutive technical errors.
- Admin-only `/v1/xlabs/backfill/start`, `/step` and `/status` operations support explicit production smoke tests, resume and monitoring.
- Historical/current X-Labs acquisition remains complementary: missing X-Labs never invalidates official facts.

## Private interface
- `/app` is a private read-only browser interface using `APP_PASSWORD` and a secure HttpOnly session cookie.
- `/app/api/*` is private session-authenticated read API; `ADMIN_TOKEN` is never exposed to the browser.
- `/v1/*` remains operational/admin-token protected.
- Global search covers horses, trainers and drivers.
- Entity lists are paginated and preserve list position when opening/returning from details.
- Entity **Starter** tabs read paginated historical pages rather than relying on a fixed latest-N detail payload.
- Each historical start page is enriched with stored betting, odds, equipment, X-Labs, positions, features, AI and editorial histories only for that page, keeping D1 work bounded as history grows.
- Trainer/driver **Hästar** tabs use a separate paginated linked-horse query so older horse relationships remain discoverable after multi-year backfill.
- Internal provider/source IDs are not primary user-facing content.
- Missing facts and unsupported derived values remain null/unknown.

## Navigation and visual direction
- Bottom navigation is: **Trend -> Tränare -> Hästar -> Kuskar -> Spel**.
- Trend uses the approved chart-line symbol, including the Trend empty state.
- Tränare uses the approved clipboard/pen symbol, Hästar keeps the horse symbol, and Kuskar uses the approved lightbulb symbol.
- Entity detail tiles retain the framed square and display entity initials rather than category icons.
- Initials use up to three meaningful name words; one-word names use the first two letters. Small connector words are skipped where possible.
- The Trend page header is singular **Trend**.
- Trend category controls remain Tränare / Hästar / Kuskar with 2 veckor / 4 veckor / 3 mån / 6 mån / 1 år.
- The timeframe shown inside the trend panel header is plain text, not an outlined pill.
- Entity detail back navigation uses the approved corner/back-arrow treatment.
- The visible logout control and logout endpoint are removed; the private session still expires normally.
- Approved Sagittarius KentaurAI brand mark remains unchanged; the circular badge uses optical sizing beside the KENTAURAI wordmark.
- General UI remains minimal/dark with black, grey, brown and beige plus restrained warm accent color.
- Installable PWA packaging is deliberately deferred until the active data/backfill builds are complete. The known mobile gap is that KentaurAI currently behaves as a browser/home-screen shortcut rather than a true standalone installed app and lacks a dedicated installed-app icon.

## Entity pages
- Trainer and driver roles remain separate analytical pages because their measured data and interpretation differ.
- A person who appears in both roles can move between trainer and driver profiles through a small `Tränare · Kusk` role line under the name.
- Current cross-role navigation is deliberately conservative: it is offered only when private entity search finds exactly one counterpart with the same canonical name. This is a UI convenience, not a persisted shared-person identity assertion.
- A durable shared-person identity must not be introduced until source-backed or manually verified identity semantics are available.
- Person detail tabs are **Statistik -> Starter -> Hästar -> Data**.
- Horse detail tabs are **Statistik -> Starter -> Utrustning -> Data**.
- Horse names in linked-horse lists and start history are navigable to the horse profile.
- The Data tab contains user-relevant profile/database facts and coverage; raw observation timestamps and internal normalization-quality labels are retained for provenance but intentionally hidden from normal profile presentation.

## Entity data coverage
Entity detail APIs and views expose the normalized/measured data already represented by the current schema, grouped so high-volume data does not become one continuous wall of fields.

### Profile and activity
- identity/profile facts, active status, nationality/country and home-track context
- horse sex, birth year/observed age, breed, color, trainer, owner, breeder and pedigree
- horse career earnings and record when stored
- person location, birth year and licence when present in normalized observations
- database starts, result starts, wins, seconds, thirds, top-3, win/top-3 rates, gallops, gallop rate, disqualifications and prize money
- gallop rate uses completed/result starts as its denominator and remains null when there are no result starts
- scratched declarations are tracked separately and excluded from start/performance denominators
- V85 and V86 start counts
- deterministic breakdowns by start method, distance and track

### Paginated per-start facts and histories
- race/game/date/leg, race name/number, track, scheduled time, distance, start method, field size, declared starters, first prize, class/class flags and race/source status
- start number, lane, tier, handicap, actual start distance, back row, inner lane, springspar and scratch fields
- placing, finish time, km time, prize, gallop, disqualification, distance behind winner, official odds and result status
- latest betting percentage/market rank plus full stored betting-snapshot history for each returned start
- latest odds by market type plus full stored odds history for each returned start
- latest equipment plus stored equipment history/change flags for each returned start
- latest X-Labs measurements plus stored X-Labs history and segment data for each returned start
- race-position observations including supported trip/position flags, traffic events and structured event data
- race conditions including track status, temperature, wind, precipitation, weather and day profile
- calculated analysis features with uncertainty/data-quality/version context plus feature history
- stored AI analyses/predictions shown separately from facts/calculated features
- structured editorial signals shown separately from factual and calculated data
- data-coverage counts explicitly show which actual non-scratched starts have market, odds, equipment, X-Labs, positions, features, AI, editorial or race-condition data

The historical page endpoint strips internal race-entry/race IDs from the browser response while retaining `horse_id` where needed for in-app navigation. Structured source/provenance internals remain backend-only.

## X-Labs verified vertical slice
- Browser network inspection established the race-object recipe `1MMDDTTRR.json` on the locked HTTPS host `kmtid.atgx.se`.
- Every captured telemetry frame must match the requested official track id and race number before the raw object is archived.
- The verified mapper reproduces first/last section pace, travelled distance, extra distance and converted kilometre time from the private raw object.
- At least 99% target-frame coverage is required per starter; unsupported or insufficient measurements remain absent.
- The observed telemetry contract has no lane field, so slipstream remains null rather than inferred.
- Raw-vs-normalized verification re-derives every mapped value and requires at least ten representative checks.
- The earlier date-page and allowlisted script capture/inspection routes remain available for provenance and diagnostics.
- Production race-object capture and normalization have been exercised successfully on a real race object. The verification endpoint returned HTTP 200, while its JSON `passed` field could not be directly inspected in the Cloudflare test UI used for the production check.

## Spel
- Spel has exactly three tabs: Översikt, V85 and V86.
- Overview aggregates completed-round accuracy, 8/8 hits, spike hit rate, V85/V86 comparison, result distribution, winner-trip distribution, recurring error types and learning statuses.
- V85/V86 list views are round based and sortable by latest, most/fewest correct and best spike result.
- Every saved system proposal remains preserved; list/overview use a deterministic primary system while round detail can switch saved systems.
- Round detail shows all eight legs with winner, verified trip classification where supported, pre-race rank/probability, system inclusion, spike result, scenario review, error type, km time, odds, concise stored review and round learnings.
- Winner-trip classification never guesses unsupported trips.

## Quality and privacy
- GitHub contains code/schema/tests/docs/synthetic fixtures only.
- No real racing payloads, private reference exports, database dumps, secrets or paid/private editorial provider identity/content may be committed.
- X-Labs tests use synthetic HTML/JavaScript only; no real captured X-Labs payload or script is committed.
- Raw facts, deterministic calculations and AI judgments remain explicitly separated.
- Model weights are not changed after a single round; learnings remain No change / Candidate / Confirmed.
- Entity search/list filters treat SQL wildcard/escape characters literally.
- Data-coverage queries use per-entry `EXISTS` checks to avoid cross-product growth as histories accumulate.
- Scratched entries are excluded from performance and coverage denominators.

## Official historical coverage in 0.5.0
- The date range is inclusive and capped at 1,096 days, covering up to three years per job.
- Daily official calendars select only tracks marked `countryCode=SE` and `sport=trot`.
- Each selected ordinary race is captured from the observed official race endpoint, archived privately and normalized idempotently.
- Stored coverage includes race/track identity, horse, trainer, driver, start position/distance, explicit scratch state, reported equipment and official result facts available in the source.
- Persistent date/race checkpoints, an atomic lease and deterministic source reuse make jobs restart-safe and prevent overlapping checkpoint work.
- One race is processed per scheduled step. Three consecutive source/normalization failures stop the job at the same checkpoint for an explicit resume.
- The production multi-year job for 2023-09-08 through 2026-09-07 is running newest-first from persisted checkpoints.
- This does not claim historical market snapshots, private editorial material, AI analysis, race-position data or X-Labs telemetry where those sources were not captured.

## Current verification gate
1. PR #41 full tests/CI must pass on the exact final head and the exact diff must be reviewed until no blocking issues remain.
2. After explicit merge authorization, migration 0006 must be applied before the Worker version containing X-Labs scheduling is deployed.
3. A small safe production X-Labs backfill job must prove checkpoint creation, capture/normalization and neutral-unavailable handling before a multi-year X-Labs job is started.
4. The multi-year X-Labs backfill must not be started without explicit user authorization after the production smoke gate passes.
5. Continue monitoring the already-running official multi-year backfill independently.
6. Check/import the private reference round if it is still absent from production.

## Next after this build
1. Finish review/fixes/CI for PR #41.
2. With explicit authorization, merge PR #41, apply migration 0006 and deploy the exact reviewed merge.
3. Smoke-test a bounded current/historical X-Labs job in production.
4. With explicit authorization, start the separate historical X-Labs backfill; it will follow official-history readiness rather than outrunning it.
5. Verify tomorrow/current V85/V86 structured data remains healthy while the background jobs operate.
6. Check/import the valid private reference round if still absent.
7. After all active data/backfill builds are complete, build the installable PWA package: manifest, install metadata, standalone behavior and dedicated KentaurAI icons.
8. Build deterministic Trend metrics/leaderboards after sufficient verified history exists.

## Not yet implemented / not yet production-enabled
- verified/persisted shared-person identity across trainer and driver roles; current UI role link is conservative exact-name matching only
- verified live scratch/withdrawal mapping
- additional official-provider endpoint patterns not yet observed
- production migration/deployment and execution of the PR #41 X-Labs scheduler/backfill
- historical trainer/driver/horse trend metrics and leaderboards
- automatic post-race review orchestration
- installable PWA packaging (web manifest, install metadata, standalone launch and dedicated app icons)
- additional winner-trip categories requiring facts not currently represented in the schema
- dead-heat-specific presentation pending a verified source example
- future feature-engine expansion
- KentaurAI AI analysis runner
- system optimizer
