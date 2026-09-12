import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const statFilters = fs.readFileSync(new URL('../src/app-page-stat-filters.js', import.meta.url), 'utf8');
const horseStats = fs.readFileSync(new URL('../src/horse-statistics-ui.js', import.meta.url), 'utf8');
const horsePatterns = fs.readFileSync(new URL('../src/horse-patterns-ui.js', import.meta.url), 'utf8');

test('generic entity breakdown loading cannot block later horse render layers', () => {
  assert.match(statFilters, /void renderStatFilters\(\)/);
  assert.doesNotMatch(statFilters, /bindFilterButtons\(\);await renderStatFilters\(\)/);
  assert.match(statFilters, /STAT_READ_TIMEOUT_MS=8000/);
  assert.match(statFilters, /Statistiken tog för lång tid att läsa\. Försök igen\./);
  assert.match(statFilters, /Promise\.race\(\[promise,timeout\]\)/);
});

test('horse detail and Build F pattern layers remain composed after generic statistics', () => {
  assert.match(horseStats, /const previousHorseRenderDetail=renderDetail/);
  assert.match(horseStats, /appendDetailStats\(id,token\)/);
  assert.match(horsePatterns, /const previousHorsePatternsRenderDetail=renderDetail/);
  assert.match(horsePatterns, /Utveckling & löpstyrka/);
  assert.match(horsePatterns, /Starttempo/);
  assert.match(horsePatterns, /Avslutning/);
  assert.match(horsePatterns, /Extra distans/);
});
