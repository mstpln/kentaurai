# D4: market delta pack v3

D4 adds the market-only transport layer that follows the newest sealed Step 1 lock. It does not implement decision-probability blending, Step 2 AI judgment, optimizer logic, scheduler changes, replay jobs or model-weight changes.

## Contract and read order

The export contract is `kentaurai-market-pack-v3` (`market-pack-v3-d4`). A pack is bound to an explicit `lock_id` and `lock_hash`; implicit or stale Step 1 parents are rejected. Required lock parameters are validated before database access.

The private export contains:

1. `00_round_market.json`
2. `01_leg_1_market.json` through `08_leg_8_market.json`
3. optional `99_external_rankings.json`, always last when present

The manifest records the exact Step 1 lock, its seal time, market cutoff, `deadline_source`, deadline quality, deterministic `market_fingerprint`, file hashes and read order. The market fingerprint is independent of export generation time and input row order.

## Timing and Step 1 safety

D4 reuses the verified market deadline logic. A real `bet_stop_at` is preferred. If it is absent, the verified round scheduled start is the documented conservative fallback. If neither exists the export fails closed. No betting stop is fabricated, and market snapshots after the effective cutoff are excluded.

The effective market cutoff must be at or after the newest sealed Step 1 lock's `created_at`. A request for market state before that seal fails closed instead of attaching earlier market facts to a later judgment.

The requested Step 1 lock must be the newest sealed lock. D4 also reconstructs the lock's parent pre-market pack and compares it with the pre-market facts available at the effective market cutoff. Transport-only `as_of` changes are ignored; semantic round or leg changes fail closed and require the D3 late-fact revision flow before market export.

## Market facts and maturity

Only source-backed official market rows with the normalized verified quality status are exported. Per entry the leg files can expose current ownership, market rank, cutoff-safe ownership history, verified winner/place odds and timestamps. Rows are canonicalized and sorted before fingerprinting and file construction so database/input row order cannot change the exported state.

Maturity is deterministic and descriptive: snapshot count, observation count, first/latest timestamp, snapshot age, ownership range, first-to-latest delta and absolute step sizes. Trend labels remain explicitly disabled until trend semantics are independently verified.

`turnover_sek` and `system_count` remain `null` because the current schema does not provide a replay-safe as-of snapshot for those values. D4 does not silently reuse mutable round columns as historical market facts.

## Market win probability proxy

V85/V86 ownership is preserved as ownership/exposure, not relabeled as win probability. A `market_win_probability_proxy` is produced only when every active entry in a leg has a verified winner-odds snapshot at or before cutoff. The proxy is normalized inverse decimal odds across that complete active field. Incomplete winner-odds coverage produces a null proxy with explicit quality metadata.

No calibration or blend with `blind_probability` happens in D4; that belongs to E1.

## External rankings

Structured external ranking/tip signals are isolated in the optional final file and read last. The export uses a strict allowlist and omits source names, source URLs, summaries, evidence excerpts and arbitrary editorial free text. Rank-like signals expose only a validated numeric rank; other supported pick/tip/spike signals do not forward their free-text `value_text`. It does not expose full editorial content and does not change the Step 1 lock.

## Private routes

ADMIN_TOKEN protected:

- `GET /v1/analysis-market-pack/:roundId?lock_id=...&lock_hash=...&as_of=...&file=...`

Session protected:

- `GET /app/api/settings/analysis-market-pack?round_id=...&lock_id=...&lock_hash=...&as_of=...&file=...`

The default file is `manifest.json`. No D4 route writes production data.

## Operational boundary

D4 requires no schema migration. It changes no cron schedule and starts no automatic Step 2 process. Deploying the Worker remains a separate release action.
