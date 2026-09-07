# KentaurAI

Private V85/V86 data, analysis backend and read-only intelligence interface with a public codebase.

## Current build
Version 0.4.5 extends the private interface on top of the verified official-provider data layer. Real provider payloads and private reference/editorial data remain outside the public repository; GitHub contains code, migrations, tests, documentation and synthetic fixtures only.

The current build contains:
- D1 normalized relational schema and provenance model
- R2 exact raw-snapshot support
- private import APIs for reference-round and structured editorial data
- private official-provider calendar/day and game capture
- verified official-game normalizer for the observed live payload shape
- immutable normalized observations plus timestamped betting/odds/equipment snapshots
- private raw-vs-normalized verification endpoint
- private read-only KentaurAI interface at `/app`
- global horse/trainer/driver search
- paginated entity lists and grouped detail pages for horses, trainers and drivers
- Trend workspace with category/time-period controls
- Spel area with Översikt / V85 / V86 plus saved-round post-race detail
- complete presentation of currently stored measurement families on entity/start detail, while internal provenance remains backend-only
- secure app login with a separate `APP_PASSWORD` and HttpOnly session cookie
- strict validation, idempotency and SQLite-backed integration QA

## Interface
Bottom navigation order is:
1. Trend
2. Tränare
3. Hästar
4. Kuskar
5. Spel

Trend is the start workspace. It switches between Tränare / Hästar / Kuskar and 2 weeks / 4 weeks / 3 months / 6 months / 1 year. Trend output remains unavailable until sufficient verified result history exists; the interface never fabricates rankings.

Entity detail views group profile/activity data and measured start history instead of flattening every field into one page. Stored race/start/result facts, market/odds histories, equipment, X-Labs, positions, conditions, calculated features, AI analyses and structured editorial signals are separated into natural sections. Unknown facts remain null/unknown.

Spel is separate from entity browsing. Översikt shows compact performance statistics, V85/V86 tabs list saved rounds, and each round has a dedicated post-race detail view. Saved systems preserve the exactly-three-spikes system rule.

The visual system is minimal, dark and structured. The approved Sagittarius mark is used for the KentaurAI brand. Entity navigation uses consistent symbols: trainer = brain, horse = horse, driver = flexed arm.

## Public-code / private-data boundary
This repository contains code, migrations, tests, documentation and synthetic fixtures only.

Never commit:
- real imported editorial data
- real reference-round exports
- database dumps or raw provider payloads
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
- `POST /v1/provider/verify-normalization` - Bearer ADMIN_TOKEN
- `POST /v1/import/editorial` - Bearer ADMIN_TOKEN
- `POST /v1/import/reference-round` - Bearer ADMIN_TOKEN
- `POST /v1/import/raw` - Bearer ADMIN_TOKEN
- `POST /v1/learning/hypotheses` - Bearer ADMIN_TOKEN

All `/v1/*` routes fail closed unless `ADMIN_TOKEN` is configured and supplied.

### Official-provider capture and normalization
Calendar/day and game-by-id are the only live acquisition patterns currently wired. Captured responses are archived exactly to private R2 and recorded in D1 before any field mapping occurs.

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

Scratch semantics have not yet been verified from a real scratched live entry. Current declared starts remain explicitly marked with scratch semantics unverified; the mapper does not invent scratch reasons or infer withdrawals from absence.

Automatic live provider acquisition remains disabled.

## Reference-round import
`kentaurai-reference-v1` is the pre-race reference contract. The validator requires exactly eight V85/V86 legs, complete analysis coverage, probabilities summing to 100% per leg, exactly three spikar in three different legs, one selected horse in every spike leg, and system row count equal to the product of selections.

## Manual editorial JSON
See `fixtures/editorial-import.example.json` for the public synthetic contract. Real exports are never committed to this repository.
