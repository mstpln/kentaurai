# Product and architecture decisions

## Architecture
- GitHub: public code, migrations, tests and version history.
- Cloudflare Worker: private API, import orchestration, interface delivery and scheduled jobs.
- Cloudflare D1: normalized/queryable data.
- Cloudflare R2: raw snapshots and larger source objects.
- A private read-only KentaurAI interface sits on top of the Worker/D1 data layer.
- AI provider is replaceable; OpenAI and Claude are both valid analysis layers.
- Raw verified facts, deterministic calculated features and AI judgments remain separate layers.
- Unknown factual data is null/unknown; it is never invented for presentation convenience.

## Interface direction
1. Horse, trainer and driver remain primary detail entities, with V85/V86 system/performance history available in a dedicated Spel area.
2. Bottom navigation is fixed as **Trend -> Tränare -> Hästar -> Kuskar -> Spel**.
3. Trend is the start workspace and uses category switching for Tränare / Hästar / Kuskar plus rolling periods 2 weeks / 4 weeks / 3 months / 6 months / 1 year.
4. Trend leaderboards must be deterministic and use sensible minimum-sample rules; insufficient history remains unavailable rather than estimated.
5. A global search bar searches all three primary entity types.
6. Spel contains exactly three tabs: Översikt / V85 / V86. V85/V86 list saved rounds; each round can open a detailed post-race page.
7. Entity and round pages should use tabs, collapsible start cards and natural data groups instead of long unstructured field lists.
8. Entity detail views expose all relevant data families already stored/measured by the current schema, while internal IDs/provenance remain backend concerns rather than normal UI content.
9. Factual race/start/result/market/equipment/X-Labs/position/condition data is presented separately from calculated features, AI analyses and editorial signals.
10. Multiple timestamped observations remain available as histories rather than silently collapsing all data to one current value; a latest value may be highlighted for convenience.
11. Entity start history is paginated and must support the complete stored history rather than being permanently capped to a latest-N window. Enrichment of betting, odds, equipment, X-Labs, positions, features, AI and editorial data is done only for the current history page to keep D1 reads bounded.
12. Trainer/driver linked-horse lists are paginated independently from start history so older horse relationships remain discoverable after multi-year backfill.
13. The interface is read-only and private.
14. Browser access uses a separate `APP_PASSWORD` secret and secure HttpOnly session cookie. `ADMIN_TOKEN` remains reserved for operational APIs and is never exposed to the interface.
15. There is no visible logout control; the private session expires normally.
16. Visual direction is minimal and strongly structured, using black/grey/brown/beige as the base with restrained warm accent color and clear card/divider/tab separation.
17. The approved Sagittarius KentaurAI brand stays separate from entity navigation symbolism.
18. Bottom-navigation symbols are Trend = approved chart-line, Tränare = clipboard/pen, Hästar = horse, Kuskar = lightbulb, Spel = ticket. Entity profile tiles use initials rather than category symbols.
19. Trend uses the approved chart-line symbol and the singular label `Trend` in both navigation and page heading.

## Historical data and X-Labs
1. Historical starter/result data is imported once, stored permanently and updated incrementally. The planned backfill remains approximately 2-3 years of Swedish racing, with older starts fetched selectively when useful for active horse profiles.
2. Race entry/start remains the central relational point linking horse, race, driver, trainer, result, equipment, market and X-Labs measurements.
3. X-Labs is complementary direct measurement data and is never mandatory. Missing X-Labs is neutral.
4. The exact X-Labs acquisition method is an implementation question that must be verified against real observed network/page behavior before a normalizer is trusted.
5. The first X-Labs implementation is therefore raw-capture only: HTTPS host locked, redirects blocked, size checked, exact response archived to private R2/source records and marked `captured_unmapped`.
6. No X-Labs measurement field is written to normalized D1 until a real small-sample verification establishes the source semantics and stable extraction method.
7. Historical backfill must not begin at full scale until the X-Labs vertical slice and official historical mapping are validated on representative samples.

## Spel and post-race analysis
1. Every V85/V86 system has exactly three spikar in three different legs, with one selected horse in each spike leg.
2. System row count equals the product of selections across all eight legs.
3. ABCD represents relative winning strength, not value; value is assessed separately against market percentage.
4. Saved main/alternative systems are preserved. Overview/list metrics use a deterministic primary system while round detail can inspect all saved proposals.
5. Post-race detail may show winner trip classifications only when stored positional evidence supports them. Unsupported trip labels remain unknown.
6. Round learnings are classified No change / Candidate / Confirmed. A single race or round does not directly change model weights.

## Official live normalization
1. Raw official responses are archived before normalization and remain the factual source of truth.
2. The live mapper only maps field semantics verified against an observed current game payload.
3. Missing optional facts remain null; age is not converted into an inferred birth year.
4. Horse `money` is treated as SEK. Nested statistics earnings are not assumed to use the same scale.
5. V85/V86 marking distribution and winner/place odds are converted from observed hundredths by deterministic code.
6. Voltstart handicap is calculated only from observed start distance minus race base distance; unsupported distance differences fail instead of being guessed.
7. Market percentages, odds and equipment are timestamped snapshots tied to exact source records; later captures do not overwrite historical snapshots.
8. Multi-track rounds do not invent a primary track.
9. Conflicting canonical names for the same official external ID preserve the existing canonical value and flag the new observation as `source_conflict`.
10. Live scratch semantics remain unimplemented until a real scratched/withdrawn response is observed. Declared starts are marked with that limitation rather than guessed.
11. Automatic live acquisition remains disabled until a later explicit build enables it.
12. The official-provider vertical slice is accepted only after raw-vs-normalized production verification passes without mismatches for the verified subset.

## Manual editorial flow
1. Editorial content is reviewed outside KentaurAI using an authorized user workflow.
2. That workflow exports only the structured signals needed by KentaurAI.
3. The export is supplied temporarily to the private import flow and is never committed to the public repository.
4. The generic manual editorial import validates it and writes structured signals to private D1 while preserving private provenance.
5. Manual editorial data uses a separate import path from automated provider ingestion.
6. KentaurAI does not browse or collect editorial content itself and does not build an automated logged-in editorial scraper.
7. Public code, tests, docs and examples never identify a private editorial source.
8. The private UI may display stored structured signals and short summaries/evidence, not full paid articles.

## Learning registry
A single race must not directly change model weights. Candidate learnings are recorded as hypotheses and accumulate supporting/contradicting observations. Actual model/rule changes are stored in `model_change_log` and tied to `model_versions`.
