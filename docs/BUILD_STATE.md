# Build state

Version: 0.6.0
Updated: 2026-09-18

## Current production truth
- Worker: `kentaurai-api`.
- D1: `kentaurai`.
- R2: `kentaurai-raw`.
- Latest v3 round-picker application source merged at `c3d36ff400b1a617475458d884e39cc0adebe372`; controlled release trigger/main head is `c86d3d209c3d42b86150c4522d11f708a6e94bf1`.
- Worker entrypoint is `src/worker-v077.js` with `ANALYSIS_WORKFLOW_MODE=v3`; v077 delegates F4 analysis/scheduling behavior to `worker-v076.js`.
- Production release #62 completed successfully. Exact-head QA, Cloudflare validation, migration/schema/index verification, Worker deploy, `/health`, `/app/login` and private analysis/replay route protection all passed.
- Production schema is current through migration `0026_app_read_performance.sql`.
- F1 replay/calibration, F2 post-race learning diagnostics, F3 private workflow/observability, F4 v3 cutover and the private-app navigation performance layer are production-live.
- Historical official/X-Labs jobs keep their durable cursors. The round-picker release did not reset, recreate or resume stopped historical work.

## External analysis workflow correction - source candidate
- The next source change replaces the primary private analysis UI with the approved external-AI workflow without changing the production database schema.
- Analysis flow: select one round + AI -> Step 1 market-blind export/instruction -> Step 2 verified market export/instruction in the same external AI conversation.
- Step 1 is not imported or server-sealed in the normal UI path and the normal UI does not invoke the canonical optimizer.
- System registration is separate: select a round later -> download round/entry import context -> copy registration instruction -> import the AI-generated JSON.
- Registration validates canonical identities and exactly three singleton spike legs, then KentaurAI derives row count, line-price cost, stored probabilities/market fields and persistence metadata.
- Existing sealed-v3 lock/decision/optimizer code and historical artifacts remain available for compatibility/history but are not the intended primary workflow after this change.
- No new migration is required; the existing analysis/system tables are reused.
- This section describes the pending source candidate only. Production release #62 remains the deployed baseline until a reviewed release is explicitly authorized and completed.

## App performance live
- `worker-v077` adds only the private-app HTML performance layer; racing/analysis semantics and auth boundaries are unchanged.
- The browser uses short-lived in-memory GET caching and in-flight request de-duplication only; no private API payloads are persisted to localStorage.
- First navigation pages are idle-prefetched, entity/track details are prefetched on hover/focus, and uncached navigation shows immediate loading feedback.
- Initial entity detail no longer enriches up to 100 historical starts before rendering; paginated history remains loaded on demand.
- Track overview defers the expensive home-trainer scan to the dedicated Hemmatränare tab and avoids a duplicate track metadata query.
- Migration `0026_app_read_performance.sql` adds the genuinely new indexes for the hottest entity/track/history read paths; existing driver/trainer/betting indexes are reused.

## F4 live - v3 cutover, legacy deprecation and release hardening
- F4 cutover layer: `src/worker-v076.js`; production is wrapped by `src/worker-v077.js` for private-app performance only.
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
