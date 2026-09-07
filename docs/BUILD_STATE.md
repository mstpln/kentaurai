# Build state

Version: 0.2.0
Phase: 1B - official-provider capture / live-shape verification
Status: capture code prepared and CI-backed; Cloudflare resources not provisioned yet; no automatic live collection enabled

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
- private official-provider capture endpoint for calendar/product/game JSON
- HTTPS-only provider configuration, input validation, timeout, JSON/content-type checks and response-size guard
- raw official responses archived as `captured_unmapped` before any field mapping is trusted
- scheduled orchestration remains non-live until a real response is captured and verified
- SQLite-backed integration QA for D1 importer and provider-capture behavior
- public-code/private-data boundary, private-import ignore rules and repository leakage guard
- GitHub Actions Node 22 QA

Next verification gate:
1. Provision private Cloudflare D1/R2 resources and `ADMIN_TOKEN`.
2. Deploy the reviewed Worker.
3. Capture one real V85/V86 calendar/product/game response into private R2/D1.
4. Inspect the observed JSON shape and manually verify 10-20 fields against the official race page.
5. Only then implement normalized live field mapping and enable scheduled collection.

Not yet implemented:
- verified live provider JSON field mapping
- automatic live provider acquisition
- X-Labs acquisition adapter
- production D1/R2 resources
- 2-3 year historical backfill
- feature engine
- KentaurAI AI analysis runner
- system optimizer
