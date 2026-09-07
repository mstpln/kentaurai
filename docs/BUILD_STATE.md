# Build state

Version: 0.4.5
Phase: interface foundation on verified official data layer
Status: Trend/navigation polish and complete measured entity-data presentation are in PR review; automatic live acquisition remains disabled

## Verified foundation
- D1 core schema, indexes and reference-round extension migrations are provisioned.
- R2/raw snapshot abstraction preserves exact private source payloads with source/import-run provenance.
- Manual editorial structured import and `kentaurai-reference-v1` import paths are implemented with public/private separation.
- Official-provider calendar/day and game capture are implemented with strict HTTPS/host/redirect/content validation.
- Conservative official-game normalization maps only verified field semantics and leaves unknown facts null.
- Betting, odds and equipment are immutable timestamped snapshots tied to source records.
- Source-name conflicts are preserved and flagged instead of silently replacing canonical names.
- Multi-track rounds do not invent a primary track.
- Live scratch semantics remain explicitly unverified.
- Production normalization is cursor/chunk based to stay within Worker request budgets.
- Raw-vs-normalized verification passed 60/60 checks on the accepted official vertical slice.
- Automatic live acquisition is still off.

## Private interface
- `/app` is a private read-only browser interface using `APP_PASSWORD` and a secure HttpOnly session cookie.
- `/app/api/*` is private session-authenticated read API; `ADMIN_TOKEN` is never exposed to the browser.
- `/v1/*` remains operational/admin-token protected.
- Global search covers horses, trainers and drivers.
- Entity lists are paginated and preserve list position when opening/returning from details.
- Internal provider/source IDs are not primary user-facing content.
- Missing facts and unsupported derived values remain null/unknown.

## Navigation and visual direction
- Bottom navigation is: **Trend -> Tränare -> Hästar -> Kuskar -> Spel**.
- Trend uses the approved chart-line symbol shown in the production-feedback reference.
- Tränare uses a brain symbol, Hästar keeps the horse symbol, and Kuskar uses the approved flexed-arm symbol.
- Entity detail tiles retain the existing framed square; initials are replaced by the same entity-type symbol used in bottom navigation.
- The Trend page header is singular **Trend**.
- Trend category controls remain Tränare / Hästar / Kuskar with 2 veckor / 4 veckor / 3 mån / 6 mån / 1 år.
- The timeframe shown inside the trend panel header is plain text, not an outlined pill.
- The visible logout control and logout endpoint are removed; the private session still expires normally.
- Approved Sagittarius KentaurAI brand mark remains unchanged.
- General UI remains minimal/dark with black, grey, brown and beige plus restrained warm accent color.

## Entity data coverage in 0.4.5
Entity detail APIs and views now expose the normalized/measured data already represented by the current schema, grouped so high-volume data does not become one continuous wall of fields.

### Profile and activity
- identity/profile facts, active status, nationality/country and home-track context
- horse sex, birth year/observed age, breed, color, trainer, owner, breeder and pedigree
- horse career earnings and record when stored
- person location, birth year and licence when present in normalized observations
- database starts, result starts, wins, seconds, thirds, top-3, win/top-3 rates, gallops, disqualifications and prize money
- V85 and V86 start counts
- deterministic breakdowns by start method, distance and track

### Per-start facts and histories
- race/game/date/leg, race name/number, track, scheduled time, distance, start method, field size, declared starters, first prize, class/class flags and race/source status
- start number, lane, tier, handicap, actual start distance, back row, inner lane, springspar and scratch fields
- placing, finish time, km time, prize, gallop, disqualification, distance behind winner, official odds and result status
- latest betting percentage/market rank plus full stored betting-snapshot history
- latest odds by market type plus full stored odds history
- latest equipment plus complete stored equipment history/change flags
- latest X-Labs measurements plus stored X-Labs history and segment data
- race-position observations including supported trip/position flags, traffic events and structured event data
- race conditions including track status, temperature, wind, precipitation, weather and day profile
- calculated analysis features with uncertainty/data-quality/version context plus feature history
- stored AI analyses/predictions shown in a separate section from facts/calculated features
- structured editorial signals shown separately from factual and calculated data
- data-coverage counts explicitly show which starts have market, odds, equipment, X-Labs, positions, features, AI, editorial or race-condition data

Arbitrary structured fields are displayed as readable key/value groups rather than raw JSON where practical. Internal feature provenance is retained in the backend but intentionally not rendered as normal user-facing data.

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
- Raw facts, deterministic calculations and AI judgments remain explicitly separated.
- Model weights are not changed after a single round; learnings remain No change / Candidate / Confirmed.

## Current verification gate
1. Run full CI on the exact final PR #13 head.
2. Review the exact diff for data completeness, null semantics, query correctness, privacy, read-only behavior, responsive layout and existing route preservation.
3. Fix any blocking issues and repeat CI/review until clean.
4. Update PR #13 with final verified head and scope.
5. Merge only after explicit user authorization.
6. After deployment, visually verify Trend/nav icons, plain timeframe label and representative trainer/horse/driver detail pages on desktop and mobile.

## Not yet implemented
- verified live scratch/withdrawal mapping
- automatic live provider acquisition
- additional official-provider endpoint patterns not yet observed
- historical trainer/driver/horse trend metrics and leaderboards
- automatic post-race result collection/review orchestration
- additional winner-trip categories requiring facts not currently represented in the schema
- dead-heat-specific presentation pending a verified source example
- X-Labs acquisition adapter
- 2-3 year historical backfill
- future feature-engine expansion
- KentaurAI AI analysis runner
- system optimizer
