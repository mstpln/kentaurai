import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/extend-production-history-2020-2023.yml', import.meta.url), 'utf8');

test('history extension is explicit, bounded and main-only', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /START HISTORY EXTENSION 2020-09-08 TO 2023-09-07/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /HISTORY_START_DATE: '2020-09-08'/);
  assert.match(workflow, /HISTORY_END_DATE: '2023-09-07'/);
  assert.match(workflow, /OFFICIAL_JOB_ID: backfill_official-se-trot-v2__2020-09-08__2023-09-07/);
  assert.match(workflow, /XLABS_JOB_ID: xlabsbackfill_xlabs-race-v1__historical-all__2020-09-08__2023-09-07/);
});

test('scheduled capacity guard stays idle until the manual authorization has created the official job', () => {
  assert.match(workflow, /github\.event_name == 'schedule'/);
  assert.match(workflow, /elif \[\[ "\$official_status" == "absent" \]\]; then/);
  assert.match(workflow, /History extension has not been authorized yet; scheduled guard is idle/);
});

test('history extension checks real D1 file size and stops well below the paid-plan database ceiling', () => {
  assert.match(workflow, /fields=uuid,name,file_size/);
  assert.match(workflow, /D1_WARNING_BYTES: '8589934592'/);
  assert.match(workflow, /D1_STOP_BYTES: '9126805504'/);
  assert.match(workflow, /d1_bytes >= D1_STOP_BYTES/);
  assert.match(workflow, /Capacity guard stopped the 2020-2023 history extension/);
  assert.match(workflow, /above 8\.00 GiB/);
});

test('official history must complete before matching X-Labs history is created', () => {
  const officialGate = workflow.indexOf('if [[ "$official_status" == "completed" ]]');
  const xlabsInsert = workflow.indexOf("INSERT OR IGNORE INTO xlabs_backfill_jobs");
  assert.ok(officialGate >= 0);
  assert.ok(xlabsInsert > officialGate);
  assert.match(workflow, /X-Labs extension will not start before official completion/);
});

test('history extension refuses overlapping long-running history jobs and is resumable', () => {
  assert.match(workflow, /Another multi-day official history job is running; refusing overlap/);
  assert.match(workflow, /Another historical X-Labs job is running; refusing overlap/);
  assert.match(workflow, /WHERE id='\$OFFICIAL_JOB_ID' AND status='failed'/);
  assert.match(workflow, /WHERE id='\$XLABS_JOB_ID' AND status='failed'/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('Cloudflare credentials remain repository secrets and actions are pinned', () => {
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /vars\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_API_TOKEN:\s*['"]?[A-Za-z0-9_-]{20,}['"]?\s*$/m);
});
