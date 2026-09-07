import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAppPage, renderLoginPage } from '../src/app-page-polish.js';

test('interface keeps navigation order, adds Spel, and retains global search', () => {
  const html = renderAppPage();
  assert.match(html, /id="globalSearch"/);
  const start = html.indexOf('data-page="start"');
  const trainers = html.indexOf('data-page="trainers"');
  const horses = html.indexOf('data-page="horses"');
  const drivers = html.indexOf('data-page="drivers"');
  const games = html.indexOf('data-page="games"');
  assert.ok(start >= 0 && start < trainers && trainers < horses && horses < drivers && drivers < games);
  assert.match(html, />Spel<\/button>/);
  assert.match(html, /aria-label="Huvudnavigation"/);
  assert.doesNotMatch(html, /ADMIN_TOKEN/);
});

test('approved brand treatment renders exact Sagittarius direction and compact proportions', () => {
  const html = renderAppPage();
  const login = renderLoginPage();
  assert.match(html, /KENTAUR<span>AI<\/span>/);
  assert.match(login, /KENTAUR<span>AI<\/span>/);
  assert.match(html, /class="brand-icon" viewBox="0 0 512 512"/);
  assert.match(html, /M267\.934 459\.625l-80\.013-80\.08/);
  assert.match(html, /--accent:#C79552/);
  assert.match(html, /\.brand-badge\{width:32px;height:32px/);
  assert.match(html, /\.brand-name\{font:800 31px\/1/);
  assert.match(html, /\.brand-name\{display:block;font-size:28px\}/);
});

test('trend navigation uses the approved chart icon and Trend naming', () => {
  const html = renderAppPage();
  assert.match(html, /chartLineIcon/);
  assert.match(html, /node\.textContent='Trend'/);
  assert.match(html, /h\.textContent='Trend'/);
  assert.match(html, /const categories=\[\['trainers','Tränare'\],\['horses','Hästar'\],\['drivers','Kuskar'\]\]/);
  assert.match(html, /\['2w','2 veckor'\]/);
  assert.match(html, /\['4w','4 veckor'\]/);
  assert.match(html, /\['3m','3 mån'\]/);
  assert.match(html, /\['6m','6 mån'\]/);
  assert.match(html, /\['1y','1 år'\]/);
  assert.match(html, /\.period-badge\{border:0!important;border-radius:0!important/);
});

test('trainer and driver profile tiles keep their frame but use matching navigation symbols', () => {
  const html = renderAppPage();
  assert.match(html, /const brainIcon/);
  assert.match(html, /const bicepsIcon/);
  assert.match(html, /function profileIcon\(type\)/);
  assert.match(html, /type==='trainer'\)return POLISH_ICONS\.trainer/);
  assert.match(html, /type==='driver'\)return POLISH_ICONS\.driver/);
  assert.match(html, /return icon\('horse','profile-icon fill'\)/);
  assert.match(html, /\.avatar\{font-size:0;color:var\(--accent-soft\)\}/);
});

test('logout control is absent from the rendered production interface', () => {
  const html = renderAppPage();
  assert.match(html, /\.top-inner>form\{display:none\}/);
});

test('search control has proper vector icon, divider, and deliberate query spacing', () => {
  const html = renderAppPage();
  assert.match(html, /class="search-prefix"/);
  assert.match(html, /class="search-icon"/);
  assert.match(html, /class="search-divider"/);
  assert.match(html, /padding:0 46px 0 80px/);
});

test('entity detail UI groups complete stored measurements instead of flattening them', () => {
  const html = renderAppPage();
  for (const label of ['Profil','Aktivitet','Datatäckning','Lopp & start','Resultat','Marknad & odds','Utrustning','X-Labs','Positioner','Beräknade features','Förhållanden']) {
    assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(html, /startsWithXLabs/);
  assert.match(html, /startsWithPositions/);
  assert.match(html, /startsWithFeatures/);
});

test('Spel has overview, V85, V86, sorting, round detail and compact comparison', () => {
  const html = renderAppPage();
  assert.match(html, /\['overview','Översikt'\],\['v85','V85'\],\['v86','V86'\]/);
  assert.match(html, /\['latest','Senaste'\]/);
  assert.match(html, /\['correct_desc','Flest rätt'\]/);
  assert.match(html, /\['correct_asc','Färst rätt'\]/);
  assert.match(html, /\['spikes_desc','Bästa spikar'\]/);
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
  assert.ok(scripts.length >= 2, 'expected base and polish scripts');
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});
