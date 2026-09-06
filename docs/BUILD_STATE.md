# Build state

Version: 0.1.0
Phase: 1A - foundation / vertical-slice scaffold
Status: code foundation reviewed and CI-backed; Cloudflare resources not provisioned yet

Implemented:
- D1 core schema, indexes and reference-round extension migration
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
- private Worker routing/auth skeleton for every `/v1/*` route
- scheduled import orchestration skeleton
- SQLite-backed integration QA for D1 importer behavior
- public-code/private-data boundary, private-import ignore rules and repository leakage guard
- GitHub Actions Node 22 QA

Not yet implemented:
- verified live provider JSON field mapping and automated acquisition
- X-Labs acquisition adapter
- production D1/R2 resources
- 2-3 year historical backfill
- feature engine
- KentaurAI AI analysis runner
- system optimizer
