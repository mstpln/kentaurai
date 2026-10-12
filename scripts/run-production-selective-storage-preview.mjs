// Bounded read-only selection sample. No source IDs, cursor, facts, or
// private payloads are printed to GitHub logs or retained as artifacts.
import { appendFileSync } from 'node:fs';

const families = ['horse_profile','horse_stat','horse_record','person_stat'];
const base = process.env.WORKER_URL;
const token = process.env.CLEANUP_TOKEN;
if (!/^https:\/\/[^/]+$/.test(String(base || '')) || !token) throw new Error('read-only preview not configured');
const limit = 25;
const MAX_PAGES_PER_FAMILY = 250;
const MAX_TOTAL_ROWS_READ = 1000000;
const STOP_AFTER_MS = 20 * 60 * 1000;
const started = Date.now();
let rowsRead = 0;
const report = [];
for (const family of families) {
  let cursor = null, pages = 0, scanned = 0, eligibleDuplicates = 0;
  let quarantined = 0, complete = false;
  while (pages < MAX_PAGES_PER_FAMILY && Date.now() - started < STOP_AFTER_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(base + '/v1/storage-cleanup/snapshots/preview-selective', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ family, limit, cursor })
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error('selective preview private API HTTP ' + response.status);
    const result = await response.json();
    if (result.safetyStop === true || !Number.isFinite(Number(result?.cost?.rowsRead)))
      throw new Error('selective preview D1 operation safety stop or missing cost');
    rowsRead += Number(result.cost.rowsRead);
    if (rowsRead > MAX_TOTAL_ROWS_READ) throw new Error('selective preview D1 read budget exceeded');
    if (!Number.isSafeInteger(Number(result.rowsScanned)) || Number(result.rowsScanned) > limit
        || !Number.isSafeInteger(Number(result.rowsQuarantined))
        || !Number.isSafeInteger(Number(result.rowsRemovable))
        || Number(result.rowsQuarantined) < 0 || Number(result.rowsRemovable) < 0
        || Number(result.rowsQuarantined) + Number(result.rowsRemovable) > Number(result.rowsScanned))
      throw new Error('selective preview returned inconsistent counts');
    pages += 1;
    scanned += Number(result.rowsScanned);
    quarantined += Number(result.rowsQuarantined);
    eligibleDuplicates += Number(result.rowsRemovable);
    const next = result.nextCursor || null;
    if (!next) { complete = true; break; }
    if (next === cursor) throw new Error('selective preview cursor did not advance');
    cursor = next;
  }
  report.push({ family, pages, scanned, quarantined, eligibleDuplicates, complete });
  if (Date.now() - started >= STOP_AFTER_MS || rowsRead >= MAX_TOTAL_ROWS_READ) break;
}
for (const row of report)
  console.log(JSON.stringify({ event:'selective_snapshot_preview', ...row }));
console.log(JSON.stringify({
  event:'selective_snapshot_preview_cost',
  rowsRead, readBudget: MAX_TOTAL_ROWS_READ,
  allFamiliesComplete: report.length === families.length && report.every(row => row.complete),
  noProductionFactsModified: true
}));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## Read-only selective storage preview\n\n'
      + 'This is a bounded sample, not proof of total storage savings. No cleanup was executed.\n\n'
      + '| Family | Scanned | Eligible duplicate candidates | Quarantined | Fully scanned |\n'
      + '|---|---:|---:|---:|---|\n'
      + report.map(row => '| '+row.family+' | '+row.scanned+' | '+row.eligibleDuplicates
        +' | '+row.quarantined+' | '+(row.complete?'yes':'no')+' |').join('\n')
      + '\n\nMeasured D1 rows read: '+rowsRead+'.\n');
}
