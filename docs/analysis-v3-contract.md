# KentaurAI analysis v3 contract

Status: target contract only; not active runtime behavior.

This public-safe document defines the version vocabulary and compatibility boundary for the future KentaurAI v3 analysis workflow. It intentionally does not change the current production workflow, prompts, persistence rules, system writer, schedules, backfills, D1 schema or Worker behavior.

## Architectural boundary

KentaurAI keeps three layers separate:

1. verified source facts,
2. deterministic calculated features,
3. AI interpretation and judgment.

Unknown source facts remain null/unknown. Optional evidence, including X-Labs, is neutral when missing and may affect confidence/uncertainty rather than horse strength merely because coverage differs.

## V3 contract registry

| Artifact | Version | Direction | Target responsibility |
| --- | --- | --- | --- |
| Pre-market analysis pack | `kentaurai-analysis-pack-v3` | KentaurAI -> AI | One round plus eight market-blind leg files, manifest and fingerprints. |
| Step-1 lock | `kentaurai-step1-lock-v1` | AI -> KentaurAI | Server-verifiable sealed blind probabilities, ranking, ABCD, scenarios and uncertainty before market exposure. |
| Market pack | `kentaurai-market-pack-v3` | KentaurAI -> AI | Lock-bound market delta, maturity/quality and current market facts only. |
| Step-2 result | `kentaurai-step2-result-v1` | AI -> KentaurAI | Market interpretation and decision-probability proposal; no authoritative system construction. |
| Optimizer | `kentaurai-optimizer-v1` | Internal code | Deterministic rectangular-system search, exact spike policy, row/cost/P8 calculations and deterministic tie-breaking. |
| System policy | `kentaurai-system-policy-v1` | Internal code/config | V85/V86 constraints, exact three spikes and budget/line-price policy. |
| Analysis persistence view | `kentaurai-analysis-v3` | Internal persistence | Links pack, lock, Step 2, decision probability, optimizer output and fingerprints. |

These names are stable contracts for later builds. A later change in semantics requires a new version rather than silently changing an existing identifier.

## Target v3 system policy

For every newly written v3 V85/V86 system:

- exactly three singleton spike legs are required,
- the three spikes are in three different legs,
- every non-spike leg has at least two selected horses,
- row count is the product of selections across all eight legs,
- default main-system target budget is 150-250 SEK,
- authoritative line price comes from verified game data/config rather than prompt memory,
- one balanced actual main system is the default output,
- alternative systems are optional diagnostics and are never forced to differ,
- the optimizer consumes `decision_probability`, initially equal to the locked blind probability until a validated blend exists.

This policy is a target invariant only in Build A1. No existing live writer is switched here.

## Legacy compatibility boundary

Current v2 behavior remains legacy runtime behavior until the later v3 cutover build.

- Existing `kentaurai-analysis-input-v2` and `kentaurai-analysis-v2` artifacts remain readable.
- Existing V85 main systems with two spikes remain readable historical records where they were valid under the policy active when written.
- Historical analyses/systems are not rewritten to look like v3 output.
- The current permissive database representation may remain temporarily for compatibility.
- No future v3 writer may create a two-spike system even while legacy rows remain readable.
- Legacy policy/version and v3 target policy must be distinguishable in tests, persistence metadata and future UI/diagnostics.

## Stage invariants reserved for later builds

### Pre-market pack

The target pre-market pack is round-scoped rather than a database dump. It contains one round file plus exactly eight leg files and a manifest. Current-market ownership/odds/rank data is forbidden from Step 1. Each pack will carry a facts fingerprint, as-of time, data coverage, feature/parser/reconstruction versions and explicit `contains_current_market=false`.

### Step-1 lock

The target lock preserves the market-blind sports assessment before market exposure. It will contain the exact active-entry probabilities, rank, ABCD, uncertainty, scenario material and confidence/data-quality fields. Probabilities sum to 1 per leg. The lock is fingerprinted and immutable; any later factual revision creates a linked revision rather than silently editing the prior lock.

### Market pack

The target market pack is a delta linked to a valid Step-1 lock. It contains current verified market facts, cutoff/maturity/quality metadata and no replacement copy of the sports history pack.

### Optimizer

The target optimizer is deterministic code, not free-form prompt arithmetic. Given identical decision probabilities, market ownership, policy and budget inputs, it must return the same result. It enforces exactly three spikes and validates row count/cost mechanically.

## Missing optional evidence

V3 is designed for incomplete source coverage from the beginning. Missing optional X-Labs, equipment history or aggregate snapshots do not become negative horse evidence. Later features must carry sample size, coverage, provenance and confidence so richer-data horses do not receive an automatic systematic advantage.

## Privacy and public-repository rules

The public repository may contain this sanitized contract, code, schema, tests and synthetic fixtures only. It must not contain real racing payloads, real reference exports, production coverage exports, database dumps, secrets, private editorial provenance/content or copies of private strategy/build-plan PDFs.

Synthetic v3 fixtures must use invented IDs/names and generic source labels only.

## Build A1 non-goals

Build A1 deliberately does not:

- activate v3 export routes,
- change Step-1 or Step-2 prompts,
- create a Step-1 lock endpoint,
- change live spike validation,
- change system budgets,
- change D1 schema,
- run/restart/reset any backfill,
- alter scheduled jobs,
- deploy production changes.

Those changes belong to later scoped builds after their dependencies are implemented and reviewed.
