## Storage cleanup integrity-audit index migration recovery candidate
- Branch: `fix/split-cleanup-audit-index-migrations`, based on main release-marker commit `9c9e2adc497d135abcab1eed54339f13a3fb732b`.
- PR #297 merged successfully and both exact-head CI and post-merge main CI passed. Production release #163 then stopped safely before Worker deployment while applying migration `0051_storage_cleanup_audit_indexes.sql`: D1 returned storage timeout code 7429 while the five indexes were being built in one migration request.
- No Worker deployment or destructive storage cleanup occurred after that failure. The failure is a schema-migration sizing issue, not a test or cleanup-integrity failure.
- The recovery splits the five index builds into bounded idempotent single-statement migrations (`0051`-`0055`) and adds `0056` as a profile-index backstop. Snapshot-table indexes are reduced to the exact `source_record_id` key required by the audit, avoiding unnecessary index width.
- Every recovery migration uses `CREATE INDEX IF NOT EXISTS`. The `0056` backstop guarantees the profile index even if Cloudflare happened to record the timed-out original `0051` migration before the client saw the reset.
- Production release verification now requires all six recovery migration records and all five final index names before Worker deployment.
- No racing facts, provenance rows, raw payloads or cleanup-session state are changed by this recovery.

## Storage cleanup integrity-audit cost hardening candidate
- Branch: `fix/storage-cleanup-audit-cost`, based on deployed main `ec849e62f282803737c94194b8e52dd6d4060cdc`.
- Production storage-cleanup dry-run #11 failed safely before planning or mutation because the read-only `/v1/storage-cleanup/audit` request tripped the D1 per-operation cost-safety stop. The temporary cleanup token was removed and production health still passed afterward.
- The provenance representation audit now counts logical source representations by `source_record_id` without a full entity/scope `UNION`. A direct snapshot plus its own factual observation counts once; observation-backed later sources count independently. This preserves current change-point semantics while avoiding the expensive global deduplication.
- Migration `0051_storage_cleanup_audit_indexes.sql` adds covering `source_record_id` access paths for all four snapshot families plus a status/source index for completed snapshot sync rows.
- The cleanup audit endpoint now cost-observes each snapshot family separately and then the operational state check, while returning one sanitized aggregate cost. The normal per-operation safety threshold remains unchanged; the GitHub runner still applies the separate cumulative per-run D1 budget.
- The runner now includes only sanitized rows-read/written/duration metrics when a cost stop occurs and refuses to begin cleanup planning if the integrity audit itself exhausts the cumulative cleanup-run budget.
- This candidate does not delete, rewrite or clean production data. The dry-run must be rerun after review/merge/deploy before any destructive cleanup authorization.

## Cost-readiness QA hardening — deployed
- PR #296 merged at `1775852716c998c85cfebd735a0185f35f9b5cb3` and production release #162 completed from main `ec849e62f282803737c94194b8e52dd6d4060cdc`.
- Deep scheduled-chain review found one dormant legacy minute-cron side path in `worker-pwa.js`: it could still run one post-race review if a retired `* * * * *` trigger were ever delivered. Current Wrangler production config exposes only `15 5 * * *`, so the path was not active, but it violates the single-owner cost-safety rule and is removed in this candidate.
- Regression coverage now exercises the full production worker chain and requires the retired minute cron to return `unsupported_cron` with no overlay work beyond the outer automation-control point read.
- QA also found that one static `captured_source_gap` game snapshot could be selected repeatedly inside the same bounded morning normalization loop. Operational state now marks that exact source as attempted, so automatic selection skips it thereafter; a newly captured source for the same game remains independently eligible.
- Release preflight is being hardened to probe D1 analytics using the exact KentaurAI database id, matching Drift's production query path.
- Documentation is aligned to the real seven-date upcoming horizon: today plus six future dates.
- No cleanup is started by this QA. Destructive cleanup remains a separately authorized operation.

## Cost efficiency & observability v2 — deployed
- PR #295 is merged and migration `0050_cost_efficiency_v2.sql` is applied in production.
- Automatic Start Points and official snapshot promotion have been removed from legacy Worker overlays and moved into the canonical morning orchestrator, where they share automation control, exact D1 cost observation and the cumulative safety stop.
- Automatic promotion is limited to normalized official sources from the recent three-day recovery window; older unsynchronized sources remain preserved for explicit/manual replay.
- Compact per-source live-normalization cursor/failure state replaces repeated audit-history reconstruction after one legacy-state migration.
- The upcoming morning horizon is exactly seven dates: today plus six future dates.
- Once cumulative D1 cost safety stops, later critical as well as non-critical processors are skipped; raw live capture remains first.
- Drift scopes D1 analytics to the exact KentaurAI database, surfaces recent Cloudflare Query Insights and shows exact recorded D1 reads/writes/time for morning stages.
- No storage cleanup, historical backfill, model change or racing-fact deletion was part of PR #295.

## Settings Drift / usage control candidate
- Branch: `feat/settings-drift-usage-control`.
- Settings is reorganized into **Drift** and **Data**. Drift owns automatic-workflow control, Cloudflare D1 usage, source/job status and recent activity; Data keeps stored counts and the sanitized coverage export.
- Migration `0049_runtime_controls.sql` adds the persisted `automatic_workflows_enabled` control, enabled by default.
- The outer production worker checks the control before entering the scheduled worker chain, and the canonical scheduled orchestrator rechecks it before each morning part. Legacy Worker overlays do not own automatic data side-jobs; a newly paused switch therefore stops subsequent automatic work, while an operation already in flight is allowed to finish. Control-read failures fail closed.
- Cloudflare is the usage/billing source of truth. D1 rows read/written/storage come from Cloudflare analytics. R2 storage progress uses the latest Cloudflare `r2StorageAdaptiveGroups` sample for the private `kentaurai-raw` bucket (payload + metadata bytes) and compares current stored bytes with a 10 GB reference level, while the USD cost beside that card continues to come from Cloudflare billable-usage for the current billing period. R2 Class A/Class B progress still uses billable-usage operation counts. Per-metric cost prefers Cloudflare `BilledCost` (falling back to Cloudflare `EffectiveCost`/`ContractedCost` when provided). Because Cloudflare's newer account-usage schema can omit cost fields, D1 rows read/written alone have a deterministic fallback from verified Cloudflare usage and the published Workers Paid included limits/rates; that fallback is explicitly tagged in the API response rather than presented as Cloudflare-returned billing. Progress-bar tones are green below 80%, orange from 80% to below 100%, and red from 100% upward. Missing factual inputs still remain unavailable rather than fabricated.
- Runtime Cloudflare usage requires `CLOUDFLARE_ACCOUNT_ID` plus a dedicated read-only `CLOUDFLARE_USAGE_API_TOKEN` with Account Analytics Read and Billing Read. Neither value is committed. The release preflight validates D1 analytics, R2 storage analytics and the billable-usage endpoint before production migration.
- Drift "Senaste aktivitet" can estimate per-workflow D1 reads, writes and USD cost without adding per-query instrumentation. Cloudflare's verified daily D1 totals are allocated across same-day registered `import_runs` using recorded import activity (duration fallback), and the estimated cost is calculated against the billing-period cumulative position so only the estimated share above the included monthly D1 thresholds is charged. These figures are explicitly labeled as estimates and historical runs without sufficient current-cycle data remain unavailable.
- The reviewed production release consumes the GitHub Actions usage token only at runtime, validates billing + D1 analytics access before any production migration, uploads both runtime bindings alongside the Worker with Wrangler's `--secrets-file`, and then verifies only the secret names/types through Cloudflare's secret-binding API. Secret values are never printed or committed.
- Production entrypoint candidate is `src/worker-v079.js`. Production release verifies migration 0049 before promotion.

## Cloudflare single-promotion-path hardening candidate
- Branch: `fix/cloudflare-build-promotion-gate`.
- Baseline before this candidate is production release #150 on main head `0b8024ff43343b9507c06ffdabe3f948a2a70e02`, with production schema verified through migration `0048_live_pending_cost_indexes.sql`.
- Deep release review showed that Cloudflare Workers Builds was still connected to GitHub and produced a build on pushes to `main`. KentaurAI's contract is stricter: explicit merge/deploy approval should flow through exactly one production promotion path.
- The release workflow now enforces the Cloudflare production Git trigger to `npx wrangler versions upload` before any production migration. Git-triggered builds may still create inactive Worker versions/check status, but they may not promote the live Worker.
- `scripts/cloudflare-builds-policy.mjs` discovers the exact `kentaurai-api` Worker tag and the exact GitHub/`kentaurai` production trigger, fails closed on ambiguity, updates only the deploy command, then re-reads the trigger to verify the policy.
- The Builds API token is never logged. Cloudflare Builds requires a user-scoped token with `Workers CI Write`; the release uses an optional dedicated `CLOUDFLARE_BUILDS_API_TOKEN` for trigger operations while the existing `CLOUDFLARE_API_TOKEN` performs Worker discovery/deployment. If the dedicated token is absent the existing token is tried for Builds too; missing permission fails the release before D1 migration or Worker deployment.
- No Worker runtime code, D1 schema, R2 data, racing facts, analysis semantics or scheduled acquisition behavior changes in this hardening build.

## Broad cost/storage QA follow-up
- The cleanup runner now records cumulative D1 rows read/written across its API requests and stops without automatic continuation at 1,000,000 reads or 100,000 writes in one run; this prevents a pathologically expensive scan from being repeated by run-until-complete chaining.
- Automatic live normalization is restricted to the recent three-day recovery window and migration `0048_live_pending_cost_indexes.sql` adds narrow pending-game and failed-normalization indexes so old captured history is not scanned during the morning loop.
- Cleanup workflow now refuses to run unless checked-out `main` exactly matches the latest successful production-release SHA, preventing a newer runner from controlling an older deployed Worker.
- Integrity preflight also fails on unfinished `started` cleanup batches or raw rewrites that reached zero legacy D1 references without a verified legacy-object deletion, covering interruption/crash residue before another destructive session.
- Cost observation of D1 `.first()` reads is bounded to one-row metadata-returning SQL instead of expanding point reads into full-result scans.
- Settings evaluates the three most recent automatic daily jobs per source, so a newer healthy day cannot hide an older failure still inside the bounded catch-up window.
- Branch: `fix/storage-cleanup-legacy-provenance` / PR #284.
- The production cleanup execute run started during review was cancelled before completion; no automatic continuation was queued, the temporary cleanup credential was removed and the post-cancel Worker health check passed.
- Deep review found that legacy duplicate snapshot rows created before `official_snapshot_observations` could lose source/as-of provenance when deleted. Cleanup now materializes the missing observation on the retained change-point before deletion and marks duplicate observations as `factual_changed=0`.
- As-of readers now treat the original snapshot row as a base observation even after later identical source observations reuse it, so a later observation cannot erase the earlier historical state for an earlier cutoff.
- Migration `0046_snapshot_observation_lookup_index.sql` adds the missing `(snapshot_family,snapshot_id,...)` access path used by snapshot reads and cleanup rewrites. Migration `0047_storage_cleanup_session_audits.sql` binds a successful provenance audit to the exact cleanup session/source SHA so continuations cannot bypass a preflight they never passed.
- D1 cost instrumentation now measures `.first()` reads through a metadata-returning equivalent instead of silently treating those reads as zero.
- New dry-runs perform a sanitized provenance-integrity audit before scanning. New execute sessions start first, then must persist a successful audit bound to that exact session/source SHA before any plan/execute request; verified continuations reuse only that persisted audit. Missing/dangling/mismatched representation fails closed.
- Do not resume the cancelled production cleanup session. A later cleanup must start as a new manually authorized operation only after this follow-up is reviewed, merged, released and the integrity preflight passes.

## Scoped production cleanup session safety follow-up
- Branch: `fix/storage-cleanup-session-safety`.
- The run-until-complete workflow now stores progress inside an explicit cleanup session rather than permanent per-target global state.
- Each session is bound to the exact Git commit that started it, expires after 24 hours and stops after at most 48 workflow runs. A changed `main` therefore cannot silently continue an older destructive cleanup cursor under different code.
- Only one running session is allowed per source commit. An interrupted manual retry resumes that session; once it completes, a later manual cleanup starts a fresh session so future newly accumulated duplicates are not skipped.
- Migration `0045_storage_cleanup_sessions.sql` adds the session/target state. The earlier additive `0044_storage_cleanup_resume_state.sql` remains in migration history but is no longer used by runtime cleanup orchestration.
- Production release now verifies the 0045 migration, both session tables and their safety indexes before the Worker deploy can pass.
- The existing 25-row/reference executor bound, plan token, exact confirmation, temporary cleanup-only auth, D1 restore point, cost-safety stop, conflict fail-closed behavior, health verification and automatic token removal remain unchanged.

## Run-until-complete production cleanup candidate
- Branch: `feat/storage-cleanup-run-until-complete`.
- Execute mode keeps the 25-row/reference executor cap but removes the workflow-level 250-batch ceiling.
- A soft 35-minute cleanup window checkpoints HMAC-signed per-target cursor/progress state in D1 through migration `0044_storage_cleanup_resume_state.sql`.
- If the cleanup is still incomplete after the soft deadline and the run made progress, GitHub Actions queues a controlled follow-on run. If no progress is made, cost safety trips, a plan mismatch occurs or a raw conflict is found, execution fails closed instead of chaining.
- The short-lived cleanup-only Worker token, 401 propagation retries, D1 Time Travel restore point, plan/execute count equality, post-run health check and automatic token deletion remain mandatory.
- Dry-run stays bounded and non-mutating. No backfill, repair, historical acquisition, VACUUM or unrelated collection is introduced.

## Ephemeral production cleanup authentication candidate
- Branch: `codex/ephemeral-cleanup-auth`.
- The manual storage-cleanup workflow no longer requires a duplicated GitHub copy of the Worker `ADMIN_TOKEN`.
- GitHub Actions uses the already-configured Cloudflare API credentials to generate a random short-lived `STORAGE_CLEANUP_TOKEN`, stores it as a temporary Worker secret, and uses it only for `/v1/storage-cleanup/*`.
- The temporary token embeds its issue time and is accepted for at most one hour. Normal admin routes still require `ADMIN_TOKEN`.
- The workflow removes the temporary Worker secret in an `always()` cleanup step and still keeps all existing restore-point, dry-run, confirmation, cost-safety and batch bounds.

## Manual production storage-cleanup workflow candidate
- Branch: `codex/manual-production-storage-cleanup-workflow`.
- Adds a manual GitHub Actions `workflow_dispatch` entry point for production storage cleanup; there is no schedule.
- Dry-run is the default. Execute mode requires the exact confirmation `EXECUTE REVIEWED STORAGE CLEANUP`.
- The workflow requires the existing Cloudflare API token/account id plus a GitHub Actions secret named `KENTAURAI_ADMIN_TOKEN`, resolves the production workers.dev URL through the Cloudflare API, verifies health and captures a current D1 Time Travel bookmark before any cleanup call.
- Cleanup remains bounded to 25 rows/references per executor batch with a configurable hard cap of at most 250 batches per family per workflow run. Every destructive batch is immediately preceded by its matching plan token and aborts on cost-safety or plan/execution count mismatch.
- No backfill, repair, historical collection, VACUUM or full database export is invoked by the workflow.

## Post-cost-safety follow-up candidate
- Branch: `codex/post-cost-safety-followups`.
- Production release #138 already has the emergency cost stop live: one `05:15 UTC` Worker cron, no minute cron, no scheduled multi-year history extension and no exhausted failed-import fallback scan.
- This follow-up keeps X-Labs automatic work bounded but expands the explicit daily catch-up set from only yesterday to the previous three dates, newest first, so late-settled recent rounds are not stranded.
- The shared X-Labs morning budget remains fixed; `historical_all` jobs are still never selected implicitly.
- Settings now treats multi-day historical jobs that remain stored as `running` after automatic history was intentionally disabled as **Pausad**, not stale/failed. Failed historical jobs still surface as action-required, and daily retry failures still surface as errors.
- README/live-state documentation is corrected to the deployed release #138 and the single-morning-schedule architecture.
- No migration, private payload, historical deletion or production mutation is part of this candidate.

## Emergency Cloudflare cost-safety production live
- PR #271 was merged and production release #138 deployed successfully.
- Cloudflare D1 query analytics identified the exhausted live-import recovery scan as the dominant current read path; the automatic fallback scan over failed import history is removed.
- Worker scheduling is one bounded morning schedule at `05:15 UTC`; stale unsupported cron invocations are ignored without D1 work.
- Morning live capture preserves the seven-day upcoming V85/V86 horizon.
- Daily official result ingestion uses explicit one-day job ids, so long multi-day historical jobs cannot be picked up by the automatic scheduler.
- Automatic statistics-history repair, X-Labs interval repair and X-Labs position-reconstruction loops are removed from cron execution. Their admin/manual routes remain available.
- The GitHub 2020-2023 history-extension workflow has no schedule and requires explicit workflow dispatch confirmation.
- Existing historical data is preserved.

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
- Analys uses the Phosphor **Asterisk** icon (Regular) and owns the existing external-AI workflow previously shown under the Settings AI tab.
- Settings is data-only and has no redundant single Data tab.
- Spel uses the Phosphor **Currency Circle Dollar** icon.
- Bottom navigation is rebalanced for four equal responsive items with a modest bar height and compact active state.
- Entity lists, detail pages, statistics tabs, track pages, Spel tabs, search and all underlying data/API behavior remain unchanged.
- No schema migration or private-data change is required.

# Build state

Version: 0.6.0
Updated: 2026-09-27

## Current production truth
- Worker: `kentaurai-api`.
- D1: `kentaurai`.
- R2: `kentaurai-raw`.
- Current reviewed production baseline is the latest successful production-release workflow on `main`; this candidate started from release #150 / `0b8024ff43343b9507c06ffdabe3f948a2a70e02`.
- Worker entrypoint is `src/worker-v078.js` with `ANALYSIS_WORKFLOW_MODE=v3`; the default mode serves the external-AI workflow while historical sealed-v3 artifacts remain read-compatible.
- The latest production release completed successfully with full QA, Cloudflare validation, migration/schema/index verification, Worker deploy, `/health`, `/app/login` and private analysis/evidence route protection.
- Production schema is verified through migration `0048_live_pending_cost_indexes.sql`, including the snapshot-observation lookup, cleanup-session audit binding and bounded live-normalization indexes.
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
- The external-analysis workflow remains active in the current production baseline; the cost/storage QA follow-up does not change analysis semantics.

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
- The single morning orchestrator runs a bounded settlement batch; each settlement batch processes at most three checkpoints sequentially, then runs the existing deterministic post-race review. No model changes are made automatically.
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
- Long production-history extension is manual-only. The GitHub workflow authorizes/orchestrates the fixed block and checks capacity; the normal morning scheduler does not advance multi-day history jobs.
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
- The explicit/admin statistics-backfill step selects one due round rather than only globally `pending` rows. Waiting facts retain bounded due times, transient failures back off exponentially, terminal rows are low-frequency re-audit candidates, and one bad round cannot hot-loop/starve an operator-triggered batch.
- Form and closing-market terminal decisions are metric-level and input-aware. Unchanged deterministic failures are not replayed; changed verified input can reopen that metric. A terminal Form decision does not block later results/final-market/payout refresh.
- Historical Form/Form-rank still requires exact audited Step 1 pack/fingerprint lineage or the verified legacy eight-leg snapshot fallback. Step 1 `as_of` and generation time must be within the verified pre-race cutoff, and generation/legacy analysis creation may not occur after the registered system.
- KentaurAI rank, ABCD and spike history are audited only from canonical stored pre-race/system facts. Missing historical AI judgments remain unavailable; malformed historical system invariants are surfaced for review rather than rewritten.
- Passive audits do not increase `attempt_count`; only actual Form/market repair work does. Aggregate status output separates waiting/retryable/manual-review/legitimate-gap states without exposing private round identities.
- Existing stale rows recover through the migration plus the explicit bounded re-audit path; there is no recurring statistics-repair scheduler, destructive reset or manual production SQL rewrite in the design.


## Historical official structural source-gap resilience
- Long multi-day official backfill can preserve an identity-verified race response with missing/non-array `starts` as `captured_source_gap` / `missing_starts_array` and advance the checkpoint.
- No participant/result rows are synthesized from that response, and daily/current plus ordinary/manual race capture remain strict.
- Existing failed production history can resume from its durable checkpoint after deployment rather than restarting the range.


## Post-race final-game identity resilience
- Final game normalization now resolves race entries by canonical horse identity before source_start_id when the horse identity is present.
- Existing non-null horse identity on a race entry is preserved rather than rewritten by a later source-start remap.
- Regression coverage includes a synthetic final payload whose two source-start ids are swapped while canonical horse ids remain stable.


## Reviewed storage cleanup executor candidate
- Branch: `codex/storage-cleanup-executor-v1`.
- Production cleanup remains blocked until this branch is reviewed, merged, deployed and the separate restore/dry-run gates pass; this build itself performs no production cleanup.
- Snapshot cleanup is explicit, ADMIN_TOKEN-protected and limited to 25 deterministic change-point candidates per batch. A fresh signed cursor, matching dry-run token and exact confirmation are required. Observation provenance is rewired before a duplicate snapshot row can be deleted, and an audited D1 constraint rolls the batch back if the delete count differs from plan.
- Raw-object cleanup verifies the legacy key/hash and object, creates or verifies the canonical object first, rewrites at most 25 indexed D1 references, confirms zero legacy references, and deletes the legacy object last. Conflicts and missing/unverifiable objects stop the operation.
- Migration `0043_storage_cleanup_executor_v1.sql` records sanitized batch assertions and completion state. No automatic schedule, backfill, deployment or production mutation is introduced.


## Winner index, Trend sort and final-game settlement ownership
- Spel → Statistik winner-rate tables now also expose a deterministic Vinnarindex: winner share divided by starter share within the same known-value metric population.
- The UI keeps existing filters/layout and adds the Vinnarindex column with an inline explanation; unknown values remain null.
- Trend keeps the current default ranking, but trainer/driver win-rate lists can switch between highest and lowest win rate without changing the underlying filters or population.
- The selected sort only changes ordering/rank; the metric calculations are unchanged.
- Post-race settlement now owns its final official game snapshot explicitly through generic source metadata.
- Settlement finalization repairs only the verified closing market required for post-race statistics, persists final payout/result facts, and does not re-run full participant normalization after all eight factual winners are already known.
- Scheduled live normalization excludes settlement-owned final sources so both pipelines cannot normalize the same source concurrently.
- Chunked official normalization now uses the same horse-first race-entry identity rules as whole-game normalization and preserves existing stored horse/source-start identity on remaps.
