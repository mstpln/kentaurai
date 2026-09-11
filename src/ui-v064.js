export const v064Css = `
<style id="kentaurai-v064-ui">
@media(max-width:760px){
  .top-inner{position:static!important;grid-template-columns:minmax(0,1fr) 32px!important;grid-template-areas:"brand settings" "search search"!important;align-items:center!important}
  .settings-button{position:static!important;top:auto!important;right:auto!important;grid-area:settings!important;align-self:center!important;justify-self:end!important}
}
.track-extra-filter-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;max-width:560px}
.track-choice-block{min-width:0}
.track-choice-button{width:100%;min-height:40px;border:1px solid var(--line);background:#10100f;color:var(--muted);border-radius:10px;padding:9px 11px;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;font:inherit;font-size:12px;cursor:pointer}
.track-choice-button.active{border-color:#6a5336;background:#231e17;color:var(--accent-soft)}
.track-choice-button span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.track-choice-caret{font-size:12px;flex:0 0 auto}
.track-filter-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.58);z-index:80;display:flex;align-items:flex-end;justify-content:center;padding:16px}
.track-filter-sheet{width:min(520px,100%);max-height:min(78vh,680px);overflow:auto;background:#131311;border:1px solid var(--line);border-radius:16px;padding:8px;box-shadow:0 18px 50px rgba(0,0,0,.45)}
.track-filter-sheet-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 9px 12px;border-bottom:1px solid var(--line-soft);font-size:14px;font-weight:600}
.track-filter-close{border:0;background:transparent;color:var(--muted);font-size:18px;cursor:pointer}
.track-filter-option{width:100%;border:0;border-bottom:1px solid var(--line-soft);background:transparent;color:var(--text);padding:12px 10px;display:flex;justify-content:space-between;align-items:center;text-align:left;font:inherit;font-size:13px;cursor:pointer}
.track-filter-option:last-child{border-bottom:0}.track-filter-option.selected{color:var(--accent-soft)}.track-filter-check{width:18px;text-align:center}
.settings-import-helper{margin-top:14px;padding-top:14px;border-top:1px solid var(--line-soft)}
.settings-import-helper h3{font-size:14px;font-weight:600;margin:0 0 5px}.settings-import-helper p{font-size:12px;color:var(--muted);line-height:1.55;margin:0 0 11px}.settings-copy-feedback{margin-left:8px;color:#a8bda4;font-size:11px}
.track-website-link{color:var(--accent-soft);text-decoration:none}.track-website-link:hover{text-decoration:underline}
@media(min-width:700px){.track-filter-backdrop{align-items:center}.track-filter-sheet{max-height:70vh}}
@media(max-width:520px){.track-extra-filter-row{grid-template-columns:1fr 1fr}.track-choice-button{font-size:11px;padding:8px 9px}.track-filter-backdrop{padding:0}.track-filter-sheet{width:100%;max-height:82vh;border-radius:18px 18px 0 0;border-left:0;border-right:0;border-bottom:0;padding-bottom:calc(8px + env(safe-area-inset-bottom))}}
</style>`;

export const v064Script = `
<script id="kentaurai-v064-script">
(function(){
const STL_OPTIONS=[
  ['all','Alla STL-klasser'],['class_iii','Klass III'],['class_ii','Klass II'],['class_i','Klass I'],
  ['bronze','Bronsdivisionen'],['silver','Silverdivisionen'],['gold','Gulddivisionen'],
  ['mares','Stodivisionen'],['diamond_mares','Diamantstoet'],['cold_blood','Kallblodsdivisionen']
];
const RACE_TYPE_OPTIONS=[
  ['all','Alla lopptyper'],['mares','Stolopp'],['cold_blood','Kallblodslopp'],['lane_ladder','Spårtrappa'],
  ['apprentice','Lärlingslopp'],['amateur','Amatörlopp'],['monte','Montélopp'],['young_horse','Unghästlopp'],
  ['age_group','Årgångslopp'],['stayer','Stayerlopp / långlopp'],['sprint','Snabblopp'],
  ['advantage','Fördelslopp / Fördel ston'],['p21','P21-lopp'],['grassroots','Breddlopp'],['double_class','Dubbelklasslopp']
];
const COUNTRY_LABELS={SE:'Sverige',NO:'Norge',DK:'Danmark',FI:'Finland',DE:'Tyskland',FR:'Frankrike',IT:'Italien',NL:'Nederländerna',BE:'Belgien',AT:'Österrike',CH:'Schweiz'};
const FIELD_LABELS={
  actualDistanceM:'Faktisk distans',extraDistanceM:'Extra distans',convertedKmTime:'Omräknad km-tid',
  first200Time:'Första 200',last200Time:'Sista 200',last400Time:'Sista 400',last500Time:'Sista 500',last800Time:'Sista 800',last1000Time:'Sista 1000',
  leader:'Spets',pocket:'Rygg ledaren',deathSeat:'Dödens',secondOver:'2:a utvändigt',thirdOver:'3:e utvändigt',wideTrip:'Brett spår',uncoveredMove:'Attack utan rygg',trafficEvent:'Loppincident',
  summary:'Sammanfattning',analysis:'Analys',conclusion:'Slutsats',scenarios:'Scenarier',scenario:'Scenario',raceShapeSummary:'Loppbild',
  dataQuality:'Datakvalitet',qualityStatus:'Kvalitet',marketBlind:'Marknadsblind',scenarioRobustness:'Scenariorobusthet',
  winProbability:'Vinstsannolikhet',uncertaintyLow:'Osäkerhet låg',uncertaintyHigh:'Osäkerhet hög',rawRank:'Rankning',abcdGroup:'ABCD',valueRatio:'Värdekvot',marketPercent:'Marknadsandel',marketRank:'Marknadsrankning',
  factOrOpinion:'Fakta / bedömning',signalType:'Signaltyp',valueText:'Värde',confidence:'Säkerhet',strength:'Styrka',polarity:'Riktning',evidence:'Underlag',evidenceExcerpt:'Underlag',
  observedAt:'Observerat',capturedAt:'Infångat',publishedAt:'Publicerat',sourceName:'Källa',raceEntryId:'Start-ID',raceId:'Lopp-ID',
  startNumber:'Startnummer',actualLane:'Spår',startTier:'Startfålla',handicapM:'Tillägg',actualStartDistanceM:'Faktisk startdistans',
  shoesFront:'Skor fram',shoesRear:'Skor bak',barefootFront:'Barfota fram',barefootRear:'Barfota bak',sulkyType:'Vagn',headgear:'Huvudlag',earplugs:'Öronproppar',otherEquipment:'Övrig utrustning',
  positionEvents:'Positionshändelser',events:'Händelser',type:'Typ',value:'Värde',note:'Notering',notes:'Noteringar',reasoning:'Motivering'
};
const FIELD_LABELS_NORMALIZED=Object.fromEntries(Object.entries(FIELD_LABELS).map(([key,value])=>[key.replaceAll('_','').toLowerCase(),value]));
const VALUE_LABELS={
  pre_market:'Förhandsanalys',final:'Slutanalys',normalized_verified_subset:'Verifierad delmängd',captured_unmapped:'Infångad, ej normaliserad',unknown:'Okänd',
  spike_miss:'Missad spik',coverage_miss:'Vinnaren saknades på systemet',auto:'Autostart',autostart:'Autostart',volte:'Voltstart',voltstart:'Voltstart'
};
const EXACT_TEXT={
  Learnings:'Lärdomar','Omgångens learnings':'Omgångens lärdomar','Vår rank':'Vår rankning',Marknadsrank:'Marknadsrankning',Miss:'Fel',
  'X-Labs segment':'X-Labs-segment',Klass:'Loppklass','Editorial signals':'Redaktionella signaler','Fakta / opinion':'Fakta / bedömning',Confidence:'Säkerhet',
  spike_miss:'Missad spik',coverage_miss:'Vinnaren saknades på systemet',pre_market:'Förhandsanalys',final:'Slutanalys',
  normalized_verified_subset:'Verifierad delmängd',captured_unmapped:'Infångad, ej normaliserad',unknown:'Okänd',Auto:'Autostart',auto:'Autostart'
};
state.trackClassFilters=state.trackClassFilters||{};

function localValue(value){if(value===null||value===undefined)return value;const raw=String(value);return VALUE_LABELS[raw.trim().toLowerCase()]||raw}
function humanKey(key){
  if(FIELD_LABELS[key])return FIELD_LABELS[key];
  const normalized=String(key).replaceAll('_','').toLowerCase();if(FIELD_LABELS_NORMALIZED[normalized])return FIELD_LABELS_NORMALIZED[normalized];
  const text=String(key).replaceAll('_',' ').replace(/([a-z0-9])([A-Z])/g,'$1 $2').trim();
  return text?text.charAt(0).toLocaleUpperCase('sv-SE')+text.slice(1):key;
}
function localizedObject(value){if(Array.isArray(value))return value.map(localizedObject);if(value&&typeof value==='object'){const out={};for(const [key,item] of Object.entries(value))out[humanKey(key)]=localizedObject(item);return out}return localValue(value)}
function localizeJsonBlocks(root=document){root.querySelectorAll('.json-block').forEach(pre=>{if(pre.dataset.svDone)return;try{const parsed=JSON.parse(pre.textContent);pre.dataset.svDone='1';pre.textContent=JSON.stringify(localizedObject(parsed),null,2)}catch{}})}
function localizeCountryText(text){return String(text).split(' · ').map(part=>COUNTRY_LABELS[part.trim()]||part).join(' · ')}
function replaceText(root=document){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  for(const node of nodes){
    if(node.parentElement?.closest('script,style,.json-block'))continue;
    let text=node.nodeValue;const trimmed=text.trim();if(EXACT_TEXT[trimmed])text=text.replace(trimmed,EXACT_TEXT[trimmed]);
    text=text.replace(/\bOmgångens learnings\b/g,'Omgångens lärdomar').replace(/\blearnings\b/gi,'lärdomar').replace(/\brank\s+(\d+)\b/gi,'rankning $1').replace(/ · rank /g,' · rankning ');
    node.nodeValue=text;
  }
  root.querySelectorAll('.detail-meta').forEach(el=>{if(el.childElementCount===0){const localized=localizeCountryText(el.textContent);if(localized!==el.textContent)el.textContent=localized}});
  root.querySelectorAll('.data-value,.history-value,.fact-value').forEach(el=>{if(el.childElementCount===0){const text=el.textContent.trim();const localized=COUNTRY_LABELS[text]||EXACT_TEXT[text]||localValue(text);if(localized!==text)el.textContent=localized}});
  localizeJsonBlocks(root);
}

function getTrackFilterState(){const id=String(state.trackDetail||'');if(!state.trackClassFilters[id])state.trackClassFilters[id]={stlClass:'all',raceType:'all'};return state.trackClassFilters[id]}
function optionLabel(options,value){return (options.find(([key])=>key===value)||options[0])[1]}
function closeSheet(){document.getElementById('trackFilterBackdrop')?.remove()}
function openSheet(kind){
  closeSheet();const current=getTrackFilterState();const options=kind==='stl'?STL_OPTIONS:RACE_TYPE_OPTIONS;const selected=kind==='stl'?current.stlClass:current.raceType;const title=kind==='stl'?'STL-klass':'Lopptyp';
  const wrap=document.createElement('div');wrap.id='trackFilterBackdrop';wrap.className='track-filter-backdrop';
  wrap.innerHTML='<div class="track-filter-sheet" role="dialog" aria-modal="true" aria-label="'+title+'"><div class="track-filter-sheet-head"><span>'+title+'</span><button class="track-filter-close" type="button" aria-label="Stäng">×</button></div>'+options.map(([key,label])=>'<button type="button" class="track-filter-option '+(key===selected?'selected':'')+'" data-filter-value="'+key+'"><span>'+label+'</span><span class="track-filter-check">'+(key===selected?'✓':'')+'</span></button>').join('')+'</div>';
  document.body.append(wrap);wrap.querySelector('.track-filter-close').onclick=closeSheet;wrap.addEventListener('click',event=>{if(event.target===wrap)closeSheet()});
  wrap.querySelectorAll('[data-filter-value]').forEach(button=>button.onclick=()=>{if(kind==='stl')current.stlClass=button.dataset.filterValue;else current.raceType=button.dataset.filterValue;closeSheet();ensureTrackExtraFilters(true)});
}
function laneStatsMarkup(data){
  if(!data.rows?.length)return empty('Ingen statistik för valt filter','Det finns ännu inga lagrade starter för den valda kombinationen.');
  return '<div class="card"><table class="track-lane-table"><thead><tr><th>Spår</th><th>Starter</th><th>Vinst %</th><th>Topp 3 %</th><th>Galopp %</th></tr></thead><tbody>'+data.rows.map(row=>'<tr><td>'+num(row.lane)+'</td><td>'+num(row.starts)+'</td><td>'+pct(row.winRate)+'</td><td>'+pct(row.top3Rate)+'</td><td>'+pct(row.gallopRate)+'</td></tr>').join('')+'</tbody></table></div><div class="track-data-note">'+num(data.totals.resultStarts)+' resultatsatta starter ligger bakom procentsatserna för den valda kombinationen.</div>';
}
async function refreshFilteredTrackStats(){
  const id=String(state.trackDetail||'');if(!id||state.trackTab!=='lanes')return;const base=state.trackFilters?.[id];if(!base)return;
  const extra=getTrackFilterState();const target=document.getElementById('trackLaneStats');if(!target)return;target.innerHTML='<div class="card stat-filter-loading">Läser spårstatistik…</div>';
  const query=new URLSearchParams({year:base.year||'all',start_method:base.startMethod||'auto',distance_group:base.distanceGroup||'2140',stl_class:extra.stlClass||'all',race_type:extra.raceType||'all'});
  try{const data=await api('/tracks/'+encodeURIComponent(id)+'/lane-stats?'+query.toString());if(state.trackDetail!==id||state.trackTab!=='lanes')return;target.innerHTML=laneStatsMarkup(data)}catch(error){target.innerHTML='<div class="notice">Kunde inte läsa spårstatistik: '+esc(error.message)+'</div>'}
}
function renderTrackExtraFilterRow(row,extra){
  row.dataset.filterSignature=extra.stlClass+'|'+extra.raceType;
  row.innerHTML='<div class="track-choice-block"><div class="filter-label">STL-klass</div><button type="button" class="track-choice-button '+(extra.stlClass!=='all'?'active':'')+'" data-track-choice="stl"><span>'+optionLabel(STL_OPTIONS,extra.stlClass)+'</span><span class="track-choice-caret">⌄</span></button></div><div class="track-choice-block"><div class="filter-label">Lopptyp</div><button type="button" class="track-choice-button '+(extra.raceType!=='all'?'active':'')+'" data-track-choice="race"><span>'+optionLabel(RACE_TYPE_OPTIONS,extra.raceType)+'</span><span class="track-choice-caret">⌄</span></button></div>';
  row.querySelector('[data-track-choice="stl"]').onclick=()=>openSheet('stl');row.querySelector('[data-track-choice="race"]').onclick=()=>openSheet('race');
}
function ensureTrackExtraFilters(refresh=false){
  const stack=document.querySelector('.track-filter-stack');if(!stack||state.trackTab!=='lanes')return;let row=stack.querySelector('.track-extra-filter-row');const created=!row;const extra=getTrackFilterState();
  if(!row){row=document.createElement('div');row.className='track-extra-filter-row';stack.append(row)}
  const signature=extra.stlClass+'|'+extra.raceType;if(row.dataset.filterSignature!==signature)renderTrackExtraFilterRow(row,extra);
  if(refresh||(created&&(extra.stlClass!=='all'||extra.raceType!=='all')))queueMicrotask(refreshFilteredTrackStats);
}

function enhanceTrackOverview(){
  if(state.page!=='tracks'||!state.trackDetail||state.trackTab!=='overview')return;const host=document.getElementById('trackTabBody');if(!host||host.dataset.v064TrackMeta)return;host.dataset.v064TrackMeta='1';
  api('/tracks/'+encodeURIComponent(state.trackDetail)).then(detail=>{
    if(!host.isConnected)return;const profile=[...host.querySelectorAll('.data-section')].find(section=>section.querySelector('h2')?.textContent.trim()==='Banprofil');if(!profile)return;const grid=profile.querySelector('.data-grid');if(!grid)return;
    const address=[detail.address?.street,[detail.address?.postalCode,detail.address?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if(address){const wrap=document.createElement('div');wrap.innerHTML=dataItem('Adress',address);grid.append(...wrap.childNodes)}
    if(detail.websiteUrl){const item=document.createElement('div');item.className='data-item';item.innerHTML='<div class="data-label">Hemsida</div><div class="data-value"><a class="track-website-link" href="'+esc(detail.websiteUrl)+'" target="_blank" rel="noopener noreferrer">Öppna hemsida ↗</a></div>';grid.append(item)}
  }).catch(()=>{});
}

function enhanceSettingsImport(){
  if(!state.settingsOpen||state.settingsTab!=='ai')return;const card=[...document.querySelectorAll('.settings-card')].find(item=>item.querySelector('h2')?.textContent.trim()==='Importera AI-analys');if(!card||card.querySelector('.settings-import-helper'))return;
  card.querySelector('.settings-help')?.remove();card.querySelector('.settings-code')?.remove();const helper=document.createElement('div');helper.className='settings-import-helper';
  helper.innerHTML='<h3>Skapa V85/V86-systemanalysfil för import</h3><p>Kopiera instruktionerna och klistra in dem i samma ChatGPT- eller Claude-konversation där analysen och systemet skapades. AI:n skapar då en JSON-fil som är färdig att importera i KentaurAI.</p><button type="button" class="settings-secondary" id="copyAnalysisInstructions">Kopiera instruktioner till AI</button><span class="settings-copy-feedback" id="copyAnalysisFeedback" aria-live="polite"></span>';
  card.querySelector('.settings-card-body')?.append(helper);helper.querySelector('#copyAnalysisInstructions').onclick=async()=>{
    const button=helper.querySelector('#copyAnalysisInstructions'),feedback=helper.querySelector('#copyAnalysisFeedback');try{button.disabled=true;const payload=await api('/settings/analysis-import-instructions');await navigator.clipboard.writeText(payload.prompt);feedback.textContent='✓ Kopierat';setTimeout(()=>{if(feedback.isConnected)feedback.textContent=''},2200)}catch{feedback.textContent='Kunde inte kopiera'}finally{button.disabled=false}
  };
}
function fixSettingsCount(){document.querySelectorAll('.settings-count span').forEach(node=>{if(node.textContent.trim()==='Spel')node.textContent='V85/V86-omgångar'})}

let queued=false;
function polish(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;replaceText(document);fixSettingsCount();enhanceSettingsImport();ensureTrackExtraFilters(false);enhanceTrackOverview()})}
const observer=new MutationObserver(polish);observer.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});polish();
})();
</script>`;
