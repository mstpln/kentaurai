import { RACE_TYPE_OPTIONS, STL_CLASS_OPTIONS } from './race-classification.js';

const css = `
<style id="kentaurai-v064-overlay">
.track-class-filter-line{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px!important;align-items:end!important}
.track-select-wrap{min-width:0}.track-select{width:100%;min-height:39px;border:1px solid var(--line);background:#10100f;color:var(--text);border-radius:10px;padding:8px 32px 8px 10px;font-family:inherit;font-size:12px;font-weight:550;appearance:auto}.track-select.active{border-color:#6a5336;color:var(--accent-soft);background:#17130f}.track-select-mobile{display:none;width:100%;min-height:39px;border:1px solid var(--line);background:#10100f;color:var(--text);border-radius:10px;padding:8px 10px;font-family:inherit;font-size:12px;font-weight:550;text-align:left;align-items:center;justify-content:space-between;gap:8px}.track-select-mobile.active{border-color:#6a5336;color:var(--accent-soft);background:#17130f}
.kentaur-filter-sheet-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.64);display:flex;align-items:flex-end}.kentaur-filter-sheet{width:100%;max-height:78vh;overflow:auto;background:#121210;border:1px solid var(--line);border-bottom:0;border-radius:18px 18px 0 0;padding:8px 12px calc(14px + env(safe-area-inset-bottom))}.kentaur-filter-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 4px 12px;border-bottom:1px solid var(--line-soft);font-size:14px;font-weight:650}.kentaur-filter-sheet-close{border:0;background:transparent;color:var(--muted);font:inherit;padding:5px 7px}.kentaur-filter-option{width:100%;border:0;border-bottom:1px solid var(--line-soft);background:transparent;color:var(--text);padding:13px 5px;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;font-family:inherit;font-size:13px;font-weight:550}.kentaur-filter-option.selected{color:var(--accent-soft)}
.track-contact-link{color:var(--accent-soft);text-decoration:none}.track-contact-link:hover{text-decoration:underline}
.analysis-prompt-guide{margin-top:16px;padding-top:15px;border-top:1px solid var(--line-soft)}.analysis-prompt-guide h3{font-size:14px;font-weight:650;margin:0 0 6px}.analysis-prompt-guide p{font-size:12px;line-height:1.55;color:var(--muted);margin:0 0 12px}.analysis-prompt-copy{width:auto}
@media(max-width:620px){.track-select{display:none}.track-select-mobile{display:flex}.track-class-filter-line{grid-template-columns:1fr 1fr!important;gap:9px!important}.analysis-prompt-copy{width:100%}}
</style>`;

const script = `
<script id="kentaurai-v064-overlay-script">
(function(){
const STL_OPTIONS=${JSON.stringify(STL_CLASS_OPTIONS)};
const RACE_TYPE_OPTIONS=${JSON.stringify(RACE_TYPE_OPTIONS)};
const classFilters=new Map();
const contactLoads=new Set();
const originalFetch=window.fetch.bind(window);

function currentTrackId(){return history.state?.trackDetail||null}
function filtersFor(id){if(!classFilters.has(id))classFilters.set(id,{stlClass:'all',raceType:'all'});return classFilters.get(id)}
function labelFor(options,value,allLabel){if(!value||value==='all')return allLabel;return options.find(([key])=>key===value)?.[1]||allLabel}

window.fetch=function(input,init){
  try{
    const raw=typeof input==='string'||input instanceof URL?String(input):input?.url;
    const url=new URL(raw,location.href);
    const match=url.pathname.match(/^\\/app\\/api\\/tracks\\/([^/]+)\\/lane-stats$/);
    if(match){
      const id=decodeURIComponent(match[1]),f=filtersFor(id);
      if(f.stlClass&&f.stlClass!=='all')url.searchParams.set('stl_class',f.stlClass);else url.searchParams.delete('stl_class');
      if(f.raceType&&f.raceType!=='all')url.searchParams.set('race_type',f.raceType);else url.searchParams.delete('race_type');
      if(typeof input==='string'||input instanceof URL)return originalFetch(url.toString(),init);
      if(input?.method==='GET'||!input?.method)return originalFetch(url.toString(),{...init,headers:input?.headers||init?.headers,credentials:input?.credentials||init?.credentials});
    }
  }catch{}
  return originalFetch(input,init);
};

function rerunTrackStats(){const active=document.querySelector('[data-track-distance].active')||document.querySelector('[data-track-distance]');if(active)active.click()}
function closeSheet(){document.querySelector('.kentaur-filter-sheet-backdrop')?.remove()}
function openSheet(kind,options,title,allLabel){
  const id=currentTrackId();if(!id)return;const f=filtersFor(id),value=kind==='stlClass'?f.stlClass:f.raceType;
  closeSheet();const backdrop=document.createElement('div');backdrop.className='kentaur-filter-sheet-backdrop';
  const panel=document.createElement('div');panel.className='kentaur-filter-sheet';panel.innerHTML='<div class="kentaur-filter-sheet-head"><span>'+title+'</span><button class="kentaur-filter-sheet-close" type="button">Stäng</button></div>';
  const choices=[['all',allLabel],...options];
  choices.forEach(([key,label])=>{const b=document.createElement('button');b.type='button';b.className='kentaur-filter-option'+(String(value)===String(key)?' selected':'');b.innerHTML='<span>'+label+'</span><span>'+(String(value)===String(key)?'✓':'')+'</span>';b.onclick=()=>{f[kind]=key;closeSheet();rerunTrackStats()};panel.appendChild(b)});
  backdrop.appendChild(panel);backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeSheet()});panel.querySelector('.kentaur-filter-sheet-close').onclick=closeSheet;document.body.appendChild(backdrop);
}
function selectMarkup(kind,options,allLabel){const id=currentTrackId(),f=filtersFor(id||'none'),value=f[kind]||'all',active=value!=='all';return '<div class="track-select-wrap"><select class="track-select '+(active?'active':'')+'" data-track-class-select="'+kind+'">'+[['all',allLabel],...options].map(([key,label])=>'<option value="'+key+'" '+(key===value?'selected':'')+'>'+label+'</option>').join('')+'</select><button type="button" class="track-select-mobile '+(active?'active':'')+'" data-track-class-mobile="'+kind+'"><span>'+labelFor(options,value,allLabel)+'</span><span>⌄</span></button></div>'}
function enhanceTrackFilters(){
  const stack=document.querySelector('.track-filter-stack');if(!stack||stack.querySelector('.track-class-filter-line'))return;
  const line=document.createElement('div');line.className='track-filter-line track-class-filter-line';line.innerHTML='<div class="filter-block"><div class="filter-label">STL-klass</div>'+selectMarkup('stlClass',STL_OPTIONS,'Alla STL-klasser')+'</div><div class="filter-block"><div class="filter-label">Lopptyp</div>'+selectMarkup('raceType',RACE_TYPE_OPTIONS,'Alla lopptyper')+'</div>';stack.appendChild(line);
  line.querySelectorAll('[data-track-class-select]').forEach(select=>select.onchange=()=>{const id=currentTrackId();if(!id)return;filtersFor(id)[select.dataset.trackClassSelect]=select.value;rerunTrackStats()});
  line.querySelectorAll('[data-track-class-mobile]').forEach(button=>button.onclick=()=>{const kind=button.dataset.trackClassMobile;if(kind==='stlClass')openSheet(kind,STL_OPTIONS,'STL-klass','Alla STL-klasser');else openSheet(kind,RACE_TYPE_OPTIONS,'Lopptyp','Alla lopptyper')});
}

const exactText=new Map([
  ['spike_miss','Missad spik'],['coverage_miss','Vinnaren saknades på systemet'],['Learnings','Lärdomar'],['Omgångens learnings','Omgångens lärdomar'],['Miss','Fel'],['Vår rank','Vår rankning'],['Marknadsrank','Marknadsrankning'],['Auto','Autostart'],['pre_market','Förhandsanalys'],['final','Slutanalys'],['normalized_verified_subset','Verifierad delmängd'],['captured_unmapped','Infångad, ej normaliserad'],['unknown','Okänd'],['X-Labs segment','X-Labs-segment'],['Main Class','Loppklass'],['Main class','Loppklass'],['Huvudklass','Loppklass']
]);
const fieldLabels=new Map([
  ['Actual Distance M','Faktisk distans'],['Actual Distance','Faktisk distans'],['actualDistanceM','Faktisk distans'],['Extra Distance M','Extra distans'],['Extra Distance','Extra distans'],['extraDistanceM','Extra distans'],['Converted Km Time','Omräknad km-tid'],['convertedKmTime','Omräknad km-tid'],['Leader','Spets'],['leader','Spets'],['Pocket','Rygg ledaren'],['pocket','Rygg ledaren'],['Death Seat','Dödens'],['deathSeat','Dödens'],['Second Over','2:a utvändigt'],['secondOver','2:a utvändigt'],['Wide Trip','Brett spår'],['wideTrip','Brett spår'],['Uncovered Move','Attack utan rygg'],['uncoveredMove','Attack utan rygg'],['Traffic Event','Loppincident'],['trafficEvent','Loppincident'],['Summary','Sammanfattning'],['summary','Sammanfattning']
]);
const countries={SE:'Sverige',NO:'Norge',DK:'Danmark',FI:'Finland',DE:'Tyskland',FR:'Frankrike',IT:'Italien',NL:'Nederländerna',BE:'Belgien',EE:'Estland',LV:'Lettland',LT:'Litauen',US:'USA',CA:'Kanada'};
function replaceNodeText(node,map){const raw=node.textContent,trim=raw.trim();if(map.has(trim))node.textContent=raw.replace(trim,map.get(trim));else if(/^rank\\s+\\d+$/i.test(trim))node.textContent=raw.replace(trim,trim.replace(/^rank/i,'rankning'))}
function normalizeClassFlagField(label){
  const raw=label.textContent.trim();if(!['Class Flags','Class flags','Klassflaggor'].includes(raw))return;
  const item=label.closest('.data-item'),value=item?.querySelector('.data-value');if(!item||!value)return;
  const text=value.textContent.toLowerCase();const found=[];
  for(const [key,name] of RACE_TYPE_OPTIONS){if(text.includes(key.toLowerCase())||text.includes(name.toLowerCase()))found.push(name)}
  if(!found.length){item.remove();return}label.textContent='Lopptyp';value.textContent=[...new Set(found)].join(' · ');
}
function localizeVisible(){
  const app=document.getElementById('app');if(!app)return;
  const walker=document.createTreeWalker(app,NodeFilter.SHOW_TEXT,{acceptNode(node){const tag=node.parentElement?.tagName;return ['SCRIPT','STYLE','CODE','PRE','TEXTAREA'].includes(tag)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}});let node;while((node=walker.nextNode()))replaceNodeText(node,exactText);
  document.querySelectorAll('.data-label').forEach(normalizeClassFlagField);
  document.querySelectorAll('.data-label,.history-fact-label,.coverage-label').forEach(el=>replaceNodeText(el,fieldLabels));
  document.querySelectorAll('.data-value').forEach(el=>{const t=el.textContent.trim();if(countries[t])el.textContent=countries[t]});
  document.querySelectorAll('.detail-meta').forEach(el=>{let t=el.textContent;for(const [code,name] of Object.entries(countries))t=t.replace(new RegExp(' · '+code+'$'), ' · '+name);el.textContent=t});
  document.querySelectorAll('.settings-count span').forEach(el=>{if(el.textContent.trim()==='Spel')el.textContent='V85/V86-omgångar'});
}

async function enhanceTrackContact(){
  const id=currentTrackId();if(!id||document.querySelector('.track-contact-section')||contactLoads.has(id))return;
  const body=document.getElementById('trackTabBody');if(!body||!document.querySelector('[data-track-tab="overview"].active'))return;
  contactLoads.add(id);
  try{const r=await originalFetch('/app/api/tracks/'+encodeURIComponent(id),{headers:{accept:'application/json'}});if(!r.ok)return;const detail=await r.json();if(currentTrackId()!==id||document.querySelector('.track-contact-section'))return;
    const address=[detail.address?.street,detail.address?.postalCode,detail.city].filter(Boolean).join(', ');if(!address&&!detail.websiteUrl)return;
    const section=document.createElement('section');section.className='data-section track-contact-section';section.innerHTML='<div class="data-section-head"><h2>Kontakt & plats</h2></div><div class="data-grid">'+(address?'<div class="data-item"><div class="data-label">Adress</div><div class="data-value">'+escapeHtml(address)+'</div></div>':'')+(detail.websiteUrl?'<div class="data-item"><div class="data-label">Hemsida</div><div class="data-value"><a class="track-contact-link" target="_blank" rel="noopener noreferrer" href="'+escapeHtml(detail.websiteUrl)+'">Öppna hemsida ↗</a></div></div>':'')+'</div>';const groups=body.querySelector('.data-groups')||body;groups.appendChild(section);
  }catch{}finally{contactLoads.delete(id)}
}
function escapeHtml(v){
  return String(v)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll(String.fromCharCode(34),'&quot;')
    .replaceAll(String.fromCharCode(39),'&#39;')
}

function enhanceAnalysisImportGuide(){
  const heads=[...document.querySelectorAll('.settings-card-head h2')];const head=heads.find(x=>x.textContent.trim()==='Importera AI-analys');if(!head)return;const card=head.closest('.settings-card'),body=card?.querySelector('.settings-card-body');if(!body||body.querySelector('.analysis-prompt-guide'))return;
  body.querySelector('.settings-help')?.remove();body.querySelector('.settings-code')?.remove();const result=body.querySelector('#analysisImportResult');const guide=document.createElement('div');guide.className='analysis-prompt-guide';guide.innerHTML='<h3>Skapa V85/V86-systemanalysfil för import</h3><p>Kopiera instruktionerna och klistra in dem i samma ChatGPT- eller Claude-konversation där analysen och systemet skapades. AI:n skapar då en JSON-fil som är färdig att importera i KentaurAI.</p><button type="button" class="settings-secondary analysis-prompt-copy">Kopiera instruktioner till AI</button>';body.insertBefore(guide,result||null);const button=guide.querySelector('button');button.onclick=async()=>{const old=button.textContent;button.disabled=true;try{const provider=document.getElementById('exportProvider')?.value||'ai';const r=await originalFetch('/app/api/settings/analysis-prompt?provider='+encodeURIComponent(provider),{headers:{accept:'application/json'}});const data=await r.json();if(!r.ok||!data.prompt)throw new Error(data.message||'Kunde inte läsa instruktionerna');if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(data.prompt);else{const area=document.createElement('textarea');area.value=data.prompt;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}button.textContent='✓ Kopierat';setTimeout(()=>{button.textContent=old},1800)}catch{button.textContent='Kunde inte kopiera';setTimeout(()=>{button.textContent=old},1800)}finally{button.disabled=false}};
}

function enhance(){enhanceTrackFilters();localizeVisible();enhanceTrackContact();enhanceAnalysisImportGuide()}
const observer=new MutationObserver(enhance);observer.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});enhance();
})();
</script>`;

export function enhanceAppHtmlV064(html) {
  return String(html).replace('</head>', `${css}</head>`).replace('</body>', `${script}</body>`);
}
