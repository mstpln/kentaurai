# Build state

Version: 0.6.0
Updated: 2026-09-18

## Current production truth
## App performance candidate
- Branch: `perf/private-app-navigation-v1`.
- Candidate Worker entrypoint: `src/worker-v077.js`, delegating all F4 behavior to `worker-v076.js`.
- Scope: faster private-app navigation only; no analysis-policy, source-ingestion, replay or learning changes.
- Adds in-session GET caching/in-flight de-duplication, idle prefetch of first navigation pages, hover/focus detail prefetch and immediate skeleton feedback.
- Entity detail navigation no longer enriches up to 100 historical starts before rendering the initial profile; paginated history remains loaded on demand.
- Track overview defers the expensive home-trainer scan to the dedicated Hemmatränare tab and avoids a duplicate track metadata query.
- Migration `0026_app_read_performance.sql` adds indexes for the hottest entity/track/history read paths.
- Production release workflow is prepared to verify worker-v077 and migration/index presence, but no deployment occurs without explicit authorization.

- Worker: `kentaurai-api`.
- D1: `kentaurai`.
- R2: `kentaurai-raw`.
- Full-plan QA application source merged at `4085a3fc9a36bddedb39e6e7ee9fc14e7105cb76`; production release trigger/main head is `799e8b1f19a57672c1332f424de89cf6391e9978`.
- Worker entrypoint is `src/worker-v076.js` with `ANALYSIS_WORKFLOW_MODE=v3`.
- Production release #60 completed successfully. Full QA (785/785), Cloudflare validation, schema verification, Worker deploy, `/health`, `/app/login`, F4 Step 2 bundle protection and existing private analysis/replay route checks passed.
- Production schema is current through migration `0025_post_race_learning_f2.sql`.
- F1 replay/calibration, F2 post-race learning diagnostics, F3 private workflow/observability and F4 v3 cutover are production-live.
- Historical official/X-Labs jobs keep their durable cursors. No build/release may reset, recreate or silently resume stopped historical work.

## F4 live - v3 cutover, legacy deprecation and release hardening
- Production Worker entrypoint: `src/worker-v076.js`.
- Production default: `ANALYSIS_WORKFLOW_MODE=v3`.
- Controlled rollback value: `ANALYSIS_WORKFLOW_MODE=legacy_v2`. Rollback requires a reviewed production release; there is no automatic fallback.
- The normal creation workflow is v3: deterministic pre-market pack -> server-sealed Step 1 -> optional late-fact revision -> self-contained Step 2 bundle -> Step 2 interpretation -> canonical decision -> deterministic exact-three-spike optimizer.
- The Step 2 bundle contains the exact persisted sealed Step 1 document plus its bound verified market files. New Step 2 work therefore does not rely on reconstructing Step 1 from conversation memory.
- Legacy v1/v2 analysis creation is disabled in v3 mode after authentication; creation routes return a deprecation error. Historical legacy read routes/artifacts remain available.
- Newly created V85/V86 systems are authoritative optimizer output with exactly three spikes. Current default policy targets 150-250 SEK and may spend less when additional rows add no P(8) coverage.
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
- Current market cannot enter sealed Step 1.
- Latest non-superseded Step 1 lock is required before market export.
- Step 2 cannot submit canonical decision probability or system structure.
- Code optimizer owns new system selections, row count, cost and exact-three-spike structure.
- External editorial/ranking signals are read last and cannot rewrite Step 1.
- Learning requires repeated evidence; one result never changes weights automatically.
- Real provider payloads, real reference exports, private editorial provenance and secrets never enter public GitHub.

## F4 release verification
F4 is production-live. The cutover was accepted after:
1. Full exact-head CI and architecture review must pass.
2. Synthetic v3 pack/lock/market/Step2/optimizer integration and private-auth/cutover tests must pass.
3. Legacy read compatibility must remain intact while new legacy creation is disabled.
4. Documentation and active prompts must contain no contradictory two-spike/declared-unsealed/current legacy policy.
5. User must explicitly authorize merge/deploy.
6. Controlled release must verify Worker v076, v3 health mode, login/private auth, F4 bundle route and legacy creation cutover.
7. No historical replay/backfill reset or resume occurred. A bounded private dry-run remains the separate operational acceptance check when a suitable private current/reference round is available.
