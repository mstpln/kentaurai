# D1 - pre-market analysis pack v3

D1 replaces the near-full database analysis export with a deterministic, round-scoped, market-blind file contract for V85/V86.

## Contract

`kentaurai-analysis-pack-v3` contains:

- `manifest.json`
- `00_round_pre_market.json`
- one self-contained file per leg (`01_leg_1.json` through `08_leg_8.json`), or deterministic numbered parts when a leg exceeds the file-size bound

The manifest records the exact round, pack ID, `as_of`, generation time, facts fingerprint, expected filenames, byte counts, SHA-256 checksums, deterministic feature/parser/reconstruction versions, evidence contract, warnings and source-family coverage. Every Step-1 file carries `contains_current_market=false`.

## Market-blind boundary

D1 never reads current betting snapshots or odds snapshots. A structural denylist rejects current market ownership/rank, odds, turnover/jackpot, value fields and external ranking/tip/recommendation fields if they enter the structured pack. Editorial imports may contribute only factual/qualitative structured signals published before the cutoff; market/tip/ranking/value/recommendation signals and private source identity are not exported.

The pack contains official as-of observations, timestamped official horse snapshots, structured proposition facts, deterministic B2-B6 feature families, C2 X-Labs evidence profiles and optional compact C3 reconstruction for selected historical starts. Raw R2 telemetry is never exported. Missing X-Labs remains missing evidence and affects coverage/confidence only.

## As-of safety

Current race and entry facts are selected from official normalized observations at or before the effective pre-market cutoff. The effective cutoff is the earlier of requested `as_of` and the verified round cutoff. The current deterministic feature modules still use the normalized target entities as join/context anchors, so D1 additionally fails closed when those mutable target rows no longer match the selected official as-of observations. This prevents a later driver/start-position/scratch/race-context update from silently leaking into an older replay. A future replay build may replace this fail-closed guard with an explicit immutable target projection, but D1 does not weaken chronology to make replay succeed.

## Size policy

The default maximum output file size is 20 MiB. A large leg is split deterministically by complete entry objects. Entries are never truncated. If one entry alone exceeds the limit, generation fails rather than silently dropping data.

## Private route

`GET /v1/analysis-pack/:roundId` requires `ADMIN_TOKEN`.

Query parameters:

- `file`: omitted/`manifest.json` for the manifest, or one filename returned by the manifest
- `as_of`: optional requested cutoff timestamp

D1 adds no scheduler, replay job, historical backfill, model weight or production data mutation. It requires no D1 migration.
