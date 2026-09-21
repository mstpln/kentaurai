import {
  renderAppPage as renderHistoryAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-history.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

const gearIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.4 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.9 8.4c.2.37.5.72.6 1 .15.35.42.67.78.85.25.12.53.18.81.18H22a2 2 0 1 1 0 4h-.09c-.28 0-.56.06-.81.18-.36.18-.63.5-.78.85-.1.28-.4.63-.92.54Z"/></svg>`;

const settingsMarkup = `    <button class="settings-button" id="settingsButton" type="button" aria-label="Inställningar" title="Inställningar">${gearIcon}<span class="settings-alert-badge" id="settingsAlertBadge" aria-hidden="true"></span></button>\n`;

const settingsCss = `
<style id="kentaurai-settings-ui">
.settings-button{position:relative;justify-self:end;width:42px;height:42px;border:1px solid var(--line);border-radius:11px;background:#121210;color:#9c958b;display:grid;place-items:center;cursor:pointer;padding:9px}.settings-button:hover,.settings-button.active{color:var(--accent-soft);border-color:#5b4933;background:#1a1712}.settings-button svg{width:21px;height:21px;display:block}.settings-alert-badge{display:none;position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;background:#c95f54;border:1.5px solid var(--bg);box-sizing:content-box}.settings-alert-badge.show{display:block}
.settings-layout{max-width:920px}.settings-tabs{margin-bottom:22px}.settings-section{margin-top:16px}.settings-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}.settings-card-head{padding:18px 20px;border-bottom:1px solid var(--line-soft)}.settings-card-head h2{font-size:16px;font-weight:600;margin:0}.settings-card-head p{font-size:12px;line-height:1.55;color:var(--muted);margin:6px 0 0;max-width:720px}.settings-card-body{padding:20px}.settings-actions{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.settings-field{display:grid;gap:7px;min-width:210px}.settings-field label{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);font-weight:650}.settings-select,.settings-file{min-height:42px;border:1px solid var(--line);background:#10100f;color:var(--text);border-radius:10px;padding:9px 11px}.settings-file{padding:8px;max-width:100%}.settings-primary,.settings-secondary{min-height:42px;border-radius:10px;padding:10px 15px;cursor:pointer;font-weight:600}.settings-primary{border:1px solid var(--accent);background:var(--accent);color:#17120d}.settings-secondary{border:1px solid var(--line);background:#121210;color:var(--text)}.settings-primary:disabled,.settings-secondary:disabled{opacity:.5;cursor:default}.settings-help{font-size:12px;color:var(--muted);line-height:1.55;margin-top:12px}.settings-code{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#bbb3a8;background:#0d0d0c;border:1px solid var(--line-soft);border-radius:9px;padding:9px 11px;margin-top:9px;overflow-wrap:anywhere}.settings-result{display:none;margin-top:12px;padding:10px 12px;border-radius:10px;font-size:12px}.settings-result.show{display:block}.settings-result.success{border:1px solid #455743;background:#151c14;color:#a8bda4}.settings-result.error{border:1px solid #66413a;background:#211512;color:#d4a49a}
.settings-source-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.settings-source-card{background:#10100f;border:1px solid var(--line-soft);border-radius:12px;padding:16px;min-width:0}.settings-source-card.issue{border-color:#4b302c;background:#12100e}.settings-source-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.settings-source-title{font-size:14px;font-weight:600;line-height:1.25}.settings-source-desc{font-size:10.5px;color:var(--muted);margin-top:4px;line-height:1.45}.settings-source-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 8px;font-size:9.5px;font-weight:650;white-space:nowrap;border:1px solid}.settings-source-pill:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex:0 0 auto}.settings-source-pill.working,.settings-source-pill.running,.settings-source-pill.completed{color:#a8bda4;border-color:#455743;background:#151c14}.settings-source-pill.error_retrying,.settings-source-pill.action_required{color:#d4a49a;border-color:#66413a;background:#211512}.settings-source-pill.waiting,.settings-source-pill.never_run{color:#aaa39a;border-color:#3b382f;background:#121210}.settings-source-job{margin-top:17px}.settings-source-job-line{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:11px}.settings-source-job-line span:first-child{color:var(--muted)}.settings-source-job-line strong{font-weight:650}.settings-source-job-line strong.running,.settings-source-job-line strong.completed{color:#a8bda4}.settings-source-job-line strong.action_required{color:#d4a49a}.settings-progress{height:4px;background:#24221e;border-radius:999px;overflow:hidden;margin-top:8px}.settings-progress-fill{height:100%;border-radius:999px;background:#677963}.settings-source-stats{display:grid;grid-template-columns:1fr 1fr;gap:11px 14px;margin-top:15px;padding-top:14px;border-top:1px solid var(--line-soft)}.settings-source-stat small{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.055em;margin-bottom:3px}.settings-source-stat strong{display:block;font-size:11px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}.settings-source-error{margin-top:14px;border:1px solid #66413a;background:#211512;border-radius:9px;padding:10px 11px;color:#d4a49a;font-size:10.5px;line-height:1.5}.settings-source-error strong{font-weight:700;color:#e1aaa1}.settings-source-error-detail{margin-top:4px;color:#b9958f;overflow-wrap:anywhere}
.settings-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.settings-count{border:1px solid var(--line-soft);background:#10100f;border-radius:11px;padding:14px}.settings-count strong{font-size:24px;font-weight:650;display:block}.settings-count span{display:block;color:var(--muted);font-size:11px;margin-top:3px}.settings-list{display:grid}.settings-row{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,2fr) auto;gap:14px;align-items:center;padding:13px 0;border-bottom:1px solid var(--line-soft)}.settings-row:last-child{border-bottom:0}.settings-row-title{font-size:13px;font-weight:550}.settings-row-meta{font-size:11px;color:var(--muted);margin-top:3px;line-height:1.45}.settings-row-output{font-size:11px;color:#aaa39a}.status-pill{font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--line);border-radius:999px;padding:5px 8px;white-space:nowrap}.status-pill.working,.status-pill.success,.status-pill.running{color:#a8bda4;border-color:#455743}.status-pill.warning,.status-pill.error{color:#d4a49a;border-color:#66413a}.status-pill.unknown{color:#aaa39a;border-color:#3b382f}.settings-footer{margin-top:26px;padding-top:16px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--muted);font-size:11px}.settings-footer form{margin:0}.settings-logout{border:0;background:transparent;color:#aaa39a;padding:7px 0;cursor:pointer}.settings-logout:hover{color:var(--text)}
.analysis-section-title{font-size:18px;font-weight:650;margin:18px 0 10px}.analysis-card{border-color:#3a3125}.analysis-context{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:16px 18px;border-bottom:1px solid var(--line-soft)}.analysis-context .settings-field{min-width:230px}.analysis-card-body{padding:18px}.analysis-timeline{display:grid;grid-template-columns:34px minmax(0,1fr);gap:0 14px}.analysis-node{position:relative}.analysis-node span{width:30px;height:30px;border:1px solid #a77f49;border-radius:50%;display:grid;place-items:center;color:#d0b178;font-size:12px;font-weight:700}.analysis-node:not(.analysis-last)::after{content:"";position:absolute;top:31px;left:14px;bottom:-18px;width:1px;background:var(--line-soft)}.analysis-step{padding:2px 0 22px}.analysis-step h3{font-size:14px;margin:4px 0 5px}.analysis-step p{font-size:11px;line-height:1.45;color:var(--muted);margin:0 0 10px}.analysis-pill{display:inline-flex;margin-left:7px;padding:3px 7px;border:1px solid var(--line-soft);border-radius:999px;color:var(--muted);font-size:9px;font-weight:550;vertical-align:1px}.analysis-import{margin-top:12px;align-items:end}.analysis-import .settings-field{min-width:260px}.analysis-register-head{display:grid;grid-template-columns:34px minmax(0,1fr);gap:14px;padding:18px 18px 10px}.analysis-register-head h3{font-size:14px;margin:4px 0 4px}.analysis-register-head p{font-size:11px;color:var(--muted);margin:0}.analysis-register-body{padding:0 18px 18px 66px}.analysis-callout{font-size:11px;color:var(--muted);border:1px solid var(--line-soft);border-radius:9px;padding:9px 11px;margin-top:12px}
@media(max-width:760px){.top-inner{position:relative}.settings-button{position:absolute;right:12px;top:10px;width:38px;height:38px}.brand{padding-right:48px}.settings-counts{grid-template-columns:1fr 1fr}.settings-row{grid-template-columns:1fr auto}.settings-row-output{grid-column:1/-1}.settings-layout{max-width:none}.analysis-context{display:grid}.analysis-context .settings-field,.analysis-import .settings-field{min-width:0;width:100%}.analysis-step .settings-actions,.analysis-import{display:grid}.analysis-step .settings-primary,.analysis-step .settings-secondary,.analysis-step .settings-file{width:100%;max-width:none}}
@media(max-width:760px){.settings-source-grid{grid-template-columns:1fr}}
@media(max-width:430px){.settings-card-body,.settings-card-head{padding:16px}.settings-counts{grid-template-columns:1fr 1fr}.settings-actions{display:grid}.settings-field{min-width:0}.settings-primary,.settings-secondary{width:100%}}
</style>`;

const settingsScript = `
<script id="kentaurai-settings-script">
(function(){
const settingsButton=document.getElementById('settingsButton');
if(!settingsButton)return;
state.settingsTab='data';
const priorSetNav=setNav;
setNav=function(page){settingsButton.classList.remove('active');state.settingsOpen=false;priorSetNav(page)};
function clearMainNav(){document.querySelectorAll('.nav-item').forEach(b=>{b.classList.remove('active');b.removeAttribute('aria-current')})}
function statusText(status){return ({working:'Fungerar',success:'Klar',warning:'Varning',error:'Fel upptäckt',running:'Pågår',never_run:'Ingen körning ännu',waiting:'Väntar',completed:'Klar',error_retrying:'Fel upptäckt',action_required:'Åtgärd krävs'})[status]||status}
function dateTimeSv(value){if(!value)return '—';const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short'}).format(d)}
function settingsFooter(version){return '<div class="settings-footer"><span>KentaurAI v'+esc(version||'—')+'</span><form method="post" action="/app/logout"><button class="settings-logout" type="submit">Logga ut</button></form></div>'}
async function copyPrompt(button,url){const old=button.textContent;button.disabled=true;try{const r=await fetch(url,{headers:{accept:'application/json'}});const data=await r.json();if(!r.ok||!data.prompt)throw new Error(data.message||'Kunde inte läsa instruktionerna');if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(data.prompt);else{const area=document.createElement('textarea');area.value=data.prompt;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}button.textContent='✓ Kopierat';setTimeout(()=>{button.textContent=old},1800)}catch{button.textContent='Kunde inte kopiera';setTimeout(()=>{button.textContent=old},1800)}finally{button.disabled=false}}
function selectedProvider(){return document.getElementById('analysisProvider')?.value||state.analysisProvider||'openai'}
function selectedAnalysisRound(){return document.getElementById('analysisRound')?.value||state.analysisRoundId||''}
function selectedRegistrationRound(){return document.getElementById('registrationRound')?.value||state.registrationRoundId||''}
function selectedEvidenceRegistrationRound(){return document.getElementById('evidenceRegistrationRound')?.value||state.evidenceRegistrationRoundId||''}
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
async function importExternalEvidenceFile(){
 const button=document.getElementById('importExternalEvidence');
 const input=document.getElementById('externalEvidenceFile');
 const box=document.getElementById('externalEvidenceResult');
 const file=input?.files?.[0];
 const roundId=selectedEvidenceRegistrationRound();
 if(!roundId){box.className='settings-result show error';box.textContent='Välj en omgång först.';return}
 if(!file){box.className='settings-result show error';box.textContent='Välj en JSON-fil först.';return}
 button.disabled=true;box.className='settings-result';
 try{
  const r=await fetch('/app/api/settings/external-evidence-import?round_id='+encodeURIComponent(roundId),{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:await file.text()});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.message||data.error||'Importen misslyckades');
  const counts=data.counts||{};
  box.className='settings-result show success';
  box.textContent='Extern data sparad: '+num(counts.statistics||0)+' statistikobservationer · '+num(counts.interviews||0)+' intervjuer.';
 }catch(err){box.className='settings-result show error';box.textContent='Kunde inte importera extern data: '+err.message}
 finally{button.disabled=false}
}
function renderAnalysis(){
 state.settingsOpen=false;state.settingsTab='data';state.detail=null;state.gameDetail=null;state.gameSystemId=null;state.page='analysis';settingsButton.classList.remove('active');setNav('analysis');
 app.innerHTML=heading('Analys','Analysera omgångar och registrera underlag')+'<div class="settings-layout">'+
 '<h2 class="analysis-section-title">Analysera omgång</h2>'+
 '<section id="canonicalAnalysisWorkflow" class="settings-section settings-card analysis-card">'+
  '<div class="analysis-context">'+
   '<div class="settings-field"><label for="analysisRound">Omgång</label><select id="analysisRound" class="settings-select"><option>Läser…</option></select></div>'+
   '<div class="settings-field"><label for="analysisProvider">AI</label><select id="analysisProvider" class="settings-select"><option value="openai">ChatGPT</option><option value="anthropic">Claude</option></select></div>'+
  '</div>'+
  '<div class="analysis-card-body"><div class="analysis-timeline">'+
   '<div class="analysis-node"><span>1</span></div><div class="analysis-step"><h3>Marknadsblind analys <span class="analysis-pill">Ny AI-konversation</span></h3><p>Blind sportslig analys utan marknad, intervjuer eller krönikor.</p><div class="settings-actions"><button id="downloadAnalysisData" class="settings-primary" type="button">Hämta analysdata</button><button id="copyStep1Prompt" class="settings-secondary" type="button">Kopiera instruktion</button></div></div>'+
   '<div class="analysis-node"><span>2</span></div><div class="analysis-step"><h3>Marknadsanalys <span class="analysis-pill">Samma AI-konversation</span></h3><p>Jämför den blinda analysen mot streck, odds och marknadsrörelser.</p><div class="settings-actions"><button id="downloadMarketData" class="settings-primary" type="button">Hämta marknadsdata</button><button id="copyStep2Prompt" class="settings-secondary" type="button">Kopiera instruktion</button></div></div>'+
   '<div class="analysis-node"><span>3</span></div><div class="analysis-step"><h3>Intervjuer & extern statistik <span class="analysis-pill">Samma AI-konversation</span></h3><p>Hämta sparad kontext och ladda upp dagens PDF:er/skärmbilder i AI-chatten.</p><div class="settings-actions"><button id="downloadExternalContext" class="settings-primary" type="button">Hämta extern kontext</button><button id="copyStep3Prompt" class="settings-secondary" type="button">Kopiera instruktion</button></div></div>'+
   '<div class="analysis-node analysis-last"><span>4</span></div><div class="analysis-step"><h3>Bygg färdigt system <span class="analysis-pill">I AI-chatten</span></h3><p>Diskutera spikar, garderingar, risk och värde tills systemet är klart.</p></div>'+
  '</div></div>'+
 '</section>'+
 '<h2 class="analysis-section-title">Registrera extern statistik & intervjuer</h2>'+
 '<section class="settings-section settings-card analysis-card">'+
  '<div class="analysis-context"><div class="settings-field"><label for="evidenceRegistrationRound">Omgång</label><select id="evidenceRegistrationRound" class="settings-select"><option>Läser…</option></select></div></div>'+
  '<div class="analysis-register-head"><div class="analysis-node analysis-last"><span>5</span></div><div><h3>Skapa och importera extern data</h3><p>Kan göras även efter omgången.</p></div></div>'+
  '<div class="analysis-register-body">'+
   '<div class="settings-actions"><button id="downloadEvidenceImportContext" class="settings-primary" type="button">Hämta importunderlag</button><button id="copyEvidenceImportPrompt" class="settings-secondary" type="button">Kopiera importinstruktion</button></div>'+
   '<div class="analysis-callout">AI:n skapar JSON-filen från materialet i chatten.</div>'+
   '<div class="settings-actions analysis-import"><div class="settings-field"><label for="externalEvidenceFile">Extern datafil</label><input id="externalEvidenceFile" class="settings-file" type="file" accept="application/json,.json"></div><button id="importExternalEvidence" class="settings-secondary" type="button">Importera extern data</button></div>'+
   '<div id="externalEvidenceResult" class="settings-result"></div>'+
  '</div>'+
 '</section>'+
 '<h2 class="analysis-section-title">Registrera system</h2>'+
 '<section class="settings-section settings-card analysis-card">'+
  '<div class="analysis-context"><div class="settings-field"><label for="registrationRound">Omgång</label><select id="registrationRound" class="settings-select"><option>Läser…</option></select></div></div>'+
  '<div class="analysis-register-head"><div class="analysis-node analysis-last"><span>6</span></div><div><h3>Registrera färdigt system</h3><p>AI:n skapar registreringsfilen från den färdiga analysen.</p></div></div>'+
  '<div class="analysis-register-body">'+
   '<div class="settings-actions"><button id="downloadImportContext" class="settings-primary" type="button">Hämta importunderlag</button><button id="copyImportPrompt" class="settings-secondary" type="button">Kopiera importinstruktion</button></div>'+
   '<div class="settings-actions analysis-import"><div class="settings-field"><label for="recordedSystemFile">Systemfil</label><input id="recordedSystemFile" class="settings-file" type="file" accept="application/json,.json"></div><button id="importRecordedSystem" class="settings-secondary" type="button">Importera system</button></div>'+
   '<div id="recordedSystemResult" class="settings-result"></div>'+
  '</div>'+
 '</section>'+
 '</div>';
 const providerSelect=document.getElementById('analysisProvider');
 if(providerSelect){providerSelect.value=state.analysisProvider||'openai';providerSelect.onchange=()=>{state.analysisProvider=providerSelect.value}}
 function bindClick(id,handler){const node=document.getElementById(id);if(node)node.onclick=handler}
 bindClick('downloadAnalysisData',()=>{const id=selectedAnalysisRound();if(id)downloadSettingsFile('/app/api/settings/f3-analysis-pack?round_id='+encodeURIComponent(id))});
 bindClick('copyStep1Prompt',(event)=>copyPrompt(event.currentTarget,'/app/api/settings/external-step1-prompt?provider='+encodeURIComponent(selectedProvider())));
 bindClick('downloadMarketData',()=>{const id=selectedAnalysisRound();if(id)downloadSettingsFile('/app/api/settings/external-market?round_id='+encodeURIComponent(id))});
 bindClick('copyStep2Prompt',(event)=>copyPrompt(event.currentTarget,'/app/api/settings/external-step2-prompt?provider='+encodeURIComponent(selectedProvider())));
 bindClick('downloadExternalContext',()=>{const id=selectedAnalysisRound();if(id)downloadSettingsFile('/app/api/settings/external-evidence-context?round_id='+encodeURIComponent(id))});
 bindClick('copyStep3Prompt',(event)=>copyPrompt(event.currentTarget,'/app/api/settings/external-step3-prompt?provider='+encodeURIComponent(selectedProvider())));
 bindClick('downloadEvidenceImportContext',()=>{const id=selectedEvidenceRegistrationRound();if(id)downloadSettingsFile('/app/api/settings/external-evidence-import-context?round_id='+encodeURIComponent(id))});
 bindClick('copyEvidenceImportPrompt',(event)=>copyPrompt(event.currentTarget,'/app/api/settings/external-evidence-import-prompt?provider='+encodeURIComponent(selectedProvider())));
 bindClick('importExternalEvidence',importExternalEvidenceFile);
 bindClick('downloadImportContext',()=>{const id=selectedRegistrationRound();if(id)downloadSettingsFile('/app/api/settings/system-import-context?round_id='+encodeURIComponent(id))});
 bindClick('copyImportPrompt',(event)=>copyPrompt(event.currentTarget,'/app/api/settings/system-import-prompt?provider='+encodeURIComponent(selectedProvider())));
 bindClick('importRecordedSystem',importRecordedSystemFile);
 loadExternalRounds('analysis','analysisRound','analysisRoundId');
 loadExternalRounds('registration','evidenceRegistrationRound','evidenceRegistrationRoundId');
 loadExternalRounds('registration','registrationRound','registrationRoundId');
}
function processingText(status){return ({running:'Pågår',waiting:'Väntar',completed:'Klar',action_required:'Åtgärd krävs',never_run:'Ingen körning ännu'})[status]||status}
function pctText(value){if(value==null)return null;return Math.max(0,Math.min(100,Number(value))).toLocaleString('sv-SE',{maximumFractionDigits:1})+' %'}
function sourceStat(label,value){if(value===null||value===undefined||value==='')return '';return '<div class="settings-source-stat"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>'}
function renderSourceCard(x){
 const p=x.processing||{};const issue=x.issue||null;const issueClass=issue?' issue':'';
 const progress=p.progressPercent==null?'':'<div class="settings-progress" aria-label="Historisk import '+esc(pctText(p.progressPercent)||'')+' klar"><div class="settings-progress-fill" style="width:'+Math.max(0,Math.min(100,Number(p.progressPercent)))+'%"></div></div>';
 const second=x.id==='official'
   ?sourceStat('Återstår',p.remainingDates==null?null:num(p.remainingDates)+' datum')
   :sourceStat('Aktuellt datum',p.currentDate||null);
 const stats=sourceStat('Bearbetade lopp',num(p.processedRaces||0))+second+sourceStat('Senaste aktivitet',dateTimeSv(x.lastRunAt))+sourceStat('Senaste fel',issue?.error||'Inga');
 const issueBox=issue?'<div class="settings-source-error"><strong>'+esc(issue.label)+'</strong><br>'+esc(issue.message)+(issue.error?'<div class="settings-source-error-detail">'+esc(issue.error)+'</div>':'')+'</div>':'';
 return '<article class="settings-source-card'+issueClass+'"><div class="settings-source-head"><div><div class="settings-source-title">'+esc(x.name)+'</div><div class="settings-source-desc">'+esc(x.description||'')+'</div></div><span class="settings-source-pill '+esc(x.status)+'">'+esc(statusText(x.status))+'</span></div><div class="settings-source-job"><div class="settings-source-job-line"><span>Historisk import</span><strong class="'+esc(p.status)+'">'+esc(processingText(p.status))+'</strong></div>'+progress+'</div><div class="settings-source-stats">'+stats+'</div>'+issueBox+'</article>'
}
function setSettingsAlertBadge(show){
 const badge=document.getElementById('settingsAlertBadge');if(!badge)return;
 badge.classList.toggle('show',Boolean(show));
 settingsButton.setAttribute('aria-label',show?'Inställningar – nytt fel att se':'Inställningar');
}
async function refreshSettingsAlertBadge(){
 try{const r=await fetch('/app/api/settings/alerts',{headers:{accept:'application/json'},cache:'no-store'});if(!r.ok)return;const data=await r.json();setSettingsAlertBadge(Boolean(data.hasUnacknowledged))}catch{}
}
async function acknowledgeSettingsAlerts(){
 try{const r=await fetch('/app/api/settings/alerts/acknowledge',{method:'POST',headers:{accept:'application/json'}});if(r.ok)setSettingsAlertBadge(false)}catch{}
}
async function renderData(){
 app.innerHTML=heading('Inställningar','Hantera data och uppdateringar')+'<div class="settings-layout"><div class="skeleton"></div></div>';
 try{
  const s=await api('/settings/status');if(!state.settingsOpen)return;const counts=s.counts||{};
  const runs=(s.recentRuns||[]).map(r=>'<div class="settings-row"><div><div class="settings-row-title">'+esc(r.name)+'</div><div class="settings-row-meta">'+esc(dateTimeSv(r.finishedAt||r.startedAt))+'</div></div><div class="settings-row-output">'+num(r.inserted)+' nya · '+num(r.updated)+' uppdaterade · '+num(r.skipped)+' hoppades över · '+num(r.errors)+' fel</div><span class="status-pill '+esc(r.status)+'">'+esc(statusText(r.status))+'</span></div>').join('')||'<div class="settings-help">Inga registrerade körningar ännu.</div>';
  const sources=(s.sources||[]).map(renderSourceCard).join('');
  app.innerHTML=heading('Inställningar','Hantera data och uppdateringar')+'<div class="settings-layout"><section class="settings-section settings-card"><div class="settings-card-head"><h2>Datamängd</h2></div><div class="settings-card-body"><div class="settings-counts"><div class="settings-count"><strong>'+num(counts.trainers)+'</strong><span>Tränare</span></div><div class="settings-count"><strong>'+num(counts.horses)+'</strong><span>Hästar</span></div><div class="settings-count"><strong>'+num(counts.drivers)+'</strong><span>Kuskar</span></div><div class="settings-count"><strong>'+num(counts.games)+'</strong><span>V85/V86-omgångar</span></div></div></div></section><section class="settings-section settings-card"><div class="settings-card-head"><h2>Senaste körningar</h2><p>Visar vad de senaste registrerade importerna och arbetsflödena producerade och om fel registrerades.</p></div><div class="settings-card-body"><div class="settings-list">'+runs+'</div></div></section><section class="settings-section settings-card"><div class="settings-card-head"><h2>Datakällor</h2><p>Visar om datakällorna fungerar och hur långt den begärda historiska bearbetningen har kommit.</p></div><div class="settings-card-body"><div class="settings-source-grid">'+sources+'</div><div class="settings-help">'+esc(s.sourceStatusNote||'')+'</div></div></section>'+settingsFooter(s.appVersion)+'</div>';
  await acknowledgeSettingsAlerts();
 }catch(err){app.innerHTML=heading('Inställningar','Hantera data och uppdateringar')+'<div class="notice">Kunde inte läsa status: '+esc(err.message)+'</div>'}
}
async function renderSettings(){state.settingsOpen=true;state.settingsTab='data';state.detail=null;state.gameDetail=null;state.gameSystemId=null;settingsButton.classList.add('active');clearMainNav();return renderData()}
window.__kentauraiAnalysis={render:renderAnalysis};
settingsButton.onclick=()=>{renderSettings()};
refreshSettingsAlertBadge();
setInterval(refreshSettingsAlertBadge,60000);
})();
</script>`;

export function renderAppPage() {
  return renderHistoryAppPage()
    .replace('  </div></header>\n  <main id="app"', `${settingsMarkup}  </div></header>\n  <main id="app"`)
    .replace('</head>', `${settingsCss}</head>`)
    .replace('</body>', `${settingsScript}</body>`);
}
