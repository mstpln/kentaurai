# KentaurAI

Private V85/V86 data, analysis backend and read-only intelligence interface with a public codebase.

## Current build
Version 0.6.0 contains the verified official/X-Labs data foundation, resumable ordinary-race history pipeline, automatic official V85/V86 pre-race acquisition, separately checkpointed X-Labs acquisition, installable PWA packaging, deterministic automatic post-race review and the private Bana workspace. Real provider payloads and private reference/editorial/contact data remain outside the public repository; GitHub contains code, migrations, tests, documentation and synthetic fixtures only.

The current build contains:
- D1 normalized relational schema and provenance model
- R2 exact raw-snapshot support
- private import APIs for reference-round and structured editorial data
- private official-provider calendar/day, game and ordinary-race capture
- verified official-game normalizer for the observed live payload shape
- automatic upcoming V85/V86 calendar/game capture twice daily with race-day morning as the final automatic same-day refresh
- bounded, resumable automatic normalization of captured V85/V86 game snapshots
- immutable normalized observations plus timestamped betting/odds/equipment snapshots
- private raw-vs-normalized verification endpoint
- private read-only KentaurAI interface at `/app`
- installable scoped PWA packaging with KentaurAI Sagittarius icons and no caching of authenticated app/API data
- global horse/trainer/driver search
- paginated entity lists and grouped detail pages for horses, trainers and drivers
- paginated full start-history reads per horse/trainer/driver, with all stored measurement families enriched only for the current page
- paginated linked-horse history for trainer/driver profiles
- Trend workspace with category/time-period controls
- Bana list/detail with Översikt, Spårstatistik and Hemmatränare; track statistics combine period, start method, distance, STL class and race type
- nullable track address/website presentation with fact-level provenance for private enrichment
- Spel area with Översikt / V85 / V86 plus saved-round post-race detail
- deterministic automatic post-race review for fully settled saved V85/V86 systems, with misses recorded as candidate learning only and no automatic model changes
- complete presentation of currently stored measurement families on entity/start detail, while internal provenance remains backend-only
- verified X-Labs race-telemetry capture, normalization and raw-vs-normalized checks; exact payloads remain private
- scheduled previous-day X-Labs catch-up for stored V85/V86 game legs
- a separate three-year-capable historical X-Labs job that follows verified official-history readiness rather than outrunning it
- persistent official and X-Labs backfill jobs with idempotent source reuse, checkpoints, leases and bounded retries
- private sanitized X-Labs script inspection for request mechanisms and endpoint clues without returning raw script bodies
- secure app login with a separate `APP_PASSWORD` and HttpOnly session cookie
- strict validation, idempotency and SQLite-backed integration QA

## Interface
Bottom navigation order is:
1. Trend
2. Tränare
3. Hästar
4. Kuskar
5. Bana
6. Spel

Trend is the start workspace. It switches between Tränare / Hästar / Kuskar and 2 weeks / 4 weeks / 3 months / 6 months / 1 year. Trend output remains unavailable until sufficient verified result history exists; the interface never fabricates rankings.

Entity detail views group profile/activity data and measured start history instead of flattening every field into one page. Stored race/start/result facts, market/odds histories, equipment, X-Labs, positions, conditions, calculated features, AI analyses and structured editorial signals are separated into natural sections. Unknown facts remain null/unknown. Start history is paginated rather than capped to a fixed latest-100 window, so the same interface can support the planned multi-year backfill.

Bana is a separate factual workspace. Track overview presents only stored facts and hides missing contact fields. The user-facing country label is localized while DB/API country codes remain unchanged. Spårstatistik uses deterministic race classifications and applies all selected filters with AND semantics; the all/default period label remains literally `All data`.

Spel is separate from entity browsing. Översikt shows compact performance statistics, V85/V86 tabs list saved rounds, and each round has a dedicated post-race detail view. Saved systems preserve the exactly-three-spikes system rule. Once all eight legs have one unambiguous factual winner, KentaurAI can automatically write deterministic per-leg post-race reviews. Covered winners are recorded as no change; misses are candidate learning only. Dead heats remain unreviewed automatically until dedicated verified semantics exist.

The visual system is minimal, dark and structured. The approved Sagittarius mark is used for the KentaurAI brand. Bottom navigation uses the approved chart icon for Trend, clipboard/pen for Tränare, horse for Hästar, lightbulb for Kuskar, map-pin/oval for Bana and ticket for Spel. Entity profile tiles use initials rather than category icons.

KentaurAI is packaged as an installable PWA. Its manifest is scoped to `/app/`, launches standalone and uses dedicated normal/maskable Sagittarius icons. The service worker caches only public PWA metadata/icon assets; authenticated app HTML and `/app/api/*` responses are never placed in its offline cache.

## Public-code / private-data boundary
This repository contains code, migrations, tests, documentation and synthetic fixtures only.

Never commit:
- real imported editorial data
- real reference-round exports
- database dumps or raw provider payloads
- researched production track/contact datasets
- private source names or URLs that are not intended to be public
- API keys, tokens, passwords or Cloudflare secrets

Real source data belongs only in the private Cloudflare D1/R2 deployment or is supplied temporarily at import time. Expected private-import filenames and directories are blocked by `.gitignore`, and CI scans committed repository files for configured private-source leakage indicators.

## Private access
- `/app/login` - private browser login using `APP_PASSWORD`
- `/app` - private read-only KentaurAI interface
- `/app/api/*` - private session-authenticated interface read APIs
- `/v1/*` - operational APIs protected by `ADMIN_TOKEN`
- `GET /health` - intentionally public health check

`APP_PASSWORD` and `ADMIN_TOKEN` are separate Cloudflare runtime secrets. Neither belongs in GitHub. The interface never asks for or stores `ADMIN_TOKEN`.

## Private operational API
- `GET /v1/rounds/:roundId` - Bearer ADMIN_TOKEN
- `POST /v1/provider/capture` - Bearer ADMIN_TOKEN
- `POST /v1/provider/normalize` - Bearer ADMIN_TOKEN
- `POST /v1/provider/normalize-race` - Bearer ADMIN_TOKEN
- `POST /v1/provider/verify-normalization` - Bearer ADMIN_TOKEN
- `POST /v1/live/capture` - Bearer ADMIN_TOKEN; explicit upcoming V85/V86 calendar/game refresh
- `POST /v1/live/normalize-next` - Bearer ADMIN_TOKEN; advances the next pending captured V85/V86 source from its durable successful checkpoint
- `POST /v1/xlabs/capture` - Bearer ADMIN_TOKEN; raw date-page capture for provenance/diagnostics
- `POST /v1/xlabs/capture-script` - Bearer ADMIN_TOKEN; captures an allowlisted referenced X-Labs script to private R2
- `POST /v1/xlabs/capture-race-json` - Bearer ADMIN_TOKEN; captures one browser-verified telemetry object
- `POST /v1/xlabs/normalize` - Bearer ADMIN_TOKEN; maps the verified telemetry subset
- `POST /v1/xlabs/verify-normalization` - Bearer ADMIN_TOKEN; compares private raw telemetry with normalized rows
- `POST /v1/xlabs/backfill/start` - Bearer ADMIN_TOKEN; creates/resumes a historical X-Labs date-range job
- `POST /v1/xlabs/backfill/step` - Bearer ADMIN_TOKEN; advances one X-Labs checkpoint
- `GET /v1/xlabs/backfill/status?job_id=...` - Bearer ADMIN_TOKEN
- `POST /v1/xlabs/inspect` - Bearer ADMIN_TOKEN; sanitized structural inspection of a captured X-Labs date page
- `POST /v1/xlabs/inspect-script` - Bearer ADMIN_TOKEN; sanitized read-only inspection of a captured X-Labs script for request mechanisms and endpoint candidates
- `GET /v1/admin/tracks/contact-targets` - Bearer ADMIN_TOKEN; returns the private exact track identities requiring contact verification
- `POST /v1/admin/tracks/contact-enrichment` - Bearer ADMIN_TOKEN; exact-ID, provenance-backed, conflict-preserving private track contact update
- `POST /v1/import/editorial` - Bearer ADMIN_TOKEN
- `POST /v1/import/reference-round` - Bearer ADMIN_TOKEN
- `POST /v1/import/raw` - Bearer ADMIN_TOKEN
- `POST /v1/learning/hypotheses` - Bearer ADMIN_TOKEN
- `POST /v1/post-race/review-next` - Bearer ADMIN_TOKEN; manually advances one eligible deterministic post-race review
- `POST /v1/historical/backfill/start` - Bearer ADMIN_TOKEN; creates or resumes an official date-range job
- `POST /v1/historical/backfill/step` - Bearer ADMIN_TOKEN; processes one official checkpointed race
- `GET /v1/historical/backfill/status?job_id=...` - Bearer ADMIN_TOKEN

All `/v1/*` routes fail closed unless `ADMIN_TOKEN` is configured and supplied.

### Automatic V85/V86 acquisition
The configured official schedules are `15 5 * * *` and `15 17 * * *` in UTC. The morning run captures the current date plus the next seven dates. The evening run starts from the next date and therefore never changes the current race-day snapshot automatically after the morning refresh. Late changes can still be handled through the admin-only manual refresh path.

Each calendar snapshot is archived privately before game discovery. Discovery accepts only V85/V86 identities for the requested date with exactly eight same-date race ids. Each discovered game is then captured through the same verified official provider path and archived before normalization. A partial date/game capture failure marks the scheduled operation as failed rather than silently reporting success.

Captured game normalization is intentionally bounded to one entry checkpoint per minute. Progress is derived from successful contiguous normalization runs, not merely from partially written entity observations. This means a failed per-entry operation cannot cause the next scheduled invocation to skip unfinished betting, odds or equipment facts.

### Official-provider capture and normalization
Calendar/day, game-by-id and ordinary race-by-id are wired from observed official browser traffic. Captured responses are archived exactly to private R2 and recorded in D1 before any field mapping occurs.

The normalizer reads a previously captured game source record from private R2 and maps only the verified subset into normalized D1 tables. It preserves source timestamps and source-record references for observations, betting percentages, odds and equipment snapshots. Reprocessing the same captured source record is a no-op.

Production normalization is split across bounded Worker invocations so a full V85/V86 round cannot exceed Cloudflare's per-invocation external-service request budget. `POST /v1/provider/normalize` accepts `source_record_id` and an optional integer `cursor` starting at `0`. Each non-final response returns `nextCursor`; the caller submits that value in the next request. When `done` becomes `true`, the source record is marked `normalized_verified_subset`. Repeating a completed source record returns `reused: true`.

`POST /v1/provider/verify-normalization` is a read-only verification gate. It re-reads the exact private R2 snapshot for a completed source record, compares representative raw facts and aggregate counts with normalized D1 rows, and returns per-check pass/fail details. It does not mutate normalized racing data.

Verified mapping rules include:
- stable official IDs for races, horses, drivers, trainers and tracks
- race distance, start method, scheduled start and status
- start number, post position and actual start distance
- voltstart handicap derived only from the observed start distance minus the race base distance
- horse `money` stored directly as SEK; nested statistics earnings are not reused as a substitute
- V85/V86 `betDistribution` divided by 100 into market percentage
- winner/place odds divided by 100
- reported shoe and sulky state stored as source-backed equipment snapshots
- missing optional facts remain null

Ordinary historical race payloads expose an explicit boolean `scratched`; that field is mapped as verified. The V85/V86 live-game mapper remains conservative where its own captured payload does not establish scratch semantics.

Historical official acquisition filters calendar data to Swedish trotting tracks, deduplicates race identifiers and processes one race per durable checkpoint. The minute schedule may process up to three checkpoints sequentially, with no parallel source requests. Jobs persist their date/race cursor in D1, retry the same checkpoint up to three consecutive failures, reuse already captured or normalized sources, and continue in place after deployment. A job range is capped at 1,096 days.

### X-Labs telemetry and scheduling
Browser network inspection established the actual race-object recipe as `1MMDDTTRR.json`, where `TT` is the zero-padded official track id and `RR` is the zero-padded race number. The payload is a time-ordered array of telemetry frames with `trackId`, `raceNumber`, `timestamp` and target positions. Capture validates every frame against the requested race before archiving it privately.

The mapper reproduces the observed closest-frame pace calculations for first/last sections, travelled distance, extra distance and converted kilometre time. At least 99% target-frame coverage is required per starter. Raw telemetry does not contain a lane field, so source slipstream is deliberately stored as null rather than inferred. The verification route re-derives every accepted field from the private raw snapshot and requires at least ten representative field comparisons. Missing X-Labs remains neutral and never breaks the official-data pipeline.

X-Labs acquisition has two deliberately separate scopes. `daily_v85_v86` is created at `04:30 UTC` for the previous UTC date and processes only already-normalized V85/V86 game legs, so current round measurements are not blocked by the long ordinary-race history import. `historical_all` is the explicit multi-year job and considers all normalized Swedish races; it waits until the official historical backfill has completed the corresponding date before advancing, preventing temporary missing official data from being misclassified as permanent missing X-Labs.

The minute scheduler advances at most three sequential X-Labs checkpoints per invocation, with recent daily V85/V86 jobs prioritized over the long historical job and no parallel source requests. X-Labs date/race 404 responses are recorded as neutral unavailable coverage and advance the checkpoint. Technical source pushback stops the remaining batch and applies bounded retry cooldown; technical/structural/provenance failures stay on the same checkpoint and stop the job after three consecutive failures until explicitly resumed.

The script-inspection endpoint is read-only. It reports bounded counts of common browser request mechanisms, sanitized literal request URLs, sanitized candidate endpoint strings and coarse keyword counts. It does not return the raw script body, query strings, credentials or arbitrary nearby source snippets.

## Reference-round import
`kentaurai-reference-v1` is the pre-race reference contract. The validator requires exactly eight V85/V86 legs, complete analysis coverage, probabilities summing to 100% per leg, exactly three spikar in three different legs, one selected horse in every spike leg, and system row count equal to the product of selections.

## Manual editorial JSON
See `fixtures/editorial-import.example.json` for the public synthetic contract. Real exports are never committed to this repository.
