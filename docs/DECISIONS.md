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
24. Bana uses **Banprofil -> Bananalys -> Spårstatistik -> Hemmatränare**. User-facing country codes are localized (for example `SE` -> `Sverige`) while storage/API identities remain unchanged.
25. Spårstatistik owns Period, Startmetod, Distans, STL-klass and Lopptyp in the canonical lane-statistics flow. Optional filters combine with AND semantics; the literal all-period label is `All data`.
26. Verified track address/website facts remain nullable. Real enrichment values live only in private D1 with fact-level source URL/type and verification timestamps; conflicts are preserved rather than silently overwriting a previously verified fact.
27. User-facing statistics and factual pattern labels use short, natural Swedish. Internal field names, source-family names, status enums and provenance terms are technical contracts and must not leak into normal UI copy when an understandable Swedish label exists.
28. Banprofil uses the approved grouped physical-profile layout. Bananalys is a separate derived tab: Alla/Auto/Volt plus distance, individual start lanes 1-8 measured at 200 m, C4 trip-scenario/winner profile around 500 m remaining, same-country baseline excluding the current track, and compact analysis evidence. Exact data remains visible; <10 races may broaden interpretation support without crossing start method: track+method+distance -> track+method across distances. If Startmetod = Alla, a distance-specific sample may broaden to track overall. 10-24 is marked limited, and 25+ is normally interpretable. No start-gallop or last-500-gallop metric is inferred.
29. Detailed track geometry is stored as provenance-backed observations rather than overwriting generic legacy columns. Lap length, home-stretch length, open-stretch lanes, angled mobile wing, width at 1640/2140, large/first/second curve radius and first/second curve banking may be null. Distance-to-first-turn observations are keyed by actual race distance and start method.
30. Track geometry evidence distinguishes `verified` measurements from deterministic `calculated` values. Calculated values require an explanation; source conflicts are preserved; layout-effective dates prevent obsolete geometry from silently replacing current layouts. Unknown facts remain null.
31. Surface is not shown in the normal Bana profile until reliable source coverage and semantics are verified. The legacy storage field remains for compatibility.
32. The Bana detail back control uses the same canonical corner-back icon as other app detail pages. Real researched production track values remain private and are imported only through the admin enrichment path; public fixtures stay synthetic.

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
4. Saved main/alternative systems are preserved. Historik lists every saved system separately, including multiple systems from the same round, and its sorting/result metrics operate per system. Opening a history row enters the shared round detail with that exact system selected. Översikt may still use the deterministic primary system for round-level aggregate metrics.
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
23. Trend keeps **Hästar** as a first-class category. Horse Trend is ranked by the existing canonical **Form 1–100** calculation, not win rate, with **3 months** and **min 3 starts** as defaults; trainer/driver Trend keeps win rate as the primary ranking.
24. Trend and trainer/driver/horse Statistik pages share the compact filter interaction: period remains directly visible, detailed filters open from the sliders icon, and **Loppnivå** is a dropdown. Statistik defaults to **1 year** plus the same race-scope/minimum-start defaults as Trend.
25. X-Labs opening-speed presentation must use verified interval measurements for the first 200 m, respect the requested as-of source cutoff, and derive km pace from elapsed time / measured distance. Legacy first_200_time strings must not be treated directly as km pace.
26. Progressive trainer/driver/horse rankings use disjoint `core` and `extended` server modes. The UI merges the payloads; the extended request must not recompute the core ranking queries.



## X-Labs tactical labels reuse the existing race_positions model

1. C3 remains the geometric evidence layer: longitudinal order, gaps, relative lateral offsets, lead changes and trajectory confidence.
2. C4 interprets only a conservative decision window around 500 m remaining (400-600 m) and requires stable/high-confidence evidence before assigning a named tactical label.
3. Supported labels are leader/spets, pocket/rygg ledaren, death seat/dödens, second over/2:a utvändigt, third over/3:e utvändigt and a coarse back-field label. Ambiguous cases remain unknown.
4. C4 does not create a parallel storage model. Final labels are written to the existing race_positions table with source_record_id plus evidence_type, confidence and classification_version so calculated evidence remains distinguishable from direct verified observations.
5. Historical production promotion is an explicit workflow-dispatch operation over already stored private X-Labs race JSON. It is not a deployment side effect.


## X-Labs race responses use a bounded but evidence-sized capture ceiling

1. X-Labs race telemetry can legitimately exceed the original 8 MiB safety ceiling.
2. The race capture remains streaming and byte-bounded; the default ceiling is 32 MiB and configuration may not exceed 64 MiB.
3. Successful raw captures retain response byte size and active limit in source metadata. Payload contents remain private in R2.
4. Exceeding the active ceiling still fails closed and must not advance a historical cursor.
5. A failed historical backfill resumes from its existing checkpoint after the capture fix is deployed; it is not restarted from scratch.


## Historical X-Labs static pages may close as neutral source gaps

1. A valid archived X-Labs date page that references none of the verified application scripts is not automatically an error.
2. Before marking that historical date unavailable, KentaurAI runs the existing sanitized HTML inspection.
3. Only a page classified as static/unknown with no script tags, tables or iframes may close as neutral unavailable coverage.
4. Any alternate data-channel clue keeps the checkpoint failed/paused for investigation rather than being silently skipped.
5. Daily/current X-Labs jobs retain the stricter behavior; this neutral static-page rule is limited to the historical-all backfill.


## Settings health and notification semantics
1. **Datakällor** is operational health, not a mirror of the recent-run list. It must use durable official/X-Labs job state and relevant scheduled-run evidence so an active source cannot become “unknown” merely because another source filled the latest log window.
2. Source health and historical-job state are separate. User-facing health is **Fungerar / Fel upptäckt / Åtgärd krävs / Ingen körning ännu**. Historical processing is **Pågår / Väntar / Klar / Åtgärd krävs / Ingen körning ännu**.
3. **Pågår**, **Fungerar** and **Klar** use the normal green success treatment. Error/retry and action-required states are red. **Väntar** and **Ingen körning ännu** are neutral.
4. Historical progress equals completed dates divided by the inclusive requested date range. A date deliberately closed as neutral unavailable X-Labs coverage is completed work, not missing progress.
5. The Settings-gear red badge represents an unseen current incident, not merely an active error. Opening a successfully rendered Settings page acknowledges the current incident. Repeated retry failures at the same checkpoint remain acknowledged; escalation to **Åtgärd krävs** creates a new notification. Recovery removes the active incident and resets acknowledgement state for future incidents.
6. Settings health reads are observational only and must not make extra provider requests.

## Statistics ranking reads must remain interruptible
1. Horse, trainer and driver ranking pages paint `core` before any secondary family is requested.
2. Secondary ranking families are requested in bounded sequential parts, with a browser paint boundary between parts. A later part must never be started after the user has navigated away.
3. Category/list navigation must paint its destination shell before awaiting D1 and must cancel/ignore stale list responses.
4. Client fetch cancellation is not treated as proof that already-started D1 work stopped server-side; bounding each server request is therefore part of the responsiveness contract.
5. Canonical `Högre prissumma` semantics remain unchanged. Append-oriented STL/game/official-observation evidence is materialized in `race_scope_evidence`; mutable first-prize and race/class text remain read directly from `races`.
6. The unsplit extended API path remains compatibility-only. The production ranking UI uses bounded parts and merges them progressively.

## Six-year history expansion policy
1. KentaurAI may extend production history by one additional fixed three-year block, 2020-09-08 through 2023-09-07, rather than targeting ten years in one operation.
2. Existing statistics, Form, Trend and analysis time-window semantics remain unchanged. More stored history does not make ten-year reads the default.
3. Historical expansion reuses the existing resumable/idempotent official and X-Labs pipelines. Official facts must finish for the block before X-Labs enrichment starts.
4. Production history blocks remain explicit operations. Deploying code never starts a new historical import automatically.
5. The extension checks actual D1 file size through the Cloudflare API. At 8.00 GiB it warns; at 8.50 GiB it stops the fixed extension and surfaces an actionable job error, preserving margin below the paid D1 10 GB single-database ceiling.
6. Concurrent long official-history or historical-all X-Labs jobs are refused to avoid overlapping backfill load.
7. Settings must show historical blocks separately instead of replacing the previously completed block with only the newest job state.

## Track UI and home-trainer read contract
1. Upcoming Spel detail is a distinct internal-history view even though it shares the `games` primary page; round identity must therefore participate in the history signature.
2. Back buttons and back-swipe must resolve to the same stored internal view.
3. Bana → Spårstatistik follows the same compact filter language as Trend/entity statistics: visible period control, sliders trigger, dropdown detail filters, active-filter count.
4. Hemmatränare remains defined by the latest verified official trainer observation. Performance changes may narrow candidate work and add indexes, but must not change that factual rule.
5. The common first Hemmatränare page should not execute the same expensive latest-observation pipeline twice merely to obtain total count.
6. Bana → Bananalys uses the same sliders-icon/dropdown filter language as the rest of Statistik. The lane table keeps Spets/Topp 3 at 200 m but presents only **Spets vs. snittet** as the comparison column; median position is not shown. The scenario table is winner-focused: **Seger % / Andel vinnare / Vinst vs. snittet / Underlag**; occurrence, Topp 3 and raw baseline columns remain available in the derived data contract but are not shown in this UI.
7. Bananalys short copy summarizes practical lane-to-lead/early-position patterns and where winners come from, using natural Swedish and `snittet` rather than internal `baseline` language. Deterministic sample/backoff safeguards remain unchanged.
8. Bananalys lane calculations use only reliable C3 ranks: full-field checkpoint coverage plus sufficient longitudinal confidence. Voltstart lane statistics are restricted to the ground-distance tier (`start_tier = 1`); handicap/tillägg tiers must never be mixed into a lane effect for the base start line.
9. Short-analysis comparison claims require a normal per-lane/winner sample and conservative uncertainty separation from the same-context Swedish comparison set. Raw table deltas may still be displayed, but the narrative must not promote small-sample noise into a track conclusion. Backoff support must preserve an explicitly selected start method; autostart evidence may never become a voltstart conclusion or vice versa.
10. Winner-scenario coverage uses winner entries, not distinct races, so dead heats and ambiguous multi-winner factual states cannot overstate scenario coverage. Winner-share prose explicitly refers to winners whose scenario could be classified.
11. `Kort analys` is presented as bullet points for scanability; this is presentation only and does not change the deterministic calculation contract.
12. A numerical maximum alone is not a Bananalys track characteristic. Absolute strongest-lane and dominant-winner-scenario prose requires conservative separation from the runner-up under the normal-sample/Wilson safeguards; otherwise the absolute claim is omitted (and winner-scenario prose may explicitly state that no scenario clearly stands out).
13. Bananalys `Alla` start methods means the union of supported factual Auto + Volt rows. Unknown or unsupported start-method values stay outside lane/scenario samples and their coverage denominators rather than being silently mixed into the analysis.


## X-Labs trip reconstruction quarantines only proven deterministic duplicate-target sources
1. A captured X-Labs race source that deterministically fails reconstruction because one telemetry frame contains the same target number more than once is preserved unchanged in private raw storage and recorded as quarantined for that reconstruction job.
2. No position checkpoint, trip label or replacement fact is invented for a quarantined source.
3. The reconstruction cursor may advance past that source because repeating the same immutable payload cannot succeed without changing source semantics.
4. Quarantine is intentionally narrow: timestamp ordering, mapping, storage, database and all other unknown/technical failures retain the existing fail-closed retry behavior and stop after three consecutive errors.
5. Quarantine records keep job/source provenance plus a bounded public-safe failure code; raw payloads remain private.
6. Existing failed reconstruction jobs resume in place after an explicitly authorized production action; deployment alone does not restart a production backfill.


## Bananalys natural language and scenario timing
1. `Kort analys` describes the selected track before comparison. Observed maxima are factual descriptions; `tydligt bättre/sämre` remains reserved for comparisons that pass the existing sample/effect/uncertainty safeguards.
2. The summary includes the three highest and three lowest observed starting-lane win rates, ordered by percentage, when those lanes have result starts in the selected Bananalys context.
3. Technical data-quality wording belongs in `Analysunderlag`, not in the natural-language conclusions.
4. For scenario win rates, `Spets` means leading at the C3 checkpoint 500 m after start. `Rygg ledaren`, `Dödens`, `2:a utvändigt`, `3:e utvändigt` and `Bakifrån` continue to use the existing C4 position around 500 m remaining.
5. Because the scenario rows use different measurement points by design, every row carries an explicit natural Swedish measurement label and the table must not imply a common checkpoint.
6. Spårstatistik remains a separate factual tab; this build does not move it under Bananalys.


## System outcome statistics use frozen decision context and final official market
1. Horse Form used for post-race system statistics is frozen with the actual Step 1 pack, including exact as-of time, Form version, used-start count and relative Form rank. Later race results must not alter that snapshot.
2. KentaurAI rank and ABCD remain the stored pre-race analysis judgment associated with the registered primary system. Current-model reruns must not be presented as historical judgments.
3. Pre-race betting snapshots remain decision context. A separate final official game capture supplies closing betting percentage and closing market rank for post-race History and Spel statistics; closing market data must never leak back into pre-race analysis.
4. Closing-market values are accepted for statistics only when they are tied to the same final official game source record that supplies the normalized final round result.
5. Official payout and turnover integers are preserved in raw source units with provenance. SEK presentation values are derived separately; jackpot states and winning-system counts are retained per right level.
6. Winner-rate tables use all eligible starters with a known value as their denominator, not only winners. Rank buckets are 1–9 plus 10+; missing facts are excluded from that metric rather than invented.
7. Aggregate system statistics use the canonical primary/main registered system for each round so stored alternatives do not double-count one race outcome.
8. Historical values remain null unless already verified or reproducible with the exact historical cutoff/version without result leakage.
9. Statistics describe observed outcomes and do not automatically change model weights or promote a single round into a learning rule.


## Historical completion of system-outcome statistics
1. Existing post-race settlement remains authoritative for official winners, final game capture, closing betting percentage/market rank and payout. The statistics backfill must not create a parallel official-data fetch path.
2. Historical Form may be reconstructed only from an explicitly linked original Step 1 pack. Replay must use the stored Step 1 as-of, pass the canonical as-of safety guard and reproduce both the stored pack id and facts fingerprint exactly before any Form row is written.
3. A fingerprint mismatch, missing Step 1 lineage or unsafe historical replay is a valid unresolved state. The correct value is null; current data must never be substituted.
4. Historical KentaurAI rank/ABCD is frozen from the system's own model version using only analyses whose data snapshot predates the registered system. Later reruns are excluded.
5. The primary/main registered system is the statistics unit. Alternative systems do not create duplicate round-level aggregates.
6. Coverage auditing is explicit per metric family: results, final game, closing market, payout, system structure, Form and KentaurAI judgment. A round is complete only when every required family is complete.
7. The catch-up worker is bounded to one saved round per scheduler step and stores durable progress/audit state. It is idempotent and safe to resume.
