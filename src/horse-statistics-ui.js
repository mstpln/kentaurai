const horseStatisticsCss = `
<style id="kentaurai-horse-statistics-build-b">
.horse-stats-toolbar{margin:14px 0;display:grid;gap:10px}.horse-stats-control-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px}.horse-stats-period{display:flex;align-items:center;gap:8px;color:var(--muted);padding:5px 2px}.horse-stats-period>span{font-size:9px;text-transform:uppercase;letter-spacing:.08em;font-weight:650}.horse-stats-period-choice{position:relative;display:inline-flex}.horse-stats-period select{appearance:none;-webkit-appearance:none;border:0;background:transparent;color:var(--accent-soft);font:inherit;font-size:13px;font-weight:650;padding:3px 18px 3px 0;cursor:pointer}.horse-stats-chevron{position:absolute;right:0;top:50%;transform:translateY(-56%);pointer-events:none;color:var(--muted)}.horse-stats-filter-toggle{border:0;background:transparent;color:var(--muted);display:flex;align-items:center;gap:6px;padding:7px 2px;cursor:pointer}.horse-stats-filter-toggle.active,.horse-stats-filter-toggle:hover{color:var(--accent-soft)}.horse-stats-filter-toggle svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.horse-stats-filter-count{font-size:10px;color:var(--accent-soft);font-weight:700}.horse-stats-filter-panel{border-top:1px solid var(--line-soft);padding-top:12px}.horse-stats-filter-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.horse-stats-filter{min-width:0}.horse-stats-filter label{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:5px}.horse-stats-filter select{width:100%;height:38px;border:1px solid var(--line);border-radius:9px;background:#10100f;color:var(--text);padding:0 8px;font-size:11px}.horse-stats-filter select.active{border-color:#6a5336;color:var(--accent-soft)}
.horse-ranking-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.horse-ranking-card{border:1px solid var(--line);border-radius:13px;background:var(--panel);overflow:hidden}.horse-ranking-head{padding:12px 13px;border-bottom:1px solid var(--line-soft)}.horse-ranking-head h2{font-size:13px;margin:0}.horse-ranking-head span{display:block;color:var(--muted);font-size:9px;margin-top:3px}.horse-ranking-row{width:100%;border:0;border-bottom:1px solid var(--line-soft);background:transparent;color:var(--text);display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 12px;text-align:left;cursor:pointer}.horse-ranking-row:last-child{border-bottom:0}.horse-ranking-row:hover{background:#11110f}.horse-ranking-rank{color:var(--muted);font-size:10px}.horse-ranking-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.horse-ranking-value{text-align:right;font-size:11px;font-variant-numeric:tabular-nums;color:var(--accent-soft)}.horse-ranking-note{display:block;color:var(--muted);font-size:8px;margin-top:1px}.horse-ranking-empty{padding:16px 12px;color:var(--muted);font-size:11px}
.horse-special-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px}.horse-special{border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:13px;min-width:0}.horse-special h2{font-size:12px;margin:0 0 9px}.horse-special-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.horse-special-metric{border:1px solid var(--line-soft);border-radius:8px;padding:8px}.horse-special-metric span{display:block;font-size:8px;text-transform:uppercase;color:var(--muted)}.horse-special-metric strong{display:block;font-size:12px;margin-top:2px}.horse-placement-line,.horse-points-history{font-size:10px;color:var(--muted);margin-top:9px;line-height:1.6}.horse-points-current{font-size:24px;color:var(--accent-soft);font-weight:700}.horse-points-date{font-size:9px;color:var(--muted);margin-top:3px}
@media(max-width:900px){.horse-stats-filter-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.horse-special-grid{grid-template-columns:1fr}}
@media(max-width:650px){.horse-ranking-grid{grid-template-columns:1fr}.horse-stats-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:430px){.horse-ranking-row{grid-template-columns:20px minmax(0,1fr) auto;padding-left:9px;padding-right:9px}.horse-ranking-value{max-width:100px}.horse-stats-filter-grid{grid-template-columns:1fr 1fr}}
@media(max-width:320px){.horse-stats-filter-grid{grid-template-columns:1fr}.horse-ranking-value{max-width:82px}}
</style>`;

const horseStatisticsScript = `
<script id="kentaurai-horse-statistics-build-b-script">
(function(){
const PERIODS=[['2w','2 veckor'],['4w','4 veckor'],['3m','3 mån'],['6m','6 mån'],['1y','1 år'],['all','Alla']];
const SCOPES=[['all','All data'],['high_prize','Högre prissumma'],['weekday','Vardagstrav']];
const TYPES=[['all','Alla'],['sulky','Sulky'],['monte','Monté']];
const BREEDS=[['all','Alla'],['warmblood','Varmblod'],['coldblood','Kallblod']];
const METHODS=[['all','Alla'],['auto','Autostart'],['volt','Voltstart']];
const SEXES=[['all','Alla'],['mare','Sto'],['stallion','Hingst'],['gelding','Valack']];
const MINIMUMS=[['all','Alla'],['3','3'],['5','5'],['10','10'],['20','20']];
const H_FILTER_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M14 4v6M4 17h2M10 17h10M10 14v6"/></svg>';
const H_DEFAULTS={period:'1y',raceScope:'high_prize',trackId:'all',raceType:'all',breedType:'all',startMethod:'all',distanceGroup:'all',sex:'all',age:'all',minStarts:'3'};
state.horseStatsFilters={...H_DEFAULTS,...(state.horseStatsFilters||{})};
state.horseStatsOptions=state.horseStatsOptions||null;state.horseStatsFilterOpen=Boolean(state.horseStatsFilterOpen);state.horseStatsData=state.horseStatsData||null;state.horseStatsDataKey=state.horseStatsDataKey||null;
let rankingToken=0;
function opts(rows,active){return rows.map(([v,l])=>'<option value="'+esc(v)+'" '+(String(v)===String(active)?'selected':'')+'>'+esc(l)+'</option>').join('')}
function trackRows(){return [['all','Alla banor'],...((state.horseStatsOptions?.tracks)||[]).map(x=>[String(x.id),x.name])]}
function distanceRows(){return [['all','Alla'],...((state.horseStatsOptions?.distanceGroups)||[]).map(x=>[String(x),x==='other-long'?'Övrigt >2640':String(x)+' m'])]}
function ageRows(){const year=new Date().getFullYear(),births=state.horseStatsOptions?.birthYears||[];const ages=[...new Set(births.map(y=>year-Number(y)).filter(x=>x>=2&&x<=30))].sort((a,b)=>a-b);return [['all','Alla'],...ages.map(x=>[String(x),x+' år'])]}
function field(label,key,rows){const value=state.horseStatsFilters[key];return '<div class="horse-stats-filter"><label>'+esc(label)+'</label><select data-hs-filter="'+key+'" class="'+(value!=='all'?'active':'')+'">'+opts(rows,value)+'</select></div>'}
function hFilterCount(){const f=state.horseStatsFilters;return ['raceScope','trackId','raceType','breedType','startMethod','distanceGroup','sex','age','minStarts'].filter(k=>f[k]&&f[k]!=='all').length}
function hPanel(includeMinimum=true){if(!state.horseStatsFilterOpen)return'';return '<div class="horse-stats-filter-panel"><div class="horse-stats-filter-grid">'+field('Loppnivå','raceScope',SCOPES)+field('Bana','trackId',trackRows())+field('Lopptyp','raceType',TYPES)+field('Rastyp','breedType',BREEDS)+field('Startmetod','startMethod',METHODS)+field('Distans','distanceGroup',distanceRows())+field('Kön','sex',SEXES)+field('Ålder','age',ageRows())+(includeMinimum?field('Min starter','minStarts',MINIMUMS):'')+'<button type="button" class="trend-reset" id="horseStatsReset">Återställ filter</button></div></div>'}
function toolbar(includeMinimum=true){const n=hFilterCount(),f=state.horseStatsFilters;return '<div class="horse-stats-toolbar"><div class="horse-stats-control-row"><label class="horse-stats-period"><span>Tidsperiod</span><span class="horse-stats-period-choice"><select data-hs-filter="period" aria-label="Tidsperiod">'+opts(PERIODS,f.period)+'</select><span class="horse-stats-chevron" aria-hidden="true">⌄</span></span></label><button type="button" class="horse-stats-filter-toggle '+(n?'active':'')+'" id="horseStatsFilterToggle" aria-label="Detaljfilter" aria-expanded="'+(state.horseStatsFilterOpen?'true':'false')+'">'+H_FILTER_ICON+(n?'<span class="horse-stats-filter-count">'+n+'</span>':'')+'</button></div>'+hPanel(includeMinimum)+'</div>'}
function query(){const f=state.horseStatsFilters,q=new URLSearchParams({period:f.period,race_scope:f.raceScope,race_type:f.raceType,breed_type:f.breedType,start_method:f.startMethod,distance_group:f.distanceGroup,sex:f.sex,age:f.age,min_starts:f.minStarts});if(f.trackId!=='all')q.set('track_id',f.trackId);return q.toString()}
async function loadOptions(){if(state.horseStatsOptions)return;try{state.horseStatsOptions=await api('/horses/statistics/filter-options')}catch{state.horseStatsOptions={tracks:[],birthYears:[],distanceGroups:[]}}}
function hInvalidate(){state.horseStatsData=null;state.horseStatsDataKey=null}
function bindFilters(callback){document.querySelectorAll('[data-hs-filter]').forEach(select=>select.onchange=()=>{state.horseStatsFilters[select.dataset.hsFilter]=select.value;hInvalidate();callback()});const toggle=document.getElementById('horseStatsFilterToggle');if(toggle)toggle.onclick=async()=>{state.horseStatsFilterOpen=!state.horseStatsFilterOpen;if(state.horseStatsFilterOpen&&!state.horseStatsOptions)await loadOptions();callback()};const reset=document.getElementById('horseStatsReset');if(reset)reset.onclick=()=>{state.horseStatsFilters={...H_DEFAULTS};hInvalidate();callback()}}
function numberValue(v,d=1){return v==null?'—':Number(v).toFixed(d).replace('.',',')}
function paceValue(v){if(v==null)return '—';const total=Number(v);const minutes=Math.floor(total/60);const seconds=(total-minutes*60).toFixed(1).padStart(4,'0').replace('.',',');return minutes+'.'+seconds+' min/km'}
function card(title,note,rows,value){return '<section class="horse-ranking-card"><div class="horse-ranking-head"><h2>'+esc(title)+'</h2><span>'+esc(note)+'</span></div>'+(rows?.length?rows.map(row=>'<button type="button" class="horse-ranking-row" data-hs-horse="'+esc(row.id)+'"><span class="horse-ranking-rank">'+num(row.rank)+'</span><span class="horse-ranking-name">'+esc(row.name)+'</span><span class="horse-ranking-value">'+value(row)+'</span></button>').join(''):'<div class="horse-ranking-empty">Inget verifierat underlag för valt urval.</div>')+'</section>'}
function rankingGrid(data){const r=data.rankings||{};let html='<div class="horse-ranking-grid">'+(r.fastestFirst200?
 card('Startsnabbaste','X-Labs första 200 m · lägst snitt-km-tempo',r.fastestFirst200,x=>paceValue(x.averageSeconds)+'<span class="horse-ranking-note">'+num(x.measurements)+' mätningar</span>'):'')+
 card('Högst segerprocent','Vinster / starter',r.highestWinRate,x=>esc(pct(x.winRate))+'<span class="horse-ranking-note">'+num(x.starts)+' starter</span>')+
 card('Högst topp 3-procent','Placering 1–3 / resultatstarter',r.highestTop3Rate,x=>esc(pct(x.top3Rate))+'<span class="horse-ranking-note">'+num(x.resultStarts)+' resultat</span>')+
 (Object.hasOwn(r,'bestFormLast10')?card('Bäst form – senaste 10','Endast officiella placeringar',r.bestFormLast10,x=>numberValue(x.averagePlacing,2)+'<span class="horse-ranking-note">'+num(x.usedStarts)+' starter</span>'):'');if(data.partial)return html+'</div><div class="horse-ranking-empty horse-ranking-pending">Läser resterande statistik…</div>';return html+
 card('Högst startpoäng','Senast verifierade officiella observation',r.highestStartPoints,x=>num(x.points)+'<span class="horse-ranking-note">'+esc(String(x.observedAt||'').slice(0,10))+'</span>')+
 card('Starkaste avslutare','X-Labs sista 400 m · lägst snitt-km-tempo',r.strongestLast400,x=>paceValue(x.averageSeconds)+'<span class="horse-ranking-note">'+num(x.measurements)+' mätningar</span>')+
 card('Högst snittintjäning/start','Prispengar / verifierade prisstarter',r.highestEarningsPerStart,x=>esc(money(x.earningsPerVerifiedStart))+'<span class="horse-ranking-note">'+num(x.prizeVerifiedStarts)+' prisstarter</span>')+
 card('Första starten efter vila','Minst 60 dagar sedan föregående faktiska start',r.firstAfterRest,x=>esc(pct(x.winRate))+'<span class="horse-ranking-note">'+num(x.starts)+' starter</span>')+
 card('Andra starten efter vila','Nästa start efter comeback utan ny 60-dagars vila',r.secondAfterRest,x=>esc(pct(x.winRate))+'<span class="horse-ranking-note">'+num(x.starts)+' starter</span>')+'</div>'}
function bindRows(){document.querySelectorAll('[data-hs-horse]').forEach(row=>row.onclick=()=>openDetail('horses',row.dataset.hsHorse))}
function mergeHorseRankingPayload(core,extended){return{...core,...extended,partial:false,rankings:{...(core.rankings||{}),...(extended.rankings||{})}}}
function renderHorseRankingShell(data){app.innerHTML=heading('Hästar','Sök och utforska hästar')+tabs([['list','Lista'],['stats','Statistik']],state.tab)+toolbar()+rankingGrid(data);bindTabs(()=>renderEntityList('horses'));bindFilters(renderHorseRankings);bindRows()}
async function renderHorseRankings(){
 const token=++rankingToken;cancelRankingLifecycle();state.detail=null;state.page='horses';setNav('horses');const key=query();const cached=state.horseStatsDataKey===key?state.horseStatsData:null;
 app.innerHTML=heading('Hästar','Sök och utforska hästar')+tabs([['list','Lista'],['stats','Statistik']],state.tab)+toolbar()+(cached?rankingGrid(cached):'<div class="horse-ranking-empty">Läser häststatistik…</div>');bindTabs(()=>renderEntityList('horses'));bindFilters(renderHorseRankings);if(cached){bindRows();return}
 const lifecycle=beginRankingLifecycle();
 try{
  const core=await api('/horses/statistics?'+key+'&mode=core',{signal:lifecycle.controller.signal});
  if(!isCurrentRankingLifecycle(lifecycle)||token!==rankingToken||state.page!=='horses'||state.tab!=='stats'||state.detail)return;
  renderHorseRankingShell(core);
  await afterRankingCorePaint();
  if(!isCurrentRankingLifecycle(lifecycle)||token!==rankingToken||state.page!=='horses'||state.tab!=='stats'||state.detail)return;
  let extended;
  try{extended=await api('/horses/statistics?'+key+'&mode=extended',{signal:lifecycle.controller.signal})}
  catch(error){if(isRankingAbort(error))return;if(isCurrentRankingLifecycle(lifecycle)){const pending=document.querySelector('.horse-ranking-pending');if(pending)pending.textContent='Kunde inte läsa resterande statistik.'}return}
  if(!isCurrentRankingLifecycle(lifecycle)||token!==rankingToken||state.page!=='horses'||state.tab!=='stats'||state.detail)return;
  const data=mergeHorseRankingPayload(core,extended);state.horseStatsData=data;state.horseStatsDataKey=key;renderHorseRankingShell(data);
 }catch(error){if(isRankingAbort(error))return;if(isCurrentRankingLifecycle(lifecycle)&&token===rankingToken&&state.page==='horses'&&state.tab==='stats'&&!state.detail){rankingToken++;app.innerHTML+='<div class="horse-ranking-empty">Kunde inte läsa häststatistik: '+esc(error.message)+'</div>'}}
 finally{completeRankingLifecycle(lifecycle)}
}
const previousHorseEntityList=renderEntityList;
renderEntityList=async function(page){if(page==='horses'&&state.tab==='stats')return renderHorseRankings();rankingToken++;cancelRankingLifecycle();return previousHorseEntityList(page)};
})();
</script>`;

export function enhanceHorseStatisticsHtml(html) {
  return html.replace('</head>', `${horseStatisticsCss}</head>`).replace('</body>', `${horseStatisticsScript}</body>`);
}
