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

## External AI analysis exchange
1. KentaurAI is the factual database, deterministic calculation and persistence layer. The normal product does not run a separate autonomous AI model inside the Worker.
2. ChatGPT, Claude or another authorized AI client may read the same private structured round context and store independent analyses without overwriting another provider/model submission.
3. New analysis is pre-race only. A verified future betting/start deadline is required; post-deadline attempts fail closed so later facts cannot contaminate a pre-race judgment.
4. Analysis is split into two stages. `pre_market` contains official facts, X-Labs, approved deterministic market-blind features and structured editorial signals, but excludes current betting percentages, odds, turnover and jackpot. `market` is available only after a pre-market parent has been stored.
5. The market-aware final pass may add value/system recommendations but cannot rewrite the stored parent win probabilities, raw ranking or ABCD strength groups. ABCD remains strength, not value.
6. KentaurAI derives value ratios and system factual fields from stored inputs rather than trusting AI-supplied market facts or totals. Every saved V85/V86 system still has exactly three actual one-horse spike legs and row count is derived from the eight-leg selection product.
7. Every context has a stable SHA-256 fingerprint. Stale context submissions are rejected. Submission IDs are immutable idempotency keys: exact retries are no-ops; revised content requires a new ID.
8. Analysis exchange routes remain private under existing `ADMIN_TOKEN` authentication. Real analyses live in private D1 and are not committed to GitHub.
9. Stored analyses/systems feed deterministic post-race scoring. A wrong outcome is evidence to review, not an automatic logic/model change; learning remains No change / Candidate / Confirmed.

## Interface direction
1. Horse, trainer and driver remain primary detail entities, with V85/V86 system/performance history available in a dedicated Spel area.
2. Bottom navigation is fixed as **Trend -> Tränare -> Hästar -> Kuskar -> Bana -> Spel**.
3. Trend is the start workspace and uses category switching for Tränare / Hästar / Kuskar plus rolling periods 2 weeks / 4 weeks / 3 months / 6 months / 1 year.
4. Trend uses the verified actual starts currently present in D1; an incomplete historical backfill does not create guessed values or a special UI warning. Ranking is deterministic by win rate -> wins -> starts -> stable entity ID and is capped at ten rows.
5. Trend and individual entity statistics share the same core definitions and denominator rules. Scratched entries are not starts; win rate uses actual starts, top-three rate uses result starts, gallop rate uses only starts with verified gallop status, and missing prize data stays distinguishable from zero.
6. Trend race level reuses the canonical **All data / Högre prissumma / Vardagstrav** logic. Track, race type, breed type and start method are secondary AND-combined filters behind the horizontal-sliders control.
7. Trend rows use the approved Version 3 hierarchy: win percentage at left, name plus starts/wins/losses in the main area, and equal Top 3%, Gallop% and Prispengar pills beneath. The whole row navigates to the canonical entity detail page.
8. A global search bar searches all three primary entity types.
9. Spel contains exactly three tabs: Översikt / V85 / V86. V85/V86 list saved rounds; each round can open a detailed post-race page.
10. Entity and round pages should use tabs, collapsible start cards and natural data groups instead of long unstructured field lists.
11. Entity detail views expose all relevant data families already stored/measured by the current schema, while internal IDs/provenance remain backend concerns rather than normal UI content.
12. Factual race/start/result/market/equipment/X-Labs/position/condition data is presented separately from calculated features, AI analyses and editorial signals.
13. Multiple timestamped observations remain available as histories rather than silently collapsing all data to one current value; a latest value may be highlighted for convenience.
14. Entity start history is paginated and must support the complete stored history rather than being permanently capped to a latest-N window. Enrichment of betting, odds, equipment, X-Labs, positions, features, AI and editorial data is done only for the current history page to keep D1 reads bounded.
15. Trainer/driver linked-horse lists are paginated independently from start history so older horse relationships remain discoverable after multi-year backfill.
16. The interface is read-only and private.
17. Browser access uses a separate `APP_PASSWORD` secret and secure HttpOnly session cookie. `ADMIN_TOKEN` remains reserved for operational APIs and is never exposed to the interface.
18. There is no visible logout control; the private session expires normally.
19. Visual direction is minimal and strongly structured, using black/grey/brown/beige as the base with restrained warm accent color and clear card/divider/tab separation.
20. The approved Sagittarius KentaurAI brand stays separate from entity navigation symbolism.
21. Bottom-navigation symbols are Trend = approved chart-line, Tränare = clipboard/pen, Hästar = horse, Kuskar = lightbulb, Bana = map-pin/oval, Spel = ticket. Entity profile tiles use initials rather than category symbols.
22. Trend uses the approved chart-line symbol and the singular label `Trend` in both navigation and page heading.
23. KentaurAI is packaged as an installable PWA scoped to `/app/` with standalone launch and dedicated Sagittarius icons. Its service worker may cache public PWA metadata/icon assets only; authenticated app HTML and API data remain outside the offline cache.
24. Bana uses **Översikt -> Spårstatistik -> Hemmatränare**. User-facing country codes are localized (for example `SE` -> `Sverige`) while storage/API identities remain unchanged.
25. Spårstatistik owns Period, Startmetod, Distans, STL-klass and Lopptyp in the canonical lane-statistics flow. Optional filters combine with AND semantics; the literal all-period label is `All data`.
26. Verified track address/website facts remain nullable. Real enrichment values live only in private D1 with fact-level source URL/type and verification timestamps; conflicts are preserved rather than silently overwriting a previously verified fact.

## Historical data and X-Labs
1. Historical starter/result data is imported once, stored permanently and updated incrementally. The planned backfill remains approximately 2-3 years of Swedish racing, with older starts fetched selectively when useful for active horse profiles.
2. Race entry/start remains the central relational point linking horse, race, driver, trainer, result, equipment, market and X-Labs measurements.
3. X-Labs is complementary direct measurement data and is never mandatory. Missing X-Labs is neutral.
4. The exact X-Labs acquisition method is an implementation question that must be verified against real observed network/page behavior before a normalizer is trusted.
5. The first X-Labs implementation was deliberately raw-capture only: HTTPS host locked, redirects blocked, size checked, exact response archived to private R2/source records and marked `captured_unmapped`.
6. No X-Labs measurement field could be written to normalized D1 until a real small-sample verification established the source semantics and stable extraction method; that gate is now enforced by the verified telemetry mapper and raw-vs-normalized verifier.
7. Historical backfill must not begin at full scale until the X-Labs vertical slice and official historical mapping are validated on representative samples.
8. Browser verification established the X-Labs race-object recipe as `1MMDDTTRR.json`; official numeric track identity is accepted only with an every-frame payload identity guard.
9. The verified X-Labs subset consists of reproducible section pace, travelled/extra distance and converted kilometre time. Slipstream remains null because the observed telemetry has no lane field.
10. The mandatory V1 multi-year foundation is the official Swedish-trotting starter/result history. Historical X-Labs acquisition is a separate optional layer: it is not implied by completion of the official backfill and must not delay or invalidate official facts when unavailable.
11. The official historical job is date/race checkpointed, idempotent and lease-protected. The minute scheduler processes at most three ordinary-race checkpoints sequentially, committing each independently, and stops the batch on completion, non-runnable state or technical failure. Three consecutive actual failures still stop at the same checkpoint so an explicit resume cannot skip facts.
12. X-Labs historical acquisition uses a separate date/race checkpointed and lease-protected job table. It processes at most three checkpoints sequentially per minute, never issues parallel source requests, and keeps 404/unavailable X-Labs coverage neutral instead of treating missing telemetry as a model/data error. Source pushback or temporary technical failure stops the remaining batch and defers retry without advancing the checkpoint.
13. Multi-day X-Labs backfill is not allowed to outrun official history. A historical X-Labs checkpoint waits until the corresponding official backfill date is complete, so a temporarily empty official date cannot be mistaken for permanent missing X-Labs coverage.
14. A daily X-Labs catch-up job is created at `04:30 UTC` for the previous UTC date. Single-day jobs have priority over the long historical X-Labs job so recent measurements are not blocked by multi-year catch-up.
15. X-Labs date pages and the verified application-script context remain archived for provenance before race-object capture; raw race telemetry is archived before normalization, and only the verified telemetry subset is written to D1.
16. Pending current/live official normalization is attempted before the larger historical batches, and eligible daily V85/V86 X-Labs work continues to outrank `historical_all`. Existing backfill jobs retain their stored cursors and continue in place when batching code is deployed.
17. Recent ordinary-race official history is maintained by stable rolling one-day jobs for the previous three settled UTC dates. They reuse the same raw capture, final-result validation, checkpoint/source-gap rules and get priority over the long historical official job before control returns to the persisted long-history cursor.
18. A daily X-Labs job whose official live prerequisite never existed may close cleanly once its target date becomes older than yesterday. This closes stale orchestration work only; it does not claim that X-Labs telemetry was checked or unavailable.

## Spel and post-race analysis
1. Every V85/V86 system has exactly three spikar in three different legs, with one selected horse in each spike leg.
2. System row count equals the product of selections across all eight legs.
3. ABCD represents relative winning strength, not value; value is assessed separately against market percentage.
4. Saved main/alternative systems are preserved. Overview/list metrics use a deterministic primary system while round detail can inspect all saved proposals.
5. Post-race detail may show winner trip classifications only when stored positional evidence supports them. Unsupported trip labels remain unknown.
6. Round learnings are classified No change / Candidate / Confirmed. A single race or round does not directly change model weights.
7. Automatic deterministic post-race review runs only for saved V85/V86 rounds where all eight legs have exactly one factual winner. Ambiguous/dead-heat legs fail closed until dedicated verified semantics exist.
8. Post-race review is idempotent and resumable per system/race. Covered winners are recorded as No change; missed winners are Candidate learning, with spike misses distinguished from ordinary coverage misses. Review generation never writes model changes automatically.

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
11. Automatic live acquisition uses only the verified V85/V86 calendar/day and game endpoints. The morning run includes same-day and upcoming rounds; the evening run excludes same-day rounds so race-day morning remains the final automatic pre-race refresh. Manual admin refresh remains available for late changes.
12. Automatic live normalization advances only from successful contiguous source-backed entry checkpoints and fails closed on gaps or partial work.
13. The official-provider vertical slice is accepted only after raw-vs-normalized production verification passes without mismatches for the verified subset.

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
