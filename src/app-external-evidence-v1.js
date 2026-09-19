function evidenceUiClient(){
  function e(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  async function jf(url,options){const o=options||{};o.headers=Object.assign({accept:'application/json'},o.headers||{});const r=await fetch(url,o);const d=await r.json().catch(function(){return {}});if(!r.ok)throw new Error(d.message||d.error||'Begäran misslyckades');return d}
  async function copy(button,url){const old=button.textContent;button.disabled=true;try{const d=await jf(url);if(!d.prompt)throw new Error('Instruktionen saknas');if(navigator.clipboard&&navigator.clipboard.writeText)await navigator.clipboard.writeText(d.prompt);else{const area=document.createElement('textarea');area.value=d.prompt;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}button.textContent='✓ Kopierat'}catch{button.textContent='Kunde inte kopiera'}finally{setTimeout(function(){button.textContent=old;button.disabled=false},1500)}}
  function dl(url){window.location.href=url}
  function val(id){return document.getElementById(id)?.value||''}
  function provider(){return val('evidenceProvider')||'openai'}
  async function rounds(scope,id){
    const select=document.getElementById(id);if(!select)return;
    try{const d=await jf('/app/api/settings/external-rounds?scope='+scope);select.innerHTML=(d.rounds||[]).length?(d.rounds||[]).map(function(r){return '<option value="'+e(r.id)+'">'+e(r.gameType)+' '+e(r.roundDate)+(r.hasRecordedSystem?' · registrerad':'')+'</option>'}).join(''):'<option value="">Ingen komplett V85/V86-omgång</option>'}
    catch{select.innerHTML='<option value="">Kunde inte läsa omgångar</option>'}
  }
  async function importFile(button,kind){
    const external=kind==='evidence',input=document.getElementById(external?'evidenceDataFile':'evidenceSystemFile');
    const box=document.getElementById(external?'evidenceImportResult':'evidenceSystemResult'),file=input?.files?.[0];
    const roundId=val(external?'evidenceRegistrationRound':'evidenceSystemRound');
    if(!roundId){box.className='settings-result show error';box.textContent='Välj en omgång först.';return}
    if(!file){box.className='settings-result show error';box.textContent='Välj en JSON-fil först.';return}
    button.disabled=true;box.className='settings-result';
    try{
      const url=external?'/app/api/settings/external-evidence-import?round_id=':'/app/api/settings/system-import?round_id=';
      const result=await jf(url+encodeURIComponent(roundId),{method:'POST',headers:{'content-type':'application/json'},body:await file.text()});
      box.className='settings-result show success';
      if(external)box.textContent='Extern data sparad: '+Number(result.counts?.inserted||0)+' nya · '+Number(result.counts?.skipped||0)+' redan registrerade.';
      else{const first=result.systems?.[0];box.textContent=first?'Systemet är sparat: '+first.spike_count+' spikar · '+first.row_count+' rader · '+first.cost_sek+' kr.':'Systemet är sparat.'}
    }catch(err){box.className='settings-result show error';box.textContent=err.message}finally{button.disabled=false}
  }
  function workflow(){
    return '<div id="evidenceWorkflow">'+
    '<h2 class="evidence-title">Analysera omgång</h2><section class="settings-section settings-card evidence-card"><div class="evidence-context">'+
    '<div class="settings-field"><label>Omgång</label><select id="evidenceAnalysisRound" class="settings-select"><option>Läser…</option></select></div>'+
    '<div class="settings-field"><label>AI</label><select id="evidenceProvider" class="settings-select"><option value="openai">ChatGPT</option><option value="anthropic">Claude</option></select></div></div>'+
    '<div class="evidence-body"><div class="evidence-timeline">'+
    '<div class="evidence-node"><span>1</span></div><div class="evidence-step"><h3>Marknadsblind analys <em>Ny AI-konversation</em></h3><p>Blind sportslig analys utan marknad, intervjuer eller krönikor.</p><div class="settings-actions"><button id="evidencePack" class="settings-primary">Hämta analysdata</button><button id="evidenceP1" class="settings-secondary">Kopiera instruktion</button></div></div>'+
    '<div class="evidence-node"><span>2</span></div><div class="evidence-step"><h3>Marknadsanalys <em>Samma AI-konversation</em></h3><p>Jämför den blinda analysen mot streck, odds och marknadsrörelser.</p><div class="settings-actions"><button id="evidenceMarket" class="settings-primary">Hämta marknadsdata</button><button id="evidenceP2" class="settings-secondary">Kopiera instruktion</button></div></div>'+
    '<div class="evidence-node"><span>3</span></div><div class="evidence-step"><h3>Intervjuer & extern statistik <em>Samma AI-konversation</em></h3><p>Hämta sparad kontext och ladda upp dagens PDF:er/skärmbilder i AI-chatten.</p><div class="settings-actions"><button id="evidenceContext" class="settings-primary">Hämta extern kontext</button><button id="evidenceP3" class="settings-secondary">Kopiera instruktion</button></div></div>'+
    '<div class="evidence-node last"><span>4</span></div><div class="evidence-step"><h3>Bygg färdigt system <em>I AI-chatten</em></h3><p>Diskutera spikar, garderingar, risk och värde tills systemet är klart.</p></div>'+
    '</div></div></section>'+
    '<h2 class="evidence-title">Registrera extern statistik & intervjuer</h2><section class="settings-section settings-card evidence-card"><div class="evidence-context"><div class="settings-field"><label>Omgång</label><select id="evidenceRegistrationRound" class="settings-select"><option>Läser…</option></select></div></div>'+
    '<div class="evidence-register-head"><div class="evidence-node last"><span>5</span></div><div><h3>Skapa och importera extern data</h3><p>Kan göras även efter omgången.</p></div></div><div class="evidence-body">'+
    '<div class="settings-actions"><button id="evidenceImportContext" class="settings-primary">Hämta importunderlag</button><button id="evidenceImportPrompt" class="settings-secondary">Kopiera importinstruktion</button></div><div class="evidence-note">AI:n skapar JSON-filen från materialet i chatten.</div>'+
    '<div class="settings-actions evidence-import"><div class="settings-field"><label>Extern datafil</label><input id="evidenceDataFile" class="settings-file" type="file" accept="application/json,.json"></div><button id="evidenceImport" class="settings-secondary">Importera extern data</button></div><div id="evidenceImportResult" class="settings-result"></div></div></section>'+
    '<h2 class="evidence-title">Registrera system</h2><section class="settings-section settings-card evidence-card"><div class="evidence-context"><div class="settings-field"><label>Omgång</label><select id="evidenceSystemRound" class="settings-select"><option>Läser…</option></select></div></div>'+
    '<div class="evidence-register-head"><div class="evidence-node last"><span>6</span></div><div><h3>Registrera färdigt system</h3><p>AI:n skapar registreringsfilen från den färdiga analysen.</p></div></div><div class="evidence-body">'+
    '<div class="settings-actions"><button id="evidenceSystemContext" class="settings-primary">Hämta importunderlag</button><button id="evidenceSystemPrompt" class="settings-secondary">Kopiera importinstruktion</button></div>'+
    '<div class="settings-actions evidence-import"><div class="settings-field"><label>Systemfil</label><input id="evidenceSystemFile" class="settings-file" type="file" accept="application/json,.json"></div><button id="evidenceSystemImport" class="settings-secondary">Importera system</button></div><div id="evidenceSystemResult" class="settings-result"></div></div></section></div>'
  }
  function installSettings(){
    const layout=document.querySelector('.settings-layout');if(!layout||document.getElementById('evidenceWorkflow'))return;
    const ai=[...document.querySelectorAll('.tab.active')].some(function(x){return x.textContent.trim()==='AI'});if(!ai)return;
    const footer=layout.querySelector('.settings-footer')?.outerHTML||'';
    layout.innerHTML=workflow()+footer;
    const p=document.getElementById('evidenceProvider');if(p&&state.analysisProvider)p.value=state.analysisProvider;p.onchange=function(){state.analysisProvider=p.value};
    document.getElementById('evidencePack').onclick=function(){const id=val('evidenceAnalysisRound');if(id)dl('/app/api/settings/f3-analysis-pack?round_id='+encodeURIComponent(id))};
    document.getElementById('evidenceP1').onclick=function(ev){copy(ev.currentTarget,'/app/api/settings/external-step1-prompt?provider='+provider())};
    document.getElementById('evidenceMarket').onclick=function(){const id=val('evidenceAnalysisRound');if(id)dl('/app/api/settings/external-market?round_id='+encodeURIComponent(id))};
    document.getElementById('evidenceP2').onclick=function(ev){copy(ev.currentTarget,'/app/api/settings/external-step2-prompt?provider='+provider())};
    document.getElementById('evidenceContext').onclick=function(){const id=val('evidenceAnalysisRound');if(id)dl('/app/api/settings/external-step3-context?round_id='+encodeURIComponent(id))};
    document.getElementById('evidenceP3').onclick=function(ev){copy(ev.currentTarget,'/app/api/settings/external-step3-prompt?provider='+provider())};
    document.getElementById('evidenceImportContext').onclick=function(){const id=val('evidenceRegistrationRound');if(id)dl('/app/api/settings/external-evidence-import-context?round_id='+encodeURIComponent(id))};
    document.getElementById('evidenceImportPrompt').onclick=function(ev){copy(ev.currentTarget,'/app/api/settings/external-evidence-import-prompt?provider='+provider())};
    document.getElementById('evidenceImport').onclick=function(ev){importFile(ev.currentTarget,'evidence')};
    document.getElementById('evidenceSystemContext').onclick=function(){const id=val('evidenceSystemRound');if(id)dl('/app/api/settings/system-import-context?round_id='+encodeURIComponent(id))};
    document.getElementById('evidenceSystemPrompt').onclick=function(ev){copy(ev.currentTarget,'/app/api/settings/system-import-prompt?provider='+provider())};
    document.getElementById('evidenceSystemImport').onclick=function(ev){importFile(ev.currentTarget,'system')};
    rounds('analysis','evidenceAnalysisRound');rounds('registration','evidenceRegistrationRound');rounds('registration','evidenceSystemRound')
  }

  const baseTabs=detailTabs;
  detailTabs=function(type){
    const original=baseTabs(type);
    if(type==='horse'){
      const filtered=original.filter(function(x){return x[0]!=='external_stats'&&x[0]!=='interviews'});
      const idx=Math.max(0,filtered.findIndex(function(x){return x[0]==='stats'})+1);
      filtered.splice(idx,0,['external_stats','Extern statistik'],['interviews','Intervjuer']);return filtered
    }
    if(type==='trainer'){
      const filtered=original.filter(function(x){return x[0]!=='interviews'});
      const idx=Math.max(0,filtered.findIndex(function(x){return x[0]==='stats'})+1);
      filtered.splice(idx,0,['interviews','Intervjuer']);return filtered
    }
    return original
  };
  function pctText(v){return v==null?'—':Number(v).toLocaleString('sv-SE',{maximumFractionDigits:1})+'%'}
  function dateText(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('sv-SE',{dateStyle:'short'}).format(d)}
  async function renderExternalStats(id){
    const d=await api('/entities/horses/'+encodeURIComponent(id)+'/external-statistics'),rows=d.snapshots||[];
    if(!rows.length){app.insertAdjacentHTML('beforeend',empty('Ingen extern statistik','Ingen extern statistik har registrerats ännu.'));return}
    const groups=new Map();rows.forEach(function(r){const key=(r.contextType||r.context_type||'')+'|'+(r.contextKey||r.context_key||'');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)});
    let html='<div class="data-groups">';
    groups.forEach(function(items){const first=items[0];html+='<section class="data-section"><div class="data-section-head"><h2>'+e(first.contextLabel||first.context_label||first.contextType||first.context_type)+'</h2><span>'+items.length+' snapshot'+(items.length===1?'':'s')+'</span></div><div class="evidence-table-wrap"><table class="evidence-table"><thead><tr><th>Observerad</th><th>Starter</th><th>Placering</th><th>Seger %</th><th>ROI</th></tr></thead><tbody>'+items.map(function(r){return '<tr><td>'+e(dateText(r.observedAt||r.observed_at||r.availableAt||r.available_at))+'</td><td>'+e(r.starts)+'</td><td>'+e([r.wins,r.seconds,r.thirds].map(function(v){return v==null?'—':v}).join('-'))+'</td><td>'+e(pctText(r.winPercent??r.win_percent))+'</td><td>'+e(pctText(r.roiPercent??r.roi_percent))+'</td></tr>'}).join('')+'</tbody></table></div></section>'});
    app.insertAdjacentHTML('beforeend',html+'</div>')
  }
  async function renderInterviews(page,id){
    const d=await api('/entities/'+page+'/'+encodeURIComponent(id)+'/interviews'),rows=d.interviews||[];
    if(!rows.length){app.insertAdjacentHTML('beforeend',empty('Inga intervjuer','Inga intervjuer har registrerats ännu.'));return}
    app.insertAdjacentHTML('beforeend','<div class="evidence-interviews">'+rows.map(function(r){const tags=(r.signals||[]).map(function(s){return '<span class="data-tag">'+e(s.type)+(s.value?' · '+e(s.value):'')+'</span>'}).join('');return '<article class="data-section"><div class="data-section-head"><h2>'+e(r.horse_name||r.horseName||'Intervju')+'</h2><span>'+e(dateText(r.published_at||r.publishedAt||r.available_at||r.availableAt))+'</span></div><div class="evidence-interview-body"><div class="evidence-speaker">'+e(r.speaker_name||r.speakerName)+(r.speaker_relation||r.speakerRelation?' · '+e(r.speaker_relation||r.speakerRelation):'')+'</div><div class="evidence-interview-text">'+e(r.interview_text||r.interviewText||'')+'</div>'+(tags?'<div class="tag-list">'+tags+'</div>':'')+'</div></article>'}).join('')+'</div>')
  }
  const baseRenderDetail=renderDetail;
  renderDetail=async function(){
    const special=state.tab==='external_stats'||state.tab==='interviews';
    await baseRenderDetail();
    if(!special||!state.detail)return;
    const page=state.detail.page,id=state.detail.id;
    try{if(state.tab==='external_stats'&&page==='horses')await renderExternalStats(id);if(state.tab==='interviews'&&(page==='horses'||page==='trainers'))await renderInterviews(page,id)}
    catch(err){app.insertAdjacentHTML('beforeend','<div class="notice">Kunde inte läsa extern data: '+e(err.message)+'</div>')}
  };

  const observer=new MutationObserver(function(){queueMicrotask(installSettings)});
  observer.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});installSettings()
}

const evidenceCss='<style id="kentaurai-external-evidence-style">'+
'.evidence-title{font-size:18px;margin:22px 0 10px}.evidence-card{border-color:#3a3125}.evidence-context{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:16px 18px;border-bottom:1px solid var(--line-soft)}.evidence-context .settings-field{min-width:235px}.evidence-body{padding:18px}.evidence-timeline{display:grid;grid-template-columns:34px minmax(0,1fr);gap:0 14px}.evidence-node{position:relative}.evidence-node span{width:30px;height:30px;border:1px solid #b48a55;border-radius:50%;display:grid;place-items:center;color:#d0b178;font-size:12px;font-weight:700}.evidence-node:not(.last):after{content:"";position:absolute;top:31px;left:14px;bottom:-18px;width:1px;background:var(--line-soft)}.evidence-step{padding:1px 0 22px}.evidence-step h3,.evidence-register-head h3{font-size:14px;margin:4px 0 5px}.evidence-step p,.evidence-register-head p{font-size:12px;line-height:1.5;color:var(--muted);margin:0 0 11px}.evidence-step em{display:inline-flex;font-style:normal;border:1px solid var(--line);border-radius:999px;padding:4px 8px;font-size:9px;color:var(--muted);margin-left:8px}.evidence-register-head{padding:17px 18px;border-bottom:1px solid var(--line-soft);display:grid;grid-template-columns:34px 1fr;gap:0 14px}.evidence-note{border:1px solid #3b3328;border-radius:10px;padding:10px 12px;font-size:11px;color:#aaa39a;margin-top:12px}.evidence-import{margin-top:13px}.evidence-table-wrap{overflow:auto}.evidence-table{width:100%;border-collapse:collapse}.evidence-table th,.evidence-table td{padding:10px 12px;border-bottom:1px solid var(--line-soft);font-size:11px;text-align:right;white-space:nowrap}.evidence-table th:first-child,.evidence-table td:first-child{text-align:left}.evidence-table th{font-size:9px;color:var(--muted);text-transform:uppercase}.evidence-interviews{display:grid;gap:12px}.evidence-interview-body{padding:14px}.evidence-speaker{font-size:11px;color:var(--accent-soft);margin-bottom:8px}.evidence-interview-text{font-size:12px;line-height:1.65;white-space:pre-wrap;margin-bottom:10px}'+
'@media(max-width:760px){.evidence-context,.evidence-import{display:grid}.evidence-context .settings-field,.evidence-import .settings-field{min-width:0;width:100%}.evidence-step .settings-actions,.evidence-import{display:grid}.evidence-step em{display:block;width:max-content;margin:6px 0 0}.evidence-step .settings-primary,.evidence-step .settings-secondary{width:100%}}</style>';

export function enhanceExternalEvidenceUiHtml(html){
  const text=String(html);if(text.includes('kentaurai-external-evidence-script'))return text;
  return text.replace('</head>',evidenceCss+'</head>').replace('</body>','<script id="kentaurai-external-evidence-script">('+evidenceUiClient.toString()+')();</script></body>')
}
