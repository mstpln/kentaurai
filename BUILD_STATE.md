# Build state

## 0.5.0 data foundation

- X-Labs browser recipe verified: `1MMDDTTRR.json`.
- X-Labs telemetry identity is guarded by every frame's track and race fields.
- Verified telemetry mapper covers section pace, actual/extra distance and converted kilometre time.
- Slipstream remains null because the raw telemetry contract has no lane field.
- X-Labs raw-vs-normalized verification covers all accepted fields and a minimum of ten representative checks.
- Official ordinary-race endpoint verified from browser traffic and implemented as raw capture before normalization.
- Historical result mapper covers race, track, horse, trainer, driver, entry, explicit scratch, equipment and result facts with source observations.
- Swedish trotting backfill jobs persist date/race checkpoints, reuse prior captures, retry failures and continue through a minute cron.
- Public tests and fixtures are synthetic; real payloads stay in private R2/D1.

Production migration, deployment, backfill start and real-source verification are performed only after the feature PR is explicitly authorized for merge.
