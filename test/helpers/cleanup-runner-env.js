// Runner subprocess tests simulate independent invocations. They must not
// inherit control-plane fields from the GitHub Actions job that is itself
// running a READ-ONLY audit continuation. Explicit per-test overrides still
// exercise automated continuation and rejected execution scenarios.
export function syntheticCleanupRunnerEnv(overrides = {}, inherited = process.env) {
  return {
    ...inherited,
    MODE: 'dry-run',
    CLEANUP_TRIGGER_CONFIRMATION: '',
    CLEANUP_CONTINUATION_REQUEST: '',
    CLEANUP_AUDIT_RUN_ID: '',
    CLEANUP_SESSION_ID: '',
    DRY_RUN_MAX_BATCHES: '25',
    CLEANUP_SOFT_DEADLINE_MS: '300000',
    CLEANUP_RUN_MAX_ROWS_READ: '1000000',
    CLEANUP_RUN_MAX_ROWS_WRITTEN: '100000',
    GITHUB_OUTPUT: '',
    ...overrides
  };
}
