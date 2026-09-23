import {
  renderAppPage as renderSettingsAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-settings.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

const KENTAURAI_STANDARD_DISTANCE_GROUPS = [640, 1640, 2140, 2640, 3140];
const STANDARD_DISTANCE_TOLERANCE_M = 100;

export function standardDistanceGroup(value) {
  if (value === null || value === undefined || value === '' || value === 'unknown') return 'unknown';
  const distance = Number(value);
  if (!Number.isFinite(distance)) return String(value);
  for (const standard of KENTAURAI_STANDARD_DISTANCE_GROUPS) {
    if (Math.abs(distance - standard) <= STANDARD_DISTANCE_TOLERANCE_M) return String(standard);
  }
  return String(Math.round(distance));
}

export function groupDistanceRows(rows = []) {
  const grouped = new Map();
  for (const row of rows || []) {
    const label = standardDistanceGroup(row?.label);
    const current = grouped.get(label) || { label, starts: 0, resultStarts: 0, wins: 0, top3: 0, gallops: 0 };
    current.starts += Number(row?.starts || 0);
    current.resultStarts += Number(row?.resultStarts || 0);
    current.wins += Number(row?.wins || 0);
    current.top3 += Number(row?.top3 || 0);
    current.gallops += Number(row?.gallops || 0);
    grouped.set(label, current);
  }
  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      winRate: row.resultStarts ? row.wins / row.resultStarts : null,
      top3Rate: row.resultStarts ? row.top3 / row.resultStarts : null,
      gallopRate: row.resultStarts ? row.gallops / row.resultStarts : null
    }))
    .sort((a, b) => {
      if (b.starts !== a.starts) return b.starts - a.starts;
      const aDistance = Number(a.label);
      const bDistance = Number(b.label);
      if (Number.isFinite(aDistance) && Number.isFinite(bDistance)) return aDistance - bDistance;
      if (Number.isFinite(aDistance)) return -1;
      if (Number.isFinite(bDistance)) return 1;
      return String(a.label).localeCompare(String(b.label), 'sv');
    });
}

const navigationCss = `
<style id="kentaurai-navigation-fixes">
.top-inner{grid-template-columns:auto minmax(280px,680px) minmax(44px,1fr)!important}
.settings-button{justify-self:end!important;width:42px!important;height:42px!important;border:0!important;border-radius:0!important;background:transparent!important;color:#9c958b!important;display:grid!important;place-items:center!important;cursor:pointer!important;padding:9px!important;box-shadow:none!important}
.settings-button:hover,.settings-button.active{border:0!important;background:transparent!important;color:var(--accent-soft)!important;box-shadow:none!important}
.settings-button svg{width:23px!important;height:23px!important;display:block!important}
#app.kentaurai-swipe-back-active{will-change:transform;transition:none!important}
#app.kentaurai-swipe-back-settle{will-change:transform;transition:transform .14s ease-out!important}
@media(max-width:760px){.top-inner{grid-template-columns:1fr!important}.settings-button{right:16px!important;top:10px!important;width:42px!important;height:42px!important}.brand{padding-right:48px}}
</style>`;

const navigationScript = `
<script id="kentaurai-navigation-history">
const KENTAURAI_STANDARD_DISTANCE_GROUPS=${JSON.stringify(KENTAURAI_STANDARD_DISTANCE_GROUPS)};
const STANDARD_DISTANCE_TOLERANCE_M=${STANDARD_DISTANCE_TOLERANCE_M};
${standardDistanceGroup.toString()}
${groupDistanceRows.toString()}
const previousGroupedStatsView=statsView;
statsView=function(detail){
  const groupedDistances=groupDistanceRows(detail?.breakdowns?.distances||[]);
  return previousGroupedStatsView({...detail,breakdowns:{...(detail.breakdowns||{}),distances:groupedDistances}});
};

(function(){
const NAV_MARKER='kentaurai-nav-v1';
let restoring=false;
let commitTimer=null;

function copyObject(value){return value&&typeof value==='object'?{...value}:{}}
function currentView(){
  return {
    page:state.page||'start',
    tab:state.tab||'list',
    detail:state.detail?{page:state.detail.page,id:state.detail.id}:null,
    listOffsets:copyObject(state.listOffsets),
    trendCategory:state.trendCategory||'trainers',
    trendRange:state.trendRange||'4w',
    gameTab:state.gameTab||'overview',
    gameSort:state.gameSort||'latest',
    gameOffsets:copyObject(state.gameOffsets),
    gameDetail:state.gameDetail||null,
    gameSystemId:state.gameSystemId||null,
    upcomingRound:state.upcomingRound||null,
    upcomingLeg:Number(state.upcomingLeg||1),
    trackDetail:state.trackDetail||null,
    trackTab:state.trackTab||'overview',
    startHistoryOffsets:copyObject(state.startHistoryOffsets),
    linkedHorseOffsets:copyObject(state.linkedHorseOffsets),
    settingsOpen:Boolean(state.settingsOpen),
    settingsTab:state.settingsTab||'data'
  };
}
function makeHistoryState(depth){const view=currentView();return {marker:NAV_MARKER,depth,signature:JSON.stringify(view),view}}
function commitView(){
  if(restoring)return;
  const next=makeHistoryState(0);
  const current=history.state;
  if(current&&current.marker===NAV_MARKER&&current.signature===next.signature){history.replaceState({...current,view:next.view,signature:next.signature},'');return}
  const depth=current&&current.marker===NAV_MARKER?Number(current.depth||0)+1:1;
  history.pushState({...next,depth},'');
}
function scheduleCommit(){clearTimeout(commitTimer);commitTimer=setTimeout(commitView,0)}
function replaceView(){
  if(restoring)return;
  const current=history.state;
  const depth=current&&current.marker===NAV_MARKER?Number(current.depth||0):0;
  history.replaceState(makeHistoryState(depth),'');
}
function scheduleReplace(){clearTimeout(commitTimer);commitTimer=setTimeout(replaceView,0)}
const SWIPE_EDGE_PX=24,SWIPE_TRIGGER_PX=72,SWIPE_MAX_VISUAL_PX=46;
let swipe=null;
function canSwipeBack(target){
  const current=history.state;
  if(!current||current.marker!==NAV_MARKER||Number(current.depth||0)<=0)return false;
  if(!(target instanceof Element))return true;
  return !target.closest('input,select,textarea,[contenteditable="true"],[data-no-back-swipe],.entity-detail-table-wrap,.table-wrap,.tabs,.stat-pills,.segment-group');
}
function clearSwipeVisual(settle=false){
  app.classList.remove('kentaurai-swipe-back-active');
  if(settle)app.classList.add('kentaurai-swipe-back-settle');
  app.style.transform='';
  if(settle)setTimeout(()=>app.classList.remove('kentaurai-swipe-back-settle'),160);
}
document.addEventListener('touchstart',event=>{
  if(event.touches.length!==1)return;
  const touch=event.touches[0];
  if(touch.clientX>SWIPE_EDGE_PX||!canSwipeBack(event.target))return;
  swipe={startX:touch.clientX,startY:touch.clientY,dx:0,dy:0,horizontal:false,cancelled:false};
},{passive:true});
document.addEventListener('touchmove',event=>{
  if(!swipe||event.touches.length!==1)return;
  const touch=event.touches[0];
  swipe.dx=touch.clientX-swipe.startX;
  swipe.dy=touch.clientY-swipe.startY;
  if(swipe.dx<0){swipe.cancelled=true;clearSwipeVisual();return}
  if(!swipe.horizontal){
    if(Math.abs(swipe.dy)>12&&Math.abs(swipe.dy)>Math.abs(swipe.dx)){swipe.cancelled=true;clearSwipeVisual();return}
    if(swipe.dx<10)return;
    if(swipe.dx<=Math.abs(swipe.dy)*1.25){swipe.cancelled=true;clearSwipeVisual();return}
    swipe.horizontal=true;
    app.classList.add('kentaurai-swipe-back-active');
  }
  if(swipe.horizontal&&!swipe.cancelled){
    event.preventDefault();
    const visual=Math.min(SWIPE_MAX_VISUAL_PX,Math.max(0,swipe.dx)*0.38);
    app.style.transform='translate3d('+visual+'px,0,0)';
  }
},{passive:false});
document.addEventListener('touchend',()=>{
  if(!swipe)return;
  const shouldBack=swipe.horizontal&&!swipe.cancelled&&swipe.dx>=SWIPE_TRIGGER_PX;
  swipe=null;
  clearSwipeVisual(true);
  if(shouldBack)history.back();
},{passive:true});
document.addEventListener('touchcancel',()=>{swipe=null;clearSwipeVisual(true)},{passive:true});
function restoreShared(view){
  state.tab=view.tab||'list';
  state.listOffsets=copyObject(view.listOffsets);
  state.trendCategory=view.trendCategory||'trainers';
  state.trendRange=view.trendRange||'4w';
  state.gameTab=view.gameTab||'overview';
  state.gameSort=view.gameSort||'latest';
  state.gameOffsets=copyObject(view.gameOffsets);
  state.gameSystemId=view.gameSystemId||null;
  state.upcomingRound=view.upcomingRound||null;
  state.upcomingLeg=Number(view.upcomingLeg||1);
  state.trackDetail=view.trackDetail||null;
  state.trackTab=view.trackTab||'overview';
  state.startHistoryOffsets=copyObject(view.startHistoryOffsets);
  state.linkedHorseOffsets=copyObject(view.linkedHorseOffsets);
  state.settingsTab='data';
}
async function restoreView(view){
  if(!view)return;
  cancelRankingLifecycle();
  cancelEntityListLifecycle();
  restoring=true;
  clearTimeout(commitTimer);
  try{
    restoreShared(view);
    if(view.settingsOpen){
      state.settingsOpen=false;
      const button=document.getElementById('settingsButton');
      if(button)button.click();
      await new Promise(resolve=>setTimeout(resolve,0));
      return;
    }
    state.settingsOpen=false;
    document.getElementById('settingsButton')?.classList.remove('active');
    if(view.gameDetail){
      state.gameDetail=view.gameDetail;
      state.gameSystemId=view.gameSystemId||null;
      await openGameDetail(view.gameDetail);
      return;
    }
    if(view.detail&&view.detail.page&&view.detail.id){
      state.detail={page:view.detail.page,id:view.detail.id};
      state.page=view.detail.page;
      state.gameDetail=null;
      state.gameSystemId=null;
      setNav(view.detail.page);
      await renderDetail();
      return;
    }
    state.detail=null;
    state.gameDetail=null;
    state.gameSystemId=null;
    if(view.page==='games'){await renderGames();return}
    if(view.page==='analysis'&&window.__kentauraiAnalysis?.render){window.__kentauraiAnalysis.render();return}
    if(view.page==='start'||!view.page){await renderStart();return}
    if(['trainers','horses','drivers'].includes(view.page)){await renderEntityList(view.page);return}
    await renderStart();
  }finally{
    restoring=false;
  }
}

const initialDepth=history.state&&history.state.marker===NAV_MARKER?Number(history.state.depth||0):0;
history.replaceState(makeHistoryState(initialDepth),'');

document.addEventListener('click',event=>{
  const target=event.target instanceof Element?event.target:null;
  const back=target?.closest('.back');
  const current=history.state;
  if(back&&current&&current.marker===NAV_MARKER&&Number(current.depth||0)>0){
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    history.back();
    return;
  }
  if(target?.closest('[data-history-replace]')){scheduleReplace();return}
  scheduleCommit();
},true);

window.addEventListener('popstate',event=>{
  if(!event.state||event.state.marker!==NAV_MARKER)return;
  restoreView(event.state.view).catch(err=>{app.innerHTML='<div class="notice">Kunde inte återställa föregående sida: '+esc(err.message)+'</div>'});
});
})();
</script>`;

export function renderAppPage() {
  return renderSettingsAppPage()
    .replace('</head>', `${navigationCss}</head>`)
    .replace('</body>', `${navigationScript}</body>`);
}
