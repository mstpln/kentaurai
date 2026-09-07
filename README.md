# KentaurAI

Private V85/V86 data and analysis backend with a public codebase. No end-user app is required.

## Current build
Phase 1C adds a conservative normalized live-provider mapper on top of the Phase 1B raw-capture layer. Real provider payloads remain private; the public repository contains only mapping code, migrations and synthetic tests.

The current build contains:
- D1 schema and provenance model
- R2 raw snapshot support
- private import API
- reference-round import path
- generic manual editorial import path
- private official-provider capture endpoint
- verified official game normalizer for the observed game payload shape
- immutable normalized observations tied to source records
- betting/odds/equipment snapshots with source provenance
- strict validation and idempotency tests

## Public-code / private-data boundary
This repository contains code, migrations, tests, documentation and synthetic fixtures only.

Never commit:
- real imported editorial data
- real reference-round exports
- database dumps or raw provider payloads
- private source names or URLs that are not intended to be public
- API keys, tokens, passwords or Cloudflare secrets

Real source data belongs only in the private Cloudflare D1/R2 deployment or is supplied temporarily at import time. Expected private-import filenames and directories are blocked by `.gitignore`, and CI scans committed repository files for configured private-source leakage indicators.

## Private API
- `GET /health` - intentionally public health check
- `GET /v1/rounds/:roundId` - Bearer ADMIN_TOKEN
- `POST /v1/provider/capture` - Bearer ADMIN_TOKEN
- `POST /v1/provider/normalize` - Bearer ADMIN_TOKEN
- `POST /v1/import/editorial` - Bearer ADMIN_TOKEN
- `POST /v1/import/reference-round` - Bearer ADMIN_TOKEN
- `POST /v1/import/raw` - Bearer ADMIN_TOKEN
- `POST /v1/learning/hypotheses` - Bearer ADMIN_TOKEN

All `/v1/*` routes fail closed unless `ADMIN_TOKEN` is configured and supplied.

### Official-provider capture and normalization
Calendar/day and game-by-id are the only live acquisition patterns currently wired. Captured responses are archived exactly to private R2 and recorded in D1 before any field mapping occurs.

The normalizer reads a previously captured game source record from private R2 and maps only the verified subset into normalized D1 tables. It preserves source timestamps and source-record references for observations, betting percentages, odds and equipment snapshots. Reprocessing the same captured source record is a no-op.

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

Scratch semantics have not yet been verified from a real scratched live entry. Current declared starts therefore remain explicitly marked with scratch semantics unverified; the mapper does not infer scratch reasons or remove entries that disappear from a later payload.

Automatic live provider acquisition remains disabled.

## Reference-round import
`kentaurai-reference-v1` is the pre-race reference contract. The validator requires exactly eight V85/V86 legs, complete analysis coverage, probabilities summing to 100% per leg, exactly three spikar in three different legs, one selected horse in every spike leg, and system row count equal to the product of selections.

## Manual editorial JSON
See `fixtures/editorial-import.example.json` for the public synthetic contract. Real exports are never committed to this repository.
