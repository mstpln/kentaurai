import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAppPage, renderLoginPage } from '../src/app-page-final.js';

test('interface keeps navigation order, adds Spel, and retains global search', () => {
  const html = renderAppPage();
  assert.match(html, /id="globalSearch"/);
  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  const start = nav.indexOf('data-page="start"');
  const trainers = nav.indexOf('data-page="trainers"');
  const horses = nav.indexOf('data-page="horses"');
  const drivers = nav.indexOf('data-page="drivers"');
  const games = nav.indexOf('data-page="games"');
  assert.ok(start >= 0 && start < trainers && trainers < horses && horses < drivers && drivers < games);
  assert.match(nav, />Spel<\/button>/);
  assert.match(nav, /aria-label="Huvudnavigation"/);
  assert.doesNotMatch(html, /ADMIN_TOKEN/);
});

test('approved brand treatment renders exact Sagittarius direction and aligned badge treatment', () => {
  const html = renderAppPage();
  const login = renderLoginPage();
  assert.match(html, /KENTAUR<span>AI<\/span>/);
  assert.match(login, /KENTAUR<span>AI<\/span>/);
  assert.match(html, /class="brand-icon" viewBox="0 0 512 512"/);
  assert.match(html, /M267\.934 459\.625l-80\.013-80\.08/);
  assert.match(html, /--accent:#C79552/);
  assert.match(html, /\.brand-badge\{width:24px!important;height:24px!important/);
});

test('trend navigation uses approved chart icon and Trend naming', () => {
  const html = renderAppPage();
  assert.match(html, /v94\.37L90\.73,98/);
  assert.match(html, /node\.textContent='Trend'/);
  assert.match(html, /h\.textContent='Trend'/);
  assert.match(html, /const categories=\[\['trainers','Tränare'\],\['horses','Hästar'\],\['drivers','Kuskar'\]\]/);
  assert.match(html, /\['2w','2 veckor'\]/);
  assert.match(html, /\['4w','4 veckor'\]/);
  assert.match(html, /\['3m','3 mån'\]/);
  assert.match(html, /\['6m','6 mån'\]/);
  assert.match(html, /\['1y','1 år'\]/);
  assert.match(html, /\.period-badge\{border:0!important;border-radius:0!important/);
  assert.match(html, /previousRenderStart/);
  assert.match(html, /FINAL_ICONS\.trend/);
});

test('profile tiles keep their frame and display initials while category icons stay in navigation', () => {
  const html = renderAppPage();
  assert.match(html, /INITIAL_STOP_WORDS/);
  assert.match(html, /slice\(0,3\)/);
  assert.match(html, /<div class=\"avatar\">'\+esc\(initials\(e\.name\)\)/);
  assert.match(html, /M21\.378 12\.626/); // trainer clipboard/pen
  assert.match(html, /M15 14c\.2-1/); // driver lightbulb
  assert.match(html, /finalReplaceNavIcon\('trainers',FINAL_ICONS\.trainer\)/);
  assert.match(html, /finalReplaceNavIcon\('drivers',FINAL_ICONS\.driver\)/);
  assert.match(html, /\.avatar\{font-size:22px!important/);
});

test('logout control and route are absent from the production interface', () => {
  const html = renderAppPage();
  assert.doesNotMatch(html, /action="\/app\/logout"/);
  assert.doesNotMatch(html, />Logga ut</);
});

test('entity detail UI groups every stored measurement family', () => {
  const html = renderAppPage();
  for (const label of [
    'Profil','Datatäckning','Lopp & start','Klassflaggor','Resultat','Senaste marknad & odds',
    'Streckhistorik','Oddshistorik','Senaste utrustning','Utrustningshistorik','Senaste X-Labs','X-Labs segment',
    'X-Labs historik','Positioner','Beräknade features','Featurehistorik','Lagrade AI-bedömningar',
    'Redaktionella signaler','Förhållanden','Dagsprofil'
  ]) assert.ok(html.includes(label), `missing ${label}`);
  for (const field of ['startsWithXLabs','startsWithPositions','startsWithFeatures','startsWithAi','startsWithEditorial','startsWithConditions']) assert.match(html, new RegExp(field));
});

test('complete data UI preserves raw/calculated/AI separation cues and hides internal feature provenance', () => {
  const html = renderAppPage();
  assert.match(html, /råfakta → kodberäkning/);
  assert.match(html, /separerat från råfakta/);
  assert.match(html, /strukturerade signaler/);
  assert.doesNotMatch(html, /jsonText\(f\.provenance\)/);
});

test('Spel remains available with overview, V85 and V86', () => {
  const html = renderAppPage();
  assert.match(html, /\['overview','Översikt'\],\['v85','V85'\],\['v86','V86'\]/);
  assert.match(html, /Så vann loppen/);
  assert.match(html, /Var missar vi\?/);
  assert.match(html, /Avdelning för avdelning/);
});

test('production interface remains factual and localized', () => {
  const html = renderAppPage();
  assert.doesNotMatch(html, /Käll-ID/);
  assert.match(html, /mare:'Sto'/);
  assert.match(html, /gelding:'Valack'/);
  assert.match(html, /stallion:'Hingst'/);
  assert.match(html, /Trenddata byggs upp/);
  assert.match(html, /Okänt/);
});

test('entity browsing still supports complete paginated lists', () => {
  const html = renderAppPage();
  assert.match(html, /class="entity-row"/);
  assert.match(html, /PAGE_SIZE=20/);
  assert.match(html, /listOffsets/);
  assert.match(html, /Föregående/);
  assert.match(html, /Nästa/);
});

test('all embedded browser application scripts are valid JavaScript', () => {
  const html = renderAppPage();
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 4, 'expected base, polish, complete-data and final-refinement scripts');
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});
