# Build state

Version: 0.5.0
Phase: verified official + X-Labs data foundation with production backfills active
Status: official live acquisition is deployed and smoke-tested; the official multi-year historical backfill is running; verified X-Labs acquisition/normalization is deployed; the production X-Labs vertical-slice gate passed; the separate multi-year X-Labs backfill for 2023-09-08 through 2026-09-07 is running under the existing bounded scheduler; the private reference-round production import has been completed and independently verified; installable KentaurAI PWA packaging and automatic deterministic post-race review are merged to `main`.

## Current production state
- Worker: `kentaurai-api`.
- D1: `kentaurai`.
- R2: `kentaurai-raw`.
- Production migrations are applied through migration 0007; the manual GitHub migration workflow reported no pending migrations at the latest production check.
- Official historical backfill range: 2023-09-08 through 2026-09-07, newest-first, one race checkpoint per scheduled step.
- X-Labs historical backfill range: 2023-09-08 through 2026-09-07, newest-first, one X-Labs checkpoint per minute when eligible.
- The X-Labs historical job does not outrun official history: it waits until the corresponding official date is ready.
- Daily V85/V86 X-Labs catch-up remains separate and has priority over the long historical X-Labs job.
- The private `kentaurai-reference-v1` round is stored in production with archived source provenance and independently verified structural invariants.
- GitHub Actions contains guarded manual production workflows for D1 migrations and for starting/resuming the fixed historical X-Labs job.
- The Worker entrypoint includes the scoped PWA wrapper; public PWA metadata/assets are separate from authenticated app/API responses.
- The minute Worker schedule also attempts at most one eligible deterministic post-race review pass; rounds without eight unambiguous factual winners remain untouched.

## Verified foundation
- D1 core schema, indexes, reference-round extensions, X-Labs backfill schema and current production migrations are provisioned.
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

## Automatic official live acquisition
- `15 5 * * *` captures the current UTC date plus the next seven dates and discovers only verified V85/V86 eight-leg games.
- `15 17 * * *` captures upcoming dates but excludes the current date, preserving race-day morning as the final automatic same-day pre-race refresh.
- `* * * * *` continues one official historical backfill checkpoint, one pending live-normalization checkpoint, at most one eligible X-Labs checkpoint and one bounded post-race review attempt per invocation.
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
- The long historical job uses scope `historical_all` and covers all eligible normalized Swedish races.
- Historical X-Labs waits for matching official-history readiness before attempting a date.
- Date page plus verified script context are archived/reused before new race-object acquisition; raw race telemetry is archived before normalization.
- Race/date HTTP 404 is neutral unavailable X-Labs coverage and advances the checkpoint without contaminating official facts or model state.
- Structural, provenance, host/path, payload-identity, timeout and normalization failures stay on the same checkpoint and stop the job after three consecutive technical errors until explicitly resumed.
- The multi-year historical X-Labs job for 2023-09-08 through 2026-09-07 was explicitly authorized and successfully started in production through the guarded GitHub workflow.

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

## Navigation and visual direction
- Bottom navigation is: **Trend -> Tränare -> Hästar -> Kuskar -> Spel**.
- Trend uses the approved chart-line symbol.
- Tränare uses clipboard/pen, Hästar uses the horse symbol and Kuskar uses the lightbulb symbol.
- Entity detail tiles display entity initials rather than category icons.
- Trend category controls remain Tränare / Hästar / Kuskar with 2 veckor / 4 veckor / 3 mån / 6 mån / 1 år.
- Approved Sagittarius KentaurAI branding remains unchanged and is also used for the installable PWA icons.
- General UI remains minimal/dark with black, grey, brown and beige plus restrained warm accent color.

## Entity/data coverage
- Horse, trainer and driver remain separate analytical entities.
- Person detail tabs are **Statistik -> Starter -> Hästar -> Data**.
- Horse detail tabs are **Statistik -> Starter -> Utrustning -> Data**.
- A conservative exact-name cross-role link may connect trainer/driver views; this is not a persisted shared-person identity assertion.
- Stored views expose factual race/start/result/market/equipment/X-Labs/position/condition data separately from calculated features, AI analyses and editorial signals.
- Start history supports complete paginated stored history rather than a permanent latest-N cap.
- Scratched declarations are excluded from performance and coverage denominators.
- Missing values stay unknown rather than being inferred for presentation.

## Spel
- Spel has exactly three tabs: Översikt, V85 and V86.
- Every saved V85/V86 system obeys the exactly-three-spikes rule.
- Overview/list views use a deterministic primary system while round detail can inspect preserved alternatives.
- Round detail separates pre-race assessment, result facts and post-race learning.
- Winner-trip classification is shown only when stored evidence supports it.
- Automatic deterministic review requires eight legs with exactly one factual winner each; ambiguous/dead-heat rounds fail closed.
- Review writes are deterministic, resumable and idempotent per system/race, including protection against duplicate legacy review rows.
- Covered winners are No change; missed winners are Candidate learning, with spike misses distinguished from ordinary coverage misses.
- Learning remains No change / Candidate / Confirmed; one race or round never changes model weights directly.

## Quality and privacy
- GitHub contains code/schema/tests/docs/synthetic fixtures only.
- No real racing payloads, private reference exports, database dumps, secrets or paid/private editorial provider identity/content may be committed.
- Production reference verification is aggregate/invariant based and must not print private reference values into public Actions logs.
- X-Labs tests use synthetic HTML/JavaScript only; no real captured X-Labs payload or script is committed.
- Raw facts, deterministic calculations and AI judgments remain explicitly separated.
- Historical imports are checkpointed, lease-protected and idempotent.
- Post-race review does not create model changes and does not infer unsupported scenario explanations.
- PWA caching is restricted to public static metadata/assets and does not create an offline cache of private KentaurAI data.

## Current verification/operations gate
1. Keep the official and X-Labs multi-year backfills running independently through their persisted checkpoints.
2. Monitor for repeated technical failures rather than reacting to isolated neutral X-Labs unavailability.
3. Verify upcoming/current V85/V86 official acquisition and daily X-Labs catch-up remain healthy while the long jobs run.
4. Keep the verified private reference round as a fixed reference fixture in private production storage; do not commit its payload to GitHub.
5. Do not change model weights or begin AI modelling merely because one round or one telemetry sample looks interesting.

## Next build sequence
1. Let official + historical X-Labs population continue in the background and monitor operational health.
2. Assess accumulated verified history against explicit minimum-sample requirements for deterministic Trend metrics/leaderboards.
3. Build deterministic Trend metrics/leaderboards once the production history is sufficient.
4. Expand the deterministic feature engine only with calculations supported by stored factual inputs.
5. Only then move into the KentaurAI AI analysis runner, value assessment and system optimizer, keeping raw facts, calculated features and AI judgments separate.

## Not yet implemented / intentionally deferred
- verified/persisted shared-person identity across trainer and driver roles
- verified live scratch/withdrawal mapping
- additional official-provider endpoint patterns not yet observed
- historical trainer/driver/horse Trend leaderboards with production minimum-sample rules
- additional winner-trip categories requiring facts not currently represented in the schema
- dead-heat-specific post-race semantics/presentation pending a verified source example
- future feature-engine expansion
- KentaurAI AI analysis runner
- deterministic value assessment against market percentage
- system optimizer
