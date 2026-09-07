# Build state

Version: 0.2.0
Phase: 1B - official-provider capture / live-shape verification
Status: capture code prepared and CI-backed; private D1/R2 resources provisioned; Worker not yet deployed; no automatic live collection enabled

Implemented:
- D1 core schema, indexes and reference-round extension migrations
- R2/raw snapshot abstraction with conflict detection
- source/import-run provenance
- generic manual editorial structured import contract
- idempotent editorial imports with race-scoped identity matching
- `kentaurai-reference-v1` pre-race reference importer
- strict reference validation for eight legs, probability totals, exactly three spikar and row-count consistency
- no-op handling for identical reference reimports and conflict rejection for changed snapshots
- preservation of incomplete historical reference observations without invented facts
- separate storage of imported external reference analysis vs future KentaurAI model runs
- learning hypothesis/observation/change-log schema
- private Worker routing/auth for every `/v1/*` route
- private official-provider capture endpoint for calendar/day and game-by-id JSON
- HTTPS-only provider configuration, input validation, timeout, JSON/content-type checks and response-size guard
- raw official responses archived as `captured_unmapped` before any field mapping is trusted
- scheduled orchestration remains non-live until a real response is captured and verified
- SQLite-backed integration QA for D1 importer and provider-capture behavior
- public-code/private-data boundary, private-import ignore rules and repository leakage guard
- GitHub Actions Node 22 QA
- private Cloudflare D1 database `kentaurai` provisioned and bound in `wrangler.jsonc`
- private Cloudflare R2 bucket `kentaurai-raw` provisioned

Next verification gate:
1. Apply all remote D1 migrations.
2. Configure `ADMIN_TOKEN` as a Cloudflare secret.
3. Deploy the reviewed Worker.
4. Verify public `/health`.
5. Verify private `/v1/*` auth fails closed without/with an invalid token and succeeds with the configured token.
6. Capture one real calendar/day response for a V85/V86 date.
7. Read the returned game id from that private response and capture that exact game-by-id response.
8. Inspect the observed JSON shape and manually verify 10-20 fields against the official race page.
9. Only then implement normalized live field mapping and enable scheduled collection.

Not yet implemented:
- verified live provider JSON field mapping
- automatic live provider acquisition
- additional provider endpoint patterns that have not yet been observed against current data
- X-Labs acquisition adapter
- remote migration application
- deployed production Worker
- configured production `ADMIN_TOKEN`
- 2-3 year historical backfill
- feature engine
- KentaurAI AI analysis runner
- system optimizer
