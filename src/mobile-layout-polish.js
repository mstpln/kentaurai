const mobileLayoutPolishCss = `
<style id="kentaurai-mobile-layout-polish-v099">
/* Presentation-only mobile polish. Do not alter data or business behaviour here. */
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
  .top-inner,.main,.main>*{min-width:0;max-width:100%}
  .main{
    width:100%;min-height:0;overflow-y:auto!important;overflow-x:hidden!important;
    -webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;padding-bottom:23px!important
  }
  .bottom-nav{
    position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;width:100%;
    min-height:88px;padding-top:8px!important;padding-bottom:calc(8px + env(safe-area-inset-bottom))!important;
    z-index:45;flex:none
  }
  .bottom-inner{width:100%!important;max-width:820px!important;grid-template-columns:repeat(6,minmax(0,1fr))!important;gap:2px!important}
  .nav-item{min-width:0!important;font-size:11px!important;padding:9px 1px 7px!important;line-height:1.15!important}
  .nav-icon{width:23px!important;height:23px!important;margin-bottom:6px!important}

  /* Pills and tabs wrap instead of widening the page. */
  .tabs,.segment-group,.range-group,.system-switcher,.stat-pills,.trip-chips{
    max-width:100%!important;flex-wrap:wrap!important;overflow:visible!important
  }
  .segment-btn,.range-btn,.tab-btn,.system-switcher button,.stat-pill{min-width:0!important;max-width:100%}

  /* Generic containment for cards, grids and nested detail content. */
  .card,.trend-panel,.trainer-ranking-card,.trainer-special,.detail-grid,.stats-grid,.game-grid,.system-card,
  .data-section,.settings-card,.settings-layout,.analysis-workflow-intro{max-width:100%!important;min-width:0!important}
  .grid>*,.detail-grid>*,.stats-grid>*,.game-grid>*{min-width:0}
  img,svg{max-width:100%}
  pre,code,.settings-code{max-width:100%;white-space:pre-wrap!important;overflow-wrap:anywhere;word-break:break-word}

  /* Wide tables scroll inside their own container; body width never grows. */
  .table-wrap{max-width:100%!important;overflow-x:auto!important;overflow-y:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
  .table,.starts-table,.game-table{max-width:none!important}
  .starts-table,.game-table{min-width:620px}
  .table th,.table td,.starts-table th,.starts-table td,.game-table th,.game-table td{white-space:normal;overflow-wrap:anywhere}

  /* Preserve all information inside compact statistic rows/cards. */
  .trend-result-row{grid-template-columns:72px minmax(0,1fr)!important;gap:10px!important;padding:14px!important}
  .trend-panel-head{padding:12px 14px 10px!important}
  .trend-result-main,.trend-result-pills,.trend-metric-pill,.trainer-ranking-row,.trainer-special-metric{min-width:0!important}
  .trend-result-pills{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px!important}
  .trend-metric-pill{padding:6px 5px!important}
  .trend-metric-pill span{font-size:7px!important;letter-spacing:.02em!important;overflow:hidden;text-overflow:ellipsis}
  .trend-metric-pill strong{font-size:9px!important;overflow:hidden;text-overflow:ellipsis}

  /* The opened Trend filter keeps Loppnivå with the detailed filters. */
  .trend-scope-line{justify-content:flex-end!important;align-items:center!important;min-width:0}
  .trend-detail-panel{max-width:100%;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:8px!important}
  .trend-detail-panel>.trend-scope-filter-block{grid-column:1/-1!important;padding-bottom:2px}
  .trend-detail-panel>.trend-scope-filter-block .segment-group{display:flex!important;flex-wrap:wrap!important;overflow:visible!important}
  .trend-reset{grid-column:1/-1!important;justify-self:start}
  .trend-detail-field,.trend-detail-field select{min-width:0!important;max-width:100%;width:100%}

  /* Settings workflow stays readable and touch friendly. */
  .settings-card-head,.settings-card-body{min-width:0}
  .settings-actions{width:100%;min-width:0}
  .settings-actions>*{max-width:100%}
  .settings-field{min-width:0!important;max-width:100%;width:100%}
  .settings-select,.settings-file{width:100%;max-width:100%;min-width:0}
  .settings-primary,.settings-secondary{min-height:44px;max-width:100%;white-space:normal;line-height:1.3}
  .settings-help,.settings-card-head p{overflow-wrap:anywhere}
}

@media(max-width:430px){
  .trend-detail-panel{grid-template-columns:1fr!important}
  .trend-detail-panel>.trend-scope-filter-block,.trend-reset{grid-column:1!important}
  .settings-card-head,.settings-card-body{padding:15px!important}
  .settings-actions{display:grid!important;grid-template-columns:1fr!important;align-items:stretch!important}
  .settings-primary,.settings-secondary{width:100%!important}
}

@media(max-width:360px){
  .nav-item{font-size:10px!important;padding-left:0!important;padding-right:0!important}
  .nav-icon{width:22px!important;height:22px!important}
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

function ensureViewport(source) {
  if (/name=["']viewport["']/i.test(source)) return source;
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
  return source.replace('<head>', `<head>${viewport}`);
}

export function enhanceMobileLayoutPolish(html) {
  let source = ensureViewport(String(html));
  if (source.includes('kentaurai-mobile-layout-polish-v099')) return source;
  source = source.replace('</head>', `${mobileLayoutPolishCss}</head>`);
  return source.replace('</body>', `${mobileLayoutPolishScript}</body>`);
}
