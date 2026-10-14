---
name: Wrangler local D1 seeding
description: Transaction handling and safe repeatability for generated data in local D1.
---

Keep Wrangler local D1 seed files free of explicit `BEGIN`/`COMMIT` statements. The local Durable Object storage layer owns transactions and rejects SQL transaction commands; prefix-scoped cleanup makes a partial seed safe to retry.

Some generated artifacts use fingerprint-based IDs rather than the fixture prefix. Remove those through a stable parent key restricted to the reserved fixture prefix, and delete dependent rows before their parent records.

**Why:** Wrangler local D1 reported that transactions must use its storage transaction API when a seed file included SQL `BEGIN`. A failure partway through a large seed also makes rerunnable, synthetic-ID-scoped cleanup important.

**How to apply:** For local fixture seed/reset scripts, use the explicit `--local` Wrangler flag, delete only the reserved fixture ID or parent-key prefix, respect foreign-key order, and allow reruns to rebuild that fixture set.
