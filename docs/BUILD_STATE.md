# Build state

Version: 0.3.2
Phase: 1C - verified official live normalization
Status: official-provider vertical slice verified end-to-end in production; automatic live acquisition still disabled

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
- idempotent handling of repeated normalization work
- source-name conflicts preserved in observations and flagged as `source_conflict` instead of silently replacing canonical names
- multi-track rounds do not invent a primary track
- scratch semantics explicitly remain unverified rather than inferred
- request-budgeted cursor protocol for production normalization so a full round can be processed across bounded Worker invocations
- private raw-vs-normalized verification endpoint
- production verification completed successfully with 60/60 checks passing and zero mismatches
- SQLite-backed integration QA and GitHub Actions Node 22 QA

Official vertical-slice conclusion:
- raw capture -> private R2/D1 provenance -> normalization -> private verification is proven end-to-end
- the verified subset is accepted as the baseline for future official-provider imports
- live scratch/withdrawal semantics remain an explicit known gap until a real example is observed
- automatic live acquisition remains off until a later explicit build enables it

Planned interface direction:
- private read-only interface centered on horses, trainers and drivers rather than V85/V86 round pages
- reusable private read APIs for entity search/list/detail views
- factual history and deterministic statistics/trends shown directly, with AI interpretation kept separate
- future homepage trend views such as 2 weeks, 4 weeks, 3 months, 6 months and 1 year, with sensible minimum-sample rules
- exact sequencing between the interface foundation, X-Labs acquisition and historical backfill remains to be decided later

Not yet implemented:
- verified live scratch/withdrawal mapping
- automatic live provider acquisition
- additional provider endpoint patterns not yet observed
- entity-centric KentaurAI interface/read API foundation
- trainer/driver/horse trend metrics
- X-Labs acquisition adapter
- 2-3 year historical backfill
- feature engine
- KentaurAI AI analysis runner
- system optimizer
