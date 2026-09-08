# Technical decisions

## Verified source identity over name inference

X-Labs track identity uses the official numeric track id and rejects any payload whose frame identity differs. The earlier JavaScript-name inference was removed because browser traffic proved it unnecessary and less reliable.

## Raw before normalized

Every official calendar, game, race and X-Labs telemetry response is archived privately before normalized writes. Normalization retains a source-record reference, and verification re-reads the same private object.

## Conservative telemetry semantics

Only calculations reproduced from the observed telemetry contract are stored. Slipstream is not derivable from the available raw fields and remains null. A starter needs at least 99% frame coverage.

## Ordinary-race history

Historical coverage is driven by daily official calendars and individual race endpoints, not V85/V86 rounds. Only `countryCode=SE` and `sport=trot` calendar tracks enter this backfill. Jobs process deterministic race-id lists with a persistent cursor and idempotent source reuse.

## Operational pacing

One ordinary race is normalized per scheduled checkpoint. This bounds provider traffic and Worker/D1 work while allowing a multi-year job to continue without an interactive session. Three consecutive failures stop a job for explicit operational review; resuming clears only the error streak and keeps the checkpoint.
