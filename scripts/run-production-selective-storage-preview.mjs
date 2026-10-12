// Bounded read-only selection sample. No source IDs, cursor, facts, or
// private payloads are printed to GitHub logs or retained as artifacts.
import { appendFileSync } from 'node:fs';

const families = ['horse_profile','horse_stat','horse_record','person_stat'];
const base = process.env.WORKER_URL;
const token = process.env.CLEANUP_TOKEN;
if (!/^https:\/\/[^/]+$/.test(String(base || '')) || !token) throw new Error('read-only preview not configured');
const limit = 25;
const MAX_PAGES_PER_FAMILY = 1; // diagnostic-only: do not extrapolate to full coverage
const MAX_TOTAL_ROWS_READ = 100000; // bounded diagnostic budget, not full inventory
const STOP_AFTER_MS = 5 * 60 * 1000;
const started = Date.now();
let rowsRead = 0;
const report = [];
for (const family of families) {
  let cursor = null, pages = 0, scanned = 0, eligibleDuplicates = 0;
  let quarantined = 0, complete = false;
  while (pages < MAX_PAGES_PER_FAMILY && Date.now() - started < STOP_AFTER_MS && rowsRead < MAX_TOTAL_ROWS_READ) {
    // A freshly installed Worker secret can briefly yield 401 on a different
    // edge. Retry *only* authorization rejections (which the Worker rejects
    // before any database read); all transport/cost/HTTP ambiguity fails closed.
    let response;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        response = await fetch(base + '/v1/storage-cleanup/snapshots/preview-selective', {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ family, limit, cursor })
        });
      } finally {
        clearTimeout(timer);
      }
      if (response.status !== 401 || attempt === 9) break;
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
    if (!response.ok) throw new Error('selective preview private API HTTP ' + response.status);
    const result = await response.json();
    const requestRowsRead = result?.cost?.rowsRead;
    if (!Number.isSafeInteger(requestRowsRead) || requestRowsRead < 0)
      throw new Error('selective preview missing or invalid D1 read metric');
    rowsRead += requestRowsRead;
    const diag = result.diagnostic;
    if (!diag || !Number.isSafeInteger(diag.pageRowsRead) || diag.pageRowsRead < 0
        || !Number.isSafeInteger(diag.sourceProofRowsRead) || diag.sourceProofRowsRead < 0
        || !Number.isSafeInteger(diag.rawHeadRequests) || diag.rawHeadRequests < 0)
      throw new Error('selective preview cost breakdown unavailable');
    // Print only aggregate measurements; no private source IDs or cursors.
    console.log(JSON.stringify({ event:'selective_preview_page_cost', family,
      page:pages+1, rowsRead:requestRowsRead, pageRowsRead:diag.pageRowsRead,
      sourceProofRowsRead:diag.sourceProofRowsRead, rawHeadRequests:diag.rawHeadRequests,
      safetyStop:result.safetyStop === true }));
    // A Worker-level read-cost breach still fails closed, but the aggregate
    // query breakdown is already present in the diagnostic log.
    if (result.safetyStop === true)
      throw new Error('selective preview D1 operation safety stop');
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
  console.log(JSON.stringify({ event:'selective_preview_family_diagnostic', family, pages, scanned, quarantined, eligibleDuplicates, complete }));
  if (Date.now() - started >= STOP_AFTER_MS || rowsRead >= MAX_TOTAL_ROWS_READ) break;
}
for (const row of report)
  console.log(JSON.stringify({ event:'selective_snapshot_preview', ...row }));
console.log(JSON.stringify({
  event:'selective_snapshot_preview_cost',
  rowsRead, readBudget: MAX_TOTAL_ROWS_READ,
  allFamiliesComplete: report.length === families.length && report.every(row => row.complete),
  noProductionFactsModified: true, diagnosticOnly: true, stoppedAtBudget: rowsRead >= MAX_TOTAL_ROWS_READ
}));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## Bounded read-only selective storage cost diagnostic\n\n'
      + 'At most one page per family. This is not a coverage or savings forecast. No cleanup was executed.\n\n'
      + '| Family | Scanned | Eligible duplicate candidates | Quarantined | Fully scanned |\n'
      + '|---|---:|---:|---:|---|\n'
      + report.map(row => '| '+row.family+' | '+row.scanned+' | '+row.eligibleDuplicates
        +' | '+row.quarantined+' | '+(row.complete?'yes':'no')+' |').join('\n')
      + '\n\nMeasured D1 rows read: '+rowsRead+'.\n');
}
