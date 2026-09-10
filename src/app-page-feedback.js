import {
  renderAppPage as renderNavigationAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-navigation.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

const statusTextBefore = `function statusText(status){return ({working:'Fungerar',success:'Klar',warning:'Varning',error:'Fel',running:'Pågår',unknown:'Okänd'})[status]||status}`;
const statusTextAfter = `function statusText(status){return ({working:'✓',success:'✓',warning:'!',error:'✕',running:'…',unknown:'?'})[status]||status}`;

const feedbackCss = `
<style id="kentaurai-feedback-fixes">
.status-pill{border:0!important;border-radius:0!important;background:transparent!important;padding:0!important;min-width:24px;text-align:center;font-size:19px!important;font-weight:800!important;line-height:1!important}
.status-pill.working,.status-pill.success{color:#8eb28a!important}.status-pill.error{color:#d58f83!important}.status-pill.warning,.status-pill.running,.status-pill.unknown{color:#d0b178!important}
</style>`;

const feedbackScript = `
<script id="kentaurai-feedback-script">
(function(){
function hasDisplayValue(value){return value!==null&&value!==undefined&&value!==''&&value!=='—'}
const previousDataSection=dataSection;
dataSection=function(title,items,note=''){
  const visible=(items||[]).filter(item=>item&&hasDisplayValue(item[1]));
  if(!visible.length)return '';
  return previousDataSection(title,visible,note);
};

function actualRaceShapeText(leg){
  if(leg?.winner?.trip?.label)return leg.winner.trip.label;
  return leg?.winner?'Saknar verifierat positionsunderlag':'Resultat saknas';
}
function expectedVsActualText(leg,systemResult){
  const expected=systemResult?.expectedRaceShape;
  const actual=leg?.winner?.trip?.label;
  if(expected&&actual)return 'Förväntat: '+expected+' · Faktiskt: '+actual;
  if(expected)return 'Förväntat: '+expected+' · Faktiskt: saknar verifierat positionsunderlag';
  if(actual)return 'Förväntat: saknas · Faktiskt: '+actual;
  return 'Underlag saknas';
}
const previousRoundLegBlock=roundLegBlock;
roundLegBlock=function(leg,selectedSystem){
  const html=previousRoundLegBlock(leg,selectedSystem);
  const systemResult=selectedSystem?leg.systems?.[selectedSystem.id]:null;
  const actual=actualRaceShapeText(leg);
  const comparison=expectedVsActualText(leg,systemResult);
  return html
    .replace('<div class="compact-label">Vann från</div><div class="compact-value">'+esc(leg.winner?.trip?.label||'Okänt')+'</div>', '<div class="compact-label">Vann från</div><div class="compact-value">'+esc(actual)+'</div>')
    .replace('<div class="compact-label">Förväntad vs faktisk loppbild</div><div class="compact-value">'+esc(systemResult?.review?.scenarioMatch||'Ej bedömd')+'</div>', '<div class="compact-label">Förväntad vs faktisk loppbild</div><div class="compact-value">'+esc(comparison)+'</div>');
};

const previousRenderGameDetailView=renderGameDetailView;
renderGameDetailView=function(detail){
  previousRenderGameDetailView(detail);
  const selectedSystem=detail.systems.find(system=>system.id===state.gameSystemId)||detail.systems[0]||null;
  document.querySelectorAll('.game-table tbody tr').forEach((row,index)=>{
    const leg=detail.legs[index];
    const cell=row.children[2];
    if(cell&&leg)cell.textContent=actualRaceShapeText(leg);
  });
};
})();
</script>`;

export function renderAppPage() {
  return renderNavigationAppPage()
    .replace(statusTextBefore, statusTextAfter)
    .replace('</head>', `${feedbackCss}</head>`)
    .replace('</body>', `${feedbackScript}</body>`);
}
