import {
  renderAppPage as renderBaseAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

const chartLineIcon = `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0v94.37L90.73,98a8,8,0,0,1,10.07-.38l58.81,44.11L218.73,90a8,8,0,1,1,10.54,12l-64,56a8,8,0,0,1-10.07.38L96.39,114.29,40,163.63V200H224A8,8,0,0,1,232,208Z"/></svg>`;

const brainIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/></svg>`;

const bicepsIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 10 2a3 3 0 0 1 3 3 2 2 0 0 1-2 2c-1.105 0-1.64-.444-2-1"/><path d="M15 14a5 5 0 0 0-7.584 2"/><path d="M9.964 6.825C8.019 7.977 9.5 13 8 15"/></svg>`;

const polishCss = `
<style id="kentaurai-polish">
.top-inner{grid-template-columns:auto minmax(280px,680px)}
.top-inner>form{display:none}
.period-badge{border:0!important;border-radius:0!important;padding:0!important;background:transparent!important;color:#a39c92!important;align-self:flex-start;margin-top:3px}
.nav-item[data-page="start"] .nav-icon,.nav-item[data-page="trainers"] .nav-icon,.nav-item[data-page="drivers"] .nav-icon{fill:none}
.nav-item[data-page="trainers"] .nav-icon,.nav-item[data-page="drivers"] .nav-icon{stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.nav-item[data-page="start"] .nav-icon{fill:currentColor}
.avatar{font-size:0;color:var(--accent-soft)}
.avatar .profile-icon{width:34px;height:34px;display:block}
.avatar .profile-icon.stroke{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.avatar .profile-icon.fill{fill:currentColor}
.data-groups{display:grid;gap:14px}
.data-section{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.data-section-head{padding:13px 15px;border-bottom:1px solid var(--line-soft);display:flex;justify-content:space-between;gap:12px;align-items:center}
.data-section-head h2{font-size:14px;margin:0;font-weight:650}
.data-section-head span{font-size:11px;color:var(--muted)}
.data-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.data-item{padding:12px 14px;border-right:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft);min-width:0}
.data-item:nth-child(3n){border-right:0}
.data-label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.data-value{margin-top:4px;font-size:13px;overflow-wrap:anywhere}
.breakdown-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.breakdown-table{width:100%;border-collapse:collapse}
.breakdown-table th,.breakdown-table td{padding:9px 11px;border-bottom:1px solid var(--line-soft);font-size:12px;text-align:left}
.breakdown-table th{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:650}
.breakdown-table tr:last-child td{border-bottom:0}
.start-cards{display:grid;gap:10px}
.start-card{border:1px solid var(--line);border-radius:13px;background:var(--panel);overflow:hidden}
.start-card summary{list-style:none;cursor:pointer;padding:14px 15px;display:flex;justify-content:space-between;gap:14px;align-items:center}
.start-card summary::-webkit-details-marker{display:none}
.start-summary-main{min-width:0}.start-summary-title{font-weight:600}.start-summary-meta{font-size:11px;color:var(--muted);margin-top:3px}
.start-summary-result{text-align:right;white-space:nowrap}.start-summary-result strong{font-size:16px}.start-summary-result span{display:block;font-size:10px;color:var(--muted);margin-top:2px}
.start-details{border-top:1px solid var(--line-soft);padding:13px;display:grid;gap:12px}
.coverage-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
.coverage-card{border:1px solid var(--line);border-radius:11px;padding:11px;background:#11110f}.coverage-value{font-size:20px;font-weight:650}.coverage-label{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:3px}
.tag-list{display:flex;flex-wrap:wrap;gap:6px}.data-tag{border:1px solid var(--line);border-radius:999px;padding:5px 8px;font-size:11px;color:#b8b0a5;background:#11110f}
@media(max-width:900px){.data-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.data-item:nth-child(3n){border-right:1px solid var(--line-soft)}.data-item:nth-child(2n){border-right:0}.breakdown-grid{grid-template-columns:1fr}.coverage-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:760px){.top-inner{grid-template-columns:1fr}.data-grid{grid-template-columns:1fr 1fr}.coverage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.start-card summary{align-items:flex-start}}
@media(max-width:430px){.data-grid{grid-template-columns:1fr}.data-item{border-right:0!important}.coverage-grid{grid-template-columns:1fr 1fr}}
</style>`;

const polishScript = `
<script id="kentaurai-polish-script">
const POLISH_ICONS={
  trend:${JSON.stringify(chartLineIcon)},
  trainer:${JSON.stringify(brainIcon)},
  driver:${JSON.stringify(bicepsIcon)}
};
function polishReplaceNavIcon(page,svg){const btn=document.querySelector('.nav-item[data-page="'+page+'"]');if(!btn)return;const old=btn.querySelector('.nav-icon');if(!old)return;const holder=document.createElement('span');holder.innerHTML=svg;const next=holder.firstElementChild;next.classList.add('nav-icon');old.replaceWith(next)}
polishReplaceNavIcon('start',POLISH_ICONS.trend);polishReplaceNavIcon('trainers',POLISH_ICONS.trainer);polishReplaceNavIcon('drivers',POLISH_ICONS.driver);
const startNav=document.querySelector('.nav-item[data-page="start"]');if(startNav){for(const node of Array.from(startNav.childNodes)){if(node.nodeType===Node.TEXT_NODE&&node.textContent.trim()==='Start')node.textContent='Trend'}}
function polishVal(v){return v===null||v===undefined||v===''?'—':String(v)}
function yesNo(v){return v===null||v===undefined?'—':v?'Ja':'Nej'}
function dataItem(label,value){return '<div class="data-item"><div class="data-label">'+esc(label)+'</div><div class="data-value">'+esc(polishVal(value))+'</div></div>'}
function dataSection(title,items,note=''){const visible=items.filter(x=>x&&x[1]!==undefined);if(!visible.length)return '';return '<section class="data-section"><div class="data-section-head"><h2>'+esc(title)+'</h2>'+(note?'<span>'+esc(note)+'</span>':'')+'</div><div class="data-grid">'+visible.map(x=>dataItem(x[0],x[1])).join('')+'</div></section>'}
function coverage(detail){const c=detail.coverage||{};const cards=[['Starter',c.starts],['Marknad',c.startsWithMarket],['Odds',c.startsWithOdds],['Utrustning',c.startsWithEquipment],['X-Labs',c.startsWithXLabs],['Positioner',c.startsWithPositions],['Features',c.startsWithFeatures]];return '<div class="coverage-grid">'+cards.map(([l,v])=>'<div class="coverage-card"><div class="coverage-value">'+num(v||0)+'</div><div class="coverage-label">'+esc(l)+'</div></div>').join('')+'</div>'}
function breakdown(title,rows,labelFn){if(!rows||!rows.length)return '';return '<div class="data-section"><div class="data-section-head"><h2>'+esc(title)+'</h2></div><table class="breakdown-table"><thead><tr><th>Grupp</th><th>Starter</th><th>Vinster</th><th>Vinst %</th><th>Topp 3 %</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(labelFn?labelFn(r.label):r.label)+'</td><td>'+num(r.starts)+'</td><td>'+num(r.wins)+'</td><td>'+pct(r.winRate)+'</td><td>'+pct(r.top3Rate)+'</td></tr>').join('')+'</tbody></table></div>'}
function featureTags(features){if(!features||!features.length)return '<span class="metric-note">Inga beräknade features lagrade.</span>';return '<div class="tag-list">'+features.map(f=>'<span class="data-tag">'+esc(f.name)+': '+esc(f.numericValue!=null?dec(f.numericValue,2):polishVal(f.textValue))+'</span>').join('')+'</div>'}
function positionTags(items){if(!items||!items.length)return '<span class="metric-note">Inga positionsmätningar lagrade.</span>';return '<div class="tag-list">'+items.map(p=>'<span class="data-tag">'+esc((p.observedAtM==null?'Position':p.observedAtM+' m')+' · '+(p.position==null?'—':'#'+p.position)+(p.lane==null?'':' · spår '+p.lane))+'</span>').join('')+'</div>'}
function oddsText(items){if(!items||!items.length)return '—';return items.map(o=>o.marketType+' '+(o.odds==null?'—':dec(o.odds,2))).join(' · ')}
function changesText(changes){if(!changes)return '—';const labels={shoesFrontChanged:'Framskor',shoesRearChanged:'Bakskor',sulkyTypeChanged:'Vagn',sulkyColourChanged:'Vagnfärg'};const vals=Object.entries(changes).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>(labels[k]||k)+': '+(v?'ändrad':'oförändrad'));return vals.join(' · ')||'—'}
function startCards(detail){const rows=detail.starts||[];if(!rows.length)return empty('Inga starter att visa','Databasen har ännu inga starter kopplade till denna profil.');return '<div class="start-cards">'+rows.map((r,i)=>{const title=(r.game_type?r.game_type+' · ':'')+(r.track_name||'Okänd bana')+' · '+(r.race_date||'—');const who=r.horse_name||detail.entity.name||'—';const result=r.placing_text||r.placing||'—';const x=r.xlabs||{};const eq=r.equipment||{};return '<details class="start-card" '+(i===0?'open':'')+'><summary><div class="start-summary-main"><div class="start-summary-title">'+esc(who)+'</div><div class="start-summary-meta">'+esc(title+(r.leg_number?' · Avd '+r.leg_number:'')+(r.distance_m?' · '+r.distance_m+' m':'')+' · '+localStartMethod(r.start_method))+'</div></div><div class="start-summary-result"><strong>'+esc(result)+'</strong><span>'+esc(r.km_time||'')+'</span></div></summary><div class="start-details">'+
 dataSection('Lopp & start',[['Lopp',r.race_name],['Loppnummer',r.race_number],['Bana',r.track_name],['Datum',r.race_date],['Distans',r.distance_m==null?null:r.distance_m+' m'],['Startmetod',localStartMethod(r.start_method)],['Startnummer',r.start_number],['Spår',r.actual_lane],['Startvolte',r.start_tier],['Tillägg',r.handicap_m==null?null:r.handicap_m+' m'],['Faktisk startdistans',r.actual_start_distance_m==null?null:r.actual_start_distance_m+' m'],['Bakspår',yesNo(r.back_row)],['Innerspår',yesNo(r.inner_lane)],['Springspår',yesNo(r.springspar)],['Stryken',yesNo(r.scratched)],['Datakvalitet',r.data_quality]])+
 dataSection('Resultat',[['Placering',r.placing_text||r.placing],['Sluttid',r.finish_time],['Km-tid',r.km_time],['Prispengar',r.prize_sek==null?null:money(r.prize_sek)],['Galopp',yesNo(r.gallop)],['Diskvalificerad',yesNo(r.disqualified)],['Avstånd till vinnare',r.distance_behind_winner_m==null?null:r.distance_behind_winner_m+' m'],['Officiellt odds',r.official_odds==null?null:dec(r.official_odds,2)],['Resultatstatus',r.result_status]])+
 dataSection('Marknad & odds',[['Streck',r.betting?.betPercent==null?null:pct(r.betting.betPercent)],['Marknadsrank',r.betting?.marketRank],['Streck fångat',r.betting?.capturedAt],['Odds',oddsText(r.odds)]])+
 dataSection('Utrustning',[['Framskor',eq.shoesFront],['Bakskor',eq.shoesRear],['Barfota fram',yesNo(eq.barefootFront)],['Barfota bak',yesNo(eq.barefootRear)],['Sulky',eq.sulkyType],['Exakt sulky',eq.exactSulky],['Huvudlag',eq.headgear],['Öronproppar',eq.earplugs],['Övrigt',eq.otherEquipment],['Förändringar',changesText(eq.changes)],['Verifiering',eq.verificationStatus],['Observerat',eq.observedAt]])+
 dataSection('X-Labs',[['Första 200',x.first200Time],['Sista 200',x.last200Time],['Sista 400',x.last400Time],['Sista 500',x.last500Time],['Sista 800',x.last800Time],['Sista 1000',x.last1000Time],['Faktisk distans',x.actualDistanceM==null?null:x.actualDistanceM+' m'],['Extra distans',x.extraDistanceM==null?null:x.extraDistanceM+' m'],['Omräknad km-tid',x.convertedKmTime],['Ryggresa',x.slipstreamM==null?null:x.slipstreamM+' m'],['Kvalitet',x.qualityStatus],['Observerat',x.observedAt]])+
 '<section class="data-section"><div class="data-section-head"><h2>Positioner</h2><span>'+num((r.positions||[]).length)+' observationer</span></div><div class="card-pad">'+positionTags(r.positions)+'</div></section>'+
 '<section class="data-section"><div class="data-section-head"><h2>Beräknade features</h2><span>Code calculates</span></div><div class="card-pad">'+featureTags(r.features)+'</div></section>'+
 dataSection('Förhållanden',[['Banstatus',r.track_status],['Temperatur',r.temperature_c==null?null:r.temperature_c+' °C'],['Vind',r.wind_mps==null?null:r.wind_mps+' m/s'],['Vindriktning',r.wind_direction],['Nederbörd',r.precipitation_mm==null?null:r.precipitation_mm+' mm'],['Väder',r.weather_text]])+
 '</div></details>'}).join('')+'</div>'}
function profileIcon(type){if(type==='trainer')return POLISH_ICONS.trainer;if(type==='driver')return POLISH_ICONS.driver;return icon('horse','profile-icon fill')}
const baseRenderStart=renderStart;
renderStart=async function(){await baseRenderStart();const h=document.querySelector('.start-heading h1');if(h)h.textContent='Trend';const p=document.querySelector('.start-heading p');if(p)p.textContent='Jämför utveckling för tränare, hästar och kuskar över valda tidsperioder.';const badge=document.querySelector('.period-badge');if(badge)badge.setAttribute('aria-label','Vald tidsperiod')};
renderDetail=async function(){const {page,id}=state.detail;const detail=await api('/entities/'+page+'/'+encodeURIComponent(id));const e=detail.entity;const type=detail.type;const obs=detail.latestObservation?.fields||{};app.innerHTML='<button class="back" id="backBtn">← '+labels[page]+'</button><div class="detail-head"><div class="avatar">'+profileIcon(type)+'</div><div><div class="eyebrow">'+singular[type]+'</div><div class="detail-name">'+esc(e.name)+'</div><div class="detail-meta">'+esc(e.country_code||obs.location||'')+'</div></div></div>'+tabs(detailTabs(type),state.tab);
if(state.tab==='overview'){
 let identity=[];
 if(type==='horse')identity=[['Namn',e.name],['Land',e.country_code],['Aktiv',yesNo(e.active)],['Kön',localSex(e.sex)],['Födelseår',e.birth_year],['Ålder',obs.ageYears],['Ras',e.breed],['Färg',e.color],['Hemmabana',e.home_track_name],['Tränare',e.trainer_name],['Ägare',e.owner],['Uppfödare',e.breeder],['Far',e.sire_name],['Mor',e.dam_name],['Morfar',e.damsire_name],['Rekord',e.record_text],['Karriärintäkt',e.career_earnings_sek==null?null:money(e.career_earnings_sek)]];
 else identity=[['Namn',e.name],['Land',e.country_code],['Aktiv',yesNo(e.active)],['Hemmabana',e.home_track_name||obs.homeTrackName],['Plats',obs.location],['Födelseår',obs.birthYear],['Licens',obs.license],['Senast observerad',detail.latestObservation?.observedAt],['Datakvalitet',detail.latestObservation?.qualityStatus]];
 app.innerHTML+='<div class="data-groups">'+dataSection('Profil',identity)+dataSection('Aktivitet',[['Starter i databasen',detail.stats.databaseStarts],['Starter med resultat',detail.stats.resultStarts],['Vinster',detail.stats.wins],['Andraplatser',detail.stats.seconds],['Tredjeplatser',detail.stats.thirds],['Topp 3',detail.stats.top3],['Vinstprocent',pct(detail.stats.winRate)],['Topp 3-procent',pct(detail.stats.top3Rate)],['Galopper',detail.stats.gallops],['Diskvalifikationer',detail.stats.disqualifications],['Prispengar',money(detail.stats.prizeSek)],['V85-starter',detail.stats.v85Starts],['V86-starter',detail.stats.v86Starts]])+'<section class="data-section"><div class="data-section-head"><h2>Datatäckning</h2><span>lagrade mätningar</span></div><div class="card-pad">'+coverage(detail)+'</div></section></div>';
}
if(state.tab==='stats')app.innerHTML+='<div class="data-groups">'+dataSection('Resultat',[['Starter med resultat',detail.stats.resultStarts],['Vinster',detail.stats.wins],['Andraplatser',detail.stats.seconds],['Tredjeplatser',detail.stats.thirds],['Topp 3',detail.stats.top3],['Vinstprocent',pct(detail.stats.winRate)],['Topp 3-procent',pct(detail.stats.top3Rate)],['Galopper',detail.stats.gallops],['Diskvalifikationer',detail.stats.disqualifications],['Prispengar',money(detail.stats.prizeSek)]])+ '<div class="breakdown-grid">'+breakdown('Startmetod',detail.breakdowns?.startMethods,r=>localStartMethod(r))+breakdown('Distans',detail.breakdowns?.distances,r=>r==='unknown'?'Okänd':r+' m')+breakdown('Bana',detail.breakdowns?.tracks)+'</div></div>';
if(state.tab==='starts')app.innerHTML+=startCards(detail);
if(state.tab==='equipment'){const equipped=(detail.starts||[]).filter(r=>r.equipment);app.innerHTML+=equipped.length?startCards({...detail,starts:equipped}):empty('Ingen utrustningshistorik','Det finns ännu inga lagrade utrustningsobservationer för hästen.')}
if(state.tab==='horses'){const seen=new Map();(detail.starts||[]).forEach(r=>{if(r.horse_id)seen.set(r.horse_id,r.horse_name)});app.innerHTML+=seen.size?'<div class="card"><div class="card-pad">'+Array.from(seen.entries()).map(([hid,name])=>'<div class="status-row"><span>'+esc(name)+'</span><span class="link" data-horse="'+esc(hid)+'">Öppna ›</span></div>').join('')+'</div></div>':empty('Inga hästar ännu','Ingen hästhistorik är kopplad till denna profil i databasen.')}
document.getElementById('backBtn').onclick=()=>{state.detail=null;state.tab='list';renderEntityList(page)};bindTabs(renderDetail);document.querySelectorAll('[data-horse]').forEach(x=>x.onclick=()=>openDetail('horses',x.dataset.horse));
};
renderStart().catch(()=>{});
</script>`;

export function renderAppPage() {
  const html = renderBaseAppPage();
  return html
    .replace('</head>', `${polishCss}</head>`)
    .replace('</body>', `${polishScript}</body>`);
}
