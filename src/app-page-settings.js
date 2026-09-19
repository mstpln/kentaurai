import {
  renderAppPage as renderHistoryAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-history.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

const gearIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.4 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.9 8.4c.2.37.5.72.6 1 .15.35.42.67.78.85.25.12.53.18.81.18H22a2 2 0 1 1 0 4h-.09c-.28 0-.56.06-.81.18-.36.18-.63.5-.78.85-.1.28-.4.63-.92.54Z"/></svg>`;

const settingsMarkup = `    <button class="settings-button" id="settingsButton" type="button" aria-label="Inställningar" title="Inställningar">${gearIcon}</button>\n`;

const settingsCss = `
<style id="kentaurai-settings-ui">
.settings-button{justify-self:end;width:42px;height:42px;border:1px solid var(--line);border-radius:11px;background:#121210;color:#9c958b;display:grid;place-items:center;cursor:pointer;padding:9px}.settings-button:hover,.settings-button.active{color:var(--accent-soft);border-color:#5b4933;background:#1a1712}.settings-button svg{width:21px;height:21px;display:block}
.settings-layout{max-width:920px}.settings-tabs{margin-bottom:22px}.settings-section{margin-top:16px}.settings-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}.settings-card-head{padding:18px 20px;border-bottom:1px solid var(--line-soft)}.settings-card-head h2{font-size:16px;font-weight:600;margin:0}.settings-card-head p{font-size:12px;line-height:1.55;color:var(--muted);margin:6px 0 0;max-width:720px}.settings-card-body{padding:20px}.settings-actions{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.settings-field{display:grid;gap:7px;min-width:210px}.settings-field label{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);font-weight:650}.settings-select,.settings-file{min-height:42px;border:1px solid var(--line);background:#10100f;color:var(--text);border-radius:10px;padding:9px 11px}.settings-file{padding:8px;max-width:100%}.settings-primary,.settings-secondary{min-height:42px;border-radius:10px;padding:10px 15px;cursor:pointer;font-weight:600}.settings-primary{border:1px solid var(--accent);background:var(--accent);color:#17120d}.settings-secondary{border:1px solid var(--line);background:#121210;color:var(--text)}.settings-primary:disabled,.settings-secondary:disabled{opacity:.5;cursor:default}.settings-help{font-size:12px;color:var(--muted);line-height:1.55;margin-top:12px}.settings-code{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#bbb3a8;background:#0d0d0c;border:1px solid var(--line-soft);border-radius:9px;padding:9px 11px;margin-top:9px;overflow-wrap:anywhere}.settings-result{display:none;margin-top:12px;padding:10px 12px;border-radius:10px;font-size:12px}.settings-result.show{display:block}.settings-result.success{border:1px solid #455743;background:#151c14;color:#a8bda4}.settings-result.error{border:1px solid #66413a;background:#211512;color:#d4a49a}
.settings-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.settings-count{border:1px solid var(--line-soft);background:#10100f;border-radius:11px;padding:14px}.settings-count strong{font-size:24px;font-weight:650;display:block}.settings-count span{display:block;color:var(--muted);font-size:11px;margin-top:3px}.settings-list{display:grid}.settings-row{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,2fr) auto;gap:14px;align-items:center;padding:13px 0;border-bottom:1px solid var(--line-soft)}.settings-row:last-child{border-bottom:0}.settings-row-title{font-size:13px;font-weight:550}.settings-row-meta{font-size:11px;color:var(--muted);margin-top:3px;line-height:1.45}.settings-row-output{font-size:11px;color:#aaa39a}.status-pill{font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--line);border-radius:999px;padding:5px 8px;white-space:nowrap}.status-pill.working,.status-pill.success{color:#a8bda4;border-color:#455743}.status-pill.warning,.status-pill.running,.status-pill.unknown{color:#d0b178;border-color:#665536}.status-pill.error{color:#d4a49a;border-color:#66413a}.settings-footer{margin-top:26px;padding-top:16px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--muted);font-size:11px}.settings-footer form{margin:0}.settings-logout{border:0;background:transparent;color:#aaa39a;padding:7px 0;cursor:pointer}.settings-logout:hover{color:var(--text)}
.analysis-section-title{font-size:18px;font-weight:650;margin:18px 0 10px}.analysis-card{border-color:#3a3125}.analysis-context{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:16px 18px;border-bottom:1px solid var(--line-soft)}.analysis-context .settings-field{min-width:230px}.analysis-card-body{padding:18px}.analysis-timeline{display:grid;grid-template-columns:34px minmax(0,1fr);gap:0 14px}.analysis-node{position:relative}.analysis-node span{width:30px;height:30px;border:1px solid #a77f49;border-radius:50%;display:grid;place-items:center;color:#d0b178;font-size:12px;font-weight:700}.analysis-node:not(.analysis-last)::after{content:"";position:absolute;top:31px;left:14px;bottom:-18px;width:1px;background:var(--line-soft)}.analysis-step{padding:2px 0 22px}.analysis-step h3{font-size:14px;margin:4px 0 10px}.analysis-import{margin-top:12px;align-items:end}.analysis-import .settings-field{min-width:260px}
@media(max-width:760px){.top-inner{position:relative}.settings-button{position:absolute;right:12px;top:10px;width:38px;height:38px}.brand{padding-right:48px}.settings-counts{grid-template-columns:1fr 1fr}.settings-row{grid-template-columns:1fr auto}.settings-row-output{grid-column:1/-1}.settings-layout{max-width:none}.analysis-context{display:grid}.analysis-context .settings-field,.analysis-import .settings-field{min-width:0;width:100%}.analysis-step .settings-actions,.analysis-import{display:grid}.analysis-step .settings-primary,.analysis-step .settings-secondary,.analysis-step .settings-file{width:100%;max-width:none}}
@media(max-width:430px){.settings-card-body,.settings-card-head{padding:16px}.settings-counts{grid-template-columns:1fr 1fr}.settings-actions{display:grid}.settings-field{min-width:0}.settings-primary,.settings-secondary{width:100%}}
</style>`;

const settingsScript = `
<script id="kentaurai-settings-script">
(function(){
const settingsButton=document.getElementById('settingsButton');
if(!settingsButton)return;
state.settingsTab=state.settingsTab||'ai';
const priorSetNav=setNav;
setNav=function(page){settingsButton.classList.remove('active');state.settingsOpen=false;priorSetNav(page)};
function clearMainNav(){document.querySelectorAll('.nav-item').forEach(b=>{b.classList.remove('active');b.removeAttribute('aria-current')})}
function statusText(status){return ({working:'Fungerar',success:'Klar',warning:'Varning',error:'Fel',running:'Pågår',unknown:'Okänd'})[status]||status}
function dateTimeSv(value){if(!value)return '—';const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short'}).format(d)}
function settingsFooter(version){return '<div class="settings-footer"><span>KentaurAI v'+esc(version||'—')+'</span><form method="post" action="/app/logout"><button class="settings-logout" type="submit">Logga ut</button></form></div>'}
async function copyPrompt(button,url){const old=button.textContent;button.disabled=true;try{const r=await fetch(url,{headers:{accept:'application/json'}});const data=await r.json();if(!r.ok||!data.prompt)throw new Error(data.message||'Kunde inte läsa instruktionerna');if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(data.prompt);else{const area=document.createElement('textarea');area.value=data.prompt;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}button.textContent='✓ Kopierat';setTimeout(()=>{button.textContent=old},1800)}catch{button.textContent='Kunde inte kopiera';setTimeout(()=>{button.textContent=old},1800)}finally{button.disabled=false}}
function selectedProvider(){return document.getElementById('analysisProvider')?.value||state.analysisProvider||'openai'}
function selectedAnalysisRound(){return document.getElementById('analysisRound')?.value||state.analysisRoundId||''}
function selectedRegistrationRound(){return document.getElementById('registrationRound')?.value||state.registrationRoundId||''}
function downloadSettingsFile(url){window.location.href=url}
async function loadExternalRounds(scope,selectId,stateKey){
 const select=document.getElementById(selectId);if(!select)return;
 try{
  const data=await api('/settings/external-rounds?scope='+encodeURIComponent(scope));
  const rounds=data.rounds||[];
  select.innerHTML=rounds.length?rounds.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.gameType)+' '+esc(r.roundDate)+(r.hasRecordedSystem?' · registrerad':'')+'</option>').join(''):'<option value="">Ingen komplett V85/V86-omgång</option>';
  const remembered=state[stateKey];
  if(remembered&&rounds.some(r=>r.id===remembered))select.value=remembered;
  state[stateKey]=select.value||'';
  select.onchange=()=>{state[stateKey]=select.value||''};
 }catch{
  select.innerHTML='<option value="">Kunde inte läsa omgångar</option>';
  state[stateKey]='';
 }
}
async function importRecordedSystemFile(){
 const button=document.getElementById('importRecordedSystem');
 const input=document.getElementById('recordedSystemFile');
 const box=document.getElementById('recordedSystemResult');
 const file=input?.files?.[0];
 const roundId=selectedRegistrationRound();
 if(!roundId){box.className='settings-result show error';box.textContent='Välj en omgång först.';return}
 if(!file){box.className='settings-result show error';box.textContent='Välj en JSON-fil först.';return}
 button.disabled=true;box.className='settings-result';
 try{
  const r=await fetch('/app/api/settings/system-import?round_id='+encodeURIComponent(roundId),{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:await file.text()});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.message||data.error||'Importen misslyckades');
  const system=data.systems?.[0];
  box.className='settings-result show success';
  box.textContent=system?'Systemet är sparat: '+system.spike_count+' spikar · '+system.row_count+' rader · '+system.cost_sek+' kr.':'Systemet är validerat och sparat.';
  await loadExternalRounds('registration','registrationRound','registrationRoundId');
 }catch(err){box.className='settings-result show error';box.textContent='Kunde inte importera systemet: '+err.message}
 finally{button.disabled=false}
}
function renderAi(version){
 app.innerHTML=heading('Inställningar','Hantera AI-utbyte och appdata')+tabs([['ai','AI'],['data','Data']],state.settingsTab)+'<div class="settings-layout">'+
 '<h2 class="analysis-section-title">Analysera omgång</h2>'+
 '<section id="canonicalAnalysisWorkflow" class="settings-section settings-card analysis-card">'+
  '<div class="analysis-context">'+
   '<div class="settings-field"><label for="analysisRound">Omgång</label><select id="analysisRound" class="settings-select"><option>Läser…</option></select></div>'+
   '<div class="settings-field"><label for="analysisProvider">AI</label><select id="analysisProvider" class="settings-select"><option value="openai">ChatGPT</option><option value="anthropic">Claude</option></select></div>'+
  '</div>'+
  '<div class="analysis-card-body"><div class="analysis-timeline">'+
   '<div class="analysis-node"><span>1</span></div><div class="analysis-step"><h3>Marknadsblind analys</h3><div class="settings-actions"><button id="downloadAnalysisData" class="settings-primary" type="button">Hämta analysdata</button><button id="copyStep1Prompt" class="settings-secondary" type="button">Kopiera instruktion</button></div></div>'+
   '<div class="analysis-node analysis-last"><span>2</span></div><div class="analysis-step"><h3>Marknad och system</h3><div class="settings-actions"><button id="downloadMarketData" class="settings-primary" type="button">Hämta marknadsdata</button><button id="copyStep2Prompt" class="settings-secondary" type="button">Kopiera instruktion</button></div></div>'+
  '</div></div>'+
 '</section>'+
 '<h2 class="analysis-section-title">Registrera system</h2>'+
 '<section class="settings-section settings-card analysis-card">'+
  '<div class="analysis-context"><div class="settings-field"><label for="registrationRound">Omgång</label><select id="registrationRound" class="settings-select"><option>Läser…</option></select></div></div>'+
  '<div class="analysis-card-body"><div class="analysis-timeline">'+
   '<div class="analysis-node analysis-last"><span>3</span></div><div class="analysis-step"><h3>Registrera färdigt system</h3>'+
    '<div class="settings-actions"><button id="downloadImportContext" class="settings-primary" type="button">Hämta importunderlag</button><button id="copyImportPrompt" class="settings-secondary" type="button">Kopiera importinstruktion</button></div>'+
    '<div class="settings-actions analysis-import"><div class="settings-field"><label for="recordedSystemFile">Systemfil</label><input id="recordedSystemFile" class="settings-file" type="file" accept="application/json,.json"></div><button id="importRecordedSystem" class="settings-secondary" type="button">Importera system</button></div>'+
    '<div id="recordedSystemResult" class="settings-result"></div>'+
   '</div>'+
  '</div></div>'+
 '</section>'+
 settingsFooter(version)+'</div>';
 bindSettingsTabs();
 const providerSelect=document.getElementById('analysisProvider');
 if(providerSelect){providerSelect.value=state.analysisProvider||'openai';providerSelect.onchange=()=>{state.analysisProvider=providerSelect.value}}
 function bindClick(id,handler){const node=document.getElementById(id);if(node)node.onclick=handler}
 bindClick('downloadAnalysisData',()=>{const id=selectedAnalysisRound();if(id)downloadSettingsFile('/app/api/settings/f3-analysis-pack?round_id='+encodeURIComponent(id))});
 bindClick('copyStep1Prompt',(event)=>copyPrompt(event.currentTarget,'/app/api/settings/external-step1-prompt?provider='+encodeURIComponent(selectedProvider())));
 bindClick('downloadMarketData',()=>{const id=selectedAnalysisRound();if(id)downloadSettingsFile('/app/api/settings/external-market?round_id='+encodeURIComponent(id))});
 bindClick('copyStep2Prompt',(event)=>copyPrompt(event.currentTarget,'/app/api/settings/external-step2-prompt?provider='+encodeURIComponent(selectedProvider())));
 bindClick('downloadImportContext',()=>{const id=selectedRegistrationRound();if(id)downloadSettingsFile('/app/api/settings/system-import-context?round_id='+encodeURIComponent(id))});
 bindClick('copyImportPrompt',(event)=>copyPrompt(event.currentTarget,'/app/api/settings/system-import-prompt?provider='+encodeURIComponent(selectedProvider())));
 bindClick('importRecordedSystem',importRecordedSystemFile);
 loadExternalRounds('analysis','analysisRound','analysisRoundId');
 loadExternalRounds('registration','registrationRound','registrationRoundId');
}
async function renderData(){
 app.innerHTML=heading('Inställningar','Hantera AI-utbyte och appdata')+tabs([['ai','AI'],['data','Data']],state.settingsTab)+'<div class="settings-layout"><div class="skeleton"></div></div>';
 bindSettingsTabs();
 try{const s=await api('/settings/status');if(!state.settingsOpen||state.settingsTab!=='data')return;const counts=s.counts||{};const runs=(s.recentRuns||[]).map(r=>'<div class="settings-row"><div><div class="settings-row-title">'+esc(r.name)+'</div><div class="settings-row-meta">'+esc(dateTimeSv(r.finishedAt||r.startedAt))+'</div></div><div class="settings-row-output">'+num(r.inserted)+' nya · '+num(r.updated)+' uppdaterade · '+num(r.skipped)+' hoppades över · '+num(r.errors)+' fel</div><span class="status-pill '+esc(r.status)+'">'+esc(statusText(r.status))+'</span></div>').join('')||'<div class="settings-help">Inga registrerade körningar ännu.</div>';const sources=(s.sources||[]).map(x=>'<div class="settings-row"><div><div class="settings-row-title">'+esc(x.name)+'</div><div class="settings-row-meta">Senast '+esc(dateTimeSv(x.lastRunAt))+'</div></div><div class="settings-row-output">'+esc(x.message)+'</div><span class="status-pill '+esc(x.status)+'">'+esc(statusText(x.status))+'</span></div>').join('');app.innerHTML=heading('Inställningar','Hantera AI-utbyte och appdata')+tabs([['ai','AI'],['data','Data']],state.settingsTab)+'<div class="settings-layout"><section class="settings-section settings-card"><div class="settings-card-head"><h2>Datamängd</h2></div><div class="settings-card-body"><div class="settings-counts"><div class="settings-count"><strong>'+num(counts.trainers)+'</strong><span>Tränare</span></div><div class="settings-count"><strong>'+num(counts.horses)+'</strong><span>Hästar</span></div><div class="settings-count"><strong>'+num(counts.drivers)+'</strong><span>Kuskar</span></div><div class="settings-count"><strong>'+num(counts.games)+'</strong><span>V85/V86-omgångar</span></div></div></div></section><section class="settings-section settings-card"><div class="settings-card-head"><h2>Senaste körningar</h2><p>Visar vad de senaste registrerade importerna och arbetsflödena producerade och om fel registrerades.</p></div><div class="settings-card-body"><div class="settings-list">'+runs+'</div></div></section><section class="settings-section settings-card"><div class="settings-card-head"><h2>Datakällor</h2><p>En snabb hälsobild baserad på de senaste registrerade körningarna.</p></div><div class="settings-card-body"><div class="settings-list">'+sources+'</div><div class="settings-help">'+esc(s.sourceStatusNote||'')+'</div></div></section>'+settingsFooter(s.appVersion)+'</div>';bindSettingsTabs();}catch(err){app.innerHTML=heading('Inställningar','Hantera AI-utbyte och appdata')+tabs([['ai','AI'],['data','Data']],state.settingsTab)+'<div class="notice">Kunde inte läsa status: '+esc(err.message)+'</div>';bindSettingsTabs()}
}
function bindSettingsTabs(){document.querySelectorAll('.tab[data-tab]').forEach(b=>b.onclick=()=>{state.settingsTab=b.dataset.tab;renderSettings()})}
async function renderSettings(){state.settingsOpen=true;state.detail=null;state.gameDetail=null;state.gameSystemId=null;settingsButton.classList.add('active');clearMainNav();if(state.settingsTab==='data')return renderData();let version='—';try{version=(await api('/settings/status')).appVersion}catch{}if(!state.settingsOpen)return;renderAi(version)}
settingsButton.onclick=()=>{state.settingsTab=state.settingsTab||'ai';renderSettings()};
})();
</script>`;

export function renderAppPage() {
  return renderHistoryAppPage()
    .replace('  </div></header>\n  <main id="app"', `${settingsMarkup}  </div></header>\n  <main id="app"`)
    .replace('</head>', `${settingsCss}</head>`)
    .replace('</body>', `${settingsScript}</body>`);
}
