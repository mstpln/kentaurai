import {
  renderAppPage as renderFinalAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-final.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

const cornerBackIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20v-7a4 4 0 0 0-4-4H4"/><path d="M9 14 4 9l5-5"/></svg>`;

const gameBackBefore = `app.innerHTML='<button class="back" id="backGames">← '+esc(d.round.gameType)+'</button>'+heading`;
const gameBackAfter = `app.innerHTML='<button class="back" id="backGames">${cornerBackIcon}<span>'+esc(d.round.gameType)+'</span></button>'+heading`;

const exactBrandAlignment = `
<style id="kentaurai-brand-cap-alignment">
/* Keep the outer Sagittarius badge exactly one brand-font cap-height tall. */
.brand{font-family:var(--font-brand)!important;font-size:31px!important}
.brand-badge{width:1cap!important;height:1cap!important;flex-basis:1cap!important}
.brand-icon{width:.72cap!important;height:.72cap!important}
@media(max-width:760px){.brand{font-size:28px!important}}
@media(max-width:430px){.brand{font-size:27px!important}}
</style>`;

const completeStatsScript = `
<script id="kentaurai-complete-stats-script">
statsView=function(detail){const s=detail.stats||{};return '<div class="data-groups">'+dataSection('Resultat',[['Starter med resultat',s.resultStarts],['Vinster',s.wins],['Andraplatser',s.seconds],['Tredjeplatser',s.thirds],['Topp 3',s.top3],['Vinstprocent',pct(s.winRate)],['Topp 3-procent',pct(s.top3Rate)],['Prispengar',money(s.prizeSek)]])+dataSection('Galopp & diskvalifikation',[['Galopper',s.gallops],['Galopp %',pct(s.gallopRate)],['Diskvalifikationer',s.disqualifications]])+'<div class="breakdown-grid">'+breakdown('Startmetod',detail.breakdowns?.startMethods,r=>localStartMethod(r))+breakdown('Distans',detail.breakdowns?.distances,r=>r==='unknown'?'Okänd':r+' m')+breakdown('Bana',detail.breakdowns?.tracks)+'</div></div>'};
</script>`;

export function renderAppPage() {
  return renderFinalAppPage()
    .replace(gameBackBefore, gameBackAfter)
    .replace('</head>', `${exactBrandAlignment}</head>`)
    .replace('</body>', `${completeStatsScript}</body>`);
}
