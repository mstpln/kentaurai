const mobileLayoutPolishCss = `
<style id="kentaurai-mobile-layout-polish-v099">
/* Keep the existing KentaurAI visual language; this layer only adjusts layout/fit. */
.trend-panel-head{padding-left:16px!important;padding-right:16px!important}
.trend-result-row{padding-left:16px!important;padding-right:16px!important}
.trend-detail-panel>.trend-scope-filter-block{grid-column:1/-1;min-width:0}
.trend-detail-panel>.trend-scope-filter-block .segment-group{max-width:100%}

@media(max-width:760px){
  html,body{height:100%;height:100dvh;max-width:100%;overflow:hidden!important}
  body{min-height:100vh;min-height:100dvh;overscroll-behavior:none}
  .shell{
    width:100%;max-width:100vw;height:100vh;height:100dvh;min-height:0!important;
    padding-bottom:0!important;display:grid!important;grid-template-rows:auto minmax(0,1fr) auto;
    overflow:hidden!important
  }
  .topbar{position:relative!important;top:auto!important;z-index:40;min-width:0;max-width:100%}
  .main{
    width:100%;max-width:100%;min-width:0;min-height:0;overflow-y:auto!important;overflow-x:hidden!important;
    -webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;padding-bottom:23px!important
  }
  .bottom-nav{
    position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;width:100%;
    min-height:104px;padding-top:12px!important;padding-bottom:calc(12px + env(safe-area-inset-bottom))!important;
    z-index:45;flex:none
  }
  .bottom-inner{width:100%!important;max-width:820px!important;grid-template-columns:repeat(6,minmax(0,1fr))!important;gap:3px!important}
  .nav-item{min-width:0!important;font-size:11px!important;padding:11px 2px 9px!important;line-height:1.15!important}
  .nav-icon{width:24px!important;height:24px!important;margin-bottom:7px!important}

  /* Pills and tab groups wrap instead of creating horizontal scrolling. */
  .tabs,.segment-group,.range-group,.system-switcher,.stat-pills,.trip-chips{
    max-width:100%!important;flex-wrap:wrap!important;overflow:visible!important
  }
  .segment-btn,.range-btn,.tab-btn,.system-switcher button,.stat-pill{min-width:0!important}

  /* Generic mobile containment: content adapts to the viewport rather than widening it. */
  .main,.main>*,.card,.trend-panel,.trainer-ranking-card,.trainer-special,.track-lane-table,.horse-start-table,
  .detail-grid,.stats-grid,.game-grid,.system-card,.data-section,.settings-card{max-width:100%!important;min-width:0!important}
  .grid>*{min-width:0}
  img,svg{max-width:100%}

  /* Existing tabular content must fit the mobile viewport without sideways scrolling. */
  .table-wrap{max-width:100%!important;overflow-x:hidden!important}
  .table,.starts-table,.game-table{width:100%!important;min-width:0!important;max-width:100%!important;table-layout:fixed!important}
  .table th,.table td,.starts-table th,.starts-table td,.game-table th,.game-table td{
    min-width:0!important;max-width:none!important;padding-left:5px!important;padding-right:5px!important;
    font-size:clamp(7px,2.35vw,10px)!important;white-space:normal!important;overflow-wrap:anywhere;word-break:break-word
  }

  /* Preserve all information inside compact statistic rows/cards. */
  .trend-result-row{grid-template-columns:72px minmax(0,1fr)!important;gap:10px!important;padding:14px 14px!important}
  .trend-panel-head{padding:12px 14px 10px!important}
  .trend-result-main,.trend-result-pills,.trend-metric-pill,.trainer-ranking-row,.trainer-special-metric{min-width:0!important}
  .trend-result-pills{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px!important}
  .trend-metric-pill{padding:6px 5px!important}
  .trend-metric-pill span{font-size:6.8px!important;letter-spacing:.025em!important;overflow:hidden;text-overflow:ellipsis}
  .trend-metric-pill strong{font-size:9px!important;overflow:hidden;text-overflow:ellipsis}

  /* The opened Trend filter keeps today's design but Loppnivå lives inside it. */
  .trend-scope-line{justify-content:flex-end!important;align-items:center!important}
  .trend-detail-panel{max-width:100%;grid-template-columns:1fr 1fr!important;gap:8px!important}
  .trend-detail-panel>.trend-scope-filter-block{grid-column:1/-1!important;padding-bottom:2px}
  .trend-detail-panel>.trend-scope-filter-block .segment-group{display:flex!important;flex-wrap:wrap!important;overflow:visible!important}
  .trend-reset{grid-column:1/-1!important;justify-self:start}
}

@media(max-width:360px){
  .nav-item{font-size:10px!important;padding-left:1px!important;padding-right:1px!important}
  .nav-icon{width:23px!important;height:23px!important}
  .table th,.table td,.starts-table th,.starts-table td,.game-table th,.game-table td{font-size:7px!important;padding-left:3px!important;padding-right:3px!important}
  .trend-result-row{grid-template-columns:64px minmax(0,1fr)!important;gap:8px!important;padding-left:12px!important;padding-right:12px!important}
}
</style>`;

const mobileLayoutPolishScript = `
<script id="kentaurai-mobile-layout-polish-v099-script">
(function(){
  function currentScopeBlock(){
    return document.querySelector('.trend-scope-line > .filter-block') || document.querySelector('.trend-detail-panel > .trend-scope-filter-block');
  }

  function syncTrendFilterCount(scopeBlock,panel,trigger){
    if(!trigger)return;
    const scopeActive=scopeBlock?.querySelector('[data-trend-scope].active');
    const scopeCount=scopeActive&&scopeActive.dataset.trendScope!=='all'?1:0;
    const detailCount=panel?[...panel.querySelectorAll('.trend-detail-field select.active')].length:0;
    const count=scopeCount+detailCount;
    let badge=trigger.querySelector('.trend-filter-count');
    if(count){
      if(!badge){badge=document.createElement('span');badge.className='trend-filter-count';trigger.appendChild(badge)}
      badge.textContent=String(count);
      trigger.classList.add('active');
    }else{
      badge?.remove();
      trigger.classList.remove('active');
    }
  }

  function alignTrendFilters(){
    const scopeLine=document.querySelector('.trend-scope-line');
    if(!scopeLine)return;
    const panel=document.querySelector('.trend-detail-panel');
    const trigger=scopeLine.querySelector('#trendFilterToggle');
    const scopeBlock=currentScopeBlock();
    if(!scopeBlock)return;

    if(panel){
      scopeBlock.style.display='';
      scopeBlock.classList.add('trend-scope-filter-block');
      if(scopeBlock.parentElement!==panel)panel.insertBefore(scopeBlock,panel.firstChild);
    }else{
      scopeBlock.style.display='none';
    }
    syncTrendFilterCount(scopeBlock,panel,trigger);
  }

  document.addEventListener('click',(event)=>{
    if(event.target.closest('#trendReset') && typeof state!=='undefined')state.trendRaceScope='all';
  },true);

  const app=document.getElementById('app');
  if(app){
    const observer=new MutationObserver(()=>alignTrendFilters());
    observer.observe(app,{childList:true,subtree:true});
  }
  alignTrendFilters();
})();
</script>`;

export function enhanceMobileLayoutPolish(html) {
  const source = String(html);
  if (source.includes('kentaurai-mobile-layout-polish-v099')) return source;
  return source
    .replace('</head>', `${mobileLayoutPolishCss}</head>`)
    .replace('</body>', `${mobileLayoutPolishScript}</body>`);
}
