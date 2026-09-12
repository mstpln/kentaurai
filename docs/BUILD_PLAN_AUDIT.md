# KentaurAI detailed build-plan completion audit

Updated: 2026-09-12
Baseline audited: `main` at Build F merge `f7d069f4010e36349fc5743b80a4a9170cc2c38d`
Plan audited: *KentaurAI - detaljerad byggplan | Statistik, startsida, analys-export och datainventering v1.0*

## Result

The functional A-F programme is implemented. The audit found one genuine unfinished Build F deliverable and two stale project-state records:

1. the plan required a versioned, public **field-by-field data dictionary** with a fixed column contract and field-status classification; Build F had a thorough narrative inventory but not that canonical table artifact;
2. `docs/BUILD_STATE.md` still described Build F as an active PR after it had been merged;
3. `docs/DECISIONS.md` did not yet record the Build F inventory/dictionary rules.

This completion branch fixes those gaps. It does **not** turn the future candidates found by Build F into model features. The plan explicitly requires inventory and classification first, not automatic mass mapping.

## Audit method

The review checked current `main`, README, AGENTS, BUILD_STATE, DECISIONS, Wrangler configuration, all migrations through `0012`, actual Worker composition, shared statistics code, horse/driver/trainer domain code, Start Points acquisition/history, controlled-analysis exchange code and the existing test families. It distinguishes:

- **Complete** - current implementation satisfies the plan requirement;
- **Fixed here** - a genuine plan requirement was missing or stale and is completed by this branch;
- **Runtime/release verification** - code is present, but a production deployment or real browser/runtime check is separate from source completion;
- **Future candidate** - intentionally discovered by Build F and outside A-F completion.

## 1. Shared statistics architecture

Status: **Complete**.

- Core definitions for starts, wins, losses, win rate, top-three rate, verified-denominator gallop rate and prize sums are centralized in the statistics core rather than independently redefined by every screen.
- Scratched declarations are excluded from starts.
- Percentage responses retain their denominators instead of hiding them.
- Missing verified facts remain null rather than silently becoming zero.
- Canonical race scope, track, race type, breed and start-method filters are shared/validated and use AND semantics.
- Minimum-start thresholds are explicit and restricted to the supported values.
- Query-plan tests exist for Trend, horse, driver and trainer statistics; added indexes are targeted rather than aggregate cache tables.

No stale materialized statistics table is introduced.

## 2. Build A - Trend

Status: **Complete**.

Verified implementation:

- categories: Tränare / Hästar / Kuskar;
- periods: 2 veckor / 4 veckor / 3 mån / 6 mån / 1 år;
- exact top ten;
- deterministic order: win rate -> wins -> starts -> stable entity ID;
- permanent Loppnivå control: All data / Högre prissumma / Vardagstrav;
- secondary filter panel behind the borderless horizontal sliders icon;
- secondary filters: Bana, Lopptyp, Rastyp, Startmetod plus minimum starts;
- unknown enum/track filters fail closed rather than being ignored;
- approved Version 3 row hierarchy: Seger% left, name + Starter/Vinster/Förluster, then equal Topp 3% / Galopp% / Prispengar pills;
- whole result row is clickable and uses canonical entity ID;
- detail-filter reset leaves category, period and race scope intact;
- actual composed Worker render chain is covered by runtime/composition tests.

Responsive CSS has dedicated <=430 px and <=340 px layouts and avoids a horizontal result-table model. Existing source-level/runtime tests cover composition and overflow safeguards.

### Runtime evidence boundary

The repository does not currently depend on a real-browser layout engine, so CI does not literally measure screenshots at 320/375/430 px. Source implementation contains the required breakpoints and structural safeguards, but final visual verification at those exact widths remains a **release/runtime QA check**, not a missing functional implementation. This audit does not falsely label a structural Node test as browser geometry proof.

## 3. Build B - Horse statistics

Status: **Complete**.

Verified ranking families:

- Startsnabbaste - verified X-Labs first 200 m pace;
- Högst segerprocent;
- Högst topp 3-procent;
- Bäst form - senaste upp till 10, placements only;
- Högst startpoäng from latest verified as-of observation;
- Starkaste avslutare - explicitly last 400 m;
- Högst snittintjäning/start with verified-prize denominator;
- Första starten efter vila;
- Andra starten efter vila.

Verified filter families:

- sex;
- age;
- breed/rastyp;
- race type/lopptyp;
- start method;
- canonical distance group;
- period;
- track;
- race scope/loppnivå;
- minimum starts for percentage-type rankings.

Horse detail uses the same filtered core statistics and separately presents rest blocks, placements-only form and Start Points current/history.

## 4. Start Points time series and archived-raw recovery

Status: **Complete**.

The implementation satisfies the important storage/import contract:

- Start Points is parsed fail-closed from the verified official horse life-statistics field;
- every observation is source-record backed and timestamped;
- same horse/source reprocessing is idempotent;
- older source records are preserved as history and cannot overwrite the newer current cache;
- exact race-entry linkage is added only when official race + horse identity proves it;
- pending normalized official source records are read from their already archived R2 objects;
- the scheduled Worker processes one pending Start Points source without refetching provider data;
- as-of statistics select the latest observation known at that date.

Therefore the plan's “use already archived raw snapshots; do not refetch” requirement is implemented rather than deferred.

## 5. Shared rest, favorite, longshot, volt-lane and handicap definitions

Status: **Complete**.

- Rest threshold is 60 days over actual historical starts.
- 59/60 boundary, scratch behavior, unknown first history and second-start/reset sequences are tested.
- Good volt lanes are 1, 6 and 7 within the current volt.
- Handicap/tillägg remains a separate verified distance dimension and can combine with volt-lane filters.
- Favorite uses verified market rank 1 from the final source-backed snapshot at/before betting stop.
- Longshot uses one shared `<=5%` contract.
- Missing market evidence fails closed rather than treating a start as non-favorite/non-longshot.

## 6. Build C - Driver statistics

Status: **Complete**.

Verified ranking families:

- Högst segerprocent;
- Högst topp 3-procent;
- Flest segrar;
- Bäst form - senaste 30, placements only;
- Mest inkört i år;
- Högst intjänat per start;
- Bäst från spets;
- Bäst från dödens;
- Bäst med bakspår;
- Bäst i autostart;
- Bäst i voltstart;
- Resultat som favorit;
- Resultat som skräll.

The position rankings require source-backed verified position rows. Driver detail includes normal filtered totals and separate favorite/longshot blocks. No separate “lowest gallop rate” ranking is added.

## 7. Build D - Trainer statistics

Status: **Complete**.

Verified ranking families:

- Högst segerprocent;
- Högst topp 3-procent;
- Flest segrar;
- Bäst form - senaste 30;
- Mest inkört i år;
- Högst intjänat per start;
- autostart / voltstart;
- good/other volt lane;
- handicap/tillägg;
- home track / other tracks;
- short / medium / long distance profiles;
- favorite / longshot;
- first / second start after rest.

Trainer detail has direct home-vs-away, favorite/longshot and first/second-after-rest result blocks. Home-track identity requires the latest source-backed official external track mapping; a matching display name alone is not accepted.

## 8. Build E - Controlled analysis export/import

Status: **Complete and already production-live**.

Verified contract:

- KentaurAI supplies round ID, all race IDs, race-entry IDs and context fingerprint;
- external AI never has to invent canonical IDs;
- final stage is parent-bound to the correct stored pre-market submission;
- producer provider/model are explicit and validated;
- current canonical provider allowlist supports OpenAI and Anthropic without false attribution;
- pre-market is market blind;
- post-deadline creation of a new pre-market analysis fails closed;
- final cannot rewrite parent probability/rank/ABCD strength;
- verified market-at-stop is the sole factual market input to final persistence;
- stale fingerprint, wrong parent, missing/cross-round IDs, changed retry content and invalid spike structure are rejected;
- exact retries remain idempotent;
- filenames are descriptive and provider/model/stage aware but never authoritative identity.

## 9. Build F - Full data inventory

Status before this branch: **substantively complete, missing one required artifact**.

`docs/DATA_INVENTORY.md` already traces the implemented official and X-Labs source families through raw capture, normalized storage, deterministic use, UI and AI exposure, and already contains a prioritized opportunity backlog.

### Missing requirement fixed here

The detailed plan additionally requires a **versioned public field-level dictionary** with the exact information contract:

- source family;
- raw path/verified field identifier;
- semantic name;
- data type;
- nullable semantics;
- normalized target;
- one canonical status;
- current consumer;
- provenance rule;
- generic notes.

`docs/DATA_DICTIONARY.md` now provides that artifact with the canonical statuses:

- `used`
- `stored_unused`
- `raw_only`
- `derived`
- `unclear`
- `ignore`
- `build_candidate`

It covers official calendar/day, live game, ordinary race/history/results, equipment, betting/odds, X-Labs telemetry, important normalized feature families and the provider-neutral analysis context. A dedicated test locks the schema/status/privacy contract.

### Important scope distinction

The following are **future candidates, not unfinished A-F requirements**:

- richer 100 m X-Labs interval features;
- structured official horse record/aggregate snapshots;
- deeper Start Points dynamics;
- structured race-term parsing;
- class-adjusted per-start performance;
- driver-horse combination features;
- trainer-relative form;
- historical equipment-response features;
- verified market-trend/maturity semantics;
- X-Labs-derived tactical positions;
- pedigree relationship features.

Each requires its own verified, leakage-safe build. `build_candidate` in the dictionary is explicitly not permission to map or weight a field automatically.

## 10. Public/private and language requirements

Status: **Complete**.

- Public files contain generic source-family names and synthetic fixtures only.
- No real private payload/export or secret is introduced by this completion work.
- Internal/API field names remain stable technical contracts where needed.
- User-facing labels are Swedish and natural: for example `Startpoäng`, `Starttempo`, `Avslutning`, `Extra distans`, `Resultat som favorit`, `Resultat som skräll`, `Första starten efter vila`, `Andra starten efter vila`, `All data`, `Högre prissumma`, `Vardagstrav`.
- Technical provenance/status labels are not exposed as raw UI vocabulary merely because they exist internally.

## 11. Test and QA coverage

Status: **Complete for deterministic/source implementation; browser geometry remains runtime QA**.

The repository includes unit/integration/runtime tests for:

- core denominators/nulls/scratches;
- top-ten ordering/tie breakers;
- exact rest sequence semantics;
- volt lane and handicap;
- favorite/longshot source-backed cutoff;
- placements-only forms;
- Start Points parsing, timeline, chronology and idempotency;
- complete horse/driver/trainer ranking/filter contracts;
- query plans;
- actual Worker composition;
- Build E stage/fingerprint/parent/provider/idempotency rules;
- Build F market-blind patterns and same-day leakage protection;
- public repository privacy safeguards.

This completion branch adds a test for the public field-dictionary contract. CI and exact-head review are release-gate evidence and are tracked on the pull request for the final immutable branch head rather than hard-coded into this source document.

## 12. Production/release status

Source completion and production release are deliberately separate.

- Builds A-E are recorded as production-live in project state.
- Build F was merged to `main` but has **not** been deployed as part of this completion audit.
- This branch requires no new D1 migration.
- Any later production release must preserve the existing official and X-Labs persisted jobs/cursors and verify them after deployment.
- No backfill reset/recreate is part of this work.

## 13. Completion fixes in this branch

Source-level completion work in this follow-up is complete:

- canonical public `docs/DATA_DICTIONARY.md` added and reconciled against the actual live/historical mapper field names and targets;
- automated dictionary schema/status/privacy contract test added;
- BUILD_STATE corrected from the stale “Build F active PR” state to the actual merged source state;
- DECISIONS updated with the Build F inventory, promotion, leakage and natural-Swedish presentation rules;
- this audit document added to make the A-F completion boundary explicit.

Final CI, exact-head review and pull-request readiness are performed after the last source commit and are intentionally represented by GitHub PR/check metadata rather than mutable checkboxes in this file.

No production deployment, migration or backfill mutation belongs to this source-completion PR.
