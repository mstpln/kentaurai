# Build state

Version: 0.6.0
Phase: verified official + X-Labs data foundation with production backfills active
Status: v0.6.0 is deployed in production; migration 0008, Worker health, private login and the analysis-prompt route were verified by the successful production release after PR #77. PR #78 and PR #79 are merged on main. PR #79 completed the canonical race-level/statistics/UI follow-up, including `Loppnivå = All data / Högre prissumma / Vardagstrav`, filtered entity summaries and historical V75/V85/V86 race-level evidence. Migration 0009 has not yet been production-applied or verified, and the PR #79 code is not yet production-live. The official multi-year historical backfill and separate multi-year X-Labs backfill remain active on their persisted cursors and were not reset or recreated by these builds.

## Current production state
- Worker: `kentaurai-api`.
- D1: `kentaurai`.
- R2: `kentaurai-raw`.
- Production migrations are applied through migration 0008. The production release verified the 0008 track-contact columns and calculated race-classification tables before deploying the Worker.
- Repository migration 0009 adds fact-level provenance for researched track contact facts. It is present on main after merged PR #78 but must not be assumed production-applied until an authorized release applies and verifies it.
- Production `/health` was verified against KentaurAI `0.6.0`; `/app/login` and the private analysis-prompt route were also verified after the release.
- Official historical backfill range: 2023-09-08 through 2026-09-07, newest-first, up to three sequential race checkpoints per minute when eligible.
- X-Labs historical backfill range: 2023-09-08 through 2026-09-07, newest-first, up to three sequential X-Labs checkpoints per minute when eligible.
- The X-Labs historical job does not outrun official history: it waits until the corresponding official date is ready.
- Daily V85/V86 X-Labs catch-up remains separate and has priority over the long historical X-Labs job.
- A rolling three-day official ordinary-race catch-up is created at the existing 04:30 UTC scheduling point so recent historical coverage remains current and short scheduler gaps can self-heal.
- The private `kentaurai-reference-v1` round is stored in production with archived source provenance and independently verified structural invariants.
- Existing official and X-Labs backfill jobs are persistent and must continue from their stored cursors across deployments; the merged completion work does not recreate, reset or restart them.
- The Worker entrypoint is `src/worker-v064.js` and includes the scoped PWA wrapper; public PWA metadata/assets are separate from authenticated app/API responses.
- The minute Worker schedule also attempts at most one eligible deterministic post-race review pass; rounds without eight unambiguous factual winners remain untouched.

## Verified foundation
- D1 core schema, indexes, reference-round extensions, X-Labs backfill schema and production migrations through 0008 are provisioned.
- R2/raw snapshot handling preserves exact private source payloads with source/import-run provenance.
- Manual editorial structured import and `kentaurai-reference-v1` import paths are implemented with public/private separation.
- The private reference-round browser import is deployed without a client-JavaScript dependency; production import and persistence were independently verified without exposing the private payload in GitHub.
- Reference-round verification confirmed the stored round/legs/entries, reference analyses and predictions, probability-sum invariants, systems and exactly-three-spikes contract.
- Official-provider calendar/day, game and ordinary-race capture use strict HTTPS/host/redirect/content validation.
- Conservative official normalization maps only verified field semantics and leaves unknown facts null.
- Betting, odds and equipment are immutable timestamped snapshots tied to source records.
- Source-name conflicts are preserved and flagged instead of silently replacing canonical names.
- Multi-track rounds do not invent a primary track.
- Live scratch semantics remain explicitly unverified.
- Production game normalization is cursor/chunk based to stay within Worker request budgets.
- Official ordinary-race production capture/normalization has been exercised successfully on representative records.
- A one-day official historical production job completed 28 races with zero errors before the multi-year job was started.
- The production official backfill for 2023-09-08 through 2026-09-07 has been observed advancing from its persisted checkpoint.
- Official race first-prize mapping is implemented deterministically from verified prize text; malformed/unknown prize text stays null and existing source-backed facts are not overwritten by conflicting later observations.
- Existing already-normalized official race observations can be repaired from archived source-backed data without refetching.
- Form, class-exposure and development deterministic features use strict-null semantics so missing factual inputs do not silently become zero or partial certainty.
- Trend readiness has an explicit fail-closed minimum-sample/date-coverage contract; actual leaderboards remain deferred until production history is sufficient.

## Automatic official live acquisition
- `15 5 * * *` captures the current UTC date plus the next seven dates and discovers only verified V85/V86 eight-leg games.
- `15 17 * * *` captures upcoming dates but excludes the current date, preserving race-day morning as the final automatic same-day pre-race refresh.
- `* * * * *` attempts pending live normalization first, then continues up to three sequential official historical checkpoints and up to three sequential eligible X-Labs checkpoints, plus one bounded post-race review attempt per invocation.
- Calendar discovery requires a matching date, V85/V86 game identity, exactly eight race ids and same-date race identities before a game is fetched.
- Raw calendar and game snapshots are archived before normalization.
- Partial capture failures are surfaced as failed import/orchestrator runs rather than silently reported as success.
- Live normalization resumes only from successful contiguous entry checkpoints.
- Admin-only manual live capture/normalize endpoints remain available for explicit refreshes and operational recovery.

## X-Labs verified vertical slice
- Browser network inspection established the race-object recipe `1MMDDTTRR.json` on the locked HTTPS X-Labs host.
- Every captured telemetry frame must match the requested official track id and race number before the raw object is archived.
- The verified mapper reproduces first/last section pace, travelled distance, extra distance and converted kilometre time from the private raw object.
- At least 99% target-frame coverage is required per starter; unsupported or insufficient measurements remain absent.
- The observed telemetry contract has no lane field, so slipstream remains null rather than inferred.
- Raw-vs-normalized verification re-derives accepted mapped values from the archived source.
- The context-resolution fast path introduced before the production smoke uses only verified bounded `calculate.js` + `main.js` context and falls back fail-closed to the stricter resolver when the fast path cannot prove the expected request context.
- Production single-day smoke for 2026-09-06 completed through the existing scheduler: 28 processed races, 16 neutral unavailable races, 1 reused race and no remaining consecutive-error condition at completion.
- That smoke demonstrated successful available-race capture/normalization plus neutral 404/unavailable handling without recurrence of the previous persistent context-resolution blocker.

## X-Labs scheduling and historical acquisition
- `30 4 * * *` creates/reuses the previous-day V85/V86 X-Labs catch-up job.
- Daily jobs use scope `daily_v85_v86` and target only stored normalized V85/V86 game legs.
- Stale daily jobs whose required official live prerequisite never existed are closed safely once their target is older than yesterday; this does not falsely mark X-Labs telemetry unavailable.
- The long historical job uses scope `historical_all` and covers all eligible normalized Swedish races.
- Historical X-Labs waits for matching official-history readiness before attempting a date.
- Date page plus verified script context are archived/reused before new race-object acquisition; raw race telemetry is archived before normalization.
- Race/date HTTP 404 is neutral unavailable X-Labs coverage and advances the checkpoint without contaminating official facts or model state.
- Structural, provenance, host/path, payload-identity, timeout and normalization failures stay on the same checkpoint and stop the job after three consecutive technical errors until explicitly resumed.
- The multi-year historical X-Labs job for 2023-09-08 through 2026-09-07 was explicitly authorized and successfully started in production through the guarded GitHub workflow.
- Historical batches never parallelize source requests. Each successful race is durably checkpointed before the next begins; completion, busy/idle state, dependency waits or a technical failure stop the remaining source batch. Rate limits, access pushback, temporary upstream failures and timeouts apply bounded persistent cooldowns without advancing the failed checkpoint.
- Existing official and X-Labs jobs continue from their stored cursors after deployment; this batching change does not recreate, restart or reinitialize them.

## Provider-neutral analysis exchange
- KentaurAI is the factual database, deterministic calculation and persistence layer; it does not run a separate autonomous AI model inside the Worker.
- ChatGPT, Claude or another authorized external AI client can use the same private structured exchange and store independent analyses for the same round without overwriting each other.
- The exchange is pre-race only and requires a verified future betting/start deadline so post-race facts cannot leak into a new pre-race analysis.
- `pre_market` context exposes official facts, verified historical starts/X-Labs, approved market-blind deterministic feature versions and structured editorial signals while excluding current betting percentages, odds, turnover and jackpot.
- A stored `pre_market` submission records scenarios, ranking, ABCD, win probabilities, uncertainty and reasoning for every active entry.
- `market` context is available only after a stored pre-market parent. A final submission may add recommendations and systems but cannot rewrite the parent market-blind probabilities/ranks/ABCD assessment.
- KentaurAI derives value ratio from stored probability versus stored market percentage; AI clients do not supply value or market percentage as factual inputs.
- Every analysis context has a stable SHA-256 fingerprint. Changed current context requires a fresh submission.
- Submission IDs are immutable idempotency keys: an exact retry is a no-op, while changed content under the same ID is rejected.
- Every stored V85/V86 system must cover all eight legs and contain exactly three actual one-horse spike legs. KentaurAI derives row count and spike count rather than trusting client totals.
- Analysis exchange routes live under `/v1/analysis/*` and use existing `ADMIN_TOKEN` authentication; real submissions remain private in D1.
- The private Settings view also contains a version-bound helper for copying the exact client instructions needed to create a compatible JSON import file. The helper keeps pre-market and final submission shapes separate and does not allow an AI client to supply KentaurAI-calculated market/value fields.
- The detailed contract is documented in `docs/ANALYSIS_EXCHANGE.md`.

## Private interface
- `/app` is a private browser interface using `APP_PASSWORD` and a secure HttpOnly session cookie.
- `/app/api/*` is private session-authenticated API; `ADMIN_TOKEN` is never exposed to the browser.
- `/app/import/reference-round` accepts the private reference export through an authenticated multipart form and sends it directly to the Worker without committing it to GitHub.
- `/v1/*` remains operational/admin-token protected.
- KentaurAI is packaged as an installable PWA with a scoped `/app/` manifest, standalone launch behavior and dedicated Sagittarius app/maskable icons.
- The service worker caches only public PWA metadata/icon assets; authenticated app HTML and `/app/api/*` responses are not cached.
- Global search covers horses, trainers and drivers.
- Entity lists are paginated and preserve list position when opening/returning from details.
- Entity **Starter** tabs read paginated historical pages rather than relying on a fixed latest-N detail payload.
- Each historical start page is enriched with stored betting, odds, equipment, X-Labs, positions, features, AI and editorial histories only for that page, keeping D1 work bounded as history grows.
- Trainer/driver **Hästar** tabs use a separate paginated linked-horse query so older horse relationships remain discoverable after multi-year backfill.
- Internal provider/source IDs are not primary user-facing content.
- Missing facts and unsupported derived values remain null/unknown.
- Bana has list/detail views with **Översikt -> Spårstatistik -> Hemmatränare**. Stored track profile facts are shown only when verified; address/website fields are nullable and hidden when unavailable.
- Bana spårstatistik supports period, startmetod, loppnivå and canonical distance together with independent optional **STL-klass** and **Lopptyp** filters. These filters combine in the backend query. STL/race-type classifications are deterministic calculated data stored separately from raw race facts.
- Loppnivå is `All data / Högre prissumma / Vardagstrav`. `Högre prissumma` qualifies through stored V75/V85/V86 game identity, source-backed historical V75/V85/V86 calendar membership, verified STL evidence, or `first_prize_sek >= 100000`; GS75 identity alone does not qualify. `Vardagstrav` is the null-safe complement, so unknown first prize remains unknown without dropping the race from both groups.
- PR #79 is merged and owns the essential Bana filter state/query wiring, address formatting, Settings analysis CTA and V85/V86 round-count label in the canonical render path. `All data` remains literal and `SE` is presented as `Sverige` without altering stored country codes.
- The completion build adds an `ADMIN_TOKEN`-protected exact-ID track-contact target/enrichment path. Researched real values stay private; conflicts are recorded and do not overwrite an existing different fact.

## Navigation and visual direction
- Bottom navigation is: **Trend -> Tränare -> Hästar -> Kuskar -> Bana -> Spel**.
- Trend uses the approved chart-line symbol and Bana uses the approved map-pin/oval symbol.
- Tränare uses clipboard/pen, Hästar uses the horse symbol and Kuskar uses the lightbulb symbol.
- Entity detail tiles display entity initials rather than category icons.
- Trend category controls remain Tränare / Hästar / Kuskar with 2 veckor / 4 veckor / 3 mån / 6 mån / 1 år.
- Approved Sagittarius KentaurAI branding remains unchanged and is also used for the installable PWA icons.
- General UI remains minimal/dark with black, grey, brown and beige plus restrained warm accent color.

## Entity/data coverage
- Horse, trainer and driver remain separate analytical entities.
- Person detail tabs are **Statistik -> Starter -> Hästar -> Data**.
- Horse detail tabs are **Statistik -> Starter -> Data**; equipment for historical starts is shown within the expandable Starter history instead of a duplicate Utrustning tab.
- A conservative exact-name cross-role link may connect trainer/driver views; this is not a persisted shared-person identity assertion.
- Stored views expose factual race/start/result/market/equipment/X-Labs/position/condition data separately from calculated features, AI analyses and editorial signals.
- Start history supports complete paginated stored history rather than a permanent latest-N cap.
- Scratched declarations are excluded from performance and coverage denominators.
- Missing values stay unknown rather than being inferred for presentation.
- User-facing presentation uses natural Swedish labels for known statuses, rankings, post-race miss types, countries and structured data fields while keeping internal storage/API identifiers technical.

## Spel and post-race review
- Spel has exactly three tabs: Översikt, V85 and V86.
- Every saved V85/V86 system obeys the exactly-three-spikes rule.
- Overview/list views use a deterministic primary system while round detail can inspect preserved alternatives.
- Round detail separates pre-race assessment, result facts and post-race learning.
- Winner-trip classification is shown only when stored evidence supports it.
- Automatic deterministic review requires eight legs with exactly one factual winner each; ambiguous/dead-heat rounds fail closed.
- Review writes are deterministic, resumable and idempotent per system/race, including protection against duplicate legacy review rows.
- Covered winners are No change; missed winners are Candidate learning, with spike misses distinguished from ordinary coverage misses.
- Learning remains No change / Candidate / Confirmed; one race or round never changes analysis rules or model weights directly.
- Settings counts stored V85/V86 rounds separately from the Spel overview count of actually saved systems; the Settings label is **V85/V86-omgångar** to avoid conflating those measures.

## Quality and privacy
- GitHub contains code/schema/tests/docs/synthetic fixtures only.
- No real racing payloads, private reference exports, database dumps, secrets, researched production track-contact dataset or paid/private editorial provider identity/content may be committed.
- Production reference verification is aggregate/invariant based and must not print private reference values into public Actions logs.
- X-Labs tests use synthetic HTML/JavaScript only; no real captured X-Labs payload or script is committed.
- Raw facts, deterministic calculations and AI judgments remain explicitly separated.
- Historical imports are checkpointed, lease-protected and idempotent.
- Post-race review does not create model changes and does not infer unsupported scenario explanations.
- PWA caching is restricted to public static metadata/assets and does not create an offline cache of private KentaurAI data.

## Current verification/operations gate
1. Keep the official and X-Labs multi-year backfills running independently through their persisted checkpoints; do not reset or recreate them.
2. PR #79 is merged on main at merge commit `43fa58139f0bb3886f6444fe5c99a8c8e9319200`; do not repeat the completed review/merge gate.
3. Apply pending migration 0009 if still needed and deploy the exact reviewed main head through the authorized production path.
4. Verify `/health` and private authentication, then verify the actual authenticated application shows the Settings AI CTA, V85/V86 count label, Swedish presentation, filtered entity summaries and combined statistics/Bana filters including Loppnivå.
5. Confirm the existing official and X-Labs backfill state remains intact after deployment.
6. Perform real track-contact research/enrichment separately through the private exact-ID path without committing the dataset.

## Next build sequence
1. Complete the pending migration/deployment and production verification gate above.
2. Let official + historical X-Labs population continue in the background and verify the natural rolling-history executions.
3. Use the provider-neutral analysis exchange on an upcoming live V85/V86 round and verify the first private read -> external AI analysis -> stored submission round trip.
4. Assess accumulated verified history against the Trend readiness contract and build deterministic Trend metrics/leaderboards once production history is sufficient.
5. Expand deterministic factual features and objective post-race scoring/calibration only where stored source data supports the calculation.
6. Keep interpretation, rankings, probabilities, value judgment and betting suggestions in the replaceable external AI analysis layer; do not add an autonomous Worker AI runner unless the product direction is explicitly changed later.

## Not yet implemented / intentionally deferred
- verified/persisted shared-person identity across trainer and driver roles
- verified live scratch/withdrawal mapping
- additional official-provider endpoint patterns not yet observed
- historical trainer/driver/horse Trend leaderboards once production minimum-sample rules pass
- additional winner-trip categories requiring facts not currently represented in the schema
- dead-heat-specific post-race semantics/presentation pending a verified source example
- future deterministic feature-engine expansion
- expanded objective probability/ranking/system calibration reports across accumulated rounds
- any autonomous in-Worker AI analysis runner (not currently planned)
