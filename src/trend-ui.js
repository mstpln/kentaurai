const trendCss = `
<style id="kentaurai-trend-build-a">
.trend-top-controls{display:grid;gap:14px;margin:18px 0 14px}
.trend-scope-line{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;border-top:1px solid var(--line-soft);padding-top:13px}
.trend-scope-line .filter-block{min-width:0}
.trend-detail-trigger{border:0;background:transparent;color:var(--muted);padding:7px 2px;display:flex;align-items:center;gap:6px;cursor:pointer;flex:0 0 auto}
.trend-detail-trigger:hover,.trend-detail-trigger.active{color:var(--accent-soft)}
.trend-detail-trigger svg{width:22px;height:22px;display:block;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.trend-filter-count{font-size:10px;font-weight:700;color:var(--accent-soft);font-variant-numeric:tabular-nums}
.trend-detail-panel{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) auto;gap:10px;align-items:end;padding:13px 0 4px;border-top:1px solid var(--line-soft)}
.trend-detail-field{min-width:0}.trend-detail-field label{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:650;margin:0 0 6px}
.trend-detail-field select{width:100%;min-height:40px;border:1px solid var(--line);background:#10100f;color:var(--text);border-radius:9px;padding:8px 28px 8px 9px;font-size:11px}
.trend-detail-field select.active{border-color:#6a5336;color:var(--accent-soft);background:#17130f}
.trend-reset{min-height:40px;border:0;background:transparent;color:var(--muted);padding:0 4px;font-size:11px;cursor:pointer}.trend-reset:hover{color:var(--text)}
.trend-panel{overflow:hidden}
.trend-panel-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:16px 0 10px}
.trend-panel-head h2{font-size:18px;margin:0;font-weight:650}.trend-panel-kicker{font-size:9px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);font-weight:650;margin-bottom:4px}.trend-panel-period{font-size:10px;color:var(--muted);white-space:nowrap}
.trend-results{border-top:1px solid var(--line)}
.trend-result-row{width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--text);display:grid;grid-template-columns:92px minmax(0,1fr);gap:15px;padding:16px 4px;text-align:left;cursor:pointer}
.trend-result-row:last-child{border-bottom:0}.trend-result-row:hover{background:#11110f}.trend-result-row:focus-visible{outline:1px solid var(--accent);outline-offset:-1px}
.trend-win-block{border-right:1px solid var(--line);display:flex;flex-direction:column;justify-content:center;min-width:0}.trend-win-value{font-size:25px;line-height:1;font-weight:700;color:var(--accent-soft);font-variant-numeric:tabular-nums}.trend-win-label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-top:5px}
.trend-result-main{min-width:0}.trend-result-name{font-size:15px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.trend-result-core{font-size:10px;color:var(--muted);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}.trend-result-core span+span:before{content:'·';margin-right:8px;color:#5f5a53}
.trend-result-pills{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:11px}.trend-metric-pill{border:1px solid var(--line);background:#151412;border-radius:9px;padding:7px 8px;min-width:0}.trend-metric-pill span{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.055em;color:var(--muted);white-space:nowrap}.trend-metric-pill strong{display:block;margin-top:2px;font-size:11px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.trend-loading,.trend-no-data{padding:34px 12px;text-align:center;color:var(--muted);border-top:1px solid var(--line);font-size:12px}.trend-no-data strong{display:block;color:var(--text);font-size:14px;margin-bottom:5px}
@media(max-width:760px){.trend-detail-panel{grid-template-columns:1fr 1fr}.trend-reset{grid-column:1/-1;justify-self:start}.trend-panel-head{padding-top:12px}}
@media(max-width:430px){.trend-top-controls{gap:11px}.trend-scope-line{gap:8px}.trend-result-row{grid-template-columns:72px minmax(0,1fr);gap:10px;padding:14px 0}.trend-win-value{font-size:22px}.trend-result-name{font-size:13px}.trend-result-core{font-size:9px;gap:5px}.trend-result-core span+span:before{margin-right:5px}.trend-result-pills{gap:5px;margin-top:9px}.trend-metric-pill{padding:6px 5px}.trend-metric-pill span{font-size:6.8px;letter-spacing:.025em}.trend-metric-pill strong{font-size:9px}.trend-detail-panel{gap:8px}.trend-detail-field select{font-size:10px;padding-left:7px}.trend-panel-period{display:none}}
@media(max-width:340px){.trend-result-row{grid-template-columns:64px minmax(0,1fr);gap:8px}.trend-win-value{font-size:20px}.trend-result-pills{gap:4px}.trend-metric-pill{padding:6px 4px}.trend-metric-pill span{font-size:6.2px}.trend-metric-pill strong{font-size:8.5px}}
</style>`;

const trendScript = `
<script id="kentaurai-trend-build-a-script">
(function(){
const TREND_CATEGORIES=[['trainers','Tränare'],['horses','Hästar'],['drivers','Kuskar']];
const TREND_PERIODS=[['2w','2 veckor'],['4w','4 veckor'],['3m','3 mån'],['6m','6 mån'],['1y','1 år']];
const TREND_SCOPES=[['all','All data'],['high_prize','Högre prissumma'],['weekday','Vardagstrav']];
const TREND_RACE_TYPES=[['all','Alla'],['sulky','Sulky'],['monte','Monté']];
const TREND_BREEDS=[['all','Alla'],['warmblood','Varmblod'],['coldblood','Kallblod']];
const TREND_METHODS=[['all','Alla'],['auto','Autostart'],['volt','Voltstart']];
const SLIDERS_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M14 4v6M4 17h2M10 17h10M10 14v6"/></svg>';
state.trendRaceScope=state.trendRaceScope||'all';
state.trendDetailFilters=state.trendDetailFilters||{trackId:'all',raceType:'all',breedType:'all',startMethod:'all'};
state.trendFilterOpen=Boolean(state.trendFilterOpen);
state.trendFilterOptions=state.trendFilterOptions||null;
let trendRequestToken=0;
function trendLabel(options,value){return (options.find(x=>x[0]===value)||[])[1]||value}
function trendOptionHtml(options,active){return options.map(([value,label])=>'<option value="'+esc(value)+'" '+(String(value)===String(active)?'selected':'')+'>'+esc(label)+'</option>').join('')}
function trendSegment(options,active,attr){return '<div class="segment-group">'+options.map(([value,label])=>'<button type="button" class="segment-btn '+(value===active?'active':'')+'" '+attr+'="'+esc(value)+'">'+esc(label)+'</button>').join('')+'</div>'}
function detailCount(){const f=state.trendDetailFilters;return [f.trackId,f.raceType,f.breedType,f.startMethod].filter(x=>x&&x!=='all').length}
function trackOptions(){const rows=(state.trendFilterOptions&&state.trendFilterOptions.tracks)||[];return [['all','Alla banor'],...rows.map(row=>[String(row.id),row.name])]}
function detailPanel(){if(!state.trendFilterOpen)return '';const f=state.trendDetailFilters;return '<div class="trend-detail-panel" id="trendDetailPanel"><div class="trend-detail-field"><label>Bana</label><select data-trend-detail="trackId" class="'+(f.trackId!=='all'?'active':'')+'">'+trendOptionHtml(trackOptions(),f.trackId)+'</select></div><div class="trend-detail-field"><label>Lopptyp</label><select data-trend-detail="raceType" class="'+(f.raceType!=='all'?'active':'')+'">'+trendOptionHtml(TREND_RACE_TYPES,f.raceType)+'</select></div><div class="trend-detail-field"><label>Rastyp</label><select data-trend-detail="breedType" class="'+(f.breedType!=='all'?'active':'')+'">'+trendOptionHtml(TREND_BREEDS,f.breedType)+'</select></div><div class="trend-detail-field"><label>Startmetod</label><select data-trend-detail="startMethod" class="'+(f.startMethod!=='all'?'active':'')+'">'+trendOptionHtml(TREND_METHODS,f.startMethod)+'</select></div><button type="button" class="trend-reset" id="trendReset">Återställ detaljfilter</button></div>'}
function trendPageControls(){const count=detailCount();return '<div class="trend-top-controls"><div class="filter-block"><div class="filter-label">Kategori</div>'+trendSegment(TREND_CATEGORIES,state.trendCategory,'data-trend-category')+'</div><div class="filter-block"><div class="filter-label">Tidsperiod</div><div class="range-group">'+TREND_PERIODS.map(([value,label])=>'<button type="button" class="range-btn '+(value===state.trendRange?'active':'')+'" data-trend-range="'+value+'">'+label+'</button>').join('')+'</div></div><div class="trend-scope-line"><div class="filter-block"><div class="filter-label">Loppnivå</div>'+trendSegment(TREND_SCOPES,state.trendRaceScope,'data-trend-scope')+'</div><button type="button" class="trend-detail-trigger '+(count?'active':'')+'" id="trendFilterToggle" aria-label="Detaljfilter" aria-expanded="'+(state.trendFilterOpen?'true':'false')+'">'+SLIDERS_ICON+(count?'<span class="trend-filter-count">'+count+'</span>':'')+'</button></div>'+detailPanel()+'</div>'}
function trendPct(value){return value==null?'—':pct(value)}
function trendMoney(value){return value==null?'—':money(value)}
function metricPill(label,value){return '<span class="trend-metric-pill"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></span>'}
function trendRows(items){if(!items.length)return '<div class="trend-no-data"><strong>Ingen statistik för valt urval</strong>Rankingen fylls automatiskt när verifierade resultat finns inom filtren.</div>';return '<div class="trend-results">'+items.map(item=>'<button type="button" class="trend-result-row" data-trend-id="'+esc(item.id)+'"><span class="trend-win-block"><span class="trend-win-value">'+esc(trendPct(item.winRate))+'</span><span class="trend-win-label">Seger%</span></span><span class="trend-result-main"><span class="trend-result-name">'+esc(item.name)+'</span><span class="trend-result-core"><span>Starter '+num(item.starts)+'</span><span>Vinster '+num(item.wins)+'</span><span>Förluster '+num(item.losses)+'</span></span><span class="trend-result-pills">'+metricPill('Topp 3%',trendPct(item.top3Rate))+metricPill('Galopp%',trendPct(item.gallopRate))+metricPill('Prispengar',trendMoney(item.prizeSek))+'</span></span></button>').join('')+'</div>'}
function bindTrendBuildA(){
  document.querySelectorAll('[data-trend-category]').forEach(button=>button.onclick=()=>{state.trendCategory=button.dataset.trendCategory;renderStart()});
  document.querySelectorAll('[data-trend-range]').forEach(button=>button.onclick=()=>{state.trendRange=button.dataset.trendRange;renderStart()});
  document.querySelectorAll('[data-trend-scope]').forEach(button=>button.onclick=()=>{state.trendRaceScope=button.dataset.trendScope;renderStart()});
  const toggle=document.getElementById('trendFilterToggle');if(toggle)toggle.onclick=()=>{state.trendFilterOpen=!state.trendFilterOpen;renderStart()};
  document.querySelectorAll('[data-trend-detail]').forEach(select=>select.onchange=()=>{state.trendDetailFilters[select.dataset.trendDetail]=select.value;renderStart()});
  const reset=document.getElementById('trendReset');if(reset)reset.onclick=()=>{state.trendDetailFilters={trackId:'all',raceType:'all',breedType:'all',startMethod:'all'};renderStart()};
  document.querySelectorAll('[data-trend-id]').forEach(button=>button.onclick=()=>openDetail(state.trendCategory,button.dataset.trendId));
}
async function loadTrendFilterOptions(){if(state.trendFilterOptions)return;try{state.trendFilterOptions=await api('/trend/filter-options')}catch{state.trendFilterOptions={tracks:[]}}}
renderStart=async function(){
  state.detail=null;state.gameDetail=null;state.gameSystemId=null;state.page='start';setNav('start');
  const token=++trendRequestToken;
  await loadTrendFilterOptions();
  const f=state.trendDetailFilters;
  app.innerHTML='<div class="start-heading"><h1>Trend</h1><p>Topplistor baserade på verifierade resultat och valda filter.</p></div>'+trendPageControls()+'<section class="trend-panel"><div class="trend-panel-head"><div><div class="trend-panel-kicker">'+esc(trendLabel(TREND_CATEGORIES,state.trendCategory))+'</div><h2>Högst segerprocent</h2></div><div class="trend-panel-period">'+esc(trendLabel(TREND_PERIODS,state.trendRange))+'</div></div><div id="trendResults" class="trend-loading">Läser statistik…</div></section>';
  bindTrendBuildA();
  try{
    const query=new URLSearchParams({category:state.trendCategory,period:state.trendRange,race_scope:state.trendRaceScope,race_type:f.raceType,breed_type:f.breedType,start_method:f.startMethod});
    if(f.trackId&&f.trackId!=='all')query.set('track_id',f.trackId);
    const data=await api('/trend?'+query.toString());
    if(token!==trendRequestToken||state.page!=='start')return;
    const target=document.getElementById('trendResults');if(!target)return;target.className='';target.innerHTML=trendRows(data.items||[]);bindTrendBuildA();
  }catch(err){
    if(token!==trendRequestToken||state.page!=='start')return;
    const target=document.getElementById('trendResults');if(target){target.className='trend-no-data';target.innerHTML='<strong>Kunde inte läsa Trend</strong>'+esc(err.message)}
  }
};
})();
</script>`;

export function enhanceTrendHtml(html) {
  return String(html)
    .replace('</head>', `${trendCss}</head>`)
    .replace('</body>', `${trendScript}</body>`);
}
