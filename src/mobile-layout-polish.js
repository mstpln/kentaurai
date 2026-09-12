const mobileLayoutPolishCss = `
<style id="kentaurai-mobile-layout-polish-v101">
/* Presentation-only mobile polish. Do not alter data or business behaviour here. */
.trend-panel-head{padding-left:16px!important;padding-right:16px!important}
.trend-result-row{padding-left:16px!important;padding-right:16px!important}
.trend-detail-panel>.trend-scope-filter-block{grid-column:1/-1;min-width:0}
.trend-detail-panel>.trend-scope-filter-block .segment-group{max-width:100%}

@media(max-width:760px){
  html{max-width:100%;overflow-x:hidden!important;background:var(--bg)}
  body{
    min-height:100vh;min-height:100dvh;max-width:100%;overflow-x:hidden!important;overflow-y:auto!important;
    -webkit-overflow-scrolling:touch;overscroll-behavior-y:auto
  }
  .shell{
    width:100%;max-width:100vw;min-height:100vh;min-height:100dvh;height:auto!important;
    padding-bottom:calc(84px + env(safe-area-inset-bottom))!important;display:block!important;overflow:visible!important
  }
  .topbar{
    position:sticky!important;top:0!important;z-index:60;min-width:0;max-width:100%;
    padding-top:env(safe-area-inset-top)
  }
  .top-inner,.main,.main>*{min-width:0;max-width:100%}
  .main{
    width:100%;min-height:0;overflow:visible!important;padding-bottom:24px!important
  }
  .bottom-nav{
    position:fixed!important;left:0!important;right:0!important;bottom:0!important;width:100%;
    min-height:74px;padding-top:7px!important;padding-bottom:calc(7px + env(safe-area-inset-bottom))!important;
    padding-left:max(6px,env(safe-area-inset-left))!important;padding-right:max(6px,env(safe-area-inset-right))!important;
    z-index:70;flex:none
  }
  .bottom-inner{width:100%!important;max-width:820px!important;grid-template-columns:repeat(6,minmax(0,1fr))!important;gap:1px!important}
  .nav-item{min-width:0!important;font-size:10px!important;padding:7px 0 6px!important;line-height:1.1!important;overflow:hidden}
  .nav-icon{width:21px!important;height:21px!important;margin-bottom:4px!important}

  /* Time period must always remain on one row. */
  .range-group{
    width:100%!important;max-width:100%!important;display:grid!important;
    grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:5px!important;
    flex-wrap:nowrap!important;overflow:visible!important
  }
  .range-btn{
    min-width:0!important;width:100%!important;max-width:100%!important;padding:9px 3px!important;
    font-size:clamp(9px,2.7vw,12px)!important;white-space:nowrap!important;text-align:center!important
  }

  /* Other pills and tabs may wrap rather than widening the page. */
  .tabs,.segment-group,.system-switcher,.stat-pills,.trip-chips{
    max-width:100%!important;flex-wrap:wrap!important;overflow:visible!important
  }
  .segment-btn,.tab-btn,.system-switcher button,.stat-pill{min-width:0!important;max-width:100%}

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
  .nav-item{font-size:9px!important;padding-left:0!important;padding-right:0!important}
  .nav-icon{width:20px!important;height:20px!important}
  .range-group{gap:3px!important}
  .range-btn{padding-left:1px!important;padding-right:1px!important;font-size:9px!important}
  .trend-result-row{grid-template-columns:64px minmax(0,1fr)!important;gap:8px!important;padding-left:12px!important;padding-right:12px!important}
}
</style>`;

const mobileLayoutPolishScript = `
<script id="kentaurai-mobile-layout-polish-v101-script">
(function(){
  let alignQueued=false;

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
      if(badge.textContent!==String(count))badge.textContent=String(count);
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

  function queueAlign(){
    if(alignQueued)return;
    alignQueued=true;
    requestAnimationFrame(()=>{
      alignQueued=false;
      alignTrendFilters();
    });
  }

  document.addEventListener('click',(event)=>{
    const target=event.target instanceof Element?event.target:null;
    if(target?.closest('#trendReset') && typeof state!=='undefined')state.trendRaceScope='all';
    if(target?.closest('#app'))queueAlign();
  },true);

  document.addEventListener('change',(event)=>{
    const target=event.target instanceof Element?event.target:null;
    if(target?.closest('#app'))queueAlign();
  },true);

  queueAlign();
})();
</script>`;

function ensureViewport(source) {
  if (/name=["']viewport["']/i.test(source)) return source;
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
  return source.replace('<head>', `<head>${viewport}`);
}

export function enhanceMobileLayoutPolish(html) {
  let source = ensureViewport(String(html));
  if (source.includes('kentaurai-mobile-layout-polish-v101')) return source;
  source = source.replace('</head>', `${mobileLayoutPolishCss}</head>`);
  return source.replace('</body>', `${mobileLayoutPolishScript}</body>`);
}
