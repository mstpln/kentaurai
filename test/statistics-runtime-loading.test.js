import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const statFilters = fs.readFileSync(new URL('../src/app-page-stat-filters.js', import.meta.url), 'utf8');
const horseStats = fs.readFileSync(new URL('../src/horse-statistics-ui.js', import.meta.url), 'utf8');
const horsePatterns = fs.readFileSync(new URL('../src/horse-patterns-ui.js', import.meta.url), 'utf8');

test('generic entity breakdown loading is owned by the section that renders the loader', () => {
  assert.match(statFilters, /function scheduleStatFilters\(\)/);
  assert.match(statFilters, /queueMicrotask\(\(\)=>\{/);
  assert.match(statFilters, /document\.getElementById\('entityStatTables'\)/);
  assert.match(statFilters, /scheduleStatFilters\(\);\s*return '<div class="data-groups">/);
  assert.match(statFilters, /void renderStatFilters\(\)/);
  assert.doesNotMatch(statFilters, /const priorRenderDetail=renderDetail/);
  assert.doesNotMatch(statFilters, /renderDetail=async function/);
});

test('generic entity breakdown loading fails visibly instead of staying on the loader forever', () => {
  assert.match(statFilters, /STAT_READ_TIMEOUT_MS=8000/);
  assert.match(statFilters, /Statistiken tog för lång tid att läsa\. Försök igen\./);
  assert.match(statFilters, /Promise\.race\(\[promise,timeout\]\)/);
  assert.match(statFilters, /Kunde inte läsa filtrerad statistik:/);
});

test('scheduled breakdown work is guarded against stale navigation and missing DOM', () => {
  assert.match(statFilters, /const key=entityStatKey\(\)/);
  assert.match(statFilters, /key!==entityStatKey\(\)\|\|state\.tab!=='stats'\|\|!document\.getElementById\('entityStatTables'\)/);
  assert.match(statFilters, /token!==statRequestToken\|\|key!==entityStatKey\(\)\|\|state\.tab!=='stats'/);
});

test('horse detail and Build F pattern layers remain composed independently', () => {
  assert.match(horseStats, /const previousHorseRenderDetail=renderDetail/);
  assert.match(horseStats, /appendDetailStats\(id,token\)/);
  assert.match(horsePatterns, /const previousHorsePatternsRenderDetail=renderDetail/);
  assert.match(horsePatterns, /Utveckling & löpstyrka/);
  assert.match(horsePatterns, /Starttempo/);
  assert.match(horsePatterns, /Avslutning/);
  assert.match(horsePatterns, /Extra distans/);
});
