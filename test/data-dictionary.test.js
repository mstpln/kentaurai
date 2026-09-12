import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dictionary = fs.readFileSync(new URL('../docs/DATA_DICTIONARY.md', import.meta.url), 'utf8');

const allowedStatuses = new Set([
  'used',
  'stored_unused',
  'raw_only',
  'derived',
  'unclear',
  'ignore',
  'build_candidate'
]);

function dictionaryRows() {
  return dictionary
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| ---') && !line.includes('source_family | raw_path'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

test('public data dictionary exposes the build-plan field inventory contract', () => {
  assert.match(dictionary, /\| source_family \| raw_path \| semantic_name \| data_type \| nullable \| normalized_target \| status \| consumer \| provenance_rule \| notes \|/);
  const rows = dictionaryRows();
  assert.ok(rows.length >= 80, `expected a field-level inventory, got only ${rows.length} rows`);
  const families = new Set(rows.map((row) => row[0]));
  for (const family of ['official_calendar', 'official_game', 'official_race', 'xlabs_telemetry', 'normalized_d1', 'analysis_context']) {
    assert.ok(families.has(family), `missing source family ${family}`);
  }
  for (const row of rows) {
    assert.equal(row.length, 10, `dictionary row must have 10 columns: ${row.join(' | ')}`);
    assert.ok(allowedStatuses.has(row[6]), `unsupported dictionary status ${row[6]}`);
    assert.ok(row[8], `provenance rule is required for ${row[0]} ${row[1]}`);
  }
});

test('public data dictionary keeps actual market facts out of pre-market strength', () => {
  for (const row of dictionaryRows()) {
    const path = row[1].toLowerCase();
    const name = row[2].toLowerCase();
    const isMarketFact =
      /(betdistribution|marketrank|odds|pool\.turnover|pool\.systemcount|betting_snapshots)/.test(path) ||
      /(betting percentage|betting rank|game turnover|verified market-at-stop|favorite at betting stop|longshot at betting stop|win\/place odds)/.test(name);
    if (isMarketFact) {
      assert.doesNotMatch(row[7].toLowerCase(), /pre-market|pre_market|ai pre-market/);
    }
  }
});

test('public data dictionary contains no private payload values or private editorial provenance', () => {
  assert.doesNotMatch(dictionary.toLowerCase(), /password|api[_ -]?key|bearer token|real payload value/);
  assert.doesNotMatch(dictionary.toLowerCase(), /paid editorial provider|private editorial provider/);
});
