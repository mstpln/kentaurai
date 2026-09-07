# Build state

Version: 0.4.4
Phase: interface foundation on verified official data layer
Status: production interface redesign and Spel history are merge-ready after CI/review; automatic live acquisition still disabled

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
- bottom navigation in approved entity order with new Spel destination: Start, Tränare, Hästar, Kuskar, Spel
- entity list/detail views backed by reusable read-only D1 APIs
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
- responsive top bar, profile hierarchy, pager controls and bottom navigation for mobile use
- active navigation exposes `aria-current` while keyboard-visible focus remains intact
- Start page reduced to a dedicated trends workspace; the old overview and data-status tabs are removed
- trend workspace supports direct category switching between Tränare, Hästar and Kuskar
- trend workspace supports 2 veckor, 4 veckor, 3 mån, 6 mån and 1 år timeframes without fabricating missing historical rankings
- redundant KentaurAI eyebrow removed from page headings
- search field rebuilt with a larger proper magnifying-glass vector, divider and deliberate spacing before query text
- bottom navigation placeholders replaced by a coherent professional vector icon set
- general application typography changed away from the previous Inter-heavy look while the approved brand-name typography remains separate
- approved Sagittarius brand mark restored with `KENTAURAI` in caps and matching accent on mark + `AI`
- third-party icon attributions documented publicly without exposing any private source identity
- Spel section with tabs: Översikt, V85 and V86
- V85/V86 list views are round-based, sortable by latest, most/fewest correct and best spike result
- one primary system is selected deterministically per round: latest `main`, with deterministic fallback if no main exists
- round list rows expose compact result, spike, cost and saved-system metadata without expanding into long analysis text
- private round-detail API and UI with eight-leg post-race table plus per-leg analysis blocks
- round detail exposes winner, winner trip classification when verified positional flags support it, pre-race rank/probability where available, system inclusion, spike status, scenario review, error type, km time and odds
- winner-trip classification uses only explicit stored race-position flags such as lead, death seat, pocket, second/third over or wide/uncovered move; unsupported cases remain unknown rather than inferred
- unfinished legs are not counted as unknown winner trips
- round detail summarizes how the eight winners won and lists linked learning observations
- concise stored post-race review summaries are shown when the structured review provides a supported summary field
- all saved system proposals remain available on round detail and can be switched without losing the shared race/post-race facts
- Spel overview aggregates completed-round accuracy, 8/8 hits, spike hit rate, V85/V86 comparison, result distribution, winner-trip distribution, recurring error types and learning statuses
- revised post-race reviews are deduplicated for overview error statistics so only the latest review per primary system/race contributes
- multiple saved system proposals remain preserved; overview/list metrics use a deterministic primary system while detail retains all saved systems

Official vertical-slice conclusion:
- raw capture -> private R2/D1 provenance -> normalization -> private verification is proven end-to-end
- the verified subset is accepted as the baseline for future official-provider imports
- live scratch/withdrawal semantics remain an explicit known gap until a real example is observed
- automatic live acquisition remains off until a later explicit build enables it

Interface foundation decisions:
- entity-centric database explorer plus a separate Spel performance/history area
- fixed top global search
- bottom navigation: Start -> Tränare -> Hästar -> Kuskar -> Spel
- Start is the trend workspace rather than a database-count dashboard
- trend navigation prioritizes entity category plus rolling timeframe controls
- Spel overview is compact statistics; V85/V86 are round lists; each round has its own detailed post-race page
- minimal dark visual system using black/grey/brown/beige with restrained blue/yellow/gold accents
- brand name retains its distinct Inter treatment; application UI uses a separate calmer sans-serif stack
- ready-made/open-licensed professional vector icons preferred over custom-drawn horse/UI symbols
- tabs and paginated entity indexes preferred over excessive vertical scrolling
- horse/trainer/driver profile pages are structured for later historical, X-Labs and calculated-feature additions
- no invented trends or race-trip labels; unavailable derived facts remain null/unknown
- internal provenance identifiers remain in the backend but are not primary UI content
- learning observations may be shown per round, but model changes still require repeated supporting evidence

Verification completed for this build:
- full Node 22 QA is green on the final feature branch after the redesign, Spel history, post-race detail and review-deduplication changes
- exact branch diff reviewed for existing API preservation, private auth, read-only behavior, primary-system consistency, incomplete-result handling, race-trip factuality, revised-review aggregation, mobile navigation and branding regressions
- no private racing payloads, paid/private editorial identity, secrets or real reference exports were added to the public repository
- no unresolved pull-request review threads remain

Next gate:
1. Merge PR #12 only after explicit user authorization.
2. Let the Cloudflare production deployment complete.
3. Verify `/health` reports 0.4.4.
4. Visually re-check trends, search, approved branding, bottom navigation, Spel overview, V85/V86 lists, saved-system switching and representative round/entity detail pages on desktop and mobile.

Not yet implemented:
- verified live scratch/withdrawal mapping
- automatic live provider acquisition
- additional provider endpoint patterns not yet observed
- historical trainer/driver/horse trend metrics and leaderboards
- automatic post-race result collection/review orchestration
- additional winner-trip categories that require facts not currently represented in the schema, for example explicit third-inside classification
- dead-heat-specific presentation; no verified source example has yet been used to define that behavior
- X-Labs acquisition adapter
- 2-3 year historical backfill
- feature engine
- KentaurAI AI analysis runner
- system optimizer
