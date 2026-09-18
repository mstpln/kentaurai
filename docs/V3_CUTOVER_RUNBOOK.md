# F4 v3 cutover release and rollback runbook

## Purpose
F4 makes the sealed v3 workflow the normal KentaurAI analysis path while preserving historical v1/v2 reads. It must not reset backfills, start large replays or rewrite legacy analysis history.

## Release source rule
- Feature work is reviewed on an exact F4 branch head.
- After explicit user authorization, merge that exact feature head to `main`.
- The production trigger `source_main` must reference the resulting application merge commit, never the later release-PR merge commit.
- Use a separate `release/...` branch and release PR.

## Required pre-release checks
1. Full repository QA is green on the exact F4 head.
2. `wrangler.jsonc` points to `src/worker-v077.js` (performance wrapper delegating to the F4 `worker-v076.js` cutover layer) and `ANALYSIS_WORKFLOW_MODE` is `v3`.
3. v3 pack, sealed Step 1, market binding, Step 2 integration and exact-three-spike optimizer tests pass.
4. Default-mode tests prove all known legacy creation routes are disabled after authentication while legacy reads remain available.
5. Private-auth tests prove unauthenticated callers learn no private analysis state.
6. Active v3 prompts contain no legacy 700 SEK, two-spike or client-built-system policy.
7. Documentation matches the cutover behavior.

## Controlled production release
1. Run full QA before any production action.
2. Validate Cloudflare configuration.
3. Apply only pending migrations. F4 itself requires no new migration.
4. Verify existing production schema through migration 0025 without exposing rows.
5. Deploy Worker v077; it must preserve the F4 worker-v076 v3/rollback semantics.
6. Verify `/health` returns service/version plus `analysisWorkflow: "v3"`, the F4 cutover version and `legacyAnalysisCreationEnabled: false`.
7. Verify `/app/login`.
8. Verify all v3 private routes remain protected, including the F4 self-contained Step 2 bundle.
9. Verify legacy analysis creation endpoints remain auth-protected and, with authorized dry-run credentials, return the F4 deprecation response rather than creating data.
10. Perform at most one bounded private synthetic/dry-run workflow verification. Do not use a real race result to tune behavior.
11. Confirm no historical replay/backfill reset or resume occurred and no X-Labs historical job was started by the release.

## Rollback
Rollback is explicit, not automatic.

1. Diagnose the production problem and preserve logs/state.
2. Create a reviewed release change setting `ANALYSIS_WORKFLOW_MODE=legacy_v2`.
3. Do not change D1 history, migrations or backfill cursors as part of the toggle.
4. Deploy through the same controlled release workflow.
5. Verify health/login and required legacy read/creation behavior for the temporary rollback mode.
6. Record the reason and return to `v3` through another reviewed release once fixed.

`legacy_v2` is an emergency compatibility mode, not an alternative normal product policy. New feature work must continue against v3.

## Post-release acceptance
- Normal private UI uses v3 only.
- Step 1 is server-sealed before current market exposure.
- Step 2 input is self-contained and does not depend on conversation memory.
- New systems are deterministic optimizer output with exactly three spikes.
- Legacy analysis/system history still renders/read-loads.
- C4 named X-Labs trip labels remain null unless separately validated.
- No automatic model-weight change is introduced.
