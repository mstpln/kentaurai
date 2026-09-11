import {
  renderAppPage as renderFilteredAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-stat-filters.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

export const PRESENTATION_STANDARD_DISTANCE_GROUPS = [640, 1640, 2140, 2640, 3140, 3640, 4140];
export const PRESENTATION_OTHER_LONG_DISTANCE_GROUP = 'Övrigt >2640';
const PRESENTATION_DISTANCE_TOLERANCE_M = 100;

export function presentationDistanceGroup(value) {
  if (value === null || value === undefined || value === '' || value === 'unknown') return 'unknown';
  const distance = Number(value);
  if (!Number.isFinite(distance)) return String(value);
  for (const standard of PRESENTATION_STANDARD_DISTANCE_GROUPS) {
    if (Math.abs(distance - standard) <= PRESENTATION_DISTANCE_TOLERANCE_M) return String(standard);
  }
  if (distance > 2640) return PRESENTATION_OTHER_LONG_DISTANCE_GROUP;
  return String(Math.round(distance));
}

export function presentationGroupDistanceRows(rows = []) {
  const grouped = new Map();
  for (const row of rows || []) {
    const label = presentationDistanceGroup(row?.label);
    const current = grouped.get(label) || { label, starts: 0, resultStarts: 0, wins: 0, top3: 0, gallops: 0 };
    current.starts += Number(row?.starts || 0);
    current.resultStarts += Number(row?.resultStarts || 0);
    current.wins += Number(row?.wins || 0);
    current.top3 += Number(row?.top3 || 0);
    current.gallops += Number(row?.gallops || 0);
    grouped.set(label, current);
  }
  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      winRate: row.resultStarts ? row.wins / row.resultStarts : null,
      top3Rate: row.resultStarts ? row.top3 / row.resultStarts : null,
      gallopRate: row.resultStarts ? row.gallops / row.resultStarts : null
    }))
    .sort((a, b) => {
      if (b.starts !== a.starts) return b.starts - a.starts;
      const aDistance = Number(a.label);
      const bDistance = Number(b.label);
      if (Number.isFinite(aDistance) && Number.isFinite(bDistance)) return aDistance - bDistance;
      if (Number.isFinite(aDistance)) return -1;
      if (Number.isFinite(bDistance)) return 1;
      return String(a.label).localeCompare(String(b.label), 'sv');
    });
}

const presentationCss = `
<style id="kentaurai-presentation-polish-v2">
@media(max-width:760px){.settings-button{top:5px!important}}
.history-value-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:9px 16px}
.history-fact{min-width:0}.history-fact-label{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}.history-fact-value{font-size:12px;margin-top:3px;color:var(--text);overflow-wrap:anywhere}
@media(max-width:620px){.history-row{grid-template-columns:1fr}.history-time{margin-bottom:2px}.history-value-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>`;

const presentationScript = `
<script id="kentaurai-presentation-polish-script-v2">
const KENTAURAI_PRESENTATION_STANDARD_DISTANCE_GROUPS=${JSON.stringify(PRESENTATION_STANDARD_DISTANCE_GROUPS)};
const KENTAURAI_PRESENTATION_OTHER_LONG_DISTANCE_GROUP=${JSON.stringify(PRESENTATION_OTHER_LONG_DISTANCE_GROUP)};
const KENTAURAI_PRESENTATION_DISTANCE_TOLERANCE_M=${PRESENTATION_DISTANCE_TOLERANCE_M};

function kentauraiPresentationDistanceGroup(value){
  if(value===null||value===undefined||value===''||value==='unknown')return 'unknown';
  const distance=Number(value);
  if(!Number.isFinite(distance))return String(value);
  for(const standard of KENTAURAI_PRESENTATION_STANDARD_DISTANCE_GROUPS){
    if(Math.abs(distance-standard)<=KENTAURAI_PRESENTATION_DISTANCE_TOLERANCE_M)return String(standard);
  }
  if(distance>2640)return KENTAURAI_PRESENTATION_OTHER_LONG_DISTANCE_GROUP;
  return String(Math.round(distance));
}
function kentauraiPresentationGroupDistanceRows(rows=[]){
  const grouped=new Map();
  for(const row of rows||[]){
    const label=kentauraiPresentationDistanceGroup(row?.label);
    const current=grouped.get(label)||{label,starts:0,resultStarts:0,wins:0,top3:0,gallops:0};
    current.starts+=Number(row?.starts||0);current.resultStarts+=Number(row?.resultStarts||0);current.wins+=Number(row?.wins||0);current.top3+=Number(row?.top3||0);current.gallops+=Number(row?.gallops||0);grouped.set(label,current);
  }
  return Array.from(grouped.values()).map(row=>({...row,winRate:row.resultStarts?row.wins/row.resultStarts:null,top3Rate:row.resultStarts?row.top3/row.resultStarts:null,gallopRate:row.resultStarts?row.gallops/row.resultStarts:null})).sort((a,b)=>{if(b.starts!==a.starts)return b.starts-a.starts;const ad=Number(a.label),bd=Number(b.label);if(Number.isFinite(ad)&&Number.isFinite(bd))return ad-bd;if(Number.isFinite(ad))return -1;if(Number.isFinite(bd))return 1;return String(a.label).localeCompare(String(b.label),'sv')});
}
standardDistanceGroup=kentauraiPresentationDistanceGroup;
groupDistanceRows=kentauraiPresentationGroupDistanceRows;

(function(){
const originalDataSection=dataSection;
const originalDataItem=dataItem;

function svDateTime(value){
  if(value===null||value===undefined||value==='')return value;
  const text=String(value);
  if(!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/.test(text))return value;
  const date=new Date(text);
  if(Number.isNaN(date.getTime()))return value;
  return new Intl.DateTimeFormat('sv-SE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Stockholm'}).format(date);
}
function friendlyStatus(value){
  if(value===null||value===undefined)return value;
  const text=String(value).trim();
  const normalized=text.toLowerCase();
  return ({upcoming:'Kommande',disqualified:'Diskad',scratched:'Struken',reported:'Rapporterad',official:'Officiellt',results:'Resultat klart',finished:'Avslutat',cancelled:'Inställt',canceled:'Inställt',running:'Pågår',live:'Pågår'})[normalized]||value;
}
function friendlyShoe(value,barefootFlag){
  const normalized=String(value||'').trim().toLowerCase();
  if(['barefoot','barfota'].includes(normalized))return 'Barfota';
  if(['shod','shoes','shoe','skor','with_shoes'].includes(normalized))return 'Med skor';
  if(normalized&&normalized!=='unknown')return String(value).replaceAll('_',' ');
  if(barefootFlag==='Ja'||barefootFlag===true)return 'Barfota';
  if(barefootFlag==='Nej'||barefootFlag===false)return 'Med skor';
  return null;
}
function friendlySulky(value){
  if(value===null||value===undefined||value===''||value==='—')return null;
  const normalized=String(value).trim().toLowerCase();
  if(['regular','normal','standard'].includes(normalized))return 'Vanlig';
  if(['american','american bike','bike'].includes(normalized))return 'Amerikansk';
  return String(value).replaceAll('_',' ');
}
function changedOnly(value){
  if(!value||value==='—')return null;
  const changed=String(value).split(' · ').filter(part=>/: ändrad$/i.test(part)).map(part=>part.replace(/: ändrad$/i,''));
  return changed.length?changed.join(', '):null;
}
function friendlyOddsType(value){
  const normalized=String(value||'').trim().toLowerCase();
  if(['vinnare','winner','win'].includes(normalized))return 'Vinnarodds';
  if(['plats_min','place_min'].includes(normalized))return 'Platsodds – lägsta';
  if(['plats_max','place_max'].includes(normalized))return 'Platsodds – högsta';
  const text=String(value||'Odds').replaceAll('_',' ');
  return text.charAt(0).toLocaleUpperCase('sv-SE')+text.slice(1);
}
function friendlyFeatureName(value){
  const normalized=String(value||'').trim().toLowerCase();
  const known={form_score:'Formpoäng',form:'Form',class_exposure:'Klassvana',class_exposure_score:'Klassvana',development:'Utveckling',development_score:'Utveckling',development_trend:'Utvecklingstrend'};
  if(known[normalized])return known[normalized];
  const text=String(value||'').replaceAll('_',' ').replace(/([a-z0-9])([A-Z])/g,'$1 $2');
  return text?text.charAt(0).toLocaleUpperCase('sv-SE')+text.slice(1):'Beräknat nyckeltal';
}
function friendlyLabel(label){return ({Stryken:'Struken','Streck fångat':'Senast uppdaterat',Verifiering:'Uppgiftsstatus'})[label]||label}
function displayValue(label,value){
  if(value===null||value===undefined)return value;
  if(['Planerad start','Senast uppdaterat','Observerat','Senast observerad','Publicerad'].includes(label))return svDateTime(value);
  if(['Loppstatus','Resultatstatus','Placering','Uppgiftsstatus'].includes(label))return friendlyStatus(value);
  return value;
}
function compactEquipment(items){
  const map=new Map(items||[]);
  const front=friendlyShoe(map.get('Framskor'),map.get('Barfota fram'));
  const rear=friendlyShoe(map.get('Bakskor'),map.get('Barfota bak'));
  const sulky=friendlySulky(map.get('Sulky'));
  const changes=changedOnly(map.get('Förändringar'));
  return [['Skor fram',front],['Skor bak',rear],['Vagn',sulky],['Huvudlag',map.get('Huvudlag')],['Öronproppar',map.get('Öronproppar')],['Övrigt',map.get('Övrigt')],['Ändringar',changes],['Senast uppdaterat',map.get('Observerat')]];
}

dataItem=function(label,value){const nextLabel=friendlyLabel(label);return originalDataItem(nextLabel,displayValue(nextLabel,value))};
dataSection=function(title,items,note=''){
  let nextItems=[...(items||[])];let nextTitle=title;
  if(title==='Lopp & start'){
    const positions=[];
    for(const [label,value] of nextItems){if(['Bakspår','Innerspår','Springspår'].includes(label)&&(value==='Ja'||value===true))positions.push(label)}
    nextItems=nextItems.filter(([label])=>!['Bakspår','Innerspår','Springspår'].includes(label));
    if(positions.length)nextItems.push(['Startposition',positions.join(' · ')]);
  }
  if(title==='Utrustning'||title==='Senaste utrustning'){nextItems=compactEquipment(nextItems);nextTitle='Utrustning'}
  nextItems=nextItems.map(([label,value])=>{const nextLabel=friendlyLabel(label);return [nextLabel,displayValue(nextLabel,value)]});
  return originalDataSection(nextTitle,nextItems,note);
};

function historyFact(label,value){if(value===null||value===undefined||value===''||value==='—')return '';return '<div class="history-fact"><div class="history-fact-label">'+esc(label)+'</div><div class="history-fact-value">'+esc(value)+'</div></div>'}
function historyRow(time,body){return '<div class="history-row"><div class="history-time">'+esc(svDateTime(time)||'—')+'</div><div class="history-value">'+body+'</div></div>'}
function equipmentHistory(items){
  if(!items||!items.length)return '';
  const rows=items.map(item=>{const front=friendlyShoe(item.shoesFront,item.barefootFront);const rear=friendlyShoe(item.shoesRear,item.barefootRear);const sulky=friendlySulky(item.sulkyType);const changes=changedOnly(changesText(item.changes));const body='<div class="history-value-grid">'+historyFact('Skor fram',front)+historyFact('Skor bak',rear)+historyFact('Vagn',sulky)+historyFact('Ändringar',changes)+'</div>';return historyRow(item.capturedAt||item.observedAt,body)}).join('');
  return '<section class="data-section"><div class="data-section-head"><h2>Utrustningshistorik</h2><span>'+num(items.length)+' observationer</span></div><div class="card-pad"><div class="history-list">'+rows+'</div></div></section>';
}
function oddsSummary(items){
  const winner=(items||[]).find(x=>['vinnare','winner','win'].includes(String(x.marketType||'').toLowerCase()));
  const placeMin=(items||[]).find(x=>['plats_min','place_min'].includes(String(x.marketType||'').toLowerCase()));
  const placeMax=(items||[]).find(x=>['plats_max','place_max'].includes(String(x.marketType||'').toLowerCase()));
  const facts=[];
  if(winner?.odds!=null)facts.push(['Vinnarodds',dec(winner.odds,2)]);
  if(placeMin?.odds!=null||placeMax?.odds!=null){const low=placeMin?.odds,high=placeMax?.odds;const value=low!=null&&high!=null?(Number(low)===Number(high)?dec(low,2):dec(low,2)+'–'+dec(high,2)):(low!=null?dec(low,2):dec(high,2));facts.push(['Platsodds',value])}
  const known=new Set(['vinnare','winner','win','plats_min','place_min','plats_max','place_max']);
  for(const item of items||[]){if(item.odds==null||known.has(String(item.marketType||'').toLowerCase()))continue;facts.push([friendlyOddsType(item.marketType),dec(item.odds,2)])}
  return facts;
}
oddsText=function(items){const facts=oddsSummary(items);return facts.length?facts.map(([label,value])=>label+' '+value).join(' · '):'—'};
function oddsHistory(items){
  if(!items||!items.length)return '';
  const groups=new Map();for(const item of items){const time=item.capturedAt||item.observedAt||'—';if(!groups.has(time))groups.set(time,[]);groups.get(time).push(item)}
  const rows=Array.from(groups.entries()).map(([time,values])=>historyRow(time,'<div class="history-value-grid">'+oddsSummary(values).map(([label,value])=>historyFact(label,value)).join('')+'</div>')).join('');
  return '<section class="data-section"><div class="data-section-head"><h2>Oddshistorik</h2><span>'+num(groups.size)+' observationer</span></div><div class="card-pad"><div class="history-list">'+rows+'</div></div></section>';
}
historySection=function(title,items,renderValue){
  if(title==='Utrustningshistorik')return equipmentHistory(items);
  if(title==='Oddshistorik')return oddsHistory(items);
  if(!items||!items.length)return '';
  const friendlyTitle=title==='Featurehistorik'?'Historik för beräknade nyckeltal':title;
  return '<section class="data-section"><div class="data-section-head"><h2>'+esc(friendlyTitle)+'</h2><span>'+num(items.length)+' observationer</span></div><div class="card-pad"><div class="history-list">'+items.map(item=>historyRow(item.capturedAt||item.observedAt||item.asOf||item.dataSnapshotAt||item.publishedAt,renderValue(item))).join('')+'</div></div></section>';
};
featureTags=function(features){if(!features||!features.length)return '<span class="kentaurai-empty-features" hidden></span>';return '<div class="history-list">'+features.map(f=>'<div class="history-row"><div class="history-time">'+esc(svDateTime(f.asOf)||'—')+'</div><div class="history-value"><strong>'+esc(friendlyFeatureName(f.name))+'</strong> · '+esc(f.numericValue!=null?dec(f.numericValue,3):polishVal(f.textValue))+'</div></div>').join('')+'</div>'};

function replaceIsoInText(text){return String(text).replace(/\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z/g,value=>svDateTime(value))}
function polishRenderedUi(){
  document.querySelectorAll('.data-section-head h2').forEach(heading=>{if(heading.textContent.trim()==='Beräknade features')heading.textContent='Beräknade nyckeltal';if(heading.textContent.trim()==='Featurehistorik')heading.textContent='Historik för beräknade nyckeltal';const section=heading.closest('.data-section');if(section?.querySelector('.kentaurai-empty-features'))section.remove()});
  document.querySelectorAll('.start-summary-result strong').forEach(node=>{node.textContent=friendlyStatus(node.textContent)});
  document.querySelectorAll('.data-label').forEach(node=>{const label=node.textContent.trim();if(label==='Verifiering')node.textContent='Uppgiftsstatus';if(label==='Stryken')node.textContent='Struken';if(label==='Streck fångat')node.textContent='Senast uppdaterat'});
  const walker=document.createTreeWalker(document.getElementById('app')||document.body,NodeFilter.SHOW_TEXT);const nodes=[];let node;while((node=walker.nextNode()))nodes.push(node);
  for(const textNode of nodes){if(textNode.parentElement?.closest('script,style,pre,code'))continue;const original=textNode.nodeValue||'';let next=replaceIsoInText(original);const trimmed=next.trim();if(['upcoming','disqualified','reported','scratched'].includes(trimmed.toLowerCase()))next=next.replace(trimmed,friendlyStatus(trimmed));if(next!==original)textNode.nodeValue=next}
}
const priorPresentationRenderDetail=renderDetail;
renderDetail=async function(){await priorPresentationRenderDetail();polishRenderedUi()};
const priorPresentationGameDetail=renderGameDetailView;
renderGameDetailView=function(detail){priorPresentationGameDetail(detail);polishRenderedUi()};
polishRenderedUi();
})();
</script>`;

export function renderAppPage() {
  return renderFilteredAppPage()
    .replace("[String(current),current+' (i år)']", "[String(current),String(current)]")
    .replace("[String(previous),previous+' (förra året)']", "[String(previous),String(previous)]")
    .replace('</head>', `${presentationCss}</head>`)
    .replace('</body>', `${presentationScript}</body>`);
}
