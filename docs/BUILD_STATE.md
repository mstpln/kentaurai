# Build state

Version: 0.3.0
Phase: 1C - verified official live normalization
Status: Worker deployed; D1/R2 provisioned; auth verified; one real calendar and one real V86 game captured privately; live game shape inspected; normalized mapper implemented with synthetic CI coverage; automatic live acquisition still disabled

Implemented:
- D1 core schema, indexes and reference-round extension migrations
- R2/raw snapshot abstraction with conflict detection
- source/import-run provenance
- generic manual editorial structured import contract
- idempotent editorial imports with race-scoped identity matching
- `kentaurai-reference-v1` pre-race reference importer
- strict reference validation for eight legs, probability totals, exactly three spikar and row-count consistency
- preservation of incomplete historical reference observations without invented facts
- separate storage of imported external reference analysis vs future KentaurAI model runs
- learning hypothesis/observation/change-log schema
- private Worker routing/auth for every `/v1/*` route
- private official-provider capture endpoint for calendar/day and game-by-id JSON
- HTTPS-only provider configuration, input validation, timeout, JSON/content-type checks, response-size guard and blocked redirects
- exact raw official responses archived privately before mapping
- production D1 migrations applied
- production Worker deployed with D1/R2 bindings
- production `ADMIN_TOKEN` configured and fail-closed auth verified
- GitHub/Cloudflare production build connection verified
- one current calendar/day response captured and inspected privately
- one current V86 game response captured and inspected privately
- verified live field semantics for round/race/start identities, distances, start methods, market distribution scaling, odds scaling, horse money, equipment and optional nulls
- conservative normalized official-game mapper with source-backed normalized observations
- immutable betting, odds and equipment snapshots tied to exact source records and capture timestamps
- idempotent no-op behavior when the same captured game snapshot is normalized twice
- source-name conflicts preserved in observations and flagged as `source_conflict` instead of silently replacing canonical names
- multi-track rounds do not invent a primary track
- scratch semantics explicitly remain unverified rather than inferred
- SQLite-backed integration QA and GitHub Actions Node 22 QA

Next verification gate:
1. Review and merge the Phase 1C mapper PR only after CI and exact-head review pass.
2. Allow Cloudflare to apply the new migration and deploy only after explicit merge authorization.
3. Normalize the already captured private V86 game snapshot through the private mapper endpoint, or normalize the next freshly captured game snapshot.
4. Verify 10-20 normalized D1 fields against the already inspected private raw payload.
5. Observe at least one real scratched/withdrawn live entry before implementing scratch-state updates.
6. Only after the official vertical slice is verified end-to-end, proceed to X-Labs acquisition.

Not yet implemented:
- verified live scratch/withdrawal mapping
- automatic live provider acquisition
- additional provider endpoint patterns not yet observed
- X-Labs acquisition adapter
- 2-3 year historical backfill
- feature engine
- KentaurAI AI analysis runner
- system optimizer
