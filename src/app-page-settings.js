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
.settings-source-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.settings-source-card{background:#10100f;border:1px solid var(--line-soft);border-radius:12px;padding:16px;min-width:0}.settings-source-card.issue{border-color:#4b302c;background:#12100e}.settings-source-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.settings-source-title{font-size:14px;font-weight:600;line-height:1.25}.settings-source-desc{font-size:10.5px;color:var(--muted);margin-top:4px;line-height:1.45}.settings-source-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 8px;font-size:9.5px;font-weight:650;white-space:nowrap;border:1px solid}.settings-source-pill:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex:0 0 auto}.settings-source-pill.working,.settings-source-pill.running,.settings-source-pill.completed{color:#a8bda4;border-color:#455743;background:#151c14}.settings-source-pill.error_retrying,.settings-source-pill.action_required{color:#d4a49a;border-color:#66413a;background:#211512}.settings-source-pill.waiting,.settings-source-pill.never_run,.settings-source-pill.paused{color:#aaa39a;border-color:#3b382f;background:#121210}.settings-source-job{margin-top:17px}.settings-history-jobs{display:grid;gap:10px;margin-top:17px}.settings-history-job{padding:10px 11px;border:1px solid var(--line-soft);border-radius:9px;background:#0d0d0c}.settings-history-job+.settings-history-job{margin-top:0}.settings-history-range{font-size:9px;color:var(--muted);letter-spacing:.02em;margin-bottom:7px}.settings-source-job-line{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:11px}.settings-source-job-line span:first-child{color:var(--muted)}.settings-source-job-line strong{font-weight:650}.settings-source-job-line strong.running,.settings-source-job-line strong.completed{color:#a8bda4}.settings-source-job-line strong.waiting,.settings-source-job-line strong.never_run,.settings-source-job-line strong.paused{color:#aaa39a}.settings-source-job-line strong.action_required{color:#d4a49a}.settings-progress{height:4px;background:#24221e;border-radius:999px;overflow:hidden;margin-top:8px}.settings-progress-fill{height:100%;border-radius:999px;background:#677963}.settings-source-stats{display:grid;grid-template-columns:1fr 1fr;gap:11px 14px;margin-top:15px;padding-top:14px;border-top:1px solid var(--line-soft)}.settings-source-stat small{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.055em;margin-bottom:3px}.settings-source-stat strong{display:block;font-size:11px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}.settings-source-error{margin-top:14px;border:1px solid #66413a;background:#211512;border-radius:9px;padding:10px 11px;color:#d4a49a;font-size:10.5px;line-height:1.5}.settings-source-error strong{font-weight:700;color:#e1aaa1}.settings-source-error-detail{margin-top:4px;color:#b9958f;overflow-wrap:anywhere}
.settings-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.settings-count{border:1px solid var(--line-soft);background:#10100f;border-radius:11px;padding:14px}.settings-count strong{font-size:24px;font-weight:650;display:block}.settings-count span{display:block;color:var(--muted);font-size:11px;margin-top:3px}.settings-list{display:grid}.settings-row{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,2fr) auto;gap:14px;align-items:center;padding:13px 0;border-bottom:1px solid var(--line-soft)}.settings-row:last-child{border-bottom:0}.settings-row-title{font-size:13px;font-weight:550}.settings-row-meta{font-size:11px;color:var(--muted);margin-top:3px;line-height:1.45}.settings-row-output{font-size:11px;color:#aaa39a}.status-pill{font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--line);border-radius:999px;padding:5px 8px;white-space:nowrap}.status-pill.working,.status-pill.success,.status-pill.running{color:#a8bda4;border-color:#455743}.status-pill.warning,.status-pill.error{color:#d4a49a;border-color:#66413a}.status-pill.unknown{color:#aaa39a;border-color:#3b382f}.settings-footer{margin-top:26px;padding-top:16px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--muted);font-size:11px}.settings-footer form{margin:0}.settings-logout{border:0;background:transparent;color:#aaa39a;padding:7px 0;cursor:pointer}.settings-logout:hover{color:var(--text)}
.settings-mode-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));height:40px;background:#11110f;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:22px}.settings-mode-tab{border:0;border-right:1px solid var(--line);background:#11110f;color:#938d84;padding:0 8px;cursor:pointer;font-size:12px;font-weight:600}.settings-mode-tab:last-child{border-right:0}.settings-mode-tab:hover{color:var(--text);background:#161512}.settings-mode-tab.active{background:#b7ac9c;color:#1a1713}
.settings-drift-summary{display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:1px;background:var(--line-soft);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;margin-bottom:16px}.settings-drift-summary-cell{background:var(--panel);padding:15px 16px}.settings-drift-summary-label{font-size:9px;text-transform:uppercase;letter-spacing:.075em;color:var(--muted);font-weight:650;margin-bottom:5px}.settings-drift-summary-value{font-size:14px;font-weight:650}.settings-drift-summary-value.good{color:#a8bda4}.settings-drift-summary-value.bad{color:#d4a49a}.settings-drift-summary-value.muted{color:#aaa39a}
.settings-automation-row{display:flex;align-items:center;justify-content:space-between;gap:20px}.settings-automation-title{font-size:14px;font-weight:650;display:flex;align-items:center;gap:9px}.settings-automation-dot{width:7px;height:7px;border-radius:50%;background:#677963;flex:0 0 auto}.settings-automation-dot.paused{background:#777168}.settings-automation-meta{color:var(--muted);font-size:11px;line-height:1.55;margin-top:5px}.settings-toggle-wrap{display:flex;align-items:center;flex:0 0 auto}.settings-toggle{position:relative;width:54px;height:28px;border:0;border-radius:999px;background:#5b6a57;cursor:pointer;transition:.15s}.settings-toggle:before{content:"";position:absolute;width:22px;height:22px;border-radius:50%;background:#f1eee6;top:3px;left:29px;transition:.15s}.settings-toggle.off{background:#393630}.settings-toggle.off:before{left:3px}.settings-toggle:disabled{opacity:.55;cursor:default}.settings-toggle-label{font-size:10px;font-weight:700;color:#a8bda4;margin-left:9px;min-width:24px;text-align:right}.settings-toggle-label.off{color:#aaa39a}.settings-drift-note{margin-top:15px;padding:10px 12px;border-radius:9px;background:#11110f;border:1px solid var(--line-soft);color:var(--muted);font-size:10.5px;line-height:1.5}
.settings-usage-period{display:flex;align-items:center;justify-content:space-between;gap:14px;padding-bottom:13px;border-bottom:1px solid var(--line-soft)}.settings-usage-period strong{font-size:12px;font-weight:600}.settings-usage-period span{font-size:10px;color:var(--muted)}.settings-usage-group{margin-top:14px}.settings-usage-group-title{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#817a71;font-weight:650;margin-bottom:1px}.settings-usage-row{padding:16px 0;border-bottom:1px solid var(--line-soft)}.settings-usage-row:last-child{border-bottom:0;padding-bottom:2px}.settings-usage-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.settings-usage-name{font-size:12px;font-weight:600}.settings-usage-rule{font-size:9.5px;color:var(--muted);margin-top:4px;line-height:1.45}.settings-usage-value{text-align:right}.settings-usage-value strong{display:block;font-size:12px;font-weight:650}.settings-usage-value strong.over{color:#d4a49a}.settings-usage-value span{font-size:9.5px;color:var(--muted)}.settings-usage-progress{height:5px;background:#24221e;border-radius:999px;overflow:hidden;margin-top:10px}.settings-usage-progress-fill{height:100%;border-radius:999px;background:#677963}.settings-usage-progress-fill.over{background:#8a4a43}.settings-usage-unavailable{padding:13px 0;color:var(--muted);font-size:10.5px;line-height:1.5;border-bottom:1px solid var(--line-soft)}.settings-usage-unavailable:last-child{border-bottom:0}.settings-usage-legend{display:flex;align-items:center;gap:18px;margin-top:13px;color:var(--muted);font-size:9.5px}.settings-usage-legend span{display:flex;align-items:center;gap:6px}.settings-usage-legend i{display:inline-block;width:16px;height:4px;border-radius:999px;background:#677963}.settings-usage-legend i.over{background:#8a4a43}
.settings-activity-row{padding:13px 0;border-bottom:1px solid var(--line-soft)}.settings-activity-row:last-child{border-bottom:0}.settings-activity-main{display:flex;justify-content:space-between;gap:16px;align-items:center}.settings-activity-title{font-size:12px;font-weight:550}.settings-activity-status{font-size:11px;font-weight:650}.settings-activity-status.good{color:#a8bda4}.settings-activity-status.bad{color:#d4a49a}.settings-activity-meta{margin-top:3px;color:var(--muted);font-size:10px;line-height:1.4}
.settings-usage-error{border:1px solid #66413a;background:#211512;border-radius:10px;padding:11px 12px;color:#d4a49a;font-size:10.5px;line-height:1.5}.settings-usage-config{border:1px solid var(--line-soft);background:#10100f;border-radius:10px;padding:11px 12px;color:var(--muted);font-size:10.5px;line-height:1.5}
.analysis-section-title{font-size:18px;font-weight:650;margin:18px 0 10px}.analysis-card{border-color:#3a3125}.analysis-context{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:16px 18px;border-bottom:1px solid var(--line-soft)}.analysis-context .settings-field{min-width:230px}.analysis-card-body{padding:18px}.analysis-timeline{display:grid;grid-template-columns:34px minmax(0,1fr);gap:0 14px}.analysis-node{position:relative}.analysis-node span{width:30px;height:30px;border:1px solid #a77f49;border-radius:50%;display:grid;place-items:center;color:#d0b178;font-size:12px;font-weight:700}.analysis-node:not(.analysis-last)::after{content:"";position:absolute;top:31px;left:14px;bottom:-18px;width:1px;background:var(--line-soft)}.analysis-step{padding:2px 0 22px}.analysis-step h3{font-size:14px;margin:4px 0 5px}.analysis-step p{font-size:11px;line-height:1.45;color:var(--muted);margin:0 0 10px}.analysis-pill{display:inline-flex;margin-left:7px;padding:3px 7px;border:1px solid var(--line-soft);border-radius:999px;color:var(--muted);font-size:9px;font-weight:550;vertical-align:1px}.analysis-import{margin-top:12px;align-items:end}.analysis-import .settings-field{min-width:260px}.analysis-register-head{display:grid;grid-template-columns:34px minmax(0,1fr);gap:14px;padding:18px 18px 10px}.analysis-register-head h3{font-size:14px;margin:4px 0 4px}.analysis-register-head p{font-size:11px;color:var(--muted);margin:0}.analysis-register-body{padding:0 18px 18px 66px}.analysis-callout{font-size:11px;color:var(--muted);border:1px solid var(--line-soft);border-radius:9px;padding:9px 11px;margin-top:12px}
@media(max-width:760px){.top-inner{position:relative}.settings-button{position:absolute;right:12px;top:10px;width:38px;height:38px}.brand{padding-right:48px}.settings-counts{grid-template-columns:1fr 1fr}.settings-row{grid-template-columns:1fr auto}.settings-row-output{grid-column:1/-1}.settings-layout{max-width:none}.settings-drift-summary{grid-template-columns:1fr}.analysis-context{display:grid}.analysis-context .settings-field,.analysis-import .settings-field{min-width:0;width:100%}.analysis-step .settings-actions,.analysis-import{display:grid}.analysis-step .settings-primary,.analysis-step .settings-secondary,.analysis-step .settings-file{width:100%;max-width:none}}
@media(max-width:760px){.settings-source-grid{grid-template-columns:1fr}}
@media(max-width:430px){.settings-card-body,.settings-card-head{padding:16px}.settings-counts{grid-template-columns:1fr 1fr}.settings-actions{display:grid}.settings-field{min-width:0}.settings-primary,.settings-secondary{width:100%}.settings-automation-row{align-items:flex-start}.settings-usage-top{display:block}.settings-usage-value{text-align:left;margin-top:7px}.settings-usage-period{display:block}.settings-usage-period span{display:block;margin-top:4px}}
</style>`;

const settingsScript = `
<script id="kentaurai-settings-script">
(function(){
const settingsButton=document.getElementById('settingsButton');
if(!settingsButton)return;
state.settingsTab='drift';
const priorSetNav=setNav;
setNav=function(page){settingsButton.classList.remove('active');state.settingsOpen=false;priorSetNav(page)};
function clearMainNav(){document.querySelectorAll('.nav-item').forEach(b=>{b.classList.remove('active');b.removeAttribute('aria-current')})}
function statusText(status){return ({working:'Fungerar',success:'Klar',warning:'Varning',error:'Fel upptäckt',running:'Pågår',never_run:'Ingen körning ännu',waiting:'Väntar',completed:'Klar',error_retrying:'Fel upptäckt',action_required:'Åtgärd krävs',paused:'Pausad'})[status]||status}
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
function processingText(status){return ({running:'Pågår',waiting:'Väntar',completed:'Klar',action_required:'Åtgärd krävs',never_run:'Ingen körning ännu',paused:'Pausad'})[status]||status}
function pctText(value){if(value==null)return null;return Math.max(0,Math.min(100,Number(value))).toLocaleString('sv-SE',{maximumFractionDigits:1})+' %'}
function sourceStat(label,value){if(value===null||value===undefined||value==='')return '';return '<div class="settings-source-stat"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>'}
function renderHistoryJob(job){
 const p=job?.processing||{};
 const progress=p.progressPercent==null?'':'<div class="settings-progress" aria-label="Historisk import '+esc(pctText(p.progressPercent)||'')+' klar"><div class="settings-progress-fill" style="width:'+Math.max(0,Math.min(100,Number(p.progressPercent)))+'%"></div></div>';
 const range=(job?.startDate&&job?.endDate)?job.startDate+' – '+job.endDate:'Historisk period';
 return '<div class="settings-history-job"><div class="settings-history-range">'+esc(range)+'</div><div class="settings-source-job-line"><span>Historisk import</span><strong class="'+esc(p.status||'never_run')+'">'+esc(processingText(p.status||'never_run'))+'</strong></div>'+progress+'</div>'
}
function renderSourceCard(x){
 const p=x.processing||{};const issue=x.issue||null;const issueClass=issue?' issue':'';
 const jobs=(x.historicalJobs||[]).map(renderHistoryJob).join('')||renderHistoryJob({processing:p});
 const second=x.id==='official'
   ?sourceStat('Återstår',p.remainingDates==null?null:num(p.remainingDates)+' datum')
   :sourceStat('Aktuellt datum',p.currentDate||null);
 const stats=sourceStat('Bearbetade lopp',num(p.processedRaces||0))+second+sourceStat('Senaste aktivitet',dateTimeSv(x.lastRunAt))+sourceStat('Senaste fel',issue?.error||'Inga');
 const issueBox=issue?'<div class="settings-source-error"><strong>'+esc(issue.label)+'</strong><br>'+esc(issue.message)+(issue.error?'<div class="settings-source-error-detail">'+esc(issue.error)+'</div>':'')+'</div>':'';
 return '<article class="settings-source-card'+issueClass+'"><div class="settings-source-head"><div><div class="settings-source-title">'+esc(x.name)+'</div><div class="settings-source-desc">'+esc(x.description||'')+'</div></div><span class="settings-source-pill '+esc(x.status)+'">'+esc(statusText(x.status))+'</span></div><div class="settings-history-jobs">'+jobs+'</div><div class="settings-source-stats">'+stats+'</div>'+issueBox+'</article>'
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
function settingsModeTabs(){
 return '<div class="settings-mode-tabs" role="tablist" aria-label="Inställningar">'+
  '<button class="settings-mode-tab '+(state.settingsTab==='drift'?'active':'')+'" type="button" data-settings-mode="drift">Drift</button>'+
  '<button class="settings-mode-tab '+(state.settingsTab==='data'?'active':'')+'" type="button" data-settings-mode="data">Data</button>'+
 '</div>'
}
function bindSettingsModeTabs(){
 document.querySelectorAll('[data-settings-mode]').forEach(button=>button.onclick=()=>{
  const next=button.dataset.settingsMode;
  if(!['drift','data'].includes(next)||next===state.settingsTab)return;
  state.settingsTab=next;
  if(next==='drift')renderDrift();else renderData();
 })
}
function compactNumber(value){
 const n=Number(value);if(!Number.isFinite(n))return '—';
 const abs=Math.abs(n);
 if(abs>=1e9)return (n/1e9).toLocaleString('sv-SE',{maximumFractionDigits:1})+' md';
 if(abs>=1e6)return (n/1e6).toLocaleString('sv-SE',{maximumFractionDigits:1})+' mn';
 if(abs>=1e3)return (n/1e3).toLocaleString('sv-SE',{maximumFractionDigits:1})+' t';
 return Math.round(n).toLocaleString('sv-SE')
}
function bytesText(value){
 const n=Number(value);if(!Number.isFinite(n))return '—';
 if(n>=1e9)return (n/1e9).toLocaleString('sv-SE',{maximumFractionDigits:2})+' GB';
 if(n>=1e6)return (n/1e6).toLocaleString('sv-SE',{maximumFractionDigits:1})+' MB';
 return Math.round(n).toLocaleString('sv-SE')+' B'
}
function billingPeriodText(period){
 if(!period?.start||!period?.end)return '—';
 const start=new Date(period.start),end=new Date(new Date(period.end).getTime()-1);
 if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime()))return '—';
 const f=new Intl.DateTimeFormat('sv-SE',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 return f.format(start)+' – '+f.format(end)
}
function nextRunText(value){
 if(!value)return 'Pausad';
 const d=new Date(value);if(Number.isNaN(d.getTime()))return '—';
 return new Intl.DateTimeFormat('sv-SE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d)
}
function usageMetric(label,metric,format,rule,extra=''){
 if(!metric||metric.value===null||metric.value===undefined)return '<div class="settings-usage-unavailable"><strong>'+esc(label)+'</strong><br>Exakt användning är inte tillgänglig från den anslutna Cloudflare-mätningen.</div>';
 const pct=Number(metric.percent);const over=Boolean(metric.overIncluded);const width=Number.isFinite(pct)?Math.max(0,Math.min(100,pct)):0;
 const value=format(metric.value),included=format(metric.included);
 const detail=Number.isFinite(pct)?pct.toLocaleString('sv-SE',{maximumFractionDigits:1})+' %'+(over?' · '+format(metric.overBy)+' över inkluderad nivå':' · '+format(metric.remaining)+' kvar'):'';
 return '<div class="settings-usage-row"><div class="settings-usage-top"><div><div class="settings-usage-name">'+esc(label)+'</div><div class="settings-usage-rule">'+esc(rule)+(extra?' '+esc(extra):'')+'</div></div><div class="settings-usage-value"><strong class="'+(over?'over':'')+'">'+esc(value)+' / '+esc(included)+'</strong><span>'+esc(detail)+'</span></div></div><div class="settings-usage-progress" aria-label="'+esc(label)+' '+esc(detail)+'"><div class="settings-usage-progress-fill '+(over?'over':'')+'" style="width:'+width+'%"></div></div></div>'
}
function usageGroups(usage){
 if(!usage?.configured){
  const reason=usage?.reason==='missing_usage_token'
   ?'Cloudflare usage-token saknas i Worker-miljön.'
   :usage?.reason==='missing_account_id'
    ?'Cloudflare account-id saknas i Worker-miljön.'
    :'Cloudflare-användning är inte ansluten.';
  return '<div class="settings-usage-config">'+esc(reason)+' När den read-only anslutningen är konfigurerad hämtas aktuella värden direkt från Cloudflare; staplarna startar inte från noll.</div>'
 }
 const d1='<div class="settings-usage-group"><div class="settings-usage-group-title">D1</div>'+
  usageMetric('Rows read',usage.d1?.rowsRead,compactNumber,'25 miljarder ingår per billingperiod. Därefter debiteras överförbrukning.')+
  usageMetric('Rows written',usage.d1?.rowsWritten,compactNumber,'50 miljoner ingår per billingperiod.')+
  usageMetric('Lagring',usage.d1?.storage,bytesText,'5 GB ingår på Workers Paid.','Stapeln visar KentaurAI-databasens aktuella storlek; Cloudflares inkluderade storage gäller på kontonivå.')+
 '</div>';
 const r2Storage=usage.r2?.storage?.exactBillingProgress
  ?usageMetric('Lagring',usage.r2.storage,(v)=>Number(v).toLocaleString('sv-SE',{maximumFractionDigits:2})+' GB-mån','10 GB-mån Standard storage ingår per månad.')
  :'<div class="settings-usage-unavailable"><strong>R2 · Lagring</strong><br>Cloudflare returnerade inte ett exakt GB-månadsvärde för billingperioden. Nuvarande lagringssnapshot visas därför inte som en kostnads-progressbar.</div>';
 const r2='<div class="settings-usage-group"><div class="settings-usage-group-title">R2</div>'+
  usageMetric('Class A-operationer',usage.r2?.classAOperations,compactNumber,'1 miljon Standard Class A-operationer ingår per månad.')+
  usageMetric('Class B-operationer',usage.r2?.classBOperations,compactNumber,'10 miljoner Standard Class B-operationer ingår per månad.')+
  r2Storage+'</div>';
 const workersCpu=usage.workers?.cpu?.exactBillingProgress
  ?usageMetric('CPU-tid',usage.workers.cpu,(v)=>compactNumber(v)+' ms','30 miljoner CPU-ms ingår per månad.')
  :'<div class="settings-usage-unavailable"><strong>Workers · CPU-tid</strong><br>Exakt billingperiod-summa kunde inte identifieras i Cloudflares billable-usage-svar och visas därför inte som en uppskattning.</div>';
 const workers='<div class="settings-usage-group"><div class="settings-usage-group-title">Workers</div>'+
  usageMetric('Requests',usage.workers?.requests,compactNumber,'10 miljoner Worker-requests ingår per månad.')+
  workersCpu+'</div>';
 return d1+r2+workers+'<div class="settings-usage-legend"><span><i></i>Inom inkluderad nivå</span><span><i class="over"></i>Över inkluderad nivå</span></div>'
}
function recentActivityRows(runs){
 return (runs||[]).slice(0,5).map(r=>{
  const bad=['warning','error'].includes(r.status);const status=statusText(r.status);
  return '<div class="settings-activity-row"><div class="settings-activity-main"><div class="settings-activity-title">'+esc(r.name)+'</div><div class="settings-activity-status '+(bad?'bad':'good')+'">'+esc(status)+'</div></div><div class="settings-activity-meta">'+esc(dateTimeSv(r.finishedAt||r.startedAt))+' · '+num(r.inserted)+' nya · '+num(r.updated)+' uppdaterade · '+num(r.errors)+' fel</div></div>'
 }).join('')||'<div class="settings-help">Inga registrerade körningar ännu.</div>'
}
function driftSummary(automation,usage){
 const usageOver=Boolean(usage?.configured&&(usage.d1?.rowsRead?.overIncluded||usage.d1?.rowsWritten?.overIncluded||usage.d1?.storage?.overIncluded||usage.r2?.classAOperations?.overIncluded||usage.r2?.classBOperations?.overIncluded||usage.workers?.requests?.overIncluded||usage.workers?.cpu?.overIncluded));
 const systemValue=!usage?.configured?'Cloudflare ej anslutet':usageOver?'Budget överskriden':'Inom inkluderade nivåer';
 const systemClass=!usage?.configured?'muted':usageOver?'bad':'good';
 return '<div class="settings-drift-summary"><div class="settings-drift-summary-cell"><div class="settings-drift-summary-label">Systemstatus</div><div class="settings-drift-summary-value '+systemClass+'">'+esc(systemValue)+'</div></div><div class="settings-drift-summary-cell"><div class="settings-drift-summary-label">Automatiska jobb</div><div class="settings-drift-summary-value '+(automation?.enabled?'good':'muted')+'">'+(automation?.enabled?'Aktiva':'Pausade')+'</div></div><div class="settings-drift-summary-cell"><div class="settings-drift-summary-label">Nästa körning</div><div class="settings-drift-summary-value">'+esc(nextRunText(automation?.nextRunAt))+'</div></div></div>'
}
function automationCard(automation){
 const enabled=Boolean(automation?.enabled);
 return '<section class="settings-section settings-card"><div class="settings-card-head"><h2>Automatiska jobb</h2><p>Styr all schemalagd datainsamling och bearbetning. Appen och manuella funktioner fortsätter fungera när automatiken är pausad.</p></div><div class="settings-card-body"><div class="settings-automation-row"><div><div class="settings-automation-title"><span class="settings-automation-dot '+(enabled?'':'paused')+'"></span><span>Automatiska jobb '+(enabled?'aktiva':'pausade')+'</span></div><div class="settings-automation-meta">'+(enabled?'Nästa schemalagda körning: '+esc(nextRunText(automation?.nextRunAt))+'.':'Inga schemalagda KentaurAI-jobb startar medan automatiken är pausad.')+'</div></div><div class="settings-toggle-wrap"><button class="settings-toggle '+(enabled?'':'off')+'" id="automationSwitch" type="button" role="switch" aria-checked="'+(enabled?'true':'false')+'" aria-label="Automatiska jobb"></button><span class="settings-toggle-label '+(enabled?'':'off')+'">'+(enabled?'PÅ':'AV')+'</span></div></div><div class="settings-drift-note">'+(enabled?'Morgonens automatiska jobb körs enligt schema och KentaurAI:s kostnadsskydd.':'Appen och manuella funktioner fungerar fortfarande. Switcha på automatiken igen när schemalagda jobb ska börja köras.')+'</div></div></section>'
}
async function bindAutomationSwitch(current){
 const button=document.getElementById('automationSwitch');if(!button)return;
 button.onclick=async()=>{
  button.disabled=true;
  try{
   const response=await fetch('/app/api/settings/automation',{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({enabled:!Boolean(current?.enabled)})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.message||'Kunde inte ändra automatikstatus');
   await renderDrift()
  }catch(error){
   button.disabled=false;
   const note=button.closest('.settings-card-body')?.querySelector('.settings-drift-note');
   if(note){note.textContent='Kunde inte ändra automatiken: '+error.message;note.style.color='#d4a49a'}
  }
 }
}
async function renderDrift(){
 app.innerHTML=heading('Inställningar','Hantera system, kostnad och data')+'<div class="settings-layout">'+settingsModeTabs()+'<div class="skeleton"></div></div>';
 bindSettingsModeTabs();
 try{
  const [s,automation,usageResponse]=await Promise.all([
   api('/settings/status'),
   api('/settings/automation'),
   fetch('/app/api/settings/cloudflare-usage',{headers:{accept:'application/json'},cache:'no-store'})
  ]);
  if(!state.settingsOpen||state.settingsTab!=='drift')return;
  let usage=null;let usageError=null;
  try{usage=await usageResponse.json()}catch{usageError='Cloudflare-användningen kunde inte läsas.'}
  if(!usageResponse.ok)usageError=usage?.message||'Cloudflare-användningen kunde inte läsas.';
  const sources=(s.sources||[]).map(renderSourceCard).join('');
  const usageBody=usageError?'<div class="settings-usage-error">'+esc(usageError)+'</div>':usageGroups(usage);
  const period=usage?.configured?billingPeriodText(usage.billingPeriod):'—';
  app.innerHTML=heading('Inställningar','Hantera system, kostnad och data')+'<div class="settings-layout">'+settingsModeTabs()+driftSummary(automation,usage)+automationCard(automation)+
   '<section class="settings-section settings-card"><div class="settings-card-head"><h2>Cloudflare-användning</h2><p>Aktuell användning mot inkluderade gränser. Grön stapel är inom inkluderad nivå; röd stapel betyder att gränsen är passerad.</p></div><div class="settings-card-body"><div class="settings-usage-period"><strong>Aktuell billingperiod</strong><span>'+esc(period)+'</span></div>'+usageBody+'</div></section>'+
   '<section class="settings-section settings-card"><div class="settings-card-head"><h2>Jobbstatus</h2><p>Nuvarande status för KentaurAI:s datakällor och automatiska bearbetning.</p></div><div class="settings-card-body"><div class="settings-source-grid">'+sources+'</div><div class="settings-help">'+esc(s.sourceStatusNote||'')+'</div></div></section>'+
   '<section class="settings-section settings-card"><div class="settings-card-head"><h2>Senaste aktivitet</h2><p>Kort översikt över de senaste registrerade jobben.</p></div><div class="settings-card-body">'+recentActivityRows(s.recentRuns)+'</div></section>'+
   settingsFooter(s.appVersion)+'</div>';
  bindSettingsModeTabs();
  await bindAutomationSwitch(automation);
  await acknowledgeSettingsAlerts()
 }catch(err){
  app.innerHTML=heading('Inställningar','Hantera system, kostnad och data')+'<div class="settings-layout">'+settingsModeTabs()+'<div class="notice">Kunde inte läsa driftstatus: '+esc(err.message)+'</div></div>';
  bindSettingsModeTabs()
 }
}
async function renderData(){
 app.innerHTML=heading('Inställningar','Hantera system, kostnad och data')+'<div class="settings-layout">'+settingsModeTabs()+'<div class="skeleton"></div></div>';
 bindSettingsModeTabs();
 try{
  const s=await api('/settings/status');if(!state.settingsOpen||state.settingsTab!=='data')return;const counts=s.counts||{};
  app.innerHTML=heading('Inställningar','Hantera system, kostnad och data')+'<div class="settings-layout">'+settingsModeTabs()+'<section class="settings-section settings-card"><div class="settings-card-head"><h2>Datamängd</h2></div><div class="settings-card-body"><div class="settings-counts"><div class="settings-count"><strong>'+num(counts.trainers)+'</strong><span>Tränare</span></div><div class="settings-count"><strong>'+num(counts.horses)+'</strong><span>Hästar</span></div><div class="settings-count"><strong>'+num(counts.drivers)+'</strong><span>Kuskar</span></div><div class="settings-count"><strong>'+num(counts.games)+'</strong><span>V85/V86-omgångar</span></div></div></div></section>'+settingsFooter(s.appVersion)+'</div>';
  bindSettingsModeTabs()
 }catch(err){
  app.innerHTML=heading('Inställningar','Hantera system, kostnad och data')+'<div class="settings-layout">'+settingsModeTabs()+'<div class="notice">Kunde inte läsa data: '+esc(err.message)+'</div></div>';
  bindSettingsModeTabs()
 }
}
async function renderSettings(){if(typeof cancelRankingLifecycle==='function')cancelRankingLifecycle();if(typeof cancelEntityListLifecycle==='function')cancelEntityListLifecycle();state.settingsOpen=true;state.settingsTab='drift';state.detail=null;state.gameDetail=null;state.gameSystemId=null;settingsButton.classList.add('active');clearMainNav();return renderDrift()}
window.__kentauraiAnalysis={render:renderAnalysis};
settingsButton.onclick=()=>{renderSettings()};
refreshSettingsAlertBadge();
if(typeof setInterval==='function')setInterval(refreshSettingsAlertBadge,60000);
})();
</script>`;

export function renderAppPage() {
  return renderHistoryAppPage()
    .replace('  </div></header>\n  <main id="app"', `${settingsMarkup}  </div></header>\n  <main id="app"`)
    .replace('</head>', `${settingsCss}</head>`)
    .replace('</body>', `${settingsScript}</body>`);
}
