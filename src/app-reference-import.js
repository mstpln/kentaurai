export function renderReferenceImportPage() {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Importera referensomgång · KentaurAI</title>
<style>
:root{color-scheme:dark;--bg:#0d0d0d;--panel:#171614;--line:#302d29;--text:#f4f1eb;--muted:#aaa39a;--accent:#b69b72;--danger:#d58b82;--ok:#9eb28f}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:680px;margin:0 auto;padding:28px 18px 48px}.back{display:inline-block;margin-bottom:22px;color:var(--muted);text-decoration:none;font-size:14px}.back:hover{color:var(--text)}h1{margin:0 0 8px;font-size:27px;letter-spacing:-.02em}.lead{margin:0 0 24px;color:var(--muted);line-height:1.5}.card{border:1px solid var(--line);background:var(--panel);border-radius:18px;padding:18px}.file{display:block;width:100%;padding:18px;border:1px dashed #514b43;border-radius:14px;background:#111;color:var(--text)}.meta{margin-top:14px;color:var(--muted);font-size:13px;line-height:1.5;white-space:pre-line}.actions{display:flex;gap:10px;margin-top:18px}.button{appearance:none;border:0;border-radius:12px;padding:13px 16px;background:var(--accent);color:#15120e;font-weight:700;cursor:pointer}.button:disabled{opacity:.45;cursor:not-allowed}.notice{margin-top:16px;border-radius:12px;padding:13px 14px;border:1px solid var(--line);background:#111;color:var(--muted);white-space:pre-wrap;line-height:1.45}.notice.ok{border-color:#40503a;color:var(--ok)}.notice.error{border-color:#5e3834;color:var(--danger)}.small{margin-top:18px;color:#7f7971;font-size:12px;line-height:1.5}
</style>
</head>
<body>
<main class="wrap">
<a class="back" href="/app">← Till KentaurAI</a>
<h1>Importera referensomgång</h1>
<p class="lead">Välj en privat <strong>kentaurai-reference-v1</strong>-fil. Filen skickas direkt från din webbläsare till KentaurAI och läggs inte i GitHub.</p>
<section class="card">
<input id="file" class="file" type="file" accept="application/json,.json">
<div id="meta" class="meta">Ingen fil vald.</div>
<div class="actions"><button id="import" class="button" type="button" disabled>Importera till KentaurAI</button></div>
<div id="notice" class="notice" hidden></div>
<p class="small">Importen validerar format, åtta avdelningar, sannolikheter, systemrader och exakt tre spikar innan data sparas. Max filstorlek: 1 MB.</p>
</section>
</main>
<script>
const fileInput=document.getElementById('file');
const importButton=document.getElementById('import');
const meta=document.getElementById('meta');
const notice=document.getElementById('notice');
const MAX_BYTES=1024*1024;
let selectedText=null;
function show(message,kind){notice.hidden=false;notice.className='notice'+(kind?' '+kind:'');notice.textContent=message}
fileInput.addEventListener('change',async()=>{
  selectedText=null;importButton.disabled=true;notice.hidden=true;
  const file=fileInput.files&&fileInput.files[0];
  if(!file){meta.textContent='Ingen fil vald.';return}
  if(file.size>MAX_BYTES){meta.textContent=file.name+' · '+Math.round(file.size/1024)+' kB';show('Filen är större än 1 MB och kan inte importeras.','error');return}
  try{
    const text=await file.text();
    const payload=JSON.parse(text);
    if(payload.export_version!=='kentaurai-reference-v1')throw new Error('Fel export_version');
    const round=payload.round||{};
    meta.textContent=[file.name,(round.game_type||'—')+' · '+(round.date||'—')+' · '+(round.track||'—'),Math.round(file.size/1024)+' kB'].join('\n');
    selectedText=text;importButton.disabled=false;
  }catch(error){
    meta.textContent=file.name;
    show('Filen kunde inte läsas som en giltig kentaurai-reference-v1 JSON-fil.','error');
  }
});
importButton.addEventListener('click',async()=>{
  if(!selectedText)return;
  importButton.disabled=true;show('Importerar…');
  try{
    const response=await fetch('/app/api/import/reference-round',{method:'POST',headers:{'content-type':'application/json'},body:selectedText});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.error||('HTTP '+response.status));
    const summary=data.summary||{};
    const counts=data.counts||{};
    const details=[];
    if(summary.raceCount!=null)details.push(summary.raceCount+' lopp');
    if(summary.entryCount!=null)details.push(summary.entryCount+' starter');
    show('Import klar.\n'+(summary.gameType||'Referensomgång')+(details.length?' · '+details.join(' · '):'')+'\nSparad: '+(data.reused?'redan importerad tidigare':'ny import')+(counts.errors?' · fel: '+counts.errors:''),'ok');
  }catch(error){
    show('Importen misslyckades: '+error.message,'error');
    importButton.disabled=false;
  }
});
</script>
</body>
</html>`;
}
