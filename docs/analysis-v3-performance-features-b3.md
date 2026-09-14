# Analysis v3 B3 — performance feature suite

Status: deterministic market-blind sports-layer foundation. B3 adds no AI judgment, composite horse score, probability, ABCD rank, value calculation, system construction, scheduler, backfill or legacy-v2 rewrite.

Contract version: `kentaurai-performance-features-v3`.

## Purpose

B3 converts the source-backed A4 snapshots, B1 proposition facts and B2 as-of-safe history package into separate reviewable feature families. Code calculates factual/empirical features; later AI stages interpret them.

The feature families are deliberately kept separate so a strong observation in one dimension cannot silently become a global horse-strength score.

## Feature families

- `capacity_v1` — official record/start-points context plus peak verified official/X-Labs observations and historical class exposure.
- `form_v3` — relevant-result form, official km time, errors, rest and optional X-Labs pace.
- `class_context_v1` — target proposition/first prize, historical prize exposure and opponent Start Points when official snapshots exist.
- `development_v3` — recent-versus-baseline factual deltas over the B2 relevant-history union.
- `method_distance_v1` — method/distance/track evidence with explicit sparse-sample backoff.
- `rest_readiness_v1` — target rest interval and outcomes from comparable rest situations; no readiness score is produced.
- `gallop_risk_v1` — empirical gallop/disqualification evidence with sparse contextual backoff.

## Evidence and confidence

Every emitted metric uses the A3 `kentaurai-evidence-v1` envelope and therefore carries:

- value,
- evidence source,
- evidence level A/B/C/D,
- sample size,
- relevant sample size,
- coverage,
- confidence,
- as-of timestamp,
- feature version.

A factual one-row observation can have full availability confidence without implying predictive certainty. For empirical rates, confidence depends on sample size and field coverage. Missing values keep `confidence = null`.

Each family also carries A3 `kentaurai-feature-provenance-v1` with the versions of B2 history selection and A3 evidence/backoff contracts plus source references that are directly available to the feature service. B2 full-history aggregates are versioned upstream aggregate evidence; individual omitted-history source references are not re-expanded by B3.

## As-of and leakage boundary

B3 delegates row-level history eligibility to B2. Its effective feature cutoff is B2 `targetCutoff`, the earlier of requested as-of and target-race start.

Official target/opponent snapshots are selected through A4 at the same effective cutoff. Future snapshot observations therefore cannot enter a pre-race feature package.

## Missing data

Missing evidence is neutral:

- missing X-Labs does not create zero pace or a performance penalty,
- missing official snapshots do not create zero Start Points,
- unknown gallop/disqualification status does not count as false,
- development deltas stay null when the recent/baseline samples are insufficient,
- proposition ambiguity is carried as proposition status rather than guessed into structured facts.

Coverage/confidence exposes the weaker evidence instead of changing the horse's factual values.

## Sparse-sample backoff

`method_distance_v1`, `rest_readiness_v1` and `gallop_risk_v1` may expose deterministic A3 hierarchical-backoff estimates beside their direct metrics.

The initial A3 policy remains unchanged:

- minimum effective prior sample: 8,
- prior equivalent sample size: 8.

These are engineering defaults, not learned model weights. Direct values are never overwritten; the shrunk estimate is a separate named metric with estimate source, backoff level and weights available in the family payload.

## Market-blind boundary

B3 does not read:

- betting percentages,
- odds snapshots,
- external editorial ranking/tips,
- prior AI judgments,
- post-race learning output.

Synthetic regression coverage verifies that inserting betting and odds records does not change B3 output.

## Runtime boundary

B3 is an additive service. It does not replace the existing `form-v2`, `class-exposure-v2` or `development-v2` modules and does not change the legacy analysis exchange.

No new D1 migration is required. B3 creates no production replay/backfill and does not touch the stopped historical X-Labs job.

## Acceptance invariants

1. All seven feature families are independently versioned.
2. No composite performance score is emitted.
3. Every metric carries evidence metadata; every family carries provenance.
4. Effective as-of never exceeds target-race start.
5. Future result/snapshot/optional observations cannot affect pre-race output.
6. Missing data remains null/low-coverage rather than becoming negative evidence.
7. Sparse contextual samples use explicit deterministic backoff, never hidden smoothing.
8. Development deltas require samples on both sides of the comparison.
9. B3 output is invariant to betting and odds records.
10. Legacy v2 feature/runtime behavior remains unchanged.
11. No schema migration, scheduler, backfill or AI-model weight change is introduced by B3.
