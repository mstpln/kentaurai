const exportDownloadScript = `
<script id="kentaurai-analysis-export-download-fix">
(function(){
let exportBusy=false;
let roundsLoaded=false;
const roundStorageKey='kentaurai-analysis-round-id';
function exportButton(target){return target&&target.closest?target.closest('#exportStep1,#exportStep2'):null}
function exportPromptButton(target){return target&&target.closest?target.closest('#copyAnalysisPrompt'):null}
function selectedRoundId(){return document.getElementById('analysisRound')?.value||''}
function filenameFromDisposition(value,fallback){
  const match=String(value||'').match(/filename="?([^";]+)"?/i);
  return match&&match[1]?match[1]:fallback;
}
function svDate(value){
  if(!value)return '';
  const d=new Date(value.length===10?value+'T12:00:00Z':value);
  if(Number.isNaN(d.getTime()))return value;
  return new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
function roundLabel(round){
  const tracks=Array.isArray(round.tracks)&&round.tracks.length?' · '+round.tracks.join('/') : '';
  const suffix=round.phase==='past'?' · historisk':'';
  return round.gameType+' · '+svDate(round.roundDate)+tracks+suffix;
}
function updateRoundHelp(rounds){
  const select=document.getElementById('analysisRound');
  const help=document.getElementById('analysisRoundHelp');
  if(!select||!help)return;
  const round=rounds.find(item=>item.id===select.value);
  if(!round){help.textContent='Välj vilken V85/V86-omgång hela analysflödet gäller.';return}
  help.textContent=round.phase==='past'
    ? 'Historisk omgång: steg 3 kan användas för att återställa en redan gjord analys. Importen märks som efterhandsimport och används inte automatiskt för lärande.'
    : 'Vald omgång används konsekvent i steg 1, steg 2 och steg 3.';
}
async function installRoundSelector(){
  const provider=document.getElementById('exportProvider');
  if(!provider||document.getElementById('analysisRound'))return;
  const providerField=provider.closest('.settings-field');
  if(!providerField)return;
  const field=document.createElement('div');
  field.className='settings-field';
  field.innerHTML='<label for="analysisRound">Omgång</label><select class="settings-select" id="analysisRound"><option value="">Läser omgångar…</option></select><div class="settings-help" id="analysisRoundHelp" style="margin:0">Välj vilken V85/V86-omgång hela analysflödet gäller.</div>';
  providerField.parentNode.insertBefore(field,providerField);
  try{
    const response=await fetch('/app/api/settings/analysis-rounds',{headers:{accept:'application/json'}});
    const data=await response.json();
    if(!response.ok)throw new Error(data.message||'Kunde inte läsa omgångar');
    const rounds=Array.isArray(data.rounds)?data.rounds:[];
    const upcoming=rounds.filter(round=>round.phase==='upcoming').sort((a,b)=>String(a.roundDate).localeCompare(String(b.roundDate)));
    const past=rounds.filter(round=>round.phase==='past').sort((a,b)=>String(b.roundDate).localeCompare(String(a.roundDate)));
    const ordered=[...upcoming,...past];
    const saved=localStorage.getItem(roundStorageKey)||'';
    const initial=ordered.some(round=>round.id===saved)?saved:(upcoming[0]?.id||ordered[0]?.id||'');
    const select=document.getElementById('analysisRound');
    select.innerHTML=ordered.map(round=>'<option value="'+String(round.id).replaceAll('&','&amp;').replaceAll('"','&quot;')+'">'+roundLabel(round).replaceAll('&','&amp;').replaceAll('<','&lt;')+'</option>').join('');
    if(initial)select.value=initial;
    if(!ordered.length)select.innerHTML='<option value="">Ingen komplett V85/V86-omgång hittades</option>';
    select.addEventListener('change',()=>{localStorage.setItem(roundStorageKey,select.value);updateRoundHelp(ordered)});
    updateRoundHelp(ordered);
    roundsLoaded=true;
  }catch(error){
    const select=document.getElementById('analysisRound');
    if(select)select.innerHTML='<option value="">Kunde inte läsa omgångar</option>';
    const help=document.getElementById('analysisRoundHelp');
    if(help)help.textContent=error.message;
  }
}
async function copyText(text){
  if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(text);
  const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
}
async function downloadAnalysisExport(event){
  const button=exportButton(event.target);
  if(!button)return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  if(exportBusy)return;
  const roundId=selectedRoundId();
  if(!roundId){window.alert('Välj en omgång först.');return}
  exportBusy=true;
  const original=button.textContent;button.disabled=true;button.textContent='Förbereder export…';
  try{
    const provider=document.getElementById('exportProvider')?.value||'openai';
    const stage=button.id==='exportStep2'?'market':'pre_market';
    const url='/app/api/settings/export?provider='+encodeURIComponent(provider)+'&stage='+encodeURIComponent(stage)+'&round_id='+encodeURIComponent(roundId);
    const response=await fetch(url,{headers:{accept:'application/json'}});
    if(!response.ok){let message='Exporten misslyckades';try{const data=await response.json();message=data.message||data.error||message}catch{}throw new Error(message)}
    const blob=await response.blob();
    const fallback='kentaurai-analysis-input_'+provider+'_'+stage+'.json';
    const filename=filenameFromDisposition(response.headers.get('content-disposition'),fallback);
    const objectUrl=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=objectUrl;link.download=filename;link.style.display='none';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
    button.textContent='✓ Exporterad';
  }catch(error){button.textContent='Exportfel';window.alert('Kunde inte exportera: '+error.message)}
  finally{setTimeout(()=>{button.textContent=original;button.disabled=false;exportBusy=false},1400)}
}
async function copyCombinedPrompt(event){
  const button=exportPromptButton(event.target);
  if(!button)return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  const roundId=selectedRoundId();
  if(!roundId){window.alert('Välj en omgång först.');return}
  const original=button.textContent;button.disabled=true;
  try{
    const provider=document.getElementById('exportProvider')?.value||'openai';
    const response=await fetch('/app/api/settings/analysis-prompt?provider='+encodeURIComponent(provider)+'&round_id='+encodeURIComponent(roundId),{headers:{accept:'application/json'}});
    const data=await response.json();
    if(!response.ok||!data.prompt)throw new Error(data.message||'Kunde inte skapa exportinstruktionen');
    await copyText(data.prompt);
    button.textContent=data.importTiming==='post_race_recovery'?'✓ Kopierat · historisk':'✓ Kopierat';
  }catch(error){button.textContent='Kunde inte kopiera';window.alert(error.message)}
  finally{setTimeout(()=>{button.textContent=original;button.disabled=false},1800)}
}
document.addEventListener('click',downloadAnalysisExport,true);
document.addEventListener('click',copyCombinedPrompt,true);
const observer=new MutationObserver(()=>{if(!roundsLoaded||!document.getElementById('analysisRound'))installRoundSelector()});
observer.observe(document.documentElement,{childList:true,subtree:true});
installRoundSelector();
})();
</script>`;

export function enhanceAnalysisExportDownloads(html) {
  const source = String(html);
  if (source.includes('kentaurai-analysis-export-download-fix')) return source;
  return source.replace('</body>', `${exportDownloadScript}</body>`);
}
