const driverStatisticsCss = `
<style id="kentaurai-driver-statistics-build-c">
.driver-stats-toolbar{margin:14px 0;display:grid;gap:10px}.driver-stats-control-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px}.driver-stats-period{display:flex;align-items:center;gap:8px;color:var(--muted);padding:5px 2px}.driver-stats-period>span{font-size:9px;text-transform:uppercase;letter-spacing:.08em;font-weight:650}.driver-stats-period-choice{position:relative;display:inline-flex}.driver-stats-period select{appearance:none;-webkit-appearance:none;border:0;background:transparent;color:var(--accent-soft);font:inherit;font-size:13px;font-weight:650;padding:3px 18px 3px 0;cursor:pointer}.driver-stats-chevron{position:absolute;right:0;top:50%;transform:translateY(-56%);pointer-events:none;color:var(--muted)}.driver-stats-filter-toggle{border:0;background:transparent;color:var(--muted);display:flex;align-items:center;gap:6px;padding:7px 2px;cursor:pointer}.driver-stats-filter-toggle.active,.driver-stats-filter-toggle:hover{color:var(--accent-soft)}.driver-stats-filter-toggle svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.driver-stats-filter-count{font-size:10px;color:var(--accent-soft);font-weight:700}.driver-stats-filter-panel{border-top:1px solid var(--line-soft);padding-top:12px}.driver-stats-filter-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.driver-stats-filter{min-width:0}.driver-stats-filter label{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:5px}.driver-stats-filter select{width:100%;height:38px;border:1px solid var(--line);border-radius:9px;background:#10100f;color:var(--text);padding:0 8px;font-size:11px}.driver-stats-filter select.active{border-color:#6a5336;color:var(--accent-soft)}
.driver-ranking-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.driver-ranking-card{border:1px solid var(--line);border-radius:13px;background:var(--panel);overflow:hidden}.driver-ranking-head{padding:12px 13px;border-bottom:1px solid var(--line-soft)}.driver-ranking-head h2{font-size:13px;margin:0}.driver-ranking-head span{display:block;color:var(--muted);font-size:9px;margin-top:3px}.driver-ranking-row{width:100%;border:0;border-bottom:1px solid var(--line-soft);background:transparent;color:var(--text);display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 12px;text-align:left;cursor:pointer}.driver-ranking-row:last-child{border-bottom:0}.driver-ranking-row:hover{background:#11110f}.driver-ranking-rank{color:var(--muted);font-size:10px}.driver-ranking-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.driver-ranking-value{text-align:right;font-size:11px;font-variant-numeric:tabular-nums;color:var(--accent-soft)}.driver-ranking-note{display:block;color:var(--muted);font-size:8px;margin-top:1px}.driver-ranking-empty{padding:16px 12px;color:var(--muted);font-size:11px}
.driver-special-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.driver-special{border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:13px;min-width:0}.driver-special h2{font-size:12px;margin:0 0 9px}.driver-special-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.driver-special-metric{border:1px solid var(--line-soft);border-radius:8px;padding:8px}.driver-special-metric span{display:block;font-size:8px;text-transform:uppercase;color:var(--muted)}.driver-special-metric strong{display:block;font-size:12px;margin-top:2px}
@media(max-width:900px){.driver-stats-filter-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:650px){.driver-ranking-grid,.driver-special-grid{grid-template-columns:1fr}.driver-stats-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:430px){.driver-ranking-row{grid-template-columns:20px minmax(0,1fr) auto;padding-left:9px;padding-right:9px}.driver-ranking-value{max-width:105px}.driver-stats-filter-grid{grid-template-columns:1fr 1fr}}
@media(max-width:320px){.driver-stats-filter-grid{grid-template-columns:1fr}.driver-ranking-value{max-width:86px}}
</style>`;

const driverStatisticsScript = `
<script id="kentaurai-driver-statistics-build-c-script">
(function(){
const PERIODS=[['2w','2 veckor'],['4w','4 veckor'],['3m','3 mån'],['6m','6 mån'],['1y','1 år'],['all','Alla']];
const SCOPES=[['all','All data'],['high_prize','Högre prissumma'],['weekday','Vardagstrav']];
const TYPES=[['all','Alla'],['sulky','Sulky'],['monte','Monté']];
const BREEDS=[['all','Alla'],['warmblood','Varmblod'],['coldblood','Kallblod']];
const SEXES=[['all','Alla'],['mare','Sto'],['stallion','Hingst'],['gelding','Valack']];
const METHODS=[['all','Alla'],['auto','Autostart'],['volt','Voltstart']];
const VOLT=[['all','Alla'],['good','Bra spår (1/6/7)'],['other','Övriga spår']];
const MINIMUMS=[['all','Alla'],['3','3'],['5','5'],['10','10'],['20','20']];
const D_FILTER_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M14 4v6M4 17h2M10 17h10M10 14v6"/></svg>';
const D_DEFAULTS={period:'1y',raceScope:'high_prize',trackId:'all',raceType:'all',breedType:'all',sex:'all',age:'all',startMethod:'all',distanceGroup:'all',voltLane:'all',handicapM:'all',minStarts:'10'};
state.driverStatsFilters={...D_DEFAULTS,...(state.driverStatsFilters||{})};
state.driverStatsOptions=state.driverStatsOptions||null;state.driverStatsFilterOpen=Boolean(state.driverStatsFilterOpen);state.driverStatsData=state.driverStatsData||null;state.driverStatsDataKey=state.driverStatsDataKey||null;
let driverRankingToken=0;
function dOpts(rows,active){return rows.map(([v,l])=>'<option value="'+esc(v)+'" '+(String(v)===String(active)?'selected':'')+'>'+esc(l)+'</option>').join('')}
function dTrackRows(){return [['all','Alla banor'],...((state.driverStatsOptions?.tracks)||[]).map(x=>[String(x.id),x.name])]}
function dDistanceRows(){return [['all','Alla'],...((state.driverStatsOptions?.distanceGroups)||[]).map(x=>[String(x),x==='other-long'?'Övrigt >2640':String(x)+' m'])]}
function dAgeRows(){return [['all','Alla'],...((state.driverStatsOptions?.ageOptions)||[]).map(x=>[String(x),String(x)+' år'])]}
function dHandicapRows(){return [['all','Alla'],...((state.driverStatsOptions?.handicapBuckets)||[]).map(x=>[String(x),Number(x)===0?'Grunddistans':'+'+x+' m'])]}
function dField(label,key,rows){const value=state.driverStatsFilters[key];return '<div class="driver-stats-filter"><label>'+esc(label)+'</label><select data-ds-filter="'+key+'" class="'+(value!=='all'?'active':'')+'">'+dOpts(rows,value)+'</select></div>'}
function dFilterCount(){const f=state.driverStatsFilters;return ['raceScope','trackId','raceType','breedType','sex','age','startMethod','distanceGroup','voltLane','handicapM','minStarts'].filter(k=>f[k]&&f[k]!=='all').length}
function dPanel(includeMinimum=true){if(!state.driverStatsFilterOpen)return'';return '<div class="driver-stats-filter-panel"><div class="driver-stats-filter-grid">'+dField('Loppnivå','raceScope',SCOPES)+dField('Bana','trackId',dTrackRows())+dField('Lopptyp','raceType',TYPES)+dField('Rastyp','breedType',BREEDS)+dField('Kön','sex',SEXES)+dField('Ålder','age',dAgeRows())+dField('Startmetod','startMethod',METHODS)+dField('Distans','distanceGroup',dDistanceRows())+dField('Voltspår','voltLane',VOLT)+dField('Tillägg','handicapM',dHandicapRows())+(includeMinimum?dField('Min starter','minStarts',MINIMUMS):'')+'<button type="button" class="trend-reset" id="driverStatsReset">Återställ filter</button></div></div>'}
function dToolbar(includeMinimum=true){const n=dFilterCount(),f=state.driverStatsFilters;return '<div class="driver-stats-toolbar"><div class="driver-stats-control-row"><label class="driver-stats-period"><span>Tidsperiod</span><span class="driver-stats-period-choice"><select data-ds-filter="period" aria-label="Tidsperiod">'+dOpts(PERIODS,f.period)+'</select><span class="driver-stats-chevron" aria-hidden="true">⌄</span></span></label><button type="button" class="driver-stats-filter-toggle '+(n?'active':'')+'" id="driverStatsFilterToggle" aria-label="Detaljfilter" aria-expanded="'+(state.driverStatsFilterOpen?'true':'false')+'">'+D_FILTER_ICON+(n?'<span class="driver-stats-filter-count">'+n+'</span>':'')+'</button></div>'+dPanel(includeMinimum)+'</div>'}
function dQuery(){const f=state.driverStatsFilters,q=new URLSearchParams({period:f.period,race_scope:f.raceScope,race_type:f.raceType,breed_type:f.breedType,sex:f.sex,age:f.age,start_method:f.startMethod,distance_group:f.distanceGroup,volt_lane:f.voltLane,handicap_m:f.handicapM,min_starts:f.minStarts});if(f.trackId!=='all')q.set('track_id',f.trackId);return q.toString()}
async function dLoadOptions(){if(state.driverStatsOptions)return;try{state.driverStatsOptions=await api('/drivers/statistics/filter-options')}catch{state.driverStatsOptions={tracks:[],distanceGroups:[],ageOptions:[],handicapBuckets:[]}}}
function dInvalidate(){state.driverStatsData=null;state.driverStatsDataKey=null}
function dBindFilters(callback){document.querySelectorAll('[data-ds-filter]').forEach(select=>select.onchange=()=>{state.driverStatsFilters[select.dataset.dsFilter]=select.value;dInvalidate();callback()});const toggle=document.getElementById('driverStatsFilterToggle');if(toggle)toggle.onclick=async()=>{state.driverStatsFilterOpen=!state.driverStatsFilterOpen;if(state.driverStatsFilterOpen&&!state.driverStatsOptions)await dLoadOptions();callback()};const reset=document.getElementById('driverStatsReset');if(reset)reset.onclick=()=>{state.driverStatsFilters={...D_DEFAULTS};dInvalidate();callback()}}
function dNumValue(v,d=2){return v==null?'—':Number(v).toFixed(d).replace('.',',')}
function dCard(title,note,rows,value){return '<section class="driver-ranking-card"><div class="driver-ranking-head"><h2>'+esc(title)+'</h2><span>'+esc(note)+'</span></div>'+(rows?.length?rows.map(row=>'<button type="button" class="driver-ranking-row" data-ds-driver="'+esc(row.id)+'"><span class="driver-ranking-rank">'+num(row.rank)+'</span><span class="driver-ranking-name">'+esc(row.name)+'</span><span class="driver-ranking-value">'+value(row)+'</span></button>').join(''):'<div class="driver-ranking-empty">Inget verifierat underlag för valt urval.</div>')+'</section>'}
function dRankingGrid(data){const r=data.rankings||{},limit=data.definitions?.longshotPercentMax??5;let html='<div class="driver-ranking-grid">'+
 dCard('Högst segerprocent','Vinster / starter',r.highestWinRate,x=>pct(x.winRate)+'<span class="driver-ranking-note">'+num(x.starts)+' starter</span>')+
 dCard('Högst topp 3-procent','Placering 1–3 / resultatstarter',r.highestTop3Rate,x=>pct(x.top3Rate)+'<span class="driver-ranking-note">'+num(x.resultStarts)+' resultat</span>')+
 dCard('Flest segrar','Volymmått',r.mostWins,x=>num(x.wins)+'<span class="driver-ranking-note">'+num(x.starts)+' starter</span>')+
 dCard('Bäst form – senaste 30','Endast officiella placeringar',r.bestFormLast30,x=>dNumValue(x.averagePlacing)+'<span class="driver-ranking-note">'+num(x.usedStarts)+' starter</span>');if(data.partial)return html+'</div><div class="driver-ranking-empty driver-ranking-pending">Läser resterande statistik…</div>';return html+
 dCard('Mest inkört i år','Verifierad prissumma under kalenderåret',r.mostEarningsThisYear,x=>money(x.prizeSek)+'<span class="driver-ranking-note">'+num(x.prizeVerifiedStarts)+' prisstarter</span>')+
 dCard('Högst intjänat per start','Prispengar / verifierade prisstarter',r.highestEarningsPerStart,x=>money(x.earningsPerVerifiedStart)+'<span class="driver-ranking-note">'+num(x.prizeVerifiedStarts)+' prisstarter</span>')+
 dCard('Bäst från spets','Verifierad positionsflagga',r.bestFromLead,x=>pct(x.winRate)+'<span class="driver-ranking-note">'+num(x.starts)+' starter</span>')+
 dCard('Bäst från dödens','Verifierad positionsflagga',r.bestFromDeathSeat,x=>pct(x.winRate)+'<span class="driver-ranking-note">'+num(x.starts)+' starter</span>')+
 dCard('Bäst med bakspår','Bakre led i autostart',r.bestFromBackRow,x=>pct(x.winRate)+'<span class="driver-ranking-note">'+num(x.starts)+' starter</span>')+
 dCard('Bäst i autostart','Resultat i autostart',r.bestAuto,x=>pct(x.winRate)+'<span class="driver-ranking-note">'+num(x.starts)+' starter</span>')+
 dCard('Bäst i voltstart','Resultat i voltstart',r.bestVolt,x=>pct(x.winRate)+'<span class="driver-ranking-note">'+num(x.starts)+' starter</span>')+
 dCard('Resultat som favorit','Marknadsrank 1 vid sista giltiga snapshot före spelstopp',r.favoriteResults,x=>pct(x.winRate)+'<span class="driver-ranking-note">'+num(x.starts)+' favoritstarter</span>')+
 dCard('Resultat som skräll','≤ '+num(limit)+'% vid sista giltiga snapshot före spelstopp',r.longshotResults,x=>pct(x.winRate)+'<span class="driver-ranking-note">'+num(x.starts)+' skrällstarter</span>')+'</div>'}
function dBindRows(){document.querySelectorAll('[data-ds-driver]').forEach(row=>row.onclick=()=>openDetail('drivers',row.dataset.dsDriver))}
function dMergeRankingPayload(core,extended){return{...core,...extended,partial:false,rankings:{...(core.rankings||{}),...(extended.rankings||{})}}}
function renderDriverRankingShell(data){app.innerHTML=heading('Kuskar','Sök och utforska kuskar')+tabs([['list','Lista'],['stats','Statistik']],state.tab)+dToolbar()+dRankingGrid(data);bindTabs(()=>renderEntityList('drivers'));dBindFilters(renderDriverRankings);dBindRows()}
async function renderDriverRankings(){
 const token=++driverRankingToken;cancelRankingLifecycle();state.detail=null;state.page='drivers';setNav('drivers');const key=dQuery();const cached=state.driverStatsDataKey===key?state.driverStatsData:null;
 app.innerHTML=heading('Kuskar','Sök och utforska kuskar')+tabs([['list','Lista'],['stats','Statistik']],state.tab)+dToolbar()+(cached?dRankingGrid(cached):'<div class="driver-ranking-empty">Läser kuskstatistik…</div>');bindTabs(()=>renderEntityList('drivers'));dBindFilters(renderDriverRankings);if(cached){dBindRows();return}
 const lifecycle=beginRankingLifecycle();
 try{
  const core=await api('/drivers/statistics?'+key+'&mode=core',{signal:lifecycle.controller.signal});
  if(!isCurrentRankingLifecycle(lifecycle)||token!==driverRankingToken||state.page!=='drivers'||state.tab!=='stats'||state.detail)return;
  renderDriverRankingShell(core);
  await afterRankingCorePaint();
  if(!isCurrentRankingLifecycle(lifecycle)||token!==driverRankingToken||state.page!=='drivers'||state.tab!=='stats'||state.detail)return;
  let extended;
  try{extended=await api('/drivers/statistics?'+key+'&mode=extended',{signal:lifecycle.controller.signal})}
  catch(error){if(isRankingAbort(error))return;if(isCurrentRankingLifecycle(lifecycle)){const pending=document.querySelector('.driver-ranking-pending');if(pending)pending.textContent='Kunde inte läsa resterande statistik.'}return}
  if(!isCurrentRankingLifecycle(lifecycle)||token!==driverRankingToken||state.page!=='drivers'||state.tab!=='stats'||state.detail)return;
  const data=dMergeRankingPayload(core,extended);state.driverStatsData=data;state.driverStatsDataKey=key;renderDriverRankingShell(data);
 }catch(error){if(isRankingAbort(error))return;if(isCurrentRankingLifecycle(lifecycle)&&token===driverRankingToken&&state.page==='drivers'&&state.tab==='stats'&&!state.detail){driverRankingToken++;app.innerHTML+='<div class="driver-ranking-empty">Kunde inte läsa kuskstatistik: '+esc(error.message)+'</div>'}}
 finally{completeRankingLifecycle(lifecycle)}
}
const previousDriverEntityList=renderEntityList;
renderEntityList=async function(page){if(page==='drivers'&&state.tab==='stats')return renderDriverRankings();driverRankingToken++;cancelRankingLifecycle();return previousDriverEntityList(page)};

})();
</script>`;

export function enhanceDriverStatisticsHtml(html) {
  return html.replace('</head>', `${driverStatisticsCss}</head>`).replace('</body>', `${driverStatisticsScript}</body>`);
}
