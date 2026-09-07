# Build state

Version: 0.4.2
Phase: interface foundation on verified official data layer
Status: production interface hardened for complete entity browsing and mobile use; automatic live acquisition still disabled

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
- private read-only KentaurAI browser interface served by the Worker
- separate `APP_PASSWORD` login path with secure HttpOnly 30-day session cookie
- no `ADMIN_TOKEN` exposure in browser interface
- fixed global search across horses, trainers and drivers
- fixed bottom navigation in approved order: Start, Tränare, Hästar, Kuskar
- entity list/detail views backed by reusable read-only D1 APIs
- tabbed Start and entity detail screens to avoid long continuous scrolling
- factual/null-safe interface behavior when historical results are unavailable
- deterministic trainer/driver statistics only when stored race results exist
- production UI validation against the first normalized V86 dataset
- internal source IDs removed from user-facing entity lists
- horse sex values localized for Swedish presentation without altering stored raw facts
- trainer/driver profiles prioritize linked horses and database starts over unavailable metadata
- mouse focus styling cleaned up while retaining keyboard-visible focus states
- paginated entity APIs with deterministic total/limit/offset/hasMore metadata
- 20-item entity browsing pages so every trainer, horse and driver remains reachable as the database grows
- list-page position preserved when opening a profile and returning to the list
- entity indexes converted from wide tables to compact touch-friendly rows
- start-history tables separated from entity-list styling and given deliberate horizontal overflow on narrow screens
- refined circular horse-inspired Kentaur mark and stronger `KENTAURAI` wordmark while preserving the restrained dark/gold visual system
- responsive top bar, profile hierarchy, pager controls and bottom navigation for mobile use
- active navigation exposes `aria-current` while keyboard-visible focus remains intact

Official vertical-slice conclusion:
- raw capture -> private R2/D1 provenance -> normalization -> private verification is proven end-to-end
- the verified subset is accepted as the baseline for future official-provider imports
- live scratch/withdrawal semantics remain an explicit known gap until a real example is observed
- automatic live acquisition remains off until a later explicit build enables it

Interface foundation decisions:
- entity-centric rather than V85/V86-round-centric
- fixed top global search
- fixed bottom navigation: Start -> Tränare -> Hästar -> Kuskar
- minimal dark visual system using black/grey/brown/beige with restrained blue/yellow/gold accents
- compact circular horse-inspired mark plus uppercase KentaurAI wordmark
- clear card, divider and tab separation between sections
- tabs and paginated entity indexes preferred over excessive vertical scrolling
- horse/trainer/driver profile pages are structured for later historical, X-Labs and calculated-feature additions
- no invented trends; homepage rolling trend leaderboards remain unavailable until sufficient result history exists
- internal provenance identifiers remain in the backend but are not primary UI content

Next verification gate:
1. Run full CI on the exact 0.4.2 feature head.
2. Review the exact final diff for pagination correctness, read-only guarantees, UI semantics, accessibility and regression risk.
3. Fix any blocking issues and repeat CI/review until clean.
4. Open the pull request and merge only after explicit authorization.
5. After production deployment, visually re-check Start, all entity-list pages, pagination, search and representative trainer/horse/driver profiles on desktop and mobile.

Not yet implemented:
- verified live scratch/withdrawal mapping
- automatic live provider acquisition
- additional provider endpoint patterns not yet observed
- historical trainer/driver/horse trend metrics and leaderboards
- X-Labs acquisition adapter
- 2-3 year historical backfill
- feature engine
- KentaurAI AI analysis runner
- system optimizer
