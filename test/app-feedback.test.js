import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker-settings.js';
import { renderAppPage } from '../src/app-page-feedback.js';
import { friendlyRunName } from '../src/settings-data-display.js';
import { getEnhancedGameHistoryDetail } from '../src/routes/game-detail-display.js';
import { createTestEnv } from './helpers/d1.js';

test('settings uses understandable source labels and compact status symbols', () => {
  assert.equal(friendlyRunName('official_historical_race_normalize'), 'Historiska lopp & resultat');
  assert.equal(friendlyRunName('official_live_capture'), 'Kommande V85/V86');
  assert.equal(friendlyRunName('xlabs_telemetry_normalize'), 'X-Labs');

  const html = renderAppPage();
  assert.match(html, /working:'✓'/);
  assert.match(html, /error:'✕'/);
  assert.match(html, /\.status-pill\{[^}]*border:0!important/);
  assert.match(html, /hasDisplayValue/);
  assert.match(html, /Saknar verifierat positionsunderlag/);
  assert.match(html, /Förväntat:/);
});

test('login and root redirects stay inside the installed PWA scope', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';

  let response = await worker.fetch(new Request('https://example.test/'), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/app/');

  response = await worker.fetch(new Request('https://example.test/app/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: env.APP_PASSWORD })
  }), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/app/');
});

test('enhanced game detail fails closed for an unknown round', async () => {
  const { env } = createTestEnv();
  assert.equal(await getEnhancedGameHistoryDetail(env, 'missing-round'), null);
});
