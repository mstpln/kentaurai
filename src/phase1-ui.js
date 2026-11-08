import { phase1Css } from './phase1-style.js';
import {
  PHASE1_DEMO_HORSE_NOTES,
  createPhase1DemoHistoricalRound,
  createPhase1DemoRounds,
  createPhase1DemoSystems
} from './phase1-fixtures.js';
import {
  calculateSystem,
  displayStartResult,
  PHASE1_LINE_PRICES,
  formatSwedishMoney,
  formatSwedishNumber,
  resultNet,
  resultFormSegments,
  selectionResult,
  summarizeSystems
} from './phase1-model.js';
import { phase1ApiBrowserSource } from './phase1-data.js';

const phase1ModelBrowserSource = `
const PHASE1_LINE_PRICES=${JSON.stringify(PHASE1_LINE_PRICES)};
${Object.entries({
  calculateSystem, displayStartResult, formatSwedishNumber, formatSwedishMoney, resultNet,
  summarizeSystems, selectionResult, resultFormSegments
}).map(([name, implementation]) => `const ${name}=(${implementation.toString()});`).join('\n')}`;

function phase1ClientScript(asOfDate) {
  // Workers can freeze the module-initialization clock. Generate relative dates
  // while handling the page request, never at module evaluation time.
  const rounds = createPhase1DemoRounds(asOfDate);
  return `
<script id="kentaurai-phase1-script">
(function(){
if(window.__kentauraiPhase1)return;
window.__kentauraiPhase1={version:1};
${phase1ApiBrowserSource}
${phase1ModelBrowserSource}
const appEl=document.getElementById('app');
const demoRounds=${JSON.stringify(rounds)};
const demoHistoricalRound=${JSON.stringify(createPhase1DemoHistoricalRound(asOfDate))};
const demoSystems=${JSON.stringify(createPhase1DemoSystems(rounds, asOfDate))};
const demoNotes=${JSON.stringify(PHASE1_DEMO_HORSE_NOTES)};
const storageKey='kentaurai.phase1.local.v1';
const demoFlagKey='kentaurai.phase1.demo-visible.v1';
const esc1=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num1=value=>formatSwedishNumber(value);
const money1=value=>value==null?'–':formatSwedishMoney(value,{currency:true});
const pct1=value=>value==null?'–':new Intl.NumberFormat('sv-SE',{style:'percent',maximumFractionDigits:1}).format(Number(value));
const date1=value=>{if(!value)return '–';const d=new Date(String(value).length===10?value+'T12:00:00Z':value);return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('sv-SE',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Stockholm'}).format(d)};
const time1=value=>{if(!value)return '–';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('sv-SE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Stockholm'}).format(d)};
const method1=value=>{const key=String(value||'').toLowerCase();if(['auto','autostart'].includes(key))return 'Auto';if(['volt','voltstart','volte'].includes(key))return 'Volt';if(key==='monte'||key==='monté')return 'Monté';return value||'–'};
const pace1=value=>{if(value==null||value==='')return '–';const text=String(value).trim();const match=text.match(/^(?:1[.:])?(\\d{2})[,.](\\d)$/);return match?'1.'+match[1]+','+match[2]:text};
const storedRead=()=>{try{const raw=localStorage.getItem(storageKey);if(!raw)return{ok:true,value:{version:1,notes:[],systems:[]}};const value=JSON.parse(raw);if(value?.version!==1||!Array.isArray(value.notes)||!Array.isArray(value.systems))throw new Error('Lokal lagring har ett okänt format. Inga data har ändrats.');return{ok:true,value}}catch(error){return{ok:false,value:{version:1,notes:[],systems:[]},error:error?.message||'Kunde inte läsa lokal lagring.'}}};
let storeResult=storedRead();
let localData=storeResult.value;
let storageError=storeResult.ok?'':storeResult.error;
const storageReadBlocked=!storeResult.ok;
let demoVisible=(()=>{try{return localStorage.getItem(demoFlagKey)==='1'}catch{return false}})();
let currentRoute='trend',spelView='upcoming',roundFilter='all',activeRound=null,activeLeg=1,roundToken=0,upcomingRequestToken=0,formLoadIssue='';
let upcomingItems=[],historyRounds=[],builderType='V85',builderRoundId='',builderRound=null,builderLegs=Array.from({length:8},()=>[]);
let builderName='',builderDemo=false,expandedSystems=new Set(),expandedHorses=new Set();
let profiles=new Map(),facts=new Map(),formScores=new Map(),activeNoteDraft=null,deleteTarget=null,groupFilter='all';
let builderRoundsCache={};
function persist(next){if(storageReadBlocked){renderStorageNotice();return false}const result=(()=>{try{localStorage.setItem(storageKey,JSON.stringify(next));return{ok:true}}catch(error){return{ok:false,error:error?.message||'Kunde inte spara lokalt.'}}})();if(!result.ok){storageError=result.error;renderStorageNotice();return false}localData=next;storageError='';renderStorageNotice();return true}
function renderStorageNotice(){const host=document.getElementById('p1-storage-status');if(host)host.replaceChildren();let alert=document.getElementById('p1-global-storage-status');if(storageError){if(!alert){alert=document.createElement('div');alert.id='p1-global-storage-status';alert.className='p1-notice p1-error';alert.setAttribute('role','alert');appEl.before(alert)}alert.textContent='Lokal lagring kunde inte användas: '+storageError+(storageReadBlocked?' Befintliga data lämnas orörda; lokal sparning är blockerad.':'')}else alert?.remove()}
function saveDemoVisibility(value){demoVisible=Boolean(value);try{localStorage.setItem(demoFlagKey,demoVisible?'1':'0')}catch{}}
function setNav1(page){const navPage=page==='upcoming'||page==='systems'||page==='builder'?'spel':page==='start'?'trend':page;document.querySelectorAll('.nav-item[data-p1-nav]').forEach(button=>{const active=button.dataset.p1Nav===navPage;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')})}
function spelSwitcher(selected){return '<div class="p1-spel-switcher" role="group" aria-label="Spelvy">'+[['upcoming','Kommande'],['builder','Registrera system'],['systems','Mina system']].map(([view,label])=>'<button type="button" class="p1-filter '+(selected===view?'active':'')+'" data-p1-spel-view="'+view+'" aria-pressed="'+(selected===view)+'">'+label+'</button>').join('')+'</div>'}
function pageHead(title,subtitle,action=''){return '<div class="p1-page-head"><div><div class="p1-kicker">KentaurAI</div><h1>'+esc1(title)+'</h1><p>'+esc1(subtitle)+'</p></div>'+action+'</div>'}
function statusText1(status){return({success:'Aktiv',completed:'Slutförd',healthy:'Aktiv',ok:'Aktiv',error:'Fel',error_retrying:'Fel · försöker igen',action_required:'Åtgärd krävs',warning:'Varning',running:'Pågår',paused:'Pausad'})[String(status||'').toLowerCase()]||'Okänd'}
function button(label,action,extra=''){return '<button type="button" class="p1-button '+extra+'" data-p1-action="'+action+'">'+label+'</button>'}
function sourceTag(source){return source==='synthetic'?'<span class="p1-chip demo">Syntetiskt exempel</span>':''}
function isSettledResult(system){const known=value=>value!=null&&!(typeof value==='string'&&(!value.trim()||value.trim().toLowerCase()==='unknown'))&&Number.isFinite(Number(value));return system?.settlementState==='settled'&&known(system.payoutSek)&&known(system.stakeSek)}
function errorBox(message,retry){return '<div class="p1-notice p1-error" role="alert">'+esc1(message)+' '+(retry?button('Försök igen',retry):'')+'</div>'}
function showPage(page){if(typeof cancelEntityListLifecycle==='function')cancelEntityListLifecycle();if(typeof cancelRankingLifecycle==='function')cancelRankingLifecycle();activeRound=null;roundToken++;state.settingsOpen=page==='settings';state.gameDetail=null;state.gameSystemId=null;state.detail=null;state.trackDetail=null;document.getElementById('settingsButton')?.classList.toggle('active',page==='settings');if(page==='settings'){currentRoute='settings';state.settingsTab='data';state.page='analysis';setNav1('');renderSettings()}else if(page==='statistics'){currentRoute='statistics';state.page=['horses','drivers','trainers','tracks'].includes(state.statisticsPage)?state.statisticsPage:'horses';setNav1('statistics');renderStatistics()}else if(page==='trend'){currentRoute='trend';state.settingsOpen=false;state.page='start';setNav1('trend');if(typeof renderStart==='function')renderStart()}else{spelView='upcoming';currentRoute='upcoming';state.settingsOpen=false;state.page='games';setNav1('spel');renderUpcoming()}}
function installNav(){
 const inner=document.querySelector('.bottom-inner');if(!inner)return;
 const iconFor=(page,fallback)=>inner.querySelector('.nav-item[data-page="'+page+'"] .nav-icon')?.outerHTML||fallback;
 const trendIcon=iconFor('start','<svg class="nav-icon" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0V156.69l50.34-50.35a8,8,0,0,1,11.32,0L128,132.69,180.69,80H160a8,8,0,0,1,0-16h40a8,8,0,0,1,8,8v40a8,8,0,0,1-16,0V91.31l-58.34,58.35a8,8,0,0,1-11.32,0L96,123.31l-56,56V200H224A8,8,0,0,1,232,208Z"/></svg>');
 const tableIcon=iconFor('statistics','<svg class="nav-icon" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM40,112H80v32H40Zm56,0H216v32H96ZM216,64V96H40V64ZM40,160H80v32H40Zm176,32H96V160H216v32Z"/></svg>');
 const gamesIcon=iconFor('games','<svg class="nav-icon" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm40-68a28,28,0,0,1-28,28h-4v8a8,8,0,0,1-16,0v-8H104a8,8,0,0,1,0-16h36a12,12,0,0,0,0-24H116a28,28,0,0,1,0-56h4V72a8,8,0,0,1,16,0v8h16a8,8,0,0,1,0,16H116a12,12,0,0,0,0,24h24A28,28,0,0,1,168,148Z"/></svg>');
 inner.innerHTML='<button type="button" class="nav-item" data-page="start" data-p1-nav="trend">'+trendIcon+'Trend</button><button type="button" class="nav-item" data-page="statistics" data-p1-nav="statistics">'+tableIcon+'Statistik</button><button type="button" class="nav-item" data-page="games" data-p1-nav="spel">'+gamesIcon+'Spel</button>';
 const settingsButton=document.getElementById('settingsButton');if(settingsButton)settingsButton.onclick=()=>showPage('settings');
}
async function renderUpcoming(){
 const requestToken=++upcomingRequestToken;
 currentRoute='upcoming';spelView='upcoming';setNav1('spel');appEl.innerHTML=pageHead('Kommande omgångar','V85 och V86')+spelSwitcher('upcoming')+'<div id="p1-storage-status"></div><div class="p1-filterbar" id="p1-round-filter">'+['all','V85','V86'].map(type=>'<button class="p1-filter '+(roundFilter===type?'active':'')+'" data-p1-filter="'+type+'">'+(type==='all'?'Alla':type)+'</button>').join('')+'</div><div id="p1-upcoming-host"><div class="p1-loading-line"></div></div>';
 renderStorageNotice();
 appEl.querySelectorAll('[data-p1-filter]').forEach(b=>b.onclick=()=>{roundFilter=b.dataset.p1Filter;renderUpcoming()});
 try{const data=await phase1Api.upcomingRounds(roundFilter==='all'?'':roundFilter);if(requestToken!==upcomingRequestToken||currentRoute!=='upcoming')return;upcomingItems=(data.items||[]).map(item=>({...item,gameType:item.gameType||item.game_type,roundDate:item.roundDate||item.round_date,trackNames:item.trackNames||item.track_names,source:'live'}));renderUpcomingList()}
 catch(error){if(requestToken!==upcomingRequestToken||currentRoute!=='upcoming')return;const host=document.getElementById('p1-upcoming-host');if(!host)return;host.innerHTML=errorBox('Kunde inte läsa verifierade kommande omgångar: '+error.message,'retry-upcoming')+'<div class="p1-section">'+button(demoVisible?'Dölj syntetiska exempel':'Visa syntetiska exempel','toggle-upcoming-demo')+'</div>'+(demoVisible?demoRoundCards():'');bindRoundCards(host)}
}
function renderUpcomingList(){
 const host=document.getElementById('p1-upcoming-host');if(!host)return;
 const items=upcomingItems.filter(item=>roundFilter==='all'||item.gameType===roundFilter);
  if(!items.length){host.innerHTML='<div class="p1-card p1-empty"><strong>Inga kommande omgångar</strong>Det finns inga verifierade '+(roundFilter==='all'?'V85/V86':roundFilter)+'-omgångar i den lokala databasen.</div><div class="p1-section">'+button(demoVisible?'Dölj syntetiska exempel':'Visa syntetiska exempel','toggle-upcoming-demo')+'</div>'+(demoVisible?demoRoundCards():'' );bindRoundCards(host);return}
  const grouped=new Map();items.forEach(item=>{const key=item.roundDate||'unknown';if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(item)});
  host.innerHTML=[...grouped.entries()].map(([date,group])=>'<section class="p1-section"><div class="p1-small" style="margin:0 0 6px 2px">'+esc1(date1(date))+'</div><div class="p1-round-list">'+group.map(roundCard).join('')+'</div></section>').join('')+'<div class="p1-section">'+button(demoVisible?'Dölj syntetiska exempel':'Visa syntetiska exempel','toggle-upcoming-demo')+'</div>'+(demoVisible?demoRoundCards():'');
  bindRoundCards(host);
}
function bindRoundCards(host){host.querySelectorAll('[data-p1-round]').forEach(card=>card.onclick=()=>openRound(card.dataset.p1Round,card.dataset.p1Source==='synthetic'))}
function renderUpcomingDemoList(){const host=document.getElementById('p1-upcoming-host');if(host){host.innerHTML=demoRoundCards();bindRoundCards(host)}}
function roundCard(round){const xlabs=round.xlabsCoverage;const freshness=round.latestFetchedAt?'Senast hämtat '+date1(round.latestFetchedAt):'Källstatus saknas';return '<button type="button" class="p1-card p1-round" data-p1-round="'+esc1(round.id)+'" data-p1-source="live"><div class="p1-round-top"><span class="p1-game '+(round.gameType==='V86'?'v86':'')+'">'+esc1(round.gameType||'V85')+'</span><span class="p1-round-name">'+esc1(round.trackNames||'Omgång')+'</span><span class="p1-round-facts"><span>'+esc1(time1(round.scheduledStartAt))+'</span></span></div><div class="p1-round-meta">'+esc1(date1(round.roundDate))+' · Start '+esc1(time1(round.scheduledStartAt))+' · Spelstopp '+esc1(time1(round.betStopAt))+' · '+num1(round.legCount||8)+' avdelningar'+(xlabs?' · X-Labs '+num1(xlabs.covered)+'/'+num1(xlabs.activeEntries):'')+' · '+esc1(freshness)+'</div></button>'}
function demoRoundCards(){const rows=demoRounds.filter(x=>roundFilter==='all'||x.gameType===roundFilter).sort((a,b)=>a.roundDate.localeCompare(b.roundDate));return '<div class="p1-synthetic-banner">Syntetiska exempel · separerade från verifierade omgångar</div><div class="p1-round-list">'+rows.map(round=>'<button type="button" class="p1-card p1-round" data-p1-round="'+esc1(round.id)+'" data-p1-source="synthetic"><div class="p1-round-top"><span class="p1-game '+(round.gameType==='V86'?'v86':'')+'">'+round.gameType+'</span><span class="p1-round-name">'+esc1(round.trackNames)+'</span><span class="p1-round-facts">Exempel</span></div><div class="p1-round-meta">'+esc1(date1(round.roundDate))+' · Start '+esc1(time1(round.scheduledStartAt))+' · 8 avdelningar</div></button>').join('')+'</div>'}
async function openRound(id,isDemo=false){
 activeRound=null;activeLeg=1;expandedHorses.clear();const token=++roundToken;
 const found=isDemo?demoRounds.find(x=>x.id===id):null;
 try{activeRound=found||await phase1Api.upcomingRound(id);if(token!==roundToken||!activeRound)return;activeRound.gameType=activeRound.gameType||activeRound.game_type;activeRound.roundDate=activeRound.roundDate||activeRound.round_date;activeRound.source=isDemo?'synthetic':'live';activeRound.legs=(activeRound.legs||[]).map((leg,index)=>({...leg,number:leg.number||leg.legNumber||index+1,startMethod:leg.startMethod||leg.start_method,trackName:leg.trackName||leg.track_name}));renderRound()}
 catch(error){const host=document.getElementById('p1-upcoming-host');if(host)host.innerHTML=errorBox('Omgången kunde inte öppnas: '+error.message,'retry-upcoming')}
}
function renderRound(){
 const r=activeRound;if(!r)return;
 appEl.innerHTML='<div class="p1-row" style="justify-content:space-between;margin-bottom:12px"><button class="back" type="button" data-p1-action="back-upcoming">‹ Kommande omgångar</button>'+sourceTag(r.source)+'</div>'+pageHead((r.gameType||'V85')+' · '+(r.trackNames||r.legs?.[0]?.trackName||''),date1(r.roundDate)+' · Start '+time1(r.scheduledStartAt)+' · Spelstopp '+time1(r.betStopAt))+'<div class="p1-legs">'+Array.from({length:8},(_,i)=>{const l=(r.legs||[]).find(x=>Number(x.number||x.legNumber)===i+1)||{};return '<button type="button" class="p1-leg-tab '+(activeLeg===i+1?'active':'')+'" data-p1-leg="'+(i+1)+'"><strong>'+esc1(r.gameType)+'-'+(i+1)+'</strong><span>'+esc1((l.distanceM||l.distance_m||'–')+' m · '+method1(l.startMethod))+'</span></button>'}).join('')+'</div><div id="p1-leg-host"><div class="p1-loading-line"></div></div>';
  appEl.querySelectorAll('[data-p1-leg]').forEach(b=>b.onclick=()=>{activeLeg=Number(b.dataset.p1Leg);expandedHorses.clear();renderRound()});
 if(r.source==='synthetic')renderLeg(r.legs.find(x=>x.number===activeLeg)||r.legs[activeLeg-1],true);
 else loadLiveLeg(r,activeLeg);
}
async function loadLiveLeg(round,leg){
 const host=document.getElementById('p1-leg-host');if(!host)return;const token=roundToken;host.innerHTML='<div class="p1-loading-line"></div>';
 const isCurrent=()=>token===roundToken&&activeRound===round&&activeLeg===leg&&currentRoute==='upcoming'&&host.isConnected;
  try{const data=await phase1Api.upcomingLeg(round.id,leg);if(!isCurrent())return;let forms={forms:[]};formLoadIssue='';try{forms=await phase1Api.horseForms(round.id,leg)}catch(error){formLoadIssue=error.message}if(!isCurrent())return;for(const form of forms.forms||[])formScores.set(String(form.raceEntryId),form.score);const normalized={...data.leg,number:leg,entries:data.entries||[]};renderLeg(normalized,false);loadLiveHorseProfiles(normalized.entries||[],token)}
 catch(error){if(isCurrent())host.innerHTML=errorBox('Kunde inte läsa avdelningen: '+error.message,'retry-leg')}
}
async function loadLiveHorseProfiles(entries,token){
 const ids=[...new Set(entries.map(entry=>String(entry.horseId||'')).filter(Boolean))];let next=0;
 async function worker(){while(next<ids.length){const id=ids[next++];try{const profile=profiles.get(id)||await phase1Api.horseProfile(id);if(token!==roundToken)return;profiles.set(id,profile);const sequenceHost=appEl.querySelector('[data-p1-form-sequence="'+CSS.escape(id)+'"]');if(sequenceHost)sequenceHost.innerHTML='Form '+formHtml(formSequence(profile.starts||[]));const noteDot=appEl.querySelector('[data-p1-note-indicator="'+CSS.escape(id)+'"]');if(noteDot&&localData.notes.some(note=>String(note.horseId)===id))noteDot.hidden=false}catch{}}}
 await Promise.all(Array.from({length:Math.min(3,ids.length)},worker));
}
function renderLeg(leg,isDemo){
 const host=document.getElementById('p1-leg-host');if(!host||!leg)return;
 const round=activeRound, entries=leg.entries||[];
 host.innerHTML='<div class="p1-leg-head"><div><h2>'+esc1(round.gameType)+'-'+activeLeg+' · '+esc1(leg.distanceM||leg.distance_m||'–')+' m · '+esc1(method1(leg.startMethod))+'</h2><p>'+esc1(leg.trackName||'')+' · '+(isDemo?'Syntetisk startlista':num1(leg.activeEntries??entries.length)+' startande')+'</p></div>'+sourceTag(isDemo?'synthetic':'live')+'</div>'+(formLoadIssue&&!isDemo?'<div class="p1-small" role="status">Formpoäng kunde inte läsas just nu; okända värden visas som –.</div>':'')+(!entries.length?'<div class="p1-card p1-empty"><strong>Ingen startlista</strong>Verifierade häststarter saknas för avdelningen.</div>':'<div class="p1-horses">'+entries.map(entry=>horseCard(entry,round,leg,isDemo)).join('')+'</div>');
 host.querySelectorAll('[data-p1-horse-open]').forEach(b=>b.onclick=()=>toggleHorse(b.dataset.p1HorseOpen,b.dataset.p1Entry,b.dataset.p1Source==='synthetic',leg));
}
function horseCard(e,round,leg,isDemo){
 const entryId=e.raceEntryId||e.race_entry_id||e.horseId||e.horse_id;
 const horseId=e.horseId||e.horse_id||e.horse?.id||entryId;
 const opened=expandedHorses.has(String(entryId));
 const score=isDemo?e.formScore:formScores.get(String(entryId));
 const sequence=isDemo?e.form:formSequence((profiles.get(String(horseId))?.starts)||[]);
 const noteCount=localData.notes.filter(n=>String(n.horseId)===String(horseId)).length;
 return '<article class="p1-horse"><div class="p1-horse-grid"><div class="p1-horse-num">'+esc1(e.startNumber??e.start_number??'–')+'</div><div class="p1-horse-ident"><div class="p1-horse-name">'+esc1(e.horseName||e.horse_name||'Okänd häst')+'<span class="p1-note-dot" data-p1-note-indicator="'+esc1(horseId)+'" '+(noteCount?'':'hidden')+'>Anteckning</span></div><div class="p1-horse-driver">'+esc1(e.driverName||e.driver_name||e.driver?.name||'Okänd kusk')+' · Spår '+esc1(e.lane??e.actual_lane??'–')+'</div><div class="p1-form" data-p1-form-sequence="'+esc1(horseId)+'">Form '+formHtml(sequence)+'</div></div>'+metric('Formpoäng',score==null?'–':score)+metric('Första 200',pace1(e.first200??e.fastestFirst200?.value))+metric('Sista 400',pace1(e.last400??e.fastestLast400?.value))+metric('Streck',e.betPercent==null&&e.bet_percent==null?'–':pct1(Number(e.betPercent??e.bet_percent)/100))+'<button type="button" class="p1-expand-btn" aria-label="'+(opened?'Dölj':'Visa')+' häststatistik" data-p1-horse-open="'+esc1(entryId)+'" data-p1-entry="'+esc1(horseId)+'" data-p1-source="'+(isDemo?'synthetic':'live')+'">'+(opened?'⌃':'⌄')+'</button></div><div class="p1-expanded-host" data-p1-expanded="'+esc1(entryId)+'" '+(opened?'':'hidden')+'>'+(opened?'<div class="p1-loading-line"></div>':'')+'</div></article>'
}
function metric(label,value){return '<div class="p1-horse-metric"><small>'+label+'</small><strong>'+esc1(value)+'</strong></div>'}
function formHtml(values){if(!Array.isArray(values)||!values.length)return '<span>–</span>';return values.map((value,index)=>{const segs=resultFormSegments(value);const result=segs.map(seg=>'<span class="p1-result '+(seg.kind==='win'?'p1-result-win':seg.kind==='gallop'?'p1-gallop':seg.kind==='disqualified'?'p1-result-dq':'')+'">'+esc1(seg.text)+'</span>').join('');return (index?' <span> - </span>':'')+result}).join('')}
function formSequence(starts){return (starts||[]).slice(0,5).map(start=>displayStartResult(start)??'–')}
async function toggleHorse(entryId,horseId,isDemo,leg){
 const key=String(entryId),host=document.querySelector('[data-p1-expanded="'+CSS.escape(key)+'"]');
 if(!host)return;
 if(expandedHorses.has(key)){expandedHorses.delete(key);host.hidden=true;host.innerHTML='';return}
 expandedHorses.add(key);host.hidden=false;host.innerHTML='<div class="p1-loading-line"></div>';
 let profile=null,factData=null;
 if(isDemo){const demo=leg.entries.find(x=>String(x.horseId)===String(horseId));profile={starts:(demo?.history||[]).map((item,index)=>demoHistory(item,index,horseId)),entity:{name:demo?.horseName}};factData=demo}
 else{
  const round=activeRound;
  [profile,factData]=await Promise.all([
   profiles.get(String(horseId))?Promise.resolve(profiles.get(String(horseId))):phase1Api.horseProfile(horseId).then(x=>{profiles.set(String(horseId),x);return x}).catch(error=>({error:error.message,starts:[]})),
   facts.get(key)?Promise.resolve(facts.get(key)):phase1Api.horseFacts(round.id,activeLeg,entryId).then(x=>{facts.set(key,x);return x}).catch(error=>({error:error.message}))
  ]);
 }
 if(!host.isConnected||!expandedHorses.has(key))return;
  host.innerHTML=expandedHorseContent(horseId,profile,factData,isDemo,leg,activeRound);
 bindNotePanel(host.querySelector('.p1-notes'));
}
function demoHistory(item,index,horseId){return{race_date:item.date,track_name:item.track,race_number:item.raceNumber,distance_m:item.distanceM,start_method:item.startMethod,actual_lane:item.lane,driver_name:item.driverName,placing_text:item.placing,km_time:item.kmTime,entry_id:horseId+'-start-'+item.date+'-'+item.raceNumber,xlabs:{first200Time:item.first200,last400Time:item.last400}}}
function compactMetric(metric){if(!metric)return{value:'–',note:'Underlag saknas'};const starts=metric.starts??0,wins=metric.wins??0;return{value:metric.winRate==null?'–':pct1(metric.winRate),note:num1(wins)+' segrar / '+num1(starts)+' starter'}}
function expandedHorseContent(horseId,profile,factsData,isDemo,leg,round){
 const starts=profile?.starts||[];const metrics=factsData?.metrics||factsData?.stats||{};
 const demoStats=isDemo?{...(factsData?.stats||{})}:null;
 if(demoStats){
  const rows=factsData?.history||[],startMethod=String(leg?.startMethod||'').toLowerCase(),laneNumber=Number(factsData?.lane);
  const rowMethod=row=>String(row.startMethod||row.start_method||'').toLowerCase();
  const rowLane=row=>Number(row.lane??row.actual_lane);
  const placing=row=>String(row.placing??row.placing_text??'');
  const history=rows.filter(row=>{const date=row.date||row.raceDate||row.race_date;if(!date||!round?.roundDate)return true;return date<=round.roundDate&&date>=new Date(new Date(round.roundDate+'T12:00:00Z').getTime()-365*86400000).toISOString().slice(0,10)});
   const metricFor=(subset,label)=>{const known=subset.filter(row=>/^(?:\\d+G?|GD)$/i.test(placing(row)));const wins=known.filter(row=>Number.parseInt(placing(row),10)===1).length;return{wins,starts:known.length,winRate:known.length?wins/known.length:null,label}};
  let laneLabel='Spår saknas';
  let laneMatch=()=>false;
  if(startMethod==='auto'&&laneNumber>=1&&laneNumber<=12){const back=laneNumber>=9;laneLabel=back?'Bakspår auto':'Framspår auto';laneMatch=row=>rowMethod(row)==='auto'&&(back?rowLane(row)>=9&&rowLane(row)<=12:rowLane(row)>=1&&rowLane(row)<=8)}
  else if(startMethod==='volt'&&laneNumber>=1&&laneNumber<=12){const favored=[1,6,7].includes(laneNumber);laneLabel=favored?'Fördelsspår volt':'Övriga spår volt';laneMatch=row=>rowMethod(row)==='volt'&&([1,6,7].includes(rowLane(row))===favored)}
  else if(startMethod==='monté'){laneLabel='Spårtyp monté';laneMatch=row=>rowMethod(row)==='monté'&&rowLane(row)===laneNumber}
  const laneRows=history.filter(laneMatch),trackName=String(leg?.trackName||'').toLowerCase(),driverName=String(factsData?.driverName||factsData?.driver_name||'').toLowerCase(),distance=Number(leg?.distanceM||leg?.distance_m);
   demoStats.currentTrack=metricFor(history.filter(row=>String(row.track||row.track_name||'').toLowerCase()===trackName),'På vald bana');
   demoStats.laneType=metricFor(laneRows,laneLabel);
   demoStats.sameDistanceGroup=metricFor(history.filter(row=>Number(row.distanceM||row.distance_m)===distance),'Samma distans');
   demoStats.sameStartMethod=metricFor(history.filter(row=>rowMethod(row)===startMethod),'Samma startmetod');
   demoStats.currentDriver=metricFor(history.filter(row=>String(row.driverName||row.driver_name||'').toLowerCase()===driverName),'Med vald kusk');
   demoStats.rolling12Months=metricFor(history,'Senaste 12 månaderna');
   const knownGallop=history.filter(row=>/^(?:\\d+G?|GD)$/i.test(placing(row))),gallops=knownGallop.filter(row=>/G/i.test(placing(row))).length;
   demoStats.gallop={starts:knownGallop.length,gallops,rate:knownGallop.length?gallops/knownGallop.length:null};
 }
 const activeMetrics=isDemo?demoStats:metrics;
 const driverForm=factsData?.driver?.form??factsData?.stats?.driverForm??null,trainerForm=factsData?.trainer?.form??factsData?.stats?.trainerForm??null;
 const track=compactMetric(activeMetrics.currentTrack||activeMetrics.track);
 const lane=compactMetric(activeMetrics.laneType||activeMetrics.lane);
 const distance=compactMetric(activeMetrics.sameDistanceGroup||activeMetrics.distance);
 const method=compactMetric(activeMetrics.sameStartMethod||activeMetrics.method);
 const driver=compactMetric(activeMetrics.currentDriver||activeMetrics.driver);
 const year=compactMetric(activeMetrics.rolling12Months||activeMetrics.twelveMonths);
 const gallopMetric=activeMetrics.gallop;
 const gallopRate=gallopMetric?.gallopRate??gallopMetric?.rate??null;
 const gallopNote=gallopMetric?.starts==null?'Känd galoppstatus saknas':num1(gallopMetric.gallops??0)+' av '+num1(gallopMetric.starts)+' starter';
 const cards=[
  ['På dagens bana',track.value,track.note],[(activeMetrics.laneType?.label||activeMetrics.lane?.label||'Relevant spårtyp'),lane.value,lane.note],
  ['Samma distans',distance.value,distance.note],['Samma startmetod',method.value,method.note],
  ['Med dagens kusk',driver.value,driver.note],['Senaste 12 månaderna',year.value,year.note],
  ['Galopp %',gallopRate==null?'–':pct1(gallopRate),gallopNote],
  ['Kusk & tränare · Form','', '<div class="p1-stat-pair"><div><span>Kusk</span><strong>'+(driverForm==null?'–':esc1(driverForm)+'/100')+'</strong></div><div><span>Tränare</span><strong>'+(trainerForm==null?'–':esc1(trainerForm)+'/100')+'</strong></div></div>']
 ];
 const statsError=factsData?.error?'<div class="p1-notice p1-error">Statistik kunde inte läsas: '+esc1(factsData.error)+' · Värden visas som okända.</div>':'';
 const historyError=(profile?.error||profile?.historyError)?'<div class="p1-notice p1-error">Historik kunde inte läsas: '+esc1(profile.error||profile.historyError)+'</div>':'';
 return '<div class="p1-horse-expanded">'+statsError+'<section><div class="p1-section-title"><h2>Statistik under liknande förutsättningar</h2><span>'+(isDemo?'Syntetiska exempel':'Verifierade värden · saknade värden visas som –')+'</span></div><div class="p1-stat-grid">'+cards.map(([label,value,note])=>'<div class="p1-stat-card"><div class="p1-stat-label">'+esc1(label)+'</div>'+(value!==''?'<div class="p1-stat-value">'+esc1(value)+'</div>':'')+'<div class="p1-stat-note">'+note+'</div></div>').join('')+'</div></section><section class="p1-section"><div class="p1-section-title"><h2>Senaste fem starterna</h2><span>Nyaste först</span></div>'+historyError+historyMarkup(starts.slice(0,5))+'</section><section class="p1-section"><div class="p1-section-title"><h2>Mina hästanteckningar</h2><span>Gemensamt med hästprofilen</span></div>'+notePanelMarkup(horseId,starts,isDemo)+'</section></div>'
}
function normalizeStart(start,index){return{raceEntryId:start.raceEntryId||start.race_entry_id||start.entry_id||start.id||null,date:start.date||start.race_date,track:start.track||start.track_name,raceNumber:start.raceNumber||start.race_number,distanceM:start.distanceM||start.distance_m,startMethod:start.startMethod||start.start_method,lane:start.lane||start.actual_lane,driverName:start.driverName||start.driver_name||start.rider_name,placing:displayStartResult(start),kmTime:start.kmTime||start.km_time,xlabs:start.xlabs||null,index}}
function historyMarkup(rows){
 if(!rows?.length)return '<div class="p1-card p1-empty"><strong>Ingen historik att visa</strong>Verifierade starter saknas eller är ofullständiga.</div>';
 const list=rows.map((raw,index)=>{const r=normalizeStart(raw,index);const dateTrack=[date1(r.date),r.track,r.raceNumber?'Lopp '+r.raceNumber:null].filter(Boolean).join(' · ');const facts=[r.distanceM!=null?r.distanceM+' m':null,method1(r.startMethod),r.lane!=null?'Spår '+r.lane:null].filter(Boolean).join(' · ');return{r,dateTrack,facts}}).map(({r,dateTrack,facts})=>'<div class="p1-history-item"><div class="p1-history-main">'+esc1(dateTrack)+'</div><div class="p1-history-result">'+esc1(r.placing||'–')+' · '+esc1(r.kmTime||'–')+'</div><div class="p1-history-sub">'+esc1(facts)+' · '+esc1(r.driverName||'Kusk/ryttare saknas')+'</div></div>').join('');
 const desktop=rows.map((raw,index)=>{const r=normalizeStart(raw,index);return'<tr><td>'+esc1(date1(r.date))+'<br><span class="p1-small">'+esc1(r.track||'–')+'</span></td><td>Lopp '+esc1(r.raceNumber??'–')+' · '+esc1(r.distanceM??'–')+' m<br><span class="p1-small">'+esc1(method1(r.startMethod))+' · Spår '+esc1(r.lane??'–')+'</span></td><td class="p1-history-driver">'+esc1(r.driverName||'–')+'</td><td>'+esc1(r.placing||'–')+'</td><td>'+esc1(r.kmTime||'–')+'</td></tr>'}).join('');
 return '<div class="p1-history-table-wrap"><table class="p1-history-table"><thead><tr><th>Datum / Bana</th><th>Lopp / Distans / Start</th><th>Kusk / Ryttare</th><th>Plac.</th><th>Tid</th></tr></thead><tbody>'+desktop+'</tbody></table></div><div class="p1-mobile-history">'+list+'</div>'
}
function notesFor(horseId){return localData.notes.filter(n=>String(n.horseId)===String(horseId)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))}
function noteContextLabel(start){const r=normalizeStart(start);return [date1(r.date),r.track,r.raceNumber?'Lopp '+r.raceNumber:null].filter(Boolean).join(' · ')}
function notePanelMarkup(horseId,starts=[],includeDemo=false){
 const rows=[...notesFor(horseId),...(includeDemo?demoNotes.filter(note=>String(note.horseId)===String(horseId)):[])];const draft=activeNoteDraft?.horseId===String(horseId)?activeNoteDraft:null;
 const noteCards=rows.length?'<div class="p1-notes-list">'+rows.map(note=>{const context=(starts||[]).find(start=>String(normalizeStart(start).raceEntryId||'')===String(note.raceEntryId||''));return'<article class="p1-note-card"><div class="p1-note-meta">'+(context?esc1(noteContextLabel(context))+' · ':'')+'Skapad '+esc1(date1(note.createdAt))+(note.source==='synthetic'?' · syntetiskt exempel':'')+'</div>'+(context?'<div class="p1-small">'+esc1(noteFacts(context))+'</div>':'')+'<div class="p1-note-text">'+esc1(note.text)+'</div>'+(note.source==='synthetic'?'':'<div class="p1-note-actions"><button type="button" class="p1-button" data-p1-action="edit-note" data-note-id="'+esc1(note.id)+'" data-horse-id="'+esc1(horseId)+'">Redigera</button><button type="button" class="p1-button danger" data-p1-action="delete-note" data-note-id="'+esc1(note.id)+'">Radera</button></div>')+'</article>'}).join('')+'</div>':'<div class="p1-card p1-empty"><strong>Inga anteckningar</strong>Egna kommentarer följer hästen mellan omgångar.</div>';
 const options=(starts||[]).map((raw,index)=>({r:normalizeStart(raw,index),raw})).filter(x=>x.r.raceEntryId).map(({r})=>'<option value="'+esc1(r.raceEntryId)+'" '+(draft?.raceEntryId===String(r.raceEntryId)?'selected':'')+'>'+esc1(noteContextLabel(r))+'</option>').join('');
 const editor=draft?'<div class="p1-editor" data-note-editor="'+esc1(horseId)+'"><div class="p1-label">'+(draft.noteId?'Redigera anteckning':'Ny anteckning')+'</div><label class="p1-label">Historisk start (valfritt)<select class="p1-select" data-p1-note-race="'+esc1(horseId)+'"><option value="">Allmän anteckning</option>'+options+((starts||[]).length&&!options?'<option value="" disabled>Historiska start-ID:n saknas i API:et</option>':'')+'</select></label><textarea class="p1-textarea" data-p1-note-text="'+esc1(horseId)+'" maxlength="2000" placeholder="Skriv en egen observation…">'+esc1(draft.text||'')+'</textarea><div class="p1-note-preview" data-p1-note-preview="'+esc1(horseId)+'">'+(draft.raceEntryId&&draft.context?'<div class="p1-preview">'+esc1(noteContextLabel(draft.context))+' · '+esc1(noteFacts(draft.context))+'</div>':'<div class="p1-small">Ingen historisk start vald.</div>')+'</div><div class="p1-row wrap">'+button('Avbryt','cancel-note')+button('Spara anteckning','save-note','primary')+'</div></div>':'';
 return '<div class="p1-notes" data-horse-id="'+esc1(horseId)+'" data-p1-starts="'+encodeURIComponent(JSON.stringify(starts||[]))+'">'+noteCards+'<div class="p1-row wrap" style="margin-top:8px">'+button('+ Ny anteckning','new-note')+'</div>'+editor+'</div>'
}
function noteFacts(start){const r=normalizeStart(start);const x=r.xlabs||{};return[ r.distanceM!=null?r.distanceM+' m':null,method1(r.startMethod),r.lane!=null?'Spår '+r.lane:null,r.driverName,r.kmTime?'Km-tid '+r.kmTime:null,x.first200Time?'Första 200 '+x.first200Time:null,x.last400Time?'Sista 400 '+x.last400Time:null].filter(Boolean).join(' · ')}
function bindNotePanel(){}
async function renderStatistics(){
 currentRoute='statistics';setNav1('statistics');
 const page=['horses','drivers','trainers','tracks'].includes(state.statisticsPage)?state.statisticsPage:'horses';
 state.statisticsPage=page;
 if(page==='tracks'&&typeof renderTracks==='function')await renderTracks();
 else if(typeof renderEntityList==='function')await renderEntityList(page);
 setNav1('statistics');
}
async function renderProfileNotes(){
 const detail=state.detail;if(!detail||detail.page!=='horses'||state.tab!=='notes')return;
 const horseId=String(detail.id),host=appEl;const previous=host.querySelector('.p1-profile-notes');if(previous)previous.remove();
 const section=document.createElement('section');section.className='p1-section p1-profile-notes';section.innerHTML='<div class="p1-loading-line"></div>';host.append(section);
 let profile=profiles.get(horseId);if(!profile){try{profile=await phase1Api.horseProfile(horseId);profiles.set(horseId,profile)}catch(error){profile={error:error.message,starts:[]}}}
 if(!section.isConnected)return;
 section.innerHTML='<div class="p1-section-title"><h2>Mina hästanteckningar</h2><span>Gemensamma med startlistorna</span></div>'+(profile.error?'<div class="p1-notice p1-error">Historiska starter kunde inte läsas: '+esc1(profile.error)+'</div>':'')+notePanelMarkup(horseId,profile.starts||[]);
}
function installProfileNotes(){
 if(typeof detailTabs==='function'){const oldTabs=detailTabs;detailTabs=function(type){const list=oldTabs(type).filter(([id])=>!['external_stats','interviews'].includes(id));return type==='horse'?list.concat([['notes','Anteckningar']]):list}}
 if(typeof renderDetail==='function'){const oldRender=renderDetail;renderDetail=async function(){await oldRender();if(state.detail?.page==='horses'&&state.tab==='notes')await renderProfileNotes()}}
}
const priorPhase1SetNav=typeof setNav==='function'?setNav:null;
if(priorPhase1SetNav)setNav=function(page){priorPhase1SetNav(page);if(page==='start')currentRoute='trend';if(currentRoute==='trend')setNav1('trend');else if(currentRoute==='statistics')setNav1('statistics');else if(currentRoute==='upcoming'||currentRoute==='systems')setNav1('spel');else if(currentRoute==='settings')setNav1('');};
function renderSettings(){
 currentRoute='settings';setNav1('');
 appEl.innerHTML=pageHead('Inställningar','Datatäckning · driftstatus · lokal lagring')+'<div class="p1-loading-line"></div>';
 phase1Api.settingsStatus().then(data=>{
  if(currentRoute!=='settings')return;
  const counts=data.counts||{},sources=data.sources||[],runs=(data.recentRuns||[]).slice(0,5);
  appEl.innerHTML=pageHead('Inställningar','Datatäckning · driftstatus · lokal lagring')+'<div id="p1-storage-status"></div><section class="p1-section"><div class="p1-section-title"><h2>Datamängd</h2><span>Senast hämtat från systemstatus</span></div><div class="p1-summary-grid">'+[['Tränare',counts.trainers],['Hästar',counts.horses],['Kuskar',counts.drivers],['V85/V86-omgångar',counts.games]].map(([label,value])=>'<div class="p1-card p1-card-pad"><span class="p1-stat-label">'+esc1(label)+'</span><strong class="p1-stat-value">'+esc1(value==null?'–':num1(value))+'</strong></div>').join('')+'</div></section><section class="p1-section"><div class="p1-section-title"><h2>Datakällor</h2><span>Senaste aktivitet</span></div><div class="p1-settings-list">'+(sources.length?sources.map(source=>'<div class="p1-settings-row"><span><strong>'+esc1(source.name||'Datakälla')+'</strong><small>'+esc1(source.description||source.message||'')+'</small></span><span class="p1-settings-state '+(['error_retrying','action_required'].includes(source.status)?'error':'')+'">'+esc1(statusText1(source.status))+'</span><time>'+esc1(date1(source.lastRunAt))+'</time></div>').join(''):'<div class="p1-card p1-empty">Ingen källstatus tillgänglig.</div>')+'</div></section><section class="p1-section"><div class="p1-section-title"><h2>Senaste aktivitet</h2><span>Upp till fem körningar</span></div><div class="p1-card p1-card-pad">'+(runs.length?runs.map(run=>'<div class="p1-run-row"><strong>'+esc1(run.name||'Datakörning')+'</strong><span class="p1-settings-state '+(['error','warning'].includes(run.status)?'error':'')+'">'+esc1(statusText1(run.status))+'</span><time>'+esc1(date1(run.finishedAt||run.startedAt))+'</time><small>'+num1(run.errors||0)+' fel</small></div>').join(''):'<div class="p1-empty">Inga registrerade körningar ännu.</div>')+'</div></section><section class="p1-section"><div class="p1-card p1-card-pad"><div class="p1-section-title"><h2>Lokal lagring</h2><span>Endast den här enheten</span></div><p class="p1-small">Hästanteckningar och egna system sparas i webbläsaren. Inga formulär skickar ändringar till servern.</p><div class="p1-small">'+esc1(data.appVersion?'Appversion '+data.appVersion:'')+'</div></div></section>';
  renderStorageNotice();
 }).catch(error=>{if(currentRoute!=='settings')return;appEl.innerHTML=pageHead('Inställningar','Datatäckning · driftstatus · lokal lagring')+errorBox('Kunde inte läsa driftstatus: '+error.message,'retry-settings')+'<div id="p1-storage-status"></div>';renderStorageNotice()});
}
async function loadBuilderRounds(){
 const current=builderType;
 if(builderRoundsCache[current]){upcomingItems=builderRoundsCache[current].upcoming;historyRounds=builderRoundsCache[current].history;builderLoadError='';return}
 try{
  const [upcoming,history]=await Promise.all([phase1Api.upcomingRounds(current),phase1Api.historicalRounds(current)]);
  if(current!==builderType)return;
  upcomingItems=(upcoming.items||[]).map(x=>({...x,gameType:x.gameType||x.game_type,roundDate:x.roundDate||x.round_date,trackNames:x.trackNames||x.track_names,source:'live'}));
  const seenHistory=new Map();
  for(const x of history.items||[]){const item={id:x.roundId||x.round_id||x.id,gameType:x.gameType||x.game_type,roundDate:x.roundDate||x.round_date,trackNames:x.trackNames||x.track_names||x.trackName||'',source:'live',historical:true};if(item.id&&item.gameType===current&&!seenHistory.has(String(item.id)))seenHistory.set(String(item.id),item)}
  historyRounds=[...seenHistory.values()];builderLoadError='';builderRoundsCache[current]={upcoming:upcomingItems,history:historyRounds};
 }catch(error){historyRounds=[];upcomingItems=[];builderLoadError=error.message}
}
let builderLoadError='';
async function renderBuilder(alreadyLoaded=false){
 currentRoute='systems';spelView='builder';setNav1('spel');if(!alreadyLoaded){appEl.innerHTML=pageHead('Registrera system','Manuella val · lokal sparning · ingen AI')+spelSwitcher('builder')+'<div class="p1-loading-line"></div>';await loadBuilderRounds();if(currentRoute!=='systems'||spelView!=='builder')return}
 const rows=[...upcomingItems.filter(x=>x.gameType===builderType),...historyRounds];
 if(builderDemo){rows.push(...demoRounds.filter(x=>x.gameType===builderType).map(x=>({...x,source:'synthetic'})));if(builderType==='V85')rows.push({...demoHistoricalRound,source:'synthetic'})}
 if(!builderRoundId||!rows.some(x=>String(x.id)===String(builderRoundId))){builderRound=rows[0]||null;builderRoundId=builderRound?.id||''}
 appEl.innerHTML=pageHead('Registrera system','Manuella val · lokal sparning · ingen AI')+spelSwitcher('builder')+'<div id="p1-storage-status"></div><div class="p1-card p1-card-pad p1-section"><div class="p1-section-title"><h2>Omgång</h2><span>Kommande eller historisk</span></div><div class="p1-builder-selects"><label><span class="p1-label">Spelform</span><select class="p1-select" data-p1-builder-type><option '+(builderType==='V85'?'selected':'')+'>V85</option><option '+(builderType==='V86'?'selected':'')+'>V86</option></select></label><label><span class="p1-label">Välj omgång</span><select class="p1-select" data-p1-builder-round>'+(rows.length?rows.map(x=>'<option value="'+esc1(x.id)+'" '+(String(x.id)===String(builderRoundId)?'selected':'')+'>'+esc1(x.gameType+' · '+date1(x.roundDate)+' · '+(x.trackNames||'Bana saknas')+(x.source==='synthetic'?' · Syntetiskt exempel':x.historical?' · Historisk':' · Kommande'))+'</option>').join(''):'<option value="">Ingen omgång tillgänglig</option>')+'</select></label><div class="p1-row wrap">'+button(builderDemo?'Dölj demo-omgångar':'Visa syntetiska omgångar','toggle-builder-demo')+(builderLoadError?'<span class="p1-small">Kunde inte läsa omgångar: '+esc1(builderLoadError)+'</span>'+button('Försök igen','retry-builder'):'')+'</div></div><div class="p1-synthetic-banner">'+(builderRound?.source==='synthetic'?'Syntetisk exempelomgång vald.':'Omgångslistan hämtas från befintliga läs-API:er.')+'</div></div>'+(builderRound?builderLegMarkup():'<div class="p1-card p1-empty"><strong>Ingen omgång att välja</strong>Välj syntetiska exempel för att prova byggaren, eller läs in en omgång från databasen.</div>')+'<div class="p1-section"><div class="p1-section-title"><h2>Systemöversikt</h2><span>Alla åtta avdelningar krävs för att spara</span></div>'+builderSummary()+'<div class="p1-save-row"><input class="p1-input" data-p1-builder-name maxlength="60" placeholder="Systemnamn (valfritt)" value="'+esc1(builderName)+'">'+button('Rensa val','clear-builder')+button('Spara system','save-system','primary')+'</div><div id="p1-builder-message" class="p1-small" role="status"></div></div>';
 renderStorageNotice();
 appEl.querySelector('[data-p1-builder-type]').onchange=event=>{builderType=event.target.value;builderRoundId='';builderLegs=Array.from({length:8},()=>[]);renderBuilder()};
  appEl.querySelector('[data-p1-builder-round]').onchange=event=>{builderRoundId=event.target.value;builderRound=rows.find(x=>String(x.id)===String(builderRoundId))||null;builderLegs=Array.from({length:8},()=>[]);renderBuilder(true)};
 appEl.querySelector('[data-p1-builder-name]').oninput=event=>{builderName=event.target.value};
  appEl.querySelectorAll('[data-p1-number]').forEach(b=>b.onclick=()=>{const index=Number(b.dataset.legIndex),value=Number(b.dataset.p1Number),set=new Set(builderLegs[index]);if(set.has(value))set.delete(value);else set.add(value);builderLegs[index]=[...set].sort((a,b)=>a-b);renderBuilder(true)});
}
function builderLegMarkup(){return '<div class="p1-builder-legs">'+Array.from({length:8},(_,i)=>{const l=builderRound?.legs?.[i]||{};const selected=builderLegs[i]||[];return'<section class="p1-card p1-builder-leg" data-p1-builder-leg="'+(i+1)+'"><div class="p1-builder-leg-head"><strong>'+builderType+'-'+(i+1)+'</strong><span>'+esc1(l.distanceM||l.distance_m||'–')+' m · '+esc1(method1(l.startMethod||l.start_method))+'</span><span class="p1-spike">'+(selected.length===1?'SPIK':'')+'</span><span class="p1-small">'+selected.length+' valda</span></div><div class="p1-number-grid">'+Array.from({length:15},(_,n)=>'<button type="button" class="p1-number '+(selected.includes(n+1)?'selected':'')+'" data-p1-number="'+(n+1)+'" data-leg-index="'+i+'" aria-pressed="'+selected.includes(n+1)+'">'+(n+1)+'</button>').join('')+'</div></section>'}).join('')+'</div>'}
function builderSummary(){const calc=calculateSystem(builderLegs,builderType);return'<div class="p1-summary-grid"><div class="p1-summary-item"><small>Antal rader</small><strong>'+ (calc.complete?num1(calc.rows):'Ofullständigt')+'</strong></div><div class="p1-summary-item"><small>Spikar</small><strong>'+calc.spikes+'</strong></div><div class="p1-summary-item"><small>Radpris</small><strong>'+money1(calc.linePrice)+'</strong></div><div class="p1-summary-item"><small>Systemkostnad</small><strong>'+money1(calc.cost)+'</strong></div></div>'}
function addLocalSystem(){
 const calc=calculateSystem(builderLegs,builderType);const message=document.getElementById('p1-builder-message');
 if(!builderRound||!calc.complete){if(message)message.innerHTML='<span class="p1-result-dq">Välj en omgång och minst ett nummer i varje avdelning.</span>';return}
 const system={roundId:String(builderRound.id),gameType:builderType,roundDate:builderRound.roundDate,trackNames:builderRound.trackNames||'',systemName:builderName.trim()||'Manuellt system',legs:builderLegs.map(leg=>[...leg]),rowCount:calc.rows,stakeSek:calc.cost,settlementState:'pending',payoutSek:null,netSek:null,winnerNumbers:null,createdAt:new Date().toISOString(),source:'local',historical:Boolean(builderRound.historical||new Date(builderRound.roundDate+'T23:59:59')<new Date())};
 const resultId=globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2);
 const next={...localData,systems:[{...system,id:'system-'+resultId},...localData.systems]};
 if(!persist(next)){if(message)message.innerHTML='<span class="p1-result-dq">Systemet sparades inte: '+esc1(storageError)+'</span>';return}
  builderName='';builderLegs=Array.from({length:8},()=>[]);renderBuilder(true);const m=document.getElementById('p1-builder-message');if(m)m.textContent='Systemet är sparat lokalt på den här enheten.'
}
function renderSystems(){
 currentRoute='systems';spelView='systems';setNav1('spel');
  const all=[...localData.systems,...(demoVisible?demoSystems:[])];const visible=all.filter(s=>groupFilter==='all'||(groupFilter==='settled'?isSettledResult(s):!isSettledResult(s)));
 const summary=summarizeSystems(all);
 appEl.innerHTML=pageHead('Mina system','Dina registrerade V85- och V86-system')+spelSwitcher('systems')+'<div id="p1-storage-status"></div><div class="p1-finance">'+financeCard('INSATS',summary.stakeSek)+financeCard('UTDELNING',summary.payoutSek)+financeCard('RESULTAT',summary.netSek,true)+'</div><div class="p1-section"><div class="p1-section-title"><h2>Registrerade omgångar</h2><span>'+(demoVisible?'<span class="p1-chip demo">Syntetiska exempel visas</span>':'')+'</span></div><div class="p1-filterbar">'+[['all','Alla'],['settled','Avgjorda'],['pending','Kommande']].map(([id,label])=>'<button class="p1-filter '+(groupFilter===id?'active':'')+'" data-p1-group-filter="'+id+'">'+label+'</button>').join('')+'<button class="p1-filter" data-p1-action="toggle-demo-systems">'+(demoVisible?'Dölj exempeldata':'Visa syntetiska exempel')+'</button></div><div id="p1-round-groups">'+renderRoundGroups(visible)+'</div></div><div class="p1-section"><div class="p1-section-title"><h2>Min resultatstatistik</h2><span>Underlag: '+summary.settledCount+' avgjorda system</span></div>'+performanceMarkup(all,summary)+'</div>';
 renderStorageNotice();
 appEl.querySelectorAll('[data-p1-group-filter]').forEach(b=>b.onclick=()=>{groupFilter=b.dataset.p1GroupFilter;renderSystems()});
 appEl.querySelectorAll('[data-p1-round-toggle]').forEach(b=>b.onclick=()=>{const id=b.dataset.p1RoundToggle;const group=document.querySelector('[data-p1-round-systems="'+CSS.escape(id)+'"]');if(group)group.hidden=!group.hidden});
 appEl.querySelectorAll('[data-p1-system-toggle]').forEach(b=>b.onclick=()=>{const id=b.dataset.p1SystemToggle;const detail=document.querySelector('[data-p1-system-detail="'+CSS.escape(id)+'"]');if(detail)detail.hidden=!detail.hidden});
 appEl.querySelectorAll('[data-p1-delete-system]').forEach(b=>b.onclick=()=>confirmDelete('system',b.dataset.p1DeleteSystem));
}
function financeCard(label,value,net=false){const tone=net?(value>0?'p1-positive':value<0?'p1-negative':'p1-neutral'):'p1-neutral';return'<div class="p1-card p1-finance-card"><small>'+label+'</small><strong class="'+tone+'">'+(value==null?'–':money1(value))+'</strong></div>'}
function renderRoundGroups(systems){
 if(!systems.length)return'<div class="p1-card p1-empty"><strong>Inga registrerade system</strong>Spara ett manuellt system eller visa de tydligt märkta syntetiska exemplen.</div>';
 const groups=new Map();systems.forEach(system=>{const key=String(system.roundId);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(system)});
  return'<div class="p1-rounds">'+[...groups.entries()].map(([id,items])=>{const first=items[0],settled=items.filter(isSettledResult),stake=items.reduce((s,x)=>s+Number(x.stakeSek||0),0),payout=settled.reduce((s,x)=>s+Number(x.payoutSek),0),net=settled.length?payout-settled.reduce((s,x)=>s+Number(x.stakeSek),0):null;return'<section class="p1-card p1-saved-round"><button type="button" class="p1-saved-round-head" data-p1-round-toggle="'+esc1(id)+'"><span><span class="p1-saved-round-title"><span class="p1-game '+(first.gameType==='V86'?'v86':'')+'">'+esc1(first.gameType)+'</span>'+esc1(first.trackNames||'Bana saknas')+' '+sourceTag(first.source==='synthetic'?'synthetic':'')+'</span><span class="p1-saved-round-meta">'+esc1(date1(first.roundDate))+' · '+items.length+' system · Insatser '+money1(stake)+'</span></span><span class="p1-saved-round-result '+(net==null?'p1-neutral':net>0?'p1-positive':net<0?'p1-negative':'p1-neutral')+'">'+(settled.length?money1(net)+' netto':'Inväntar resultat')+'</span></button><div class="p1-systems" data-p1-round-systems="'+esc1(id)+'" hidden>'+items.map(systemCard).join('')+'</div></section>'}).join('')+'</div>'
}
function systemCard(s){
  const synthetic=s.source==='synthetic',settled=isSettledResult(s),stateLabel=settled?'Avgjort':'Väntar';
  return'<article class="p1-system"><button type="button" class="p1-system-head" data-p1-system-toggle="'+esc1(s.id)+'"><span><strong>'+esc1(s.systemName||s.name||'Manuellt system')+'</strong><span class="p1-chip '+(synthetic?'demo':'')+'">'+(synthetic?'Syntetiskt exempel':stateLabel)+'</span><div class="p1-small">'+num1(s.rowCount)+' rader · Insats '+money1(s.stakeSek)+' · '+(settled?'Utdelning '+money1(s.payoutSek):'Ej avgjort')+'</div></span><span>Visa detaljer</span></button><div class="p1-system-detail" data-p1-system-detail="'+esc1(s.id)+'" hidden>'+systemDetail(s)+'<div class="p1-row" style="margin-top:8px">'+(synthetic?'':button('Radera lokalt system','delete-system','danger').replace('data-p1-action="delete-system"','data-p1-delete-system="'+esc1(s.id)+'"'))+'</div></div></article>'
}
function systemDetail(s){
 const winners=Array.isArray(s.winnerNumbers)?s.winnerNumbers:null,legs=s.legs||[];
  const settled=isSettledResult(s),net=settled?resultNet(s.payoutSek,s.stakeSek):null;
  return'<div class="p1-detail-figures"><div class="p1-detail-figure"><small>Antal rader</small><strong>'+num1(s.rowCount)+'</strong></div><div class="p1-detail-figure"><small>Insats</small><strong>'+money1(s.stakeSek)+'</strong></div><div class="p1-detail-figure"><small>Utdelning</small><strong>'+(settled?money1(s.payoutSek):'Inväntar')+'</strong></div><div class="p1-detail-figure"><small>Netto</small><strong class="'+(net==null?'p1-neutral':net>0?'p1-positive':net<0?'p1-negative':'p1-neutral')+'">'+(net==null?'Inväntar':money1(net))+'</strong></div></div><div class="p1-small" style="margin:0 0 7px">Rätt avdelningar: '+(s.correctLegs==null?'–':s.correctLegs+'/8')+' · Utfallet baseras inte enbart på antal rätt.</div><div class="p1-result-legs">'+Array.from({length:8},(_,i)=>{const selected=legs[i]||[],winner=winners?.[i]??null,result=selectionResult(selected,winner);return'<div class="p1-result-leg '+(result==='covered'?'p1-result-winner':result==='missed'?'p1-result-missed':'p1-result-pending')+'"><strong>'+(s.gameType||'V85')+'-'+(i+1)+' · '+(result==='pending'?'Ej avgjord':result==='covered'?'Vinnare täckt':'Vinnare missad')+'</strong><div class="p1-picks">Val: '+(selected.length?selected.map(n=>'<span class="'+(winner!=null&&Number(n)===Number(winner)?'p1-result-win':'')+'">'+esc1(n)+'</span>').join(', '):'–')+'</div><div class="p1-small">Vinnare: '+esc1(winner??'–')+'</div></div>'}).join('')+'</div>'
}
function performanceMarkup(systems,summary){
  const settled=systems.filter(isSettledResult),spikes=settled.flatMap(s=>(s.legs||[]).filter(leg=>leg.length===1).map((leg,index)=>({system:s,leg})));
 const spikeHits=spikes.filter(x=>Array.isArray(x.system.winnerNumbers)&&x.leg.includes(x.system.winnerNumbers[(x.system.legs||[]).indexOf(x.leg)])).length;
 const best=settled.reduce((max,s)=>Math.max(max,Number(s.payoutSek||0)),0);
 return'<div class="p1-performance"><div class="p1-card"><small>Registrerade system</small><strong>'+summary.registeredCount+'</strong><div class="p1-small">'+settled.length+' avgjorda · '+summary.pendingCount+' väntar</div></div><div class="p1-card"><small>Spikträffar</small><strong>'+(spikes.length?pct1(spikeHits/spikes.length):'–')+'</strong><div class="p1-small">'+spikeHits+' av '+spikes.length+' spikar · avgjorda system</div></div><div class="p1-card"><small>Bästa utdelning</small><strong>'+money1(best)+'</strong><div class="p1-small">Ur '+settled.length+' avgjorda system</div></div></div>'
}
function confirmDelete(kind,id){deleteTarget={kind,id};const label=kind==='note'?'anteckningen':'systemet';document.body.insertAdjacentHTML('beforeend','<div class="p1-modal-backdrop" data-p1-modal><section class="p1-modal" role="dialog" aria-modal="true" aria-labelledby="p1-confirm-title"><h2 id="p1-confirm-title">Radera '+label+'?</h2><p>Åtgärden kan inte ångras. Endast lokal data påverkas.</p><div class="p1-modal-actions">'+button('Avbryt','cancel-delete')+button('Radera','confirm-delete','danger')+'</div></section></div>');document.querySelector('[data-p1-modal]').onclick=event=>{if(event.target.matches('[data-p1-modal]'))closeConfirm()}}
function closeConfirm(){document.querySelector('[data-p1-modal]')?.remove();deleteTarget=null}
function renderNotesHost(host){if(!host)return;let starts=[];try{starts=JSON.parse(decodeURIComponent(host.dataset.p1Starts||'%5B%5D'))}catch{}host.outerHTML=notePanelMarkup(host.dataset.horseId,starts);const next=document.querySelector('.p1-notes[data-horse-id="'+CSS.escape(host.dataset.horseId)+'"]');bindNotePanel(next)}
function bindNotePanel(){}
function noteDraftFor(host){let starts=[];try{starts=JSON.parse(decodeURIComponent(host.dataset.p1Starts||'%5B%5D'))}catch{}return starts}
function handleAction(action,element){
  if(action==='back-upcoming'){activeRound=null;roundToken++;renderUpcoming()}
 else if(action==='retry-upcoming')renderUpcoming()
 else if(action==='retry-leg')renderRound()
 else if(action==='toggle-upcoming-demo'){saveDemoVisibility(!demoVisible);renderUpcoming()}
  else if(action==='open-builder'){currentRoute='systems';state.settingsOpen=false;state.detail=null;state.gameDetail=null;state.gameSystemId=null;state.page='games';renderBuilder()}
 else if(action==='toggle-builder-demo'){builderDemo=!builderDemo;builderRoundId='';renderBuilder(true)}
 else if(action==='retry-builder'){delete builderRoundsCache[builderType];renderBuilder()}
 else if(action==='retry-settings')renderSettings()
 else if(action==='clear-builder'){builderLegs=Array.from({length:8},()=>[]);renderBuilder(true)}
 else if(action==='save-system')addLocalSystem()
 else if(action==='toggle-demo-systems'){saveDemoVisibility(!demoVisible);renderSystems()}
 else if(action==='new-note'){const host=element.closest('.p1-notes');activeNoteDraft={horseId:host.dataset.horseId,noteId:null,text:'',raceEntryId:'',context:null};renderNotesHost(host)}
 else if(action==='cancel-note'){activeNoteDraft=null;const host=element.closest('.p1-notes');renderNotesHost(host)}
 else if(action==='save-note')saveNote(element)
 else if(action==='edit-note'){const host=element.closest('.p1-notes'),id=element.dataset.noteId,note=localData.notes.find(n=>n.id===id);if(!note)return;const starts=noteDraftFor(host),context=starts.find(x=>String(normalizeStart(x).raceEntryId||'')===String(note.raceEntryId||''))||null;activeNoteDraft={horseId:String(note.horseId),noteId:id,text:note.text,raceEntryId:note.raceEntryId||'',context};renderNotesHost(host)}
 else if(action==='delete-note')confirmDelete('note',element.dataset.noteId)
 else if(action==='cancel-delete')closeConfirm()
 else if(action==='confirm-delete')executeDelete()
 else if(action==='statistics-retry')renderStatistics()
 else if(action==='more-statistics')renderStatistics()
}
function saveNote(button){
 const editor=button.closest('.p1-note-card,.p1-notes')?.querySelector('[data-note-editor]')||document.querySelector('[data-note-editor]');
 if(!editor||!activeNoteDraft)return;
 const horseId=editor.dataset.noteEditor,textarea=editor.querySelector('[data-p1-note-text]'),select=editor.querySelector('[data-p1-note-race]'),host=editor.closest('.p1-notes');
 const starts=noteDraftFor(host);const selected=starts.find(x=>String(normalizeStart(x).raceEntryId)===String(select?.value));
 const draft={...activeNoteDraft,text:textarea?.value||'',raceEntryId:select?.value||'',context:selected||null};
 if(!draft.text.trim()){textarea?.focus();editor.querySelector('.p1-note-preview').insertAdjacentHTML('beforeend','<div class="p1-result-dq">Skriv en anteckning innan du sparar.</div>');return}
 let next;
 if(draft.noteId){next={...localData,notes:localData.notes.map(n=>{if(n.id!==draft.noteId)return n;const{context:_context,...storedNote}=n;return{...storedNote,text:draft.text.trim(),raceEntryId:draft.raceEntryId||null,updatedAt:new Date().toISOString()}})}}
 else{const id='note-'+(globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2));const now=new Date().toISOString();next={...localData,notes:[{id,horseId,raceEntryId:draft.raceEntryId||null,text:draft.text.trim(),createdAt:now,updatedAt:now},...localData.notes]}}
 if(!persist(next)){editor.insertAdjacentHTML('beforeend','<div class="p1-result-dq">'+esc1(storageError)+'</div>');return}
 activeNoteDraft=null;renderNotesHost(host)
}
function executeDelete(){
 if(!deleteTarget)return;const {kind,id}=deleteTarget;
 const next=kind==='note'?{...localData,notes:localData.notes.filter(x=>x.id!==id)}:{...localData,systems:localData.systems.filter(x=>x.id!==id)};
 if(!persist(next)){closeConfirm();const host=document.querySelector('.p1-notes')||appEl;host.insertAdjacentHTML('afterbegin','<div class="p1-notice p1-error" role="alert">Ändringen kunde inte sparas lokalt: '+esc1(storageError)+'</div>');return}
 closeConfirm();if(kind==='system')renderSystems();else{activeNoteDraft=null;document.querySelectorAll('.p1-notes').forEach(host=>{if(host.querySelector('[data-note-id="'+CSS.escape(id)+'"]'))renderNotesHost(host)})}
}
document.addEventListener('click',event=>{const spelControl=event.target.closest('[data-p1-spel-view]');if(spelControl){event.preventDefault();spelView=spelControl.dataset.p1SpelView;if(spelView==='systems')renderSystems();else if(spelView==='builder')renderBuilder();else renderUpcoming();return}
 const action=event.target.closest('[data-p1-action]');if(action){event.preventDefault();handleAction(action.dataset.p1Action,action);return}
 const nav=event.target.closest('[data-p1-nav]');if(nav){event.preventDefault();showPage(nav.dataset.p1Nav==='trend'?'trend':nav.dataset.p1Nav==='statistics'?'statistics':'spel');return}
 const number=event.target.closest('[data-p1-number]');if(number)return;
},true);
document.addEventListener('change',event=>{
 const select=event.target.closest('[data-p1-note-race]');if(!select)return;
 const host=select.closest('.p1-notes'),starts=noteDraftFor(host),selected=starts.find(x=>String(normalizeStart(x).raceEntryId)===String(select.value));
 if(activeNoteDraft){activeNoteDraft.raceEntryId=select.value;activeNoteDraft.context=selected||null}
 const preview=host.querySelector('[data-p1-note-preview]');if(preview)preview.innerHTML=selected?'<div class="p1-preview">'+esc1(noteContextLabel(selected))+' · '+esc1(noteFacts(selected))+'</div>':'<div class="p1-small">Ingen historisk start vald.</div>';
});
document.addEventListener('click',event=>{if(event.target.closest('[data-p1-note-text]'))return},true);
const originalSearchResults=document.getElementById('searchResults');
let searchSequence=0,searchTimer=null;
if(typeof searchInput!=='undefined'&&searchInput){
 searchInput.addEventListener('input',event=>{
  event.stopImmediatePropagation();clearTimeout(searchTimer);const query=searchInput.value.trim(),sequence=++searchSequence;
  if(query.length<2){searchResults.classList.remove('open');return}
  searchTimer=setTimeout(async()=>{
   try{
    const [entities,trackResult]=await Promise.all([phase1Api.search(query),phase1Api.searchTracks(query).catch(()=>({items:[]}))]);
    if(sequence!==searchSequence||searchInput.value.trim()!==query)return;
    const tracks=(trackResult.items||[]).map(item=>({type:'track',id:item.id,name:item.name}));
    const items=[...(entities||[]),...tracks].slice(0,20);
    const labels={horse:'Häst',driver:'Kusk',trainer:'Tränare',track:'Bana'};
    searchResults.innerHTML=items.length?items.map(item=>'<button type="button" class="search-item" data-type="'+esc1(item.type)+'" data-id="'+esc1(item.id)+'"><span>'+esc1(item.name)+'</span><span class="search-type">'+labels[item.type]+'</span></button>').join(''):'<div class="empty">Inga träffar</div>';
    searchResults.classList.add('open');
   }catch(error){if(sequence===searchSequence){searchResults.innerHTML='<div class="p1-notice p1-error">Sökningen misslyckades: '+esc1(error.message)+'</div>';searchResults.classList.add('open')}}
  },180)
 },true);
}
if(originalSearchResults){new MutationObserver(()=>{originalSearchResults.querySelectorAll('.search-item').forEach(item=>{const label=item.querySelector('.search-type');if(item.dataset.type==='track'&&label&&label.textContent!=='Bana')label.textContent='Bana'})}).observe(originalSearchResults,{childList:true,subtree:true})}
document.addEventListener('click',event=>{
 const result=event.target.closest('.search-item[data-id]');if(!result)return;
 const type=result.dataset.type,id=result.dataset.id;
 event.preventDefault();event.stopImmediatePropagation();originalSearchResults?.classList.remove('open');const input=document.getElementById('globalSearch');if(input)input.value='';
  if(type==='track'){currentRoute='statistics';setNav1('statistics');if(typeof openTrackDetail==='function')openTrackDetail(id);return}
 const page={horse:'horses',driver:'drivers',trainer:'trainers'}[type];
  if(page&&typeof openDetail==='function'){currentRoute='statistics';state.statisticsPage=page;setNav1('statistics');openDetail(page,id)}
},true);
installProfileNotes();installNav();
renderStorageNotice();
state.settingsOpen=false;state.page='start';document.getElementById('settingsButton')?.classList.remove('active');
window.__kentauraiPhase1Api=phase1Api;
window.__kentauraiPhase1.calculateSystem=calculateSystem;
window.__kentauraiPhase1.resultNet=resultNet;
window.__kentauraiPhase1.summarizeSystems=summarizeSystems;
window.__kentauraiPhase1.selectionResult=selectionResult;
window.__kentauraiPhase1.resultFormSegments=resultFormSegments;
window.__kentauraiPhase1.renderUpcoming=renderUpcoming;
window.__kentauraiPhase1.renderSystems=renderSystems;
window.__kentauraiPhase1.renderBuilder=renderBuilder;
currentRoute='trend';setNav1('trend');renderStart();
})();
</script>`;
}

export function enhancePhase1Html(html, { asOfDate } = {}) {
  if (typeof html !== 'string' || html.includes('kentaurai-phase1-script')) return html;
  let enhanced = html.replace('</head>', `${phase1Css}</head>`);
  const compatibility = '<script id="kentaurai-phase1-esbuild-compat">function __name(target){return target}</script>';
  const firstScript = enhanced.search(/<script(?:\s|>)/i);
  if (firstScript >= 0) enhanced = enhanced.slice(0, firstScript) + compatibility + enhanced.slice(firstScript);
  else enhanced = enhanced.replace('</body>', compatibility + '</body>');
  const date = asOfDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm' }).format(new Date());
  return enhanced.replace('</body>', `${phase1ClientScript(date)}</body>`);
}
