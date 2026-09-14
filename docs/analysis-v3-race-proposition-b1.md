# Analysis v3 B1 — structured race propositions

Status: deterministic parser foundation for race terms. This build does not change model weights, probabilities, system construction or legacy v2 analysis behavior.

## Purpose

B1 converts already preserved official race-term text into conservative, versioned structured proposition facts. Raw wording remains the source evidence. Unknown or ambiguous wording is never guessed.

Parser version: `kentaurai-race-proposition-v1`.

## Input boundary

The parser consumes the existing `normalized_observations` race field `terms`, which is copied from archived official race/game payloads. It does not refetch any provider source.

Only verified official race observations with `quality_status = normalized_verified_subset` may be persisted into `race_proposition_facts`.

## Structured allowlist

Version 1 recognizes bounded Swedish/Norwegian forms for:

- exact/minimum/maximum/range age conditions
- mares-only and stallion/gelding sex restrictions
- minimum/maximum/range earnings conditions
- final
- qualifier/försök/kval
- heat and optional heat number
- spårtrappa/sportrapp
- amateur race
- apprentice race
- young-horse race
- handicap/tillägg/tillegg and an explicitly stated step when it follows the keyword

Absence of a supported phrase is not evidence that a condition is false. Boolean fields therefore stay `null` unless an explicit supported positive phrase is present.

## Fail-closed behavior

Unsupported fragments remain in `unparsed_fragments_json` and are not converted to facts.

A supported keyword combined with explicit negation is classified as ambiguous and produces no positive fact. Conflicting structured values inside the same proposition are also classified as ambiguous; the affected field is reset to `null`.

Non-string term entries are retained as unparsed serialized fragments rather than interpreted.

## Persistence

Migration `0016_race_proposition_facts.sql` adds `race_proposition_facts` with:

- exact race identity
- source observation identity
- source record identity
- observation time
- parser version
- parse status
- original raw terms JSON
- structured facts JSON
- matched-pattern audit JSON
- unparsed fragments JSON
- ambiguous fragments JSON

The unique key `(source_observation_id, parser_version)` makes replay idempotent while allowing a later parser version to replay the same raw observation without rewriting the old version.

## Parse statuses

- `no_terms` — no usable source terms were present
- `parsed` — every non-empty string fragment was covered by the allowlist
- `partial` — at least one fact parsed and at least one fragment remained unsupported
- `unparsed` — terms were present but no allowlisted fact was extracted
- `ambiguous` — negation or conflicting supported facts require fail-closed handling

## As-of access

`getRacePropositionsAsOf` returns the latest stored parser result at or before the requested cutoff. Later observations are excluded. This is the integration surface for B2/B3 statistics, feature and analysis-pack work; B1 does not alter the current legacy v2 pack.

## Backfill boundary

B1 deliberately does not start a production replay automatically. Existing normalized race observations may be replayed later through a separately authorized, bounded, idempotent backfill. No source refetch is required.

## Acceptance invariants

1. Supported allowlist wording yields exact structured facts.
2. Unsupported wording remains visible as unparsed text.
3. Negated or conflicting wording fails closed.
4. Missing facts remain `null`; absence is never converted to `false`.
5. Raw wording and source provenance are retained.
6. Replaying the same observation with the same parser version is a no-op.
7. A later parser version can coexist with older parser output.
8. Historical/as-of reads never select a proposition observation from the future.
9. No market information is introduced by the parser.
10. No production backfill is started by this build.
