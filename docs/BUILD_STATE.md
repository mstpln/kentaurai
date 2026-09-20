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
- The Settings flow is Step 1 blind analysis -> Step 2 market analysis only -> Step 3 interviews/external horse statistics -> Step 4 user/AI system dialogue -> Step 5 separate external-evidence registration -> Step 6 separate system registration.
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
- C4 named trip-label promotion remains optional/gated and is not required for the cutover.
- F4 has no planned schema migration and does not reset or start replay/backfill work.

## v3 programme status
- A1-A4: complete.
- B1-B6: complete.
- C1-C3: complete and deployed. C4: optional/gated, not promoted.
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
