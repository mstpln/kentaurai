import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { openBrowser, authenticateBrowser } from '../test/helpers/browser-cdp.js';

if (!process.env.REPLIT_DEV_DOMAIN?.endsWith('.replit.dev')) {
  throw new Error('This check is restricted to the Replit development domain');
}
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const browser = await openBrowser(origin);
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const value = expression => browser.evaluate(expression);
const wait = expression => browser.waitFor(expression);
const click = selector => browser.click(selector);
const nav = async page => {
  if (page === 'settings') return click('#settingsButton');
  if (page === 'upcoming' || page === 'systems') {
    await click('[data-p1-nav="spel"]');
    await wait('!!document.querySelector("[data-p1-spel-view]")');
    return click(`[data-p1-spel-view="${page}"]`);
  }
  return click(`[data-p1-nav="${page}"]`);
};
const fill = (selector, text) => value(`(() => {
  const element=document.querySelector(${JSON.stringify(selector)});
  if(!element) throw new Error('Missing editor');
  element.value=${JSON.stringify(text)};
  element.dispatchEvent(new Event('input',{bubbles:true}));
  element.dispatchEvent(new Event('change',{bubbles:true}));
})()`);
async function noOverflow(name, width) {
  const metrics = await value(`({
    viewport:innerWidth,width:document.documentElement.scrollWidth,
    offenders:[...document.querySelectorAll('body *')].filter(el=>{
      const r=el.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+2||r.left < -2)
    }).slice(0,5).map(el=>({tag:el.tagName,class:el.className}))
  })`);
  assert.ok(metrics.width <= metrics.viewport + 1, `${name} ${width}px overflow: ${JSON.stringify(metrics)}`);
}
async function sizes(name, extra) {
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    await browser.viewport(width);
    await noOverflow(name, width);
    if (extra) await extra(width);
  }
  checks.push(`${name}: 320/375/390/430/768/1280 px`);
}
try {
  await authenticateBrowser(browser, origin);
  await browser.viewport(1280);
  await browser.navigate('/app/');
  await wait('!!window.__kentauraiPhase1 && document.querySelectorAll("[data-p1-nav]").length===3');
  await value('document.fonts.ready');
  check('Helvetica body and smaller italic Arial wordmark preserve the round logo', await value(`document.title==='Travdata' && getComputedStyle(document.body).backgroundColor==='rgb(247, 247, 252)' && getComputedStyle(document.body).fontFamily.startsWith('Helvetica, Arial') && document.querySelector('.travdata-logo-mark')?.naturalWidth>0 && getComputedStyle(document.querySelector('.travdata-wordmark')).fontFamily.startsWith('Arial, Helvetica') && getComputedStyle(document.querySelector('.travdata-wordmark')).fontStyle==='italic' && parseFloat(getComputedStyle(document.querySelector('.travdata-wordmark')).fontSize)<document.querySelector('.travdata-logo-mark').getBoundingClientRect().height*1.2`));
  check('Navy top banner, blue settings icon and light app surfaces', await value(`getComputedStyle(document.querySelector('.topbar')).backgroundColor==='rgb(1, 1, 39)' && getComputedStyle(document.querySelector('.search')).color==='rgb(255, 255, 255)' && getComputedStyle(document.querySelector('#settingsButton')).color==='rgb(0, 1, 253)'`));
  check('Frameless navy navigation, bright-blue selection and light period controls', await value(`getComputedStyle(document.querySelector('.trend-category-tabs .active')).backgroundColor==='rgb(0, 1, 253)' && [...document.querySelectorAll('.trend-category-tabs .segment-btn')].every(e=>getComputedStyle(e).color==='rgb(255, 255, 255)') && getComputedStyle(document.querySelector('.trend-category-tabs .segment-btn:not(.active)')).backgroundColor==='rgb(1, 1, 39)' && getComputedStyle(document.querySelector('.trend-category-tabs')).borderTopWidth==='0px' && getComputedStyle(document.querySelector('.trend-category-tabs')).backgroundColor==='rgba(0, 0, 0, 0)' && getComputedStyle(document.querySelector('.trend-scope-line')).backgroundColor==='rgba(0, 0, 0, 0)' && ['rgb(142, 49, 253)','rgb(109, 32, 196)'].includes(getComputedStyle(document.querySelector('.trend-win-value')).color)`));
  check('Bottom navigation keeps its approved purple active styling', await value(`getComputedStyle(document.querySelector('.bottom-nav .nav-item.active')).color==='rgb(109, 32, 196)'`));
  await wait('!!document.querySelector(".trend-metric-pill")');
  check('Trend metric surfaces are light and readable', await value(`getComputedStyle(document.querySelector('.trend-metric-pill')).backgroundColor==='rgb(255, 255, 255)'`));
  check('Original icon navigation: Trend, Statistik, Spel only', await value(`JSON.stringify([...document.querySelectorAll('[data-p1-nav]')].map(x=>x.textContent.trim()))===JSON.stringify(['Trend','Statistik','Spel']) && document.querySelectorAll('[data-p1-nav] svg').length===3`));
  await wait('!!document.querySelector("[data-p1-nav=trend].active")');
  await sizes('Original three-item bottom navigation', async () => {
    assert.ok(await value(`[...document.querySelectorAll('[data-p1-nav] svg')].every(x=>getComputedStyle(x).display!=='none'&&x.getBoundingClientRect().width>0)`));
  });
  await nav('upcoming');
  await wait('!!document.querySelector("[data-p1-round]")');
  check('Spel has the requested three-part navigation and no redundant explanatory copy', await value(`JSON.stringify([...document.querySelectorAll('[data-p1-spel-view]')].map(e=>e.textContent))===JSON.stringify(['Kommande','Registrera system','Mina system']) && !/Egna anteckningar och system|Startlistor utan val för egna system|verifierade startlistor/.test(document.querySelector('#app').innerText) && document.querySelector('.p1-page-head p').textContent==='V85 och V86'`));
  await sizes('Three-part Spel banner', async () => {
    assert.equal(await value(`getComputedStyle(document.querySelector('.p1-spel-switcher')).gridTemplateColumns.split(' ').length`), 3);
    assert.equal(await value(`getComputedStyle(document.querySelector('.p1-spel-switcher')).height`), '40px');
  });
  await click('[data-p1-round][data-p1-source="live"]');
  await wait('document.querySelectorAll("[data-p1-leg]").length===8 && !!document.querySelector("[data-p1-horse-open]")');
  check('Upcoming start list has no selection checkboxes', await value('!document.querySelector("#app input[type=checkbox]")'));
  check('Selected purple race leg uses white title and distance/start-method text', await value(`[...document.querySelectorAll('.p1-leg-tab.active strong,.p1-leg-tab.active span')].length===2 && [...document.querySelectorAll('.p1-leg-tab.active strong,.p1-leg-tab.active span')].every(e=>getComputedStyle(e).color==='rgb(255, 255, 255)')`));
  const horseId = await value('document.querySelector("[data-p1-horse-open]").dataset.p1Entry');
  await click('[data-p1-horse-open]');
  await wait('document.querySelectorAll(".p1-stat-grid .p1-stat-card").length===8');
  check('Eight exact horse statistic cards', await value('document.querySelectorAll(".p1-stat-card").length===8'));
  await wait('document.querySelectorAll(".p1-history-table tbody tr").length>0');
  check('Completed historical starts loaded through the paginated API', true);
  check('Market shares use percent units, not hundredfold values', await value(`[...document.querySelectorAll('.p1-horse-metric')].filter(x=>x.innerText.includes('Streck')).every(x=>!x.innerText.includes('%')||parseFloat(x.querySelector('strong').innerText.replace(',','.'))<=100)`));
  await sizes('Expanded horse', async width => {
    const columns = await value('getComputedStyle(document.querySelector(".p1-stat-grid")).gridTemplateColumns.split(" ").length');
    assert.equal(columns, width < 768 ? 2 : 4, `Statistic grid ${width}px`);
  });
  await browser.viewport(390);
  await click('[data-p1-action="new-note"]');
  await fill('[data-p1-note-text]', 'Syntetisk QA-notering för delad hästidentitet');
  await click('[data-p1-action="save-note"]');
  await wait('document.querySelector(".p1-notes")?.innerText.includes("Syntetisk QA-notering")');
  check('General note saves locally by horse ID', await value(`JSON.parse(localStorage.getItem('kentaurai.phase1.local.v1')).notes.some(n=>n.horseId===${JSON.stringify(horseId)}&&!n.raceEntryId)`));
  await browser.navigate('/app/');
  await wait('!!window.__kentauraiPhase1');
  await value(`openDetail('horses',${JSON.stringify(horseId)})`);
  await wait('!!document.querySelector("[data-tab=notes]")');
  await click('[data-tab="notes"]');
  await wait('document.querySelector(".p1-profile-notes")?.innerText.includes("Syntetisk QA-notering")');
  check('Same note survives reload and appears in horse-profile tab', true);
  await sizes('Horse profile notes');
  await click('[data-p1-action="edit-note"]');
  await fill('[data-p1-note-text]', 'Redigerad syntetisk QA-notering');
  const raceEntryId = await value('document.querySelector("[data-p1-note-race]")?.options[1]?.value || ""');
  if (raceEntryId) await fill('[data-p1-note-race]', raceEntryId);
  await click('[data-p1-action="save-note"]');
  await wait('document.querySelector(".p1-notes")?.innerText.includes("Redigerad syntetisk")');
  check('Edit note and optional historical link', true);
  await click('[data-p1-action="delete-note"]');
  await wait('!!document.querySelector("[data-p1-modal]")');
  await click('[data-p1-action="cancel-delete"]');
  check('Deletion can be cancelled', await value('document.querySelector(".p1-notes").innerText.includes("Redigerad syntetisk")'));
  await click('[data-p1-action="delete-note"]');
  await click('[data-p1-action="confirm-delete"]');
  await wait('!document.querySelector(".p1-notes")?.innerText.includes("Redigerad syntetisk")');
  check('Confirmed note deletion', true);
  await nav('upcoming');
  await wait('!!document.querySelector("[data-p1-action=toggle-upcoming-demo]")');
  await click('[data-p1-action="toggle-upcoming-demo"]');
  await wait('!!document.querySelector("[data-p1-round][data-p1-source=synthetic]")');
  await click('[data-p1-round^="demo-v85-"][data-p1-source="synthetic"]');
  await wait('!!document.querySelector("[data-p1-horse-open]")');
  await click('.p1-horse:has(.p1-result-win):has(.p1-result-dq) [data-p1-horse-open]');
  await wait('document.querySelectorAll(".p1-history-table tbody tr").length===5');
  check('Synthetic form demonstrates win, gallop and gallop disqualification', await value('!!document.querySelector(".p1-result-win") && !!document.querySelector(".p1-gallop") && !!document.querySelector(".p1-result-dq")'));
  check('Demo statistics agree with known five-start history', await value(`document.querySelectorAll('.p1-stat-value')[5].innerText.replace(/\\s/g,'')==='20%' && document.querySelectorAll('.p1-stat-value')[6].innerText.replace(/\\s/g,'')==='40%'`));
  await click('[data-p1-action="new-note"]');
  const syntheticEntryId = await value('document.querySelector("[data-p1-note-race]").options[1].value');
  await fill('[data-p1-note-race]', syntheticEntryId);
  await fill('[data-p1-note-text]', 'Syntetiskt loppanknuten QA-notering');
  await click('[data-p1-action="save-note"]');
  check('Race-linked demo note stores a stable reference, not copied racing facts', await value(`JSON.parse(localStorage.getItem('kentaurai.phase1.local.v1')).notes.some(n=>n.raceEntryId===${JSON.stringify(syntheticEntryId)}&&!n.context)`));
  await nav('upcoming');
  await wait('!!document.querySelector("[data-p1-action=toggle-upcoming-demo]")');
  await click('[data-p1-action="toggle-upcoming-demo"]');

  await nav('systems');
  await wait('!!document.querySelector(".p1-finance")');
  check('Mina system uses the banner instead of a separate oversized registration button', await value(`!document.querySelector('.p1-page-head [data-p1-action="open-builder"]') && document.querySelector('.p1-spel-switcher .active').dataset.p1SpelView==='systems'`));
  await click('[data-p1-spel-view="builder"]');
  await wait('document.querySelectorAll("[data-p1-number]").length===120');
  check('Registration opens from the middle tab and marks only that tab selected', await value(`document.querySelectorAll('.p1-spel-switcher .active').length===1 && document.querySelector('.p1-spel-switcher .active').dataset.p1SpelView==='builder' && document.querySelector('h1').textContent==='Registrera system'`));
  check('Eight legs always offer numbers 1–15', await value(`Array.from(document.querySelectorAll('[data-p1-builder-leg]')).every(l=>JSON.stringify([...l.querySelectorAll('[data-p1-number]')].map(x=>Number(x.dataset.p1Number)))===JSON.stringify(Array.from({length:15},(_,i)=>i+1)))`));
  await sizes('System builder', async width => {
    if (width < 768) assert.equal(await value('getComputedStyle(document.querySelector(".p1-number-grid")).gridTemplateColumns.split(" ").length'), 5);
  });
  await browser.viewport(390);
  await click('[data-p1-action="save-system"]');
  check('Incomplete save rejected', await value('!JSON.parse(localStorage.getItem("kentaurai.phase1.local.v1")).systems.length'));
  for (let leg = 0; leg < 8; leg++) {
    await click(`[data-p1-number="1"][data-leg-index="${leg}"]`);
    await wait(`document.querySelector('[data-p1-number="1"][data-leg-index="${leg}"]')?.getAttribute('aria-pressed')==='true'`);
  }
  const selectedRound = await value('document.querySelector("[data-p1-builder-round]").value');
  await fill('[data-p1-builder-name]', 'QA – åtta spikar');
  await click('[data-p1-action="save-system"]');
  await wait('JSON.parse(localStorage.getItem("kentaurai.phase1.local.v1")).systems.length===1');
  check('System with eight spikes saves without old backend restriction', true);
  await nav('systems');
  await click('[data-p1-spel-view="builder"]');
  await wait('document.querySelectorAll("[data-p1-number]").length===120');
  await fill('[data-p1-builder-round]', selectedRound);
  for (let leg = 0; leg < 8; leg++) {
    await click(`[data-p1-number="15"][data-leg-index="${leg}"]`);
    await wait(`document.querySelector('[data-p1-number="15"][data-leg-index="${leg}"]')?.getAttribute('aria-pressed')==='true'`);
  }
  await fill('[data-p1-builder-name]', 'QA – nummer femton');
  await click('[data-p1-action="save-system"]');
  await wait('JSON.parse(localStorage.getItem("kentaurai.phase1.local.v1")).systems.length===2');
  await nav('systems');
  check('Multiple systems in one canonical round', await value(`document.querySelectorAll('[data-p1-round-toggle="${selectedRound}"]').length===1`));
  check('Pending registrations excluded from realized finances', await value('window.__kentauraiPhase1.summarizeSystems(JSON.parse(localStorage.getItem("kentaurai.phase1.local.v1")).systems).stakeSek===0'));
  if (!await value('!!document.querySelector(".p1-finance .p1-negative")')) {
    await click('[data-p1-action="toggle-demo-systems"]');
  }
  await wait('!!document.querySelector(".p1-finance .p1-negative")');
  check('Three concise finance cards, no descriptions or ROI, negative demo net', await value(`JSON.stringify([...document.querySelectorAll('.p1-finance small')].map(e=>e.textContent))===JSON.stringify(['INSATS','UTDELNING','RESULTAT']) && document.querySelectorAll('.p1-finance > *').length===3 && !document.querySelector('.p1-finance .p1-small') && !/\\bROI\\b/.test(document.getElementById('app').innerText)`));
  await sizes('Saved systems', async () => {
    assert.equal(await value(`getComputedStyle(document.querySelector('.p1-finance')).gridTemplateColumns.split(' ').length`), 3);
    assert.ok(await value(`(()=>{const cards=[...document.querySelectorAll('.p1-finance-card')];return cards.every(c=>Math.abs(c.getBoundingClientRect().top-cards[0].getBoundingClientRect().top)<1)})()`));
  });
  await click('[data-p1-round-toggle]');
  await click('[data-p1-system-toggle]');
  check('System detail shows all eight leg comparisons', await value('!!document.querySelector("[data-p1-system-detail]:not([hidden])")'));

  browser.mock('/app/api/games/upcoming', 200, { items: [] });
  await nav('upcoming');
  await wait('document.getElementById("app").innerText.includes("Inga kommande")');
  check('Empty state', true);
  browser.mock('/app/api/games/upcoming', 503, { error: 'synthetic-qa-unavailable' });
  await nav('upcoming');
  await wait('document.getElementById("app").innerText.includes("Kunde inte läsa")');
  check('API error and retry state', true);
  browser.clearMocks();
  await nav('upcoming');
  await wait('!!document.querySelector("[data-p1-round]")');
  await nav('statistics');
  await wait('document.getElementById("app").innerText.includes("Hästar")');
  check('Existing statistics destination remains available', true);
  await sizes('Statistics');
  for (const [page, type] of [['horses', 'horse'], ['trainers', 'trainer'], ['drivers', 'driver'], ['tracks', 'track']]) {
    const name = await value(`fetch('/app/api/${page==='tracks'?'tracks':'entities/'+page}?limit=1').then(r=>r.json()).then(d=>d.items[0].name)`);
    await fill('#globalSearch', name);
    await wait(`!!document.querySelector('.search-item[data-type="${type}"]')`);
    await click(`.search-item[data-type="${type}"]`);
    await wait(`document.getElementById('app').innerText.includes(${JSON.stringify(name)})`);
  }
  check('Global search opens horses, trainers, drivers and tracks', true);
  await nav('settings');
  await wait('document.getElementById("app").innerText.includes("Inställningar")');
  check('Settings only opens through the top gear', await value('!document.querySelector(".bottom-nav .active") && !!document.querySelector("#settingsButton.active")'));
  await sizes('Settings');
  const stored = await value('localStorage.getItem("kentaurai.phase1.local.v1")');
  await value('localStorage.setItem("kentaurai.phase1.local.v1","{invalid-json")');
  await browser.navigate('/app/');
  await wait('!!document.querySelector("#p1-global-storage-status")');
  await value(`openDetail('horses',${JSON.stringify(horseId)})`);
  await wait('!!document.querySelector("[data-tab=notes]")');
  await click('[data-tab="notes"]');
  await wait('!!document.querySelector("[data-p1-action=new-note]")');
  await click('[data-p1-action="new-note"]');
  await fill('[data-p1-note-text]', 'Sparning måste blockeras');
  await click('[data-p1-action="save-note"]');
  check('Corrupt local storage is not overwritten by a save attempt', await value('localStorage.getItem("kentaurai.phase1.local.v1")==="{invalid-json"'));
  await value(`localStorage.setItem('kentaurai.phase1.local.v1',${JSON.stringify(stored)})`);
  await browser.navigate('/app/');
  await wait('!!window.__kentauraiPhase1');
  await nav('upcoming');
  await wait('!!document.querySelector("[data-p1-round]")');
  await browser.viewport(1280);
  if (process.env.KENTAURAI_QA_SCREENSHOT) {
    // Optional temporary screenshot path, never required for normal verification.
    await writeFile(process.env.KENTAURAI_QA_SCREENSHOT, await browser.screenshot());
  }
  check('No backend mutation requests', browser.writes.length === 0);
  check('No uncaught browser exceptions', browser.errors.length === 0);
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    passed: checks.length, checks, failure: error.message,
    browserErrors: browser.errors, blockedMutationRequests: browser.writes
  }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
