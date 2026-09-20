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
2. Step 1 exports a deterministic market-blind pack for one selected round. Editorial/interview material is excluded from that pack.
3. Step 2 exports verified current market data for the same round. It is market analysis only: market data may expose disagreements or information gaps but never rewrites Step 1 probabilities/ranking/ABCD and no system is built yet.
4. Step 3 exports relevant previously stored external horse statistics and horse/trainer interview context. The user can manually add current private PDFs/screenshots in the same AI conversation. New sports facts/statistical evidence may justify an explicitly explained day adjustment; market disagreement alone may not.
5. Step 4 is system construction through user/AI dialogue. Exactly three singleton spike legs remain mandatory and KentaurAI owns row/cost arithmetic.
6. External statistics/interviews are registered separately in Step 5 through a round-scoped import-context -> AI structured JSON -> private import flow. Registration can happen after betting or after the round without changing when the analysis information originally became available.
7. External horse statistics are append-only timestamped observations, not mutable profile values. Current track/balance/wagon contexts are bound to canonical/current KentaurAI identities where available. Unknown context remains unknown rather than guessed.
8. External statistics from this workflow attach only to horses. Interview records attach to the horse and trainer/stable context with the actual speaker and role. Drivers are outside this workflow.
9. Private PDFs/images are not direct database imports. Full paid article bodies are not persisted; structured evidence/signals and sufficiently complete summaries are retained privately with provenance.
10. Step 6 is system registration. The registration file carries the latest sports assessment used by the final system; if Step 3 made no sports adjustment, this equals Step 1. Step 2 market data alone may not change those probabilities.
11. System registration remains bound to reproducible Step 1 pack/facts and Step 2 market fingerprints. External blindness is recorded as `declared_unsealed`, not server-proven.
12. KentaurAI validates canonical round/race/entry identities and recomputes spike count, row count and cost. AI-supplied arithmetic is not authoritative.
13. Registrations at or after the authoritative deadline are preserved as post-race recovery/manual-review evidence and cannot become automatic learning evidence.
14. Missing market percentages remain null. Exact retries are idempotent; changed content requires a new submission identity.
15. Historical v1/v2 and sealed-v3 artifacts remain readable for compatibility, but their mutation routes stay disabled in the default workflow.
16. F1 replay/calibration and F2 post-race diagnostics remain evidence layers; no model/rule change follows one race or round.


## Interface direction
1. Horse, trainer and driver remain primary detail entities, with V85/V86 system/performance history available in a dedicated Spel area.
2. Bottom navigation is fixed as **Trend -> Statistik -> Analys -> Spel**. Statistik owns the four-way top selector **Tränare -> Hästar -> Kuskar -> Bana**, shown above the workspace page heading and only on those four list/workspace views.
3. Trend is the start workspace and uses category switching for Tränare / Hästar / Kuskar plus rolling periods 2 weeks / 4 weeks / 3 months / 6 months / 1 year.
4. Trend uses the verified actual starts currently present in D1; an incomplete historical backfill does not create guessed values or a special UI warning. Ranking is deterministic by win rate -> wins -> starts -> stable entity ID and is capped at ten rows.
5. Trend and individual entity statistics share the same core definitions and denominator rules. Scratched entries are not starts; win rate uses actual starts, top-three rate uses result starts, gallop rate uses only starts with verified gallop status, and missing prize data stays distinguishable from zero.
6. Trend race level reuses the canonical **All data / Högre prissumma / Vardagstrav** logic. Track, race type, breed type and start method are secondary AND-combined filters behind the horizontal-sliders control.
7. Trend rows use the approved Version 3 hierarchy: win percentage at left, name plus starts/wins/losses in the main area, and equal Top 3%, Gallop% and Prispengar pills beneath. The whole row navigates to the canonical entity detail page.
8. A global search bar searches all three primary entity types.
9. Spel contains exactly three primary tabs: **Kommande / Historik / Översikt**. V85/V86 are filters inside Kommande and Historik; saved rounds can open detailed round pages.
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
21. Bottom-navigation symbols are Trend = the existing approved Trend chart-line, Statistik = Phosphor Table, Analys = Phosphor Magnifying Glass, and Spel = Phosphor Currency Circle Dollar. Entity profile tiles use initials rather than category symbols.
22. Trend keeps the approved chart-line symbol and its current workspace content. Analys owns the existing external-AI workflow that previously lived under Settings. Settings is data-only and does not keep a redundant one-item tab bar.
23. KentaurAI is packaged as an installable PWA scoped to `/app/` with standalone launch and dedicated Sagittarius icons. Its service worker may cache public PWA metadata/icon assets only; authenticated app HTML and API data remain outside the offline cache.
24. Bana uses **Översikt -> Spårstatistik -> Hemmatränare**. User-facing country codes are localized (for example `SE` -> `Sverige`) while storage/API identities remain unchanged.
25. Spårstatistik owns Period, Startmetod, Distans, STL-klass and Lopptyp in the canonical lane-statistics flow. Optional filters combine with AND semantics; the literal all-period label is `All data`.
26. Verified track address/website facts remain nullable. Real enrichment values live only in private D1 with fact-level source URL/type and verification timestamps; conflicts are preserved rather than silently overwriting a previously verified fact.
27. User-facing statistics and factual pattern labels use short, natural Swedish. Internal field names, source-family names, status enums and provenance terms are technical contracts and must not leak into normal UI copy when an understandable Swedish label exists.

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
1. Newly registered V85/V86 systems may be selected by the external AI, but KentaurAI accepts them only after strict validation that they contain exactly three one-horse spikes in three different legs. Historical legacy systems remain readable even if an older policy allowed a different V85-main spike count.
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

## Build F data inventory and promotion rules
1. The public field-level inventory is versioned in `docs/DATA_DICTIONARY.md`. Its canonical columns are source family, generic raw path/field identifier, semantic name, data type, nullability, normalized target, status, consumer, provenance rule and generic notes.
2. Field status uses the closed set `used`, `stored_unused`, `raw_only`, `derived`, `unclear`, `ignore`, `build_candidate`. New synonyms must not be introduced casually because the dictionary is intended to be machine/test readable as well as human readable.
3. A D1 column existing in the schema does **not** prove that a source currently supplies that fact. Schema-present but unpopulated fields remain unavailable/null until source semantics and provenance are verified.
4. `build_candidate` means “worth a separately scoped future build”; it is not permission to normalize, expose or weight a field automatically. Build F inventories and prioritizes first.
5. `unclear` fields fail closed. Exact semantics, units, identity and time meaning must be verified before mapping or feature use.
6. Future promotion of source data must preserve the same gates used by Start Points: exact source semantics, stable identity, effective/observed time, leakage-safe historical use, null safety, conflict behavior, idempotency and fact/feature/AI separation.
7. Market/odds/trend/public-expectation data remains outside the market-blind Step-1 strength context even when the inventory identifies it as useful. Verified market candidates belong only to Step 2/final/post-race layers.
8. Start Points remains a timestamped external factual rating signal, not a hidden KentaurAI model truth. Current cache may be denormalized for convenience, but historical observations remain immutable/source-backed and as-of selection is required.
9. X-Labs interval/trajectory candidates are not assigned tactical labels such as lead, death seat or wide trip until geometry/coordinate semantics are separately validated. Direct measured pace/distance facts may be promoted earlier when their units and identity are already verified.
10. User-facing presentation of promoted facts must use natural Swedish labels and group related facts clearly. Internal dictionary/source/status vocabulary remains a backend/documentation contract unless technically necessary in the UI.

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


## Horse profile Form is a deterministic current-performance index
- The horse profile label is `Form (1–100)`, not average placing.
- Form uses up to the five latest eligible starts in the active calendar/filter context. Each start is scored from result quality, verified race/opposition difficulty, measured extra running distance and measured field-relative speed/closing evidence, then recent starts receive greater weight.
- Missing verified evidence is null and causes weight renormalization; it never becomes a zero-performance assumption.
- Opposition Start Points/earnings may contribute only when an official snapshot existed by the historical race cutoff. Current values are never projected backwards.
- Form is market-blind and deterministic. It is a calculated feature shown in the factual/statistical UI, not an AI judgment or a replacement for the broader KentaurAI strength analysis.


## X-Labs interval rows must follow captured telemetry into production
- A normalized X-Labs race source is not complete for current consumers until both trusted whole-race telemetry and the additive `xlabs-intervals-v2` rows have been attempted from the same immutable raw source.
- Existing normalized sources are repaired from private R2 rather than refetched externally. Repair is bounded, idempotent, recent-first and retries failed sources only up to the configured limit.
- User-facing Toppfart opening sections use only valid v2 local intervals. Missing local evidence remains null; the UI must not substitute unrelated legacy values merely to fill a card.


## Interview histories use collapsed factual race-context rows
- Interview lists default to one collapsed row per stored interview: date · track · race · Auto/Voltstart · post position.
- Speaker and role are deliberately excluded from the collapsed row and shown only after expansion together with the summary and structured signals.
- The canonical interview signal taxonomy remains: form, training, tactics, distance, start, equipment, expectation and other.
- A relevant explicit change versus the previous start/state is stored separately as nullable `change_since_last` plus `change_summary`; it is not introduced as a ninth signal family and is never guessed.


## Driver and trainer Form are role-specific deterministic current-form indices
- Horse Form semantics and weights remain unchanged.
- Driver `Form (1–100)` uses only two relevant components: 60% recent field-size-aware results and 40% historical result versus market-rank expectation. Up to 30 eligible drives are recency-weighted.
- Driver market expectation uses only a source-backed historical betting snapshot captured at or before that round's authoritative bet stop. The market-derived component remains separately identifiable and must not be presented as market-blind evidence. Missing market history stays null and available weights renormalize.
- Trainer `Form (1–100)` uses only two relevant components: 60% recent field-size-aware results and 40% development of the trainer's horses against their own prior verified results. Up to 30 eligible trainer starts are recency-weighted.
- Trainer Form does not use betting/odds, race/opposition difficulty or X-Labs merely to mirror the horse formula.
- Person Form requires at least three verified result starts for a score. Missing secondary evidence remains null; it is never treated as a zero-performance assumption.
- Core entity statistics must not wait for any Form calculation. Horse, trainer and driver Form all load through separate private lazy endpoints after core paint.


## Saved V85/V86 systems settle from exact official race ids before post-race learning
- Pre-race automatic capture still stops at the race-day morning boundary. Post-race settlement is a separate factual pipeline and is allowed to fetch final official race results after racing.
- Settlement is anchored to the eight race ids already stored in `game_legs`; it must not rediscover the round through Swedish-only historical calendar filtering.
- Same-day automatic settlement becomes eligible only after the latest known race start plus 45 minutes. Older unresolved saved rounds are recovery candidates immediately.
- A race is settled only from an archived official ordinary-race payload that passes the existing final-result validator and normalizer. Not-final source data is retried; unknown is never replaced by a guessed result.
- Exactly one factual winner per leg is required for automatic round completion. Multiple winners/dead-heat ambiguity fails closed to `manual_review` until dedicated verified semantics exist.
- Up to three legs may settle sequentially per minute invocation. Job state is lease-protected and idempotent.
- Full eight-leg settlement queues/reopens exact-date X-Labs enrichment and only then allows the existing post-race diagnostic/learning flow to consume the completed factual outcomes. One result or round still never changes model weights automatically.

## Upcoming Spel is a factual pre-analysis surface
- Spel navigation is `Kommande / Historik / Översikt`. V85/V86 are filters inside the first two views, not top-level navigation.
- A stored V85/V86 round belongs to Kommande only while it is still pre-bet-stop. A saved system may be marked `System registrerat` without moving the round out of Kommande.
- Upcoming round cards are date-grouped and responsive but deliberately sparse: game type, track, start/bet-stop, saved-system state, X-Labs coverage and latest source-backed fetch timestamp.
- The collapsed horse row is limited to start number/name/post, horse Form, fastest verified first 200 m for the same start method, fastest verified last 400 m and current market percentage.
- Expanded rows are deterministic historical context only. They must show the metric/value at left and a concise explanation at right, including sample sizes for rates.
- First-200 and last-400 values are peak verified X-Labs facts, not median/average scores, and are not duplicated in the expanded section.
- Distance statistics reuse the canonical ±100 m buckets already used by entity statistics.
- Lane context is autostart 1–8 versus 9–12, and voltstart lanes 1/6/7 versus all other lanes within the volt.
- `Hög prissumma` and `Vardagstrav` reuse the canonical `race-scope.js` evidence definition; no second prize-class threshold is introduced.
- Upcoming Spel is explicitly before AI analysis. It must not expose or create strength labels, probabilities, ABCD, race scenarios, value judgments, system recommendations, tips or interview/editorial evidence.

