## Track physical profile candidate
- Branch: `feat/track-physical-profile-v1`.
- Bana Översikt follows the approved V5 layout: an initially empty **Bananalys** section first, followed by grouped **Grundmått / Start & bredd / Till första sväng / Kurvradier / Dosering**, then existing Datatäckning, Kontakt & plats and optional Startnoteringar.
- The track back button uses the canonical app detail back icon; the legacy track-only `↩` glyph is removed.
- Migration `0032_track_physical_profile_v1.sql` adds provenance-backed, layout-aware physical geometry observations plus distance/start-method-specific first-turn distances.
- Evidence is explicitly `verified` or `calculated`; calculated values require a calculation note, conflicts are retained, and unknown facts remain null.
- Surface is no longer presented in the normal track profile. Legacy columns remain untouched for compatibility.
- Public code contains no researched production track dataset. Real values are intended for private admin enrichment only.

## App/statistics responsiveness candidate
- Trainer/driver ranking core now derives win rate, top-3 rate and wins from one materialized filtered sample instead of three repeated scans.
- Horse ranking core shares win/top-3 aggregation, keeps Start Points out of the fast core response, scopes X-Labs reads to eligible entries and combines both rest rankings into one history pass.
- Trainer extended rankings consolidate performance, home/away, distance, market and rest families; driver extended rankings consolidate performance and market families.
- Ranking UI starts extended work shortly after core work begins, while still painting the core response first. Entity-detail statistics uses the same overlap for specialties, Form and horse top speed.
- Statistics ranking responses use the app read cache for three minutes and default statistics paths are prefetched with cache keys matching the actual UI defaults.
- Statistics JSON responses are compact rather than pretty-printed. No factual definitions, model weights or private/public boundaries are intentionally changed.

## Trend and statistics filter/performance candidate
- Trend keeps **Tränare / Hästar / Kuskar**.
- Trainer/driver Trend remains win-rate-led; horse Trend is ranked by the canonical **Form 1–100** calculation with **3 months** and **min 3 starts** as horse defaults.
- Trend **Loppnivå** is a dropdown inside the collapsible filter panel.
- Trainer/driver/horse Statistik pages use the same compact period + filter-icon pattern as Trend. Defaults are **1 year**, **Högre prissumma**, and category-appropriate minimum starts (10 for trainer/driver, 3 for horse).
- Filter-option requests are deferred until the filter panel is opened, and ranking payloads are cached by filter key in the client so repeat visits do not block on duplicate reads.
- Progressive rankings use disjoint `core` and `extended` responses; the second request calculates only the remaining cards and the UI merges both payloads instead of repeating the core queries.
- Horse **Startsnabbaste** no longer interprets legacy first-200 elapsed-time strings as km pace. It uses the verified X-Labs interval-v2 first 0–200 m segment, respects the statistics as-of source cutoff, and derives seconds/km from elapsed time and measured distance.
- Unknown or unavailable measurements remain null/empty rather than being invented.
- No market percentages or editorial signals are used in horse Trend Form ranking.

## Primary navigation candidate
- Branch: `feat/analysis-primary-navigation`.
- Primary bottom navigation is **Trend / Statistik / Analys / Spel**.
- Trend keeps the existing Trend chart icon and current Trend workspace behavior.
- Statistik uses the Phosphor **Table** icon and groups **Tränare / Hästar / Kuskar / Bana** under one four-way selector above the workspace heading.
- The selected top-navigation design is the full-width segmented selector with shared border, subtle active background and warm accent underline.
- The Statistik selector is restricted to those four workspace/list views and must not appear in Settings, Analys, Trend, Spel or entity/track detail views.
- Analys uses the Phosphor **Magnifying Glass** icon and owns the existing external-AI workflow previously shown under the Settings AI tab.
- Settings is data-only and has no redundant single Data tab.
- Spel uses the Phosphor **Currency Circle Dollar** icon.
- Bottom navigation is rebalanced for four equal responsive items with a modest bar height and compact active state.
- Entity lists, detail pages, statistics tabs, track pages, Spel tabs, search and all underlying data/API behavior remain unchanged.
- No schema migration or private-data change is required.

# Build state

Version: 0.6.0
Updated: 2026-09-20

## Current production truth
- Worker: `kentaurai-api`.
- D1: `kentaurai`.
- R2: `kentaurai-raw`.
- Current deployed main head before PR #204 is `f4cf8e0b1cddae94ad48df45a65179f397022a96`.
- Worker entrypoint is `src/worker-v077.js` with `ANALYSIS_WORKFLOW_MODE=v3`; the default mode serves the external-AI workflow while historical sealed-v3 artifacts remain read-compatible.
- The latest production release completed successfully with full QA, Cloudflare validation, migration/schema/index verification, Worker deploy, `/health`, `/app/login` and private analysis/evidence route protection.
- Production schema is current through migration `0028_external_evidence_v1.sql`.
- External Step 1/Step 2 analysis exchange, later system registration, audited external lineage, external-aware F1 replay/F2 post-race diagnostics and the private-app performance layer are production-live.
- Historical official/X-Labs jobs keep their durable cursors. The external-analysis release did not reset, recreate or resume stopped historical work.

## External analysis workflow production live
- The reviewed source candidate replaces the primary private analysis UI with the approved external-AI workflow: shared round + AI selection -> Step 1 market-blind export/instruction -> Step 2 verified market export/instruction in the same external AI conversation.
- Step 1 is not imported or server-sealed in the normal UI path and the normal UI does not invoke the canonical optimizer. Historical sealed-v3 data remains readable, while sealed-v3 creation/mutation routes are disabled in the default mode.
- System registration is separate and may happen later: select round -> download canonical import context -> copy import instruction -> import the generated JSON.
- Registration validates canonical identities, eight complete legs, probability/rank/ABCD constraints and exactly three singleton spike legs. KentaurAI derives row count, line-price cost, spike flags and market metrics.
- Migration `0027_external_analysis_lineage_v1.sql` adds explicit external lineage plus external post-race diagnostic/link tables. It does not alter or delete historical sealed-v3 records.
- External lineage binds the registration to reproducible Step 1 pack/facts fingerprints and Step 2 market fingerprint/cutoff, records `declared_unsealed` blindness and server-side import timing, and preserves explicit supersession between repeated registrations.
- Post-deadline registration remains allowed for bookkeeping but is marked `post_race_recovery` / `manual_review_required`. F1/F2 can diagnose it but exclude it from automatic promotion evidence.
- Verified Step 2 reads enforce both observation/published timestamps and source-record availability at the cutoff. Missing market percentages stay null.
- F1 and F2 understand the external lineage directly; they do not fabricate sealed Step 1/decision/optimizer parents. If an external run exists for a round, stale sealed-v3 system lineage is not selected as the current F1/F2 target.
- Exact-head CI passed with 809/809 tests before merge. Production release #64 then reran full QA, verified migration 0027 and the external schema, deployed the Worker and passed health/login/private-route verification.

## External evidence workflow production live
- The Analys workspace flow is Step 1 blind analysis -> Step 2 market analysis only -> Step 3 interviews/external horse statistics -> Step 4 user/AI system dialogue -> Step 5 separate external-evidence registration -> Step 6 separate system registration.
- Step 1 excludes editorial/interview signals entirely.
- External horse statistics use append-only dated snapshots with canonical contexts for track/balance/wagon where known. Historical values are never overwritten.
- Interview records link to horse plus trainer/stable context with actual speaker/role and structured signals/summary. Drivers remain intentionally outside this workflow.
- Step 3 and Step 5 use private round-scoped context exports. Private PDFs/screenshots remain manual conversation inputs and are transformed by the external AI into validated structured JSON before import.
- Migration `0028_external_evidence_v1.sql` is deployed.
- Horse detail supports `Extern statistik` and `Intervjuer`; trainer detail supports `Intervjuer`; driver detail remains unchanged.

## Entity detail UI core-ownership candidate
- Branch: `fix/entity-detail-core-runtime` / PR #202.
- Goal: make `src/app-page-final.js` the single owner of entity-detail tabs and page rendering instead of relying on late runtime wrappers.
- The core renderer owns the canonical horse/trainer/driver tab sets, statistics shell and external-evidence routes. `src/entity-detail-ui.js` is presentation-only: it supplies the shared scorecard runtime and evidence styles but no longer mutates `detailTabs` or `renderDetail`.
- Legacy horse/trainer/driver detail append helpers and the horse-pattern `renderDetail` wrapper are retired; list/ranking behavior remains.
- Horse Startpoäng/X-Labs sections and trainer home-track/other-track specialty statistics remain part of the canonical scorecard.
- Production-entrypoint regression tests execute the composed `worker-v077` scripts in order, record visible writes, verify no late tab reversion or legacy detail hosts, and check that no legacy async detail writer remains.
- `/health/entity-detail-ui` performs a safe structural probe of the actual authenticated app payload inside the Worker and returns only boolean checks. The production release workflow verifies this probe after deployment without exposing `APP_PASSWORD` or private app HTML.
- This candidate is not production-accepted until PR #202 is explicitly authorized, merged, released and then verified on the stable production app.

## App critical-path performance candidate
- Branch: `perf/app-critical-path-v2` / PR #204.
- Goal: materially reduce first useful paint time for app startup and horse/trainer/driver/track detail pages without changing factual/statistical semantics.
- Startup no longer blocks on the legacy summary read, and Trend filter options are loaded only when the filter panel is opened.
- Normal entity profile reads are identity-only; Data explicitly requests the full observation/statistics/breakdown/coverage payload.
- Trainer/driver cross-role lookup no longer blocks the detail header.
- Entity score/table statistics use a core-first route. Slower market/rest/home-track specialties plus horse Startpoäng/X-Labs sections load after the core statistics are visible.
- Stable filter/stat reads use longer in-memory TTLs, and entity hover/focus prefetches the exact default core-statistics request.
- Track overview identity, coverage and distance-group reads are parallelized while the existing indexed track-list query remains unchanged.
- No migration or private-data change is required. Production remains unchanged until PR #204 is reviewed, explicitly authorized, merged and released.

## App performance live
- `worker-v077` adds only the private-app HTML performance layer; racing/analysis semantics and auth boundaries are unchanged.
- The browser uses short-lived in-memory GET caching and in-flight request de-duplication only; no private API payloads are persisted to localStorage.
- First navigation pages are idle-prefetched, entity/track details are prefetched on hover/focus, and uncached navigation shows immediate loading feedback.
- Initial entity detail no longer enriches up to 100 historical starts before rendering; paginated history remains loaded on demand.
- Track overview defers the expensive home-trainer scan to the dedicated Hemmatränare tab and avoids a duplicate track metadata query.
- Migration `0026_app_read_performance.sql` adds the genuinely new indexes for the hottest entity/track/history read paths; existing driver/trainer/betting indexes are reused.

## Historical F4 sealed-v3 baseline
- F4 cutover layer: `src/worker-v076.js`; production is wrapped by `src/worker-v077.js` for private-app performance only.
- Production default: `ANALYSIS_WORKFLOW_MODE=v3`.
- Controlled rollback value: `ANALYSIS_WORKFLOW_MODE=legacy_v2`. Rollback requires a reviewed production release; there is no automatic fallback.
- This section describes the historical sealed-v3 baseline retained for compatibility and rollback context. It is no longer the intended normal creation workflow after the external-analysis release.
- The Step 2 bundle contains the exact persisted sealed Step 1 document plus its bound verified market files. New Step 2 work therefore does not rely on reconstructing Step 1 from conversation memory.
- Legacy v1/v2 analysis creation is disabled in v3 mode after authentication; creation routes return a deprecation error. Historical legacy read routes/artifacts remain available.
- Historical sealed-v3 systems remain authoritative for their own lineage. New external-workflow systems are selected by the external AI and accepted only after deterministic exact-three-spike/row/cost validation.
- C4 named trip-label promotion is implemented on top of C3 with a conservative 400-600 m decision window centered on 500 m remaining. It writes only stable high-confidence labels to the existing `race_positions` table as calculated X-Labs evidence.
- F4 has no planned schema migration and does not reset or start replay/backfill work.

## v3 programme status
- A1-A4: complete.
- B1-B6: complete.
- C1-C3: complete and deployed. C4: implemented in code with explicit production backfill activation; ambiguous labels remain null.
- D1 pre-market pack v3: complete and deployed.
- D2 Step 1 prompt + sealed lock: complete and deployed.
- D3 late-fact revision + lock lineage: complete and deployed.
- D4.1 market delta pack v3 + maturity + server-owned system policy binding: complete and deployed.
- E1 canonical decision probability: complete and deployed.
- E2 exact-three-spike P(8) optimizer: complete and deployed.
- E3 Step 2 + integrated v3 analysis: complete and deployed.
- F1 replay/calibration: complete and deployed.
- F2 post-race/learning evaluation: complete and deployed.
- F3 private UI/diagnostics/observability: complete and deployed.
- F4 v3 cutover/deprecation/release hardening: complete and deployed.

## Active invariants
- Raw facts, deterministic features and AI judgments remain separate.
- Unknown facts remain null/unknown.
- Current market cannot enter Step 1.
- Step 1 external analysis remains a declared-unsealed blind baseline. In the candidate flow Step 2 is market-only and Step 3 is the first point where interview/external-stat evidence can enter.
- External AI may choose final system selections; code owns canonical IDs, exactly-three-spike validation, row count, line-price cost and null-safe market persistence.
- Post-deadline external registrations are diagnostics/bookkeeping only until manually reviewed for learning.
- External editorial/interview evidence is excluded from Step 1; in the candidate flow it enters at Step 3 and market disagreement alone cannot rewrite the blind baseline.
- Learning requires repeated evidence; one result never changes weights automatically.
- Real provider payloads, real reference exports, private editorial provenance and secrets never enter public GitHub.

## Production release verification
The external-analysis production release was accepted after:
1. Exact-head CI and architecture review passed.
2. Synthetic external Step 1/Step 2/registration, provenance, null, cutoff, F1/F2 and private-auth tests passed.
3. Historical sealed-v3 read compatibility remained intact while parallel sealed-v3 creation/mutation was disabled in the default mode.
4. Migration 0027 was applied before Worker deployment and its external export/lineage/review tables were verified without exposing production data.
5. User explicitly authorized merge/deploy.
6. Controlled release #64 verified the Worker, v3 health mode, login/private auth and external-analysis route protection.
7. No historical replay/backfill reset or resume occurred.


## Horse statistics refinement candidate
- Branch: `feat/horse-form-top-speed`.
- Horse scorecard replaces average placing as Form with a deterministic `Form (1–100)` over up to five starts. Each start combines result quality (30%), race/opposition difficulty (30%), extra-distance workload (20%) and field-relative speed/closing performance (20%); available components renormalize when verified data is missing. Recency weights are 35/25/18/13/9.
- Historical opposition context uses only official horse-stat snapshots available as-of the historical race; missing historical Start Points/earnings remain null and never fall back to current values. Race difficulty retains deterministic first-prize/class inputs when opponent snapshots are unavailable.
- Horse scorecard moves current Startpoäng into the top summary, moves Galopp % into the summary strip and removes the duplicate numeric Galopper display there.
- Horse `Toppfart` presents fastest verified X-Labs first 100 m, first 200 m, first 500 m, last 400 m and last 1000 m. Opening segments are reconstructed from valid 100 m interval measurements; closing segments use the verified whole-race telemetry facts already persisted from the same X-Labs race source.
- The Distans table now groups rows with the same canonical buckets as the Distans filter instead of splitting exact race distances.
- No market/odds/editorial data enters Form. No model weights or Step 1 analysis semantics change in this candidate.


## X-Labs interval production repair
- Existing historical X-Labs backfill originally normalized only the trusted whole-race `xlabs-telemetry-v1` rows, while `xlabs_intervals-v2` remained additive and unscheduled. This left horse Toppfart opening 100/200/500 values empty even when the immutable raw race telemetry already existed.
- The repair is code-only plus migration `0029_xlabs_interval_backfill.sql`: it adds durable per-source interval-repair state, derives v2 interval rows from already captured R2 telemetry, processes old normalized sources in bounded recent-first batches, and wires v2 interval normalization into every new X-Labs race backfill checkpoint and manual normalize call.
- Missing/invalid local intervals remain explicit null/eligibility states; no opening speed is guessed from closing or whole-race data.


## Interview history compact presentation
- Horse/trainer interview history renders one collapsed row per interview by default so long histories remain scannable.
- Each row shows factual race context from the linked race entry: race date, track, race number, start method and post position. Speaker/role, summary and structured signals remain inside the expanded body.
- The external-evidence import contract keeps the eight existing signal categories (form, training, tactics, distance, start, equipment, expectation, other) and adds an explicit nullable `change_since_last` marker plus a short `change_summary` when the source explicitly describes a relevant change versus the prior start/state.
- Change markers are never inferred from missing or ambiguous text; unknown stays null.


## Person form and entity-statistics performance candidate
- Branch: `feat/person-form-performance-v1`.
- Horse `Form (1–100)` is unchanged.
- Trainer and driver core calendar-statistics no longer calculate Form before first paint. All three entity types use the same lazy `calendar-form` pattern after the core scorecard/tables render.
- Driver Form uses up to 30 recent eligible drives: 60% field-size-aware result form plus 40% historical performance versus market rank from the last source-backed snapshot at or before authoritative bet stop. The market-derived component is exposed separately from the market-blind result component; missing historical market evidence renormalizes to result form rather than becoming zero.
- Trainer Form uses up to 30 recent eligible trainer starts: 60% field-size-aware result form plus 40% horse development versus that horse's own prior verified results. It uses no market/odds, race-class or opposition component.
- Trainer/driver Form cards use the same `Form (1–100)` UI treatment as horses and hydrate independently after core statistics.
- Core trainer/driver reads are entity-index-first; deferred market/rest/home-track queries are scoped to the active entity before expensive ranking/window work where applicable.
- Statistics requests use AbortController in addition to stale-write tokens, so navigation cancels browser requests instead of only suppressing late paint.
- No schema migration or private-data change is required.


## Automatic post-race settlement candidate
- Branch: `feat/post-race-settlement-v1` / PR #210.
- Saved unresolved V85/V86 rounds now get durable post-race settlement jobs after the last known race start plus a 45-minute safety delay; older unresolved saved rounds are recovered immediately.
- Settlement targets the exact eight already-linked race ids and therefore does not depend on the Swedish-only historical race-discovery path. This allows saved non-Swedish rounds to settle when the official ordinary-race endpoint supports those race ids.
- Each checkpoint captures a fresh official race snapshot to private R2 and normalizes it through the existing verified ordinary-race result mapper. Missing/not-final results stay unknown and retry later; ambiguous/dead-heat winner state fails closed to manual review.
- The minute scheduler processes at most three settlement checkpoints sequentially, then runs the existing deterministic post-race review. No model changes are made automatically.
- Once all eight legs have exactly one factual winner, the round becomes naturally rightable in Spel and an exact-date `daily_v85_v86` X-Labs job is created/reopened for post-race enrichment. Settled saved rounds can provide that X-Labs prerequisite even when a calendar snapshot is unavailable.
- Migration `0031_post_race_settlement.sql` adds only durable settlement orchestration state; factual results remain in the existing source-backed race tables.

## Upcoming Spel factual view candidate
- Branch: `feat/upcoming-games-factual-view` / PR #212.
- Spel navigation becomes `Kommande / Historik / Översikt`; V85/V86 become filters inside Kommande and Historik rather than top-level tabs.
- Kommande lists stored future V85/V86 rounds before authoritative bet stop, grouped by a muted date heading. Each full-width responsive card shows only factual operational context: game type, track, start/bet-stop, saved-system status, historical X-Labs coverage and latest source-backed fetch time.
- Opening a round exposes the eight stored game legs and a factual horse row only: start number/name/post, existing horse Form, fastest verified first 200 m from historical races with the same start method, fastest verified last 400 m, and current market percentage.
- Expanded horse facts remain deterministic/statistical: driver/trainer Form, rolling-12-month wins, gallop rate, today's driver/track/start method/distance group/lane category, and canonical higher-prize versus weekday race scopes. Every rate carries its sample size.
- Autostart lane context is front row 1–8 versus back row 9–12. Voltstart lane context is advantage lanes 1/6/7 versus other lanes within the volt.
- Distance context uses the existing ±100 m canonical groups; e.g. 2100 m and 2140 m both belong to the 2140 group.
- Higher-prize versus weekday statistics reuse the existing `race-scope.js` definition, including the 100,000 SEK first-prize threshold and stored high-level game/STL evidence.
- The view contains no AI strength, ranking, ABCD, scenario, lead prediction, value, spike recommendation, external tips or interviews. Current market remains a displayed factual input only.
- Historik is system-granular: every saved main/alternative system is one list row even when multiple systems share a round. V85/V86 filters, pagination and `Senaste / Flest rätt / Färst rätt / Bästa spikar` sorting operate on systems; row click opens the shared round detail with that system preselected. Översikt/learning aggregates remain round-oriented where already defined.



## X-Labs large race payload recovery

- Historical X-Labs backfill exposed a legitimate telemetry race response larger than the original 8 MiB capture ceiling.
- Race-object capture now keeps the same streaming byte guard but uses a 32 MiB default ceiling, optionally configurable through `XLABS_MAX_RACE_RESPONSE_BYTES` and hard-capped at 64 MiB.
- Successful race captures persist observed response bytes and the active byte limit in private source metadata for diagnostics.
- Oversized responses still fail closed before archival/normalization, now with bounded byte diagnostics.
- Existing historical X-Labs cursor/job state is preserved; after deployment the failed job should be resumed in place rather than recreated.


## X-Labs historical static-page gap handling

- Historical X-Labs backfill can encounter archived date pages that return valid HTML but no referenced application scripts or other supported data-channel clues.
- Those pages are now inspected through the existing sanitized HTML inspector. Only pages that are genuinely static/unknown with zero script tags, tables and iframes are treated as neutral unavailable X-Labs coverage.
- Pages that expose any alternate data-channel clue still fail closed for manual investigation; the backfill does not silently skip potentially available telemetry.
- The existing historical cursor is preserved and can be resumed from the failed checkpoint after deployment.


## Settings source-health and notification candidate
- Settings **Datakällor** now reads durable official/X-Labs job state plus relevant scheduled runs instead of inferring health from only the twelve latest `import_runs`.
- Source health and requested historical processing are separate user-facing concepts. Normal source health is **Fungerar**; historical work is **Pågår / Väntar / Klar**, while retrying failures and stopped work are shown as **Fel upptäckt · nytt försök pågår** or **Åtgärd krävs**.
- Historical progress is the share of the requested date interval that is fully processed. X-Labs dates closed as verified neutral unavailable coverage count as processed, so legitimate source gaps do not prevent 100% completion.
- A small red badge on the Settings gear means a current error/escalation has not yet been seen. Successfully opening Settings acknowledges the current incident; repeated retries at the same checkpoint do not re-notify, escalation to action-required does, and recovery clears acknowledgement state so a later incident can notify again.
- Migration `0034_settings_alert_acknowledgements.sql` stores only alert acknowledgement keys/timestamps. It contains no provider payloads or private racing/editorial data.

## Statistics responsiveness follow-up
- Production browser observation showed horse statistics core becoming usable before the full extended payload, while in-page category navigation could leave the old category visible until the next list read completed.
- Entity list navigation now paints the destination shell before awaiting D1, aborts stale list reads and guards against stale repaint.
- Primary Statistik/Trend/Analys/Spel navigation and history restoration cancel both active ranking and entity-list lifecycles.
- Ranking `core` remains the first paint. Extended ranking families are now requested as sequential bounded parts, with a paint boundary between parts. Navigating away prevents later parts from being started.
- The canonical high-prize scope keeps its existing semantics, but expensive append-only STL/game/official-observation evidence is materialized in D1 by migration `0035_race_scope_evidence.sql`. First-prize and race-text evidence remain evaluated directly so factual corrections stay immediate.
- Legacy unsplit extended API behavior remains readable for compatibility; the production UI uses only bounded progressive parts.

## Historical extension 2020-2023 candidate
- Adds an explicitly authorized production history block for 2020-09-08 through 2023-09-07, extending the current roughly three-year baseline to roughly six years without changing statistics or analysis semantics.
- The new workflow creates/resumes the existing official historical job first. The matching X-Labs historical job is created only after the official block is complete, preserving the existing official-first prerequisite.
- The production minute scheduler remains the worker that advances bounded checkpoints; the GitHub workflow only authorizes/orchestrates the fixed block and checks capacity.
- D1 capacity is read from Cloudflare's database metadata. The workflow warns at 8.00 GiB and stops the extension at 8.50 GiB, leaving headroom below the 10 GB per-database paid-plan limit.
- The workflow refuses overlapping multi-day official or historical-all X-Labs jobs and can safely resume a failed fixed job after explicit manual authorization.
- Settings exposes recent multi-day historical periods separately for each source so the existing 2023-2026 block and the new 2020-2023 block do not collapse into one ambiguous progress row.
- No migration, model-weight change, statistics-query semantic change, or private racing payload is part of this candidate.
- Merging/deploying the code does not start the historical extension. A manual workflow dispatch with the exact confirmation phrase is still required.

## Navigation and track consistency candidate
- Upcoming round detail now has its own history signature via `upcomingRound`/`upcomingLeg`, so Back/back-swipe returns to Spel → Kommande rather than the prior primary workspace.
- The Kommande detail back control uses the same left-arrow language as the canonical entity/game back buttons.
- Bana → Spårstatistik now follows the shared compact filter interaction: period stays visible, detailed filters open from the sliders icon, and the opened filter panel uses dropdowns consistently.
- Track history state also preserves `trackDetail` and `trackTab`.
- Bana → Hemmatränare narrows official observation candidates before latest-observation ranking, avoids the duplicate count query on the common first page, and adds a dedicated home-track expression index in migration 0036.
- No statistics semantics or factual source rules change.


## Trip-scenario backfill resilience candidate
- Branch: `fix/trip-scenario-backfill-resilience`.
- Production diagnosis found the C4 reconstruction cursor blocked by an immutable telemetry source containing a duplicate target within one frame.
- Migration `0037_xlabs_position_reconstruction_quarantine.sql` adds durable source/job quarantine provenance and a per-job quarantined-source counter.
- Only the exact deterministic duplicate-target validation error is quarantinable. The source remains unchanged in R2, writes no reconstructed/checkpoint/scenario facts, and the cursor advances to the next stored source.
- All other reconstruction failures preserve the existing retry-three-times/fail-closed behavior and do not advance the cursor.
- The production release workflow verifies the new quarantine schema before Worker deployment.
- Merging/deploying this code does not resume the stopped production reconstruction job. Resumption remains a separate explicit production action.


## Track analysis v1 candidate
- Branch: `feature/track-analysis-v1`.
- Bana is split into **Banprofil / Bananalys / Spårstatistik / Hemmatränare**; the former empty Bananalys placeholder is removed from Banprofil.
- Bananalys uses persisted C3 rank at 200 m for individual lanes and persisted conservative C4 labels around 500 m remaining. Auto and volt stay separate when Startmetod = Alla.
- Baseline is the same country/context excluding the current track. Exact data remains visible; 10-24 races is limited, <10 uses transparent interpretation backoff, and 25+ is normally interpretable.
- Step 1 export receives the same deterministic track-analysis contract plus relevant historical C4 labels; market data remains excluded and Step 2/Step 3 contracts are unchanged.
- The user-facing Step 1 copy prompt explains sample, baseline/backoff and double-counting rules. No new AI call, gallop localization or separate aggregate backfill is introduced.
- Migration `0038_track_analysis_v1.sql` adds only the composite C3 checkpoint read index required by the new 100 m/200 m analysis path; it introduces no new derived storage.
- The bounded C4 production reconstruction for the current stored target interval is complete; unsupported/ambiguous labels remain null.


## Bananalys usability v2 candidate
- Branch: `feature/bananalys-usability-v2`.
- Bananalys filter controls now reuse the existing Statistik sliders-icon pattern; Startmetod and Distans appear as dropdowns only when the filter panel is opened.
- Start-position UI keeps the underlying 200 m metrics but shows only **Spår / Spets, 200 m / Topp 3, 200 m / Spets vs. snittet / Underlag**. Median position and the Topp-3 comparison delta are hidden from the UI, not deleted from the derived contract.
- Scenario UI is winner-focused: **Scenario / Seger % / Andel vinnare / Vinst vs. snittet / Underlag**. Occurrence, Topp 3 and the raw baseline column are hidden from the UI.
- Kort analys remains deterministic code, but now prioritizes which lanes reach the lead or a strong early position versus the Swedish comparison set, plus which C4 scenarios winners come from. Internal `baseline` wording is not shown to the user.
- No schema migration, backfill, model-weight change, Step 1 export contract change or private-data mutation is required.


## Bananalys calculation-integrity follow-up
- Branch: `fix/bananalys-calculation-integrity`.
- Audit found that the first Bananalys implementation could mix voltstart handicap tiers into lane statistics and could turn small raw percentage differences into overly confident prose.
- Early-position lane metrics now require complete-field C3 rank evidence plus minimum longitudinal confidence. Voltstart lane metrics use only `start_tier = 1` (ground distance); add-on tiers remain available to scenario analysis but do not contaminate lane effects.
- Narrative comparisons require at least 25 observations on both the track and comparison side plus a minimum effect size and non-overlapping Wilson intervals. Small samples remain visible in raw tables but do not become confident prose.
- Interpretation backoff now preserves a selected start method: a sparse Auto/Volt distance may broaden across distances within the same method, but it cannot borrow the other start method and present it as support for the selected one.
- Winner-scenario coverage is entry-based, preserving correct denominators for dead heats. Scenario-share prose is explicit that it refers to classified winners.
- `Kort analys` renders as bullet points. No schema migration, backfill, model-weight change or production data mutation is part of this follow-up.
- A merely largest percentage is not enough for an absolute track conclusion. `Kort analys` now requires conservative separation from the runner-up before calling one lane or winner scenario clearly strongest; otherwise that absolute claim is suppressed. `Alla startmetoder` is explicitly limited to supported Auto/Volt facts so unknown source values cannot leak into samples or coverage denominators.


## Bananalys natural-summary + mixed scenario timing
- Branch: `feature/bananalys-natural-summary-mixed-scenario`.
- `Kort analys` now starts with what is observed on the selected track: top observed 200 m lead lanes, then same-context Swedish comparison, then top three / bottom three start lanes by observed win rate, followed by natural scenario win-rate wording.
- User-facing summary copy avoids internal data-contract language such as classified-winner phrasing, baseline terminology and observation jargon. Coverage/uncertainty remains in the separate `Analysunderlag` line.
- Absolute statements and comparative statements remain distinct: an observed leader/top lane may be reported from the track data, while words such as `tydligt` still require the conservative comparison safeguards.
- Scenario win-rate timing is intentionally asymmetric: `Spets` is measured from the reliable 500 m-after-start C3 checkpoint; all other named C4 positions remain measured around 500 m remaining.
- The scenario table exposes the measurement point per row and compares scenario win rate, not winner-share, against the same-country baseline.
- No model weights, market logic, Spårstatistik tab ownership or production data are changed by this build.


## Step 1 D1 CPU-limit follow-up
- A production Step 1 export exposed `D1_ERROR: D1 DB exceeded its CPU time limit and was reset` after Bananalys added additional 500 m scenario reads.
- Root cause in code review: Bananalys evidence queries began from nationwide X-Labs position tables and only later joined to the selected track/context. Step 1 embeds Bananalys and can request several track/distance contexts in one export, multiplying those broad scans.
- The fix keeps the same calculations and output contract but changes C3/C4 reads to first materialize eligible race entries for the selected track/country, start method, distance and as-of cutoff, then probe X-Labs evidence by `race_entry_id` through existing entry-first indexes.
- No facts, feature definitions, market-blind rules, model weights, private data or production racing rows are changed.


## Step 1 D1 CPU root-cause fix
- Codex review of the still-failing production export identified the dominant remaining cost in `xlabs-evidence-profiles-v1.js`: nationwide X-Labs ranking/population CTEs were rebuilt for every one of the eight target races.
- The fix batches the round at the shared Step 1 cutoff, pushes target horse IDs inside the X-Labs ranking scope, and shards nationwide population aggregation into bounded calendar-year queries before deterministically merging counts/sums back to the existing aggregate contract.
- The already-built Step 1 relevant-history map is now reused by performance, equipment and person-context feature builders instead of being rebuilt three additional times.
- No analysis definition, market-blind boundary, model weight or output contract changes are intended. Population means are reconstructed from exact shard sums/counts rather than averaging shard averages.


## Spel outcome statistics candidate
- Branch: `feat/game-statistics-history-v1`.
- Step 1 export now freezes horse Form 1–100, the number of starts behind the score, Form version, exact as-of timestamp and relative Form rank for every analysis-eligible starter. The frozen values are append-only per Step 1 pack and do not change after results arrive.
- Post-race settlement now completes the round with one final official game capture when no stored final game result exists. The same final game source is normalized through the existing official-live path so final betting percentage and market rank for every starter are stored as separate closing-market observations without overwriting pre-race market snapshots.
- Final game facts preserve official raw money units plus derived SEK values, payout/jackpot/system counts by right level, final turnover, final system count and source provenance. The parser is generic for V85/V86 payout levels; no real provider payload is committed.
- Existing Spel → Historik leg cards keep their current layout and add Form before start, Form rank, KentaurAI rank, ABCD group, final betting percentage and final market rank where verified data exists.
- Spel adds a separate Statistik tab. It reports winner win rates by final betting percentage, final market rank, frozen Form, Form rank, KentaurAI rank and ABCD; detailed spike outcomes; and primary-system results against the round's top-right-level final payout. Aggregate system statistics use one canonical primary system per round so alternatives are not double-counted.
- Analys and the global Statistik workspace are unchanged.
- Historical gaps stay null unless a real stored snapshot exists or a calculation can be replayed leakage-safely at the historical cutoff. The build does not synthesize missing Form, ranking or market facts.


## Statistics data completion backfill
- Current hardening branch: `fix/statistics-backfill-state-machine-20260925`.
- Durable per-round coverage remains the operational cache for registered historical V85/V86 systems; canonical racing, market, analysis, system and Form facts remain in their existing tables.
- Post-race settlement remains the owner of winners/final-game acquisition. Statistics may only repair closing market from the already archived final official game source.
- Migration `0041_statistics_data_backfill_state_v2.sql` separates lifecycle work state from metric state, adds due-time scheduling, leases, retry metadata and input fingerprints, and schedules existing rows for one safe source-of-truth re-audit.
- The minute step selects one due round rather than only globally `pending` rows. Waiting facts are rechecked at a bounded cadence, transient failures back off exponentially, terminal rows are low-frequency re-audited, and one bad round cannot hot-loop/starve the queue.
- Form and closing-market terminal decisions are metric-level and input-aware. Unchanged deterministic failures are not replayed; changed verified input can reopen that metric. A terminal Form decision does not block later results/final-market/payout refresh.
- Historical Form/Form-rank still requires exact audited Step 1 pack/fingerprint lineage or the verified legacy eight-leg snapshot fallback. Step 1 `as_of` and generation time must be within the verified pre-race cutoff, and generation/legacy analysis creation may not occur after the registered system.
- KentaurAI rank, ABCD and spike history are audited only from canonical stored pre-race/system facts. Missing historical AI judgments remain unavailable; malformed historical system invariants are surfaced for review rather than rewritten.
- Passive audits do not increase `attempt_count`; only actual Form/market repair work does. Aggregate status output separates waiting/retryable/manual-review/legitimate-gap states without exposing private round identities.
- Existing stale rows recover through the migration + scheduled re-audit path; no destructive reset or manual production SQL rewrite is part of the design.


## Historical official structural source-gap resilience
- Long multi-day official backfill can preserve an identity-verified race response with missing/non-array `starts` as `captured_source_gap` / `missing_starts_array` and advance the checkpoint.
- No participant/result rows are synthesized from that response, and daily/current plus ordinary/manual race capture remain strict.
- Existing failed production history can resume from its durable checkpoint after deployment rather than restarting the range.


## Post-race final-game identity resilience
- Final game normalization now resolves race entries by canonical horse identity before source_start_id when the horse identity is present.
- Existing non-null horse identity on a race entry is preserved rather than rewritten by a later source-start remap.
- Regression coverage includes a synthetic final payload whose two source-start ids are swapped while canonical horse ids remain stable.


## Winner index, Trend sort and final-game settlement ownership
- Spel → Statistik winner-rate tables now also expose a deterministic Vinnarindex: winner share divided by starter share within the same known-value metric population.
- The UI keeps existing filters/layout and adds the Vinnarindex column with an inline explanation; unknown values remain null.
- Trend keeps the current default ranking, but trainer/driver win-rate lists can switch between highest and lowest win rate without changing the underlying filters or population.
- The selected sort only changes ordering/rank; the metric calculations are unchanged.
- Post-race settlement now owns its final official game snapshot explicitly through generic source metadata.
- Settlement finalization repairs only the verified closing market required for post-race statistics, persists final payout/result facts, and does not re-run full participant normalization after all eight factual winners are already known.
- Scheduled live normalization excludes settlement-owned final sources so both pipelines cannot normalize the same source concurrently.
- Chunked official normalization now uses the same horse-first race-entry identity rules as whole-game normalization and preserves existing stored horse/source-start identity on remaps.
