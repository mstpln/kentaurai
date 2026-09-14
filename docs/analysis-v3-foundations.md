# KentaurAI analysis v3 foundations

Status: foundation utilities for future v3 features; not an analysis-workflow cutover.

This document defines the public-safe A3 primitives used by later v3 builds. The goal is to make time selection, missingness, evidence strength, feature provenance, version semantics and fallback estimates consistent before new feature families are implemented.

A3 does not activate v3 exports, prompts, Step-1 locking, decision probabilities, optimizer writes or new system policy. Existing v2 runtime behavior and persisted history remain unchanged.

## Stable foundation contracts

| Primitive | Version | Purpose |
| --- | --- | --- |
| As-of selection | `kentaurai-as-of-v1` | Select only observations eligible at a requested historical cutoff. |
| Evidence envelope | `kentaurai-evidence-v1` | Carry value, source class, evidence level, sample sizes, coverage, confidence, as-of time and feature version together. |
| Feature provenance | `kentaurai-feature-provenance-v1` | Canonical, stable metadata for inputs, source references, parameters, versions and fallback lineage. |
| Hierarchical backoff | `kentaurai-hierarchical-backoff-v1` | Explicit direct-data shrinkage and broader-context fallback interface. |

Semantic changes require new version identifiers rather than changing one of these contracts silently.

## As-of selection

`filterAsOf` and `selectLatestAsOf` require an explicit cutoff and an explicit time accessor. Rows with a missing, invalid or future eligibility timestamp fail closed and are excluded. A row exactly at the cutoff is eligible.

Latest-row selection is deterministic. Equal timestamps use a stable tie key, and the input rows are never reordered in place.

Later feature builders must choose the correct eligibility timestamp for their source family. They must not replace an observed/effective/published/captured timestamp with the current wall-clock time merely to make a row eligible.

Feature provenance reinforces this rule: every source reference carries the exact `selected_at` used for eligibility plus a `time_basis`, and a source timestamp after the feature `as_of` is rejected.

## Evidence envelope

Evidence level is information strength, not horse strength. Changing `evidence_level` must never change the numeric `value` by itself.

The initial versioned evidence thresholds are deliberately explicit and testable:

- **A**: at least 3 relevant direct samples.
- **B**: at least 1 direct sample when A is not met.
- **C**: no qualifying direct sample, but at least 10 context samples.
- **D**: weaker evidence than the thresholds above.

These are foundation defaults, not learned model weights. A later feature family may use a different explicitly versioned policy when validation supports it.

The envelope keeps `null` and numeric zero distinct. Coverage and confidence are nullable values in `[0, 1]`; zero remains a real zero. Missing optional evidence remains missing rather than being converted into a factual population mean.

## Feature provenance and version registry

`createFeatureProvenance` records:

- feature family and immutable feature version,
- feature `as_of`,
- sorted source references with `selected_at` and `time_basis`,
- input component versions,
- explicit calculation parameters,
- backoff level where applicable,
- estimate source where applicable.

Canonical serialization recursively sorts object keys and source references so equivalent provenance produces stable JSON independent of insertion order. Unsupported values such as `undefined` and non-finite numbers fail closed.

The feature-version registry keys definitions by `family@version`. Re-registering identical semantics is idempotent. Reusing the same version identifier with changed semantics is rejected; a changed definition must receive a new version.

## Hierarchical backoff and shrinkage

The initial backoff utility consumes an ordered list of candidates from most specific to broader context. A candidate must meet the configured minimum effective sample size before it is eligible.

Initial foundation parameters are:

- minimum effective sample size: `8`,
- prior-equivalent sample size for shrinkage: `8`.

These values are explicit engineering defaults, not calibrated racing weights. Future feature versions may override them with their own versioned policy after validation.

When direct data exists and an eligible prior exists, the utility returns an explicit weighted shrinkage result. When only an eligible prior exists, the result is labeled `model_estimate`. When neither exists, the value stays `null` with source `unknown`. Zero is never treated as missing.

The backoff calculation does not accept an evidence-level letter as a numeric input. Therefore the A/B/C/D label cannot itself create a positive or negative strength adjustment.

## Schema decision in A3

A3 adds no migration. The existing scalar `analysis_features` table is left unchanged and no v2 row is reinterpreted or overwritten.

A structured `analysis_feature_sets` table remains an allowed later addition if an actual feature family needs a bundle that cannot fit the existing scalar representation cleanly. Deferring that schema choice avoids a speculative public migration before the payload shape is proven.

## A3 acceptance invariants

A3 is considered complete only when:

1. future observations are excluded from past as-of selection;
2. provenance rejects a source selected after the feature cutoff;
3. null and zero remain distinct;
4. evidence level changes metadata strength only, not numeric feature strength;
5. fallback-only values are marked as model estimates rather than observed facts;
6. feature/provenance serialization is stable and feature-version semantics cannot drift silently;
7. existing v2 feature storage and runtime behavior are unchanged.
