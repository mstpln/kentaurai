# Selective storage cleanup: production safety gate

This branch introduces a **read-only** per-source/family eligibility preview. It
does not re-enable production deletion or claim that historical provenance is
recovered. The old global audit remains strict.

## Why a global "skip errors" switch is unsafe
- A September cleanup lost source-owned observations. Equal snapshot values
  alone do not prove that original source provenance is preserved.
- Failed, partial or deficient source histories are **barriers** in a
  chronological series. Never bridge an A-B-A (including null) change point.
- Unknown counts, malformed links, mismatched identity/timestamps, missing
  source SHA or missing raw object reference are quarantined.
- A scoped preview is not authorization to execute. Batch execution remains
  disabled for **every credential** until a separate fully reviewed guarded
  execution implementation and explicit production approval.
- R2 reference rewriting does not physically delete old R2 objects. The D1
  size must be measured from Cloudflare after any future cleanup; row counts
  alone cannot prove GB savings.

## Next execution gate (not delivered by this preview)
1. Run full read-only evidence/coverage forecast and independently confirm it
   can realistically reduce D1 below 5 GB.
2. Add scoped revision-fenced D1 transactions, transactional expected/actual
   deletion guards, post-batch source representation audit and durable
   quarantine/checkpoint reporting.
3. Separately authorize a verified **private** recovery point and the
   time-limited production execution capability; do not rely on ADMIN_TOKEN.
4. Run small bounded batches with measured D1 reads/writes, explicit rollback
   procedure and read-only post-audit, while stopping on systemic errors.
5. Keep R2 deletion disabled until full-object reference ownership and
   checksum checks are separately reviewed.
