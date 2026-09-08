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
/* Keep the outer Sagittarius badge exactly one text cap-height tall. */
.brand{font-size:31px!important}
.brand-badge{width:1cap!important;height:1cap!important;flex-basis:1cap!important}
.brand-icon{width:.72cap!important;height:.72cap!important}
@media(max-width:760px){.brand{font-size:28px!important}}
@media(max-width:430px){.brand{font-size:27px!important}}
</style>`;

export function renderAppPage() {
  return renderFinalAppPage()
    .replace(gameBackBefore, gameBackAfter)
    .replace('</head>', `${exactBrandAlignment}</head>`);
}
