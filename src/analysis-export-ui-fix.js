const exportDownloadScript = `
<script id="kentaurai-analysis-export-download-fix">
(function(){
let exportBusy=false;
function exportButton(target){return target&&target.closest?target.closest('#exportStep1,#exportStep2'):null}
function filenameFromDisposition(value,fallback){
  const match=String(value||'').match(/filename="?([^";]+)"?/i);
  return match&&match[1]?match[1]:fallback;
}
async function downloadAnalysisExport(event){
  const button=exportButton(event.target);
  if(!button)return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if(exportBusy)return;
  exportBusy=true;
  const original=button.textContent;
  button.disabled=true;
  button.textContent='Förbereder export…';
  try{
    const provider=document.getElementById('exportProvider')?.value||'openai';
    const stage=button.id==='exportStep2'?'market':'pre_market';
    const url='/app/api/settings/export?provider='+encodeURIComponent(provider)+'&stage='+encodeURIComponent(stage);
    const response=await fetch(url,{headers:{accept:'application/json'}});
    if(!response.ok){
      let message='Exporten misslyckades';
      try{const data=await response.json();message=data.message||data.error||message}catch{}
      throw new Error(message);
    }
    const blob=await response.blob();
    const fallback='kentaurai-analysis-input_'+provider+'_'+stage+'.json';
    const filename=filenameFromDisposition(response.headers.get('content-disposition'),fallback);
    const objectUrl=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=objectUrl;
    link.download=filename;
    link.style.display='none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
    button.textContent='✓ Exporterad';
  }catch(error){
    button.textContent='Exportfel';
    window.alert('Kunde inte exportera: '+error.message);
  }finally{
    setTimeout(()=>{button.textContent=original;button.disabled=false;exportBusy=false},1400);
  }
}
document.addEventListener('click',downloadAnalysisExport,true);
})();
</script>`;

export function enhanceAnalysisExportDownloads(html) {
  const source = String(html);
  if (source.includes('kentaurai-analysis-export-download-fix')) return source;
  return source.replace('</body>', `${exportDownloadScript}</body>`);
}
