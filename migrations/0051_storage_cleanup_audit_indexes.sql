-- Recovery marker for the original bundled cleanup-audit index migration.
-- Production release #163 timed out while that bundle was being applied. The
-- actual indexes are reconciled idempotently, one D1 operation at a time, by
-- migrations 0052-0056; release verification checks the final schema.
SELECT 1;
