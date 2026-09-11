import {
  renderAppPage as renderFeedbackAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-feedback.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

const statsFilterCss = `
<style id="kentaurai-stat-filters">
.entity-stat-filter-shell{margin-top:18px}
.stat-period-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px}
.stat-filter-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:650;margin-right:2px}
.stat-pills{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.stat-pill{border:1px solid var(--line);background:#11110f;color:#9f988f;border-radius:999px;padding:6px 10px;font-size:11px;line-height:1;cursor:pointer;white-space:nowrap}
.stat-pill:hover{border-color:#5c5142;color:var(--text)}
.stat-pill.active{border-color:var(--accent);background:#1b1711;color:var(--accent-soft)}
.stat-filter-card{overflow:hidden}
.stat-filter-card-head{min-height:62px;padding:14px 16px;border-bottom:1px solid var(--line-soft);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.stat-filter-card-head h2{font-size:16px;font-weight:650;margin:0}
.stat-filter-card-head .stat-pills{justify-content:flex-end}
.stat-table-scroll{overflow-x:auto}
.stat-filter-table{width:100%;border-collapse:collapse}
.stat-filter-table th,.stat-filter-table td{padding:11px 13px;text-align:left;border-bottom:1px solid var(--line-soft);white-space:nowrap}
.stat-filter-table tr:last-child td{border-bottom:0}
.stat-filter-table th{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:650}
.stat-filter-table td{font-size:12px}
.stat-filter-table td:first-child{font-weight:550;color:var(--text)}
.stat-table-empty{padding:18px 16px;color:var(--muted);font-size:12px}
.stat-filter-loading{padding:18px;color:var(--muted);font-size:12px}
@media(max-width:1200px){.breakdown-grid.entity-filter-grid{grid-template-columns:1fr}.stat-filter-card-head{min-height:auto}}
@media(max-width:620px){.stat-period-bar{display:block}.stat-filter-label{display:block;margin:0 0 8px}.stat-pills{flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.stat-pills::-webkit-scrollbar{display:none}.stat-filter-card-head{display:block}.stat-filter-card-head .stat-pills{margin-top:10px;justify-content:flex-start}.stat-filter-table th,.stat-filter-table td{padding:10px 9px}.stat-filter-table th{font-size:8px}.stat-filter-table td{font-size:11px}}
</style>`;

const statsFilterScript = `
<script id="kentaurai-stat-filter-script">
(function(){
const priorLocalStartMethod=localStartMethod;
localStartMethod=function(value){
  const normalized=String(value||'').trim().toLowerCase();
  if(['auto','autostart'].includes(normalized))return 'Autostart';
  if(['volt','volte','voltstart'].includes(normalized))return 'Voltstart';
  return priorLocalStartMethod(value);
};

const entityStatState=new Map();
let statRequestToken=0;
function entityStatKey(){return state.detail?state.detail.page+':'+state.detail.id:null}
function filtersForCurrentEntity(){
  const key=entityStatKey();
  if(!key)return {year:'all',raceScope:'all',distanceMethod:'all',trackMethod:'all'};
  if(!entityStatState.has(key))entityStatState.set(key,{year:'all',raceScope:'all',distanceMethod:'all',trackMethod:'all'});
  return entityStatState.get(key);
}
function currentYears(){const year=new Date().getFullYear();return [year,year-1]}
function periodOptions(){const [current,previous]=currentYears();return [['all','All data'],[String(current),current+' (i år)'],[String(previous),previous+' (förra året)']]}
function raceScopeOptions(){return [['all','All data'],['high_prize','Högre prissumma'],['weekday','Vardagstrav']]}
function methodOptions(){return [['all','All data'],['auto','Auto'],['volt','Voltstart']]}
function pills(options,active,attribute){return '<div class="stat-pills">'+options.map(([value,label])=>'<button type="button" class="stat-pill '+(String(active)===String(value)?'active':'')+'" '+attribute+'="'+esc(value)+'">'+esc(label)+'</button>').join('')+'</div>'}
function globalFilters(filters){return '<div data-global-stat-filters="true"><div class="stat-period-bar"><span class="stat-filter-label">Period</span>'+pills(periodOptions(),filters.year,'data-stat-year')+'</div><div class="stat-period-bar"><span class="stat-filter-label">Loppnivå</span>'+pills(raceScopeOptions(),filters.raceScope,'data-race-scope')+'</div></div>'}
function summaryStats(detail){
  const s=detail.stats||{};
  const gallopRate=s.resultStarts?Number(s.gallops||0)/Number(s.resultStarts):null;
  return dataSection('Resultat',[['Starter med resultat',s.resultStarts],['Vinster',s.wins],['Andraplatser',s.seconds],['Tredjeplatser',s.thirds],['Topp 3',s.top3],['Vinstprocent',pct(s.winRate)],['Topp 3-procent',pct(s.top3Rate)],['Prispengar',money(s.prizeSek)]])+dataSection('Galopp & diskvalifikation',[['Galopper',s.gallops],['Galopp %',pct(gallopRate)],['Diskvalifikationer',s.disqualifications]]);
}
statsView=function(detail){
  const filters=filtersForCurrentEntity();
  return '<div class="data-groups">'+summaryStats(detail)+'<div class="entity-stat-filter-shell">'+globalFilters(filters)+'<div id="entityStatTables" class="breakdown-grid entity-filter-grid"><div class="card stat-filter-loading">Läser statistik…</div></div></div></div>';
};
function formatRate(value){return value==null?'—':pct(value)}
function formatLabel(kind,label){
  if(kind==='method')return localStartMethod(label);
  if(kind==='distance')return label==='unknown'?'Okänd':label+' m';
  return label||'Okänd bana';
}
function statTable(title,kind,rows,methodValue){
  const toggles=(kind==='distance'||kind==='track')?pills(methodOptions(),methodValue,kind==='distance'?'data-distance-method':'data-track-method'):'';
  const body=(rows||[]).length?(rows||[]).map(row=>'<tr><td>'+esc(formatLabel(kind,row.label))+'</td><td>'+num(row.starts)+'</td><td>'+num(row.wins)+'</td><td>'+esc(formatRate(row.winRate))+'</td><td>'+esc(formatRate(row.top3Rate))+'</td><td>'+esc(formatRate(row.gallopRate))+'</td></tr>').join(''):'';
  return '<div class="card stat-filter-card"><div class="stat-filter-card-head"><h2>'+esc(title)+'</h2>'+toggles+'</div>'+(body?'<div class="stat-table-scroll"><table class="stat-filter-table"><thead><tr><th>Grupp</th><th>Starter</th><th>Vinster</th><th>Vinst %</th><th>Topp 3 %</th><th>Galopp %</th></tr></thead><tbody>'+body+'</tbody></table></div>':'<div class="stat-table-empty">Ingen statistik för valt filter.</div>')+'</div>';
}
function bindFilterButtons(){
  const filters=filtersForCurrentEntity();
  document.querySelectorAll('[data-stat-year]').forEach(button=>button.onclick=()=>{filters.year=button.dataset.statYear;renderStatFilters()});
  document.querySelectorAll('[data-race-scope]').forEach(button=>button.onclick=()=>{filters.raceScope=button.dataset.raceScope;renderStatFilters()});
  document.querySelectorAll('[data-distance-method]').forEach(button=>button.onclick=()=>{filters.distanceMethod=button.dataset.distanceMethod;renderStatFilters()});
  document.querySelectorAll('[data-track-method]').forEach(button=>button.onclick=()=>{filters.trackMethod=button.dataset.trackMethod;renderStatFilters()});
}
async function renderStatFilters(){
  if(state.tab!=='stats'||!state.detail)return;
  const key=entityStatKey();
  const filters=filtersForCurrentEntity();
  const global=document.querySelector('[data-global-stat-filters]');
  if(global)global.innerHTML=globalFilters(filters).replace(/^<div data-global-stat-filters="true">|<\/div>$/g,'');
  const target=document.getElementById('entityStatTables');
  if(!target)return;
  target.innerHTML='<div class="card stat-filter-loading">Läser statistik…</div>';
  bindFilterButtons();
  const token=++statRequestToken;
  try{
    const query=new URLSearchParams({year:filters.year,race_scope:filters.raceScope,distance_start_method:filters.distanceMethod,track_start_method:filters.trackMethod});
    const data=await api('/entities/'+encodeURIComponent(state.detail.page)+'/'+encodeURIComponent(state.detail.id)+'/stat-breakdowns?'+query.toString());
    if(token!==statRequestToken||key!==entityStatKey()||state.tab!=='stats')return;
    const groupedDistances=groupDistanceRows(data.distances||[]);
    target.innerHTML=statTable('Startmetod','method',data.startMethods||[],'all')+statTable('Distans','distance',groupedDistances,filters.distanceMethod)+statTable('Bana','track',data.tracks||[],filters.trackMethod);
    bindFilterButtons();
  }catch(err){
    if(token!==statRequestToken||key!==entityStatKey())return;
    target.innerHTML='<div class="notice">Kunde inte läsa filtrerad statistik: '+esc(err.message)+'</div>';
    bindFilterButtons();
  }
}
const priorRenderDetail=renderDetail;
renderDetail=async function(){
  await priorRenderDetail();
  if(state.tab==='stats'&&state.detail){bindFilterButtons();await renderStatFilters()}
};
})();
</script>`;

export function renderAppPage() {
  return renderFeedbackAppPage()
    .replace('</head>', `${statsFilterCss}</head>`)
    .replace('</body>', `${statsFilterScript}</body>`);
}
