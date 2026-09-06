# KentaurAI

Private V85/V86 data and analysis backend with a public codebase. No end-user app is required.

## What this first build contains
This is Phase 1A: the data foundation. It creates the database schema, provenance model, raw snapshot support, private import API, reference-round import path and a generic manual editorial import path.

## Public-code / private-data boundary
This repository contains code, migrations, tests, documentation and synthetic fixtures only.

Never commit:
- real imported editorial data
- real reference-round exports
- database dumps or raw provider payloads
- private source names or URLs that are not intended to be public
- API keys, tokens, passwords or Cloudflare secrets

Real source data belongs only in the private Cloudflare D1/R2 deployment or is supplied temporarily at import time. Expected private-import filenames and directories are blocked by `.gitignore`, and CI scans committed repository files for configured private-source leakage indicators.

## One-time Cloudflare setup
After the GitHub repository exists and Wrangler is installed:

```bash
npx wrangler d1 create kentaurai --location weur
npx wrangler r2 bucket create kentaurai-raw
```

Copy the D1 `database_id` returned by Wrangler into `wrangler.jsonc`.
Then apply migrations:

```bash
npx wrangler d1 migrations apply kentaurai --remote
```

Create a Worker secret used to protect the private API:

```bash
npx wrangler secret put ADMIN_TOKEN
```

Do not commit that token.

## Private API - Phase 1A
- `GET /health` - intentionally public health check
- `GET /v1/rounds/:roundId` - Bearer ADMIN_TOKEN
- `POST /v1/import/editorial` - Bearer ADMIN_TOKEN
- `POST /v1/import/reference-round` - Bearer ADMIN_TOKEN
- `POST /v1/import/raw` - Bearer ADMIN_TOKEN
- `POST /v1/learning/hypotheses` - Bearer ADMIN_TOKEN

All `/v1/*` routes fail closed unless `ADMIN_TOKEN` is configured and supplied.

## Reference-round import
`kentaurai-reference-v1` is the Phase 1A pre-race reference contract. The validator requires:
- exactly eight V85/V86 legs
- every race entry represented in the analysis snapshot
- non-scratched win probabilities summing to 100% per leg
- exactly three spikar in three different legs
- exactly one selected horse in every spike leg
- system row count equal to the product of selections across all eight legs

A repeat import of the same round/version/timestamp is a no-op. Changed content under that same identity is rejected as a source conflict.

## Manual editorial JSON
See `fixtures/editorial-import.example.json` for the public synthetic contract. A stable `source.export_id` and `source.exported_at` are required so imports can be retried safely without duplicates.

Real exports are never committed to this repository. The importer stores structured signals and short summaries rather than requiring original article text. When a race identity is supplied, horse matching is scoped to that race; ambiguous identities are skipped rather than guessed.
