import {
  renderAppPage as renderPresentationAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath,
  PRESENTATION_OTHER_LONG_DISTANCE_GROUP,
  PRESENTATION_STANDARD_DISTANCE_GROUPS,
  presentationDistanceGroup,
  presentationGroupDistanceRows
} from './app-page-presentation-v2.js';

export {
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath,
  PRESENTATION_OTHER_LONG_DISTANCE_GROUP,
  PRESENTATION_STANDARD_DISTANCE_GROUPS,
  presentationDistanceGroup,
  presentationGroupDistanceRows
};

export const PRESENTATION_FEATURE_LABELS = Object.freeze({
  form_starts_5: 'Starter – senaste 5',
  form_wins_5: 'Vinster – senaste 5',
  form_top3_5: 'Topp 3 – senaste 5',
  form_avg_placing_5: 'Snittplacering – senaste 5',
  form_gallops_5: 'Galopper – senaste 5',
  form_disqualifications_5: 'Diskvalifikationer – senaste 5',
  form_days_since_last_start: 'Dagar sedan senaste start',
  class_starts_10: 'Starter – senaste 10',
  class_wins_10: 'Vinster – senaste 10',
  class_max_first_prize_10: 'Högsta förstapris – senaste 10',
  class_avg_first_prize_10: 'Snitt förstapris – senaste 10',
  class_prize_earnings_10: 'Intjänat – senaste 10',
  class_target_first_prize: 'Förstapris i aktuellt lopp',
  class_target_vs_max_prize_ratio: 'Aktuellt förstapris / tidigare högsta',
  development_recent_avg_placing_3: 'Snittplacering – senaste 3',
  development_previous_avg_placing_3: 'Snittplacering – föregående 3',
  development_avg_placing_delta: 'Förändring i snittplacering',
  development_recent_top3_rate_3: 'Topp 3-andel – senaste 3',
  development_previous_top3_rate_3: 'Topp 3-andel – föregående 3',
  development_top3_rate_delta: 'Förändring i topp 3-andel',
  development_recent_avg_first_prize_3: 'Snitt förstapris – senaste 3',
  development_previous_avg_first_prize_3: 'Snitt förstapris – föregående 3',
  development_class_exposure_ratio: 'Förstaprisnivå – senaste 3 / föregående 3',
  development_recent_earnings_3: 'Intjänat – senaste 3',
  development_previous_earnings_3: 'Intjänat – föregående 3',
  development_earnings_ratio: 'Intjänat – senaste 3 / föregående 3',
  development_recent_gallops_3: 'Galopper – senaste 3',
  development_previous_gallops_3: 'Galopper – föregående 3',
  development_recent_disqualifications_3: 'Diskvalifikationer – senaste 3',
  development_previous_disqualifications_3: 'Diskvalifikationer – föregående 3'
});

export const PRESENTATION_QUALITY_LABELS = Object.freeze({
  sufficient: 'God',
  limited: 'Begränsad',
  unavailable: 'Saknas',
  verified: 'Verifierad',
  reported: 'Rapporterad',
  complete: 'Komplett',
  partial: 'Delvis',
  official: 'Officiell',
  high: 'Hög',
  medium: 'Medel',
  low: 'Låg',
  unknown: 'Okänd'
});

export function presentationFeatureLabel(value) {
  const key = String(value ?? '').trim();
  return PRESENTATION_FEATURE_LABELS[key] || 'Beräknat nyckeltal';
}

export function presentationQualityLabel(value) {
  if (value === null || value === undefined || value === '') return value;
  const key = String(value).trim().toLowerCase();
  return PRESENTATION_QUALITY_LABELS[key] || value;
}

export function presentationShoeLabel(value, barefootFlag) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['barefoot', 'barfota'].includes(normalized)) return 'Barfota';
  if (['shod', 'shoes', 'shoe', 'skor', 'with_shoes'].includes(normalized)) return 'Med skor';
  if (normalized && normalized !== 'unknown') return String(value).replaceAll('_', ' ');
  if (barefootFlag === true || barefootFlag === 1 || barefootFlag === '1' || barefootFlag === 'Ja') return 'Barfota';
  if (barefootFlag === false || barefootFlag === 0 || barefootFlag === '0' || barefootFlag === 'Nej') return 'Med skor';
  return null;
}

const localizationScript = `
<script id="kentaurai-localization-hardening">
(function(){
const FEATURE_LABELS=${JSON.stringify(PRESENTATION_FEATURE_LABELS)};
const QUALITY_LABELS=${JSON.stringify(PRESENTATION_QUALITY_LABELS)};
const priorLocalizedDataItem=dataItem;
const priorLocalizedDataSection=dataSection;
const priorLocalizedHistorySection=historySection;

function featureLabel(value){const key=String(value??'').trim();return FEATURE_LABELS[key]||'Beräknat nyckeltal'}
function qualityLabel(value){if(value===null||value===undefined||value==='')return value;const key=String(value).trim().toLowerCase();return QUALITY_LABELS[key]||value}
function shoeLabel(value,barefootFlag){
  const normalized=String(value??'').trim().toLowerCase();
  if(['barefoot','barfota'].includes(normalized))return 'Barfota';
  if(['shod','shoes','shoe','skor','with_shoes'].includes(normalized))return 'Med skor';
  if(normalized&&normalized!=='unknown')return String(value).replaceAll('_',' ');
  if(barefootFlag===true||barefootFlag===1||barefootFlag==='1'||barefootFlag==='Ja')return 'Barfota';
  if(barefootFlag===false||barefootFlag===0||barefootFlag==='0'||barefootFlag==='Nej')return 'Med skor';
  return null;
}
function fieldLabel(label){return ({
  'Value ratio':'Värdekvot',
  'Scenario robustness':'Scenariorobusthet',
  'Market blind':'Marknadsblind',
  'Race shape':'Loppbild',
  'Fakta / åsikt':'Fakta / bedömning',
  'Confidence':'Säkerhet'
})[label]||label}
function fieldValue(label,value){
  if(['Datakvalitet','Källkvalitet','Kvalitet','Styrka','Säkerhet'].includes(label))return qualityLabel(value);
  const normalized=String(value??'').trim().toLowerCase();
  if(label==='Polaritet')return ({positive:'Positiv',negative:'Negativ',neutral:'Neutral'})[normalized]||value;
  if(label==='Fakta / bedömning')return ({fact:'Fakta',opinion:'Bedömning',mixed:'Blandat'})[normalized]||value;
  return value;
}
function hiddenTechnicalField(label){return ['Feature-version','Prompt-version'].includes(label)}
function hasValue(value){return value!==null&&value!==undefined&&value!==''&&value!=='—'}

dataItem=function(label,value){
  if(hiddenTechnicalField(label)||!hasValue(value))return '';
  const nextLabel=fieldLabel(label);
  return priorLocalizedDataItem(nextLabel,fieldValue(nextLabel,value));
};
dataSection=function(title,items,note=''){
  const localized=(items||[]).filter(item=>item&&!hiddenTechnicalField(item[0])).map(([label,value])=>{const nextLabel=fieldLabel(label);return [nextLabel,fieldValue(nextLabel,value)]});
  return priorLocalizedDataSection(title,localized,note);
};

function localDateTime(value){
  if(value===null||value===undefined||value==='')return value;
  const date=new Date(String(value));
  if(Number.isNaN(date.getTime()))return value;
  return new Intl.DateTimeFormat('sv-SE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Stockholm'}).format(date);
}
function historyFact(label,value){if(!hasValue(value))return '';return '<div class="history-fact"><div class="history-fact-label">'+esc(label)+'</div><div class="history-fact-value">'+esc(value)+'</div></div>'}
function historyRow(time,body){return '<div class="history-row"><div class="history-time">'+esc(localDateTime(time)||'—')+'</div><div class="history-value">'+body+'</div></div>'}
function changedEquipment(changes){
  if(!changes||typeof changes!=='object')return null;
  const labels={shoesFrontChanged:'Skor fram',shoesRearChanged:'Skor bak',sulkyTypeChanged:'Vagn',sulkyColourChanged:'Vagnfärg',headgearChanged:'Huvudlag',earplugsChanged:'Öronproppar',otherEquipmentChanged:'Övrig utrustning'};
  const changed=[];let unknown=false;
  for(const [key,value] of Object.entries(changes)){if(!value)continue;if(labels[key])changed.push(labels[key]);else unknown=true}
  if(unknown&&!changed.includes('Övrig utrustning'))changed.push('Övrig utrustning');
  return changed.length?changed.join(', '):null;
}
function equipmentHistory(items){
  if(!items||!items.length)return '';
  const rows=items.map(item=>historyRow(item.capturedAt||item.observedAt,'<div class="history-value-grid">'+historyFact('Skor fram',shoeLabel(item.shoesFront,item.barefootFront))+historyFact('Skor bak',shoeLabel(item.shoesRear,item.barefootRear))+historyFact('Vagn',item.sulkyType==='regular'?'Vanlig':item.sulkyType==='american'?'Amerikansk':item.sulkyType)+historyFact('Ändringar',changedEquipment(item.changes))+'</div>')).join('');
  return '<section class="data-section"><div class="data-section-head"><h2>Utrustningshistorik</h2><span>'+num(items.length)+' observationer</span></div><div class="card-pad"><div class="history-list">'+rows+'</div></div></section>';
}
function featureHistory(items){
  if(!items||!items.length)return '';
  const rows=items.map(item=>historyRow(item.asOf||item.capturedAt,'<strong>'+esc(featureLabel(item.name))+'</strong> · '+esc(item.numericValue!=null?dec(item.numericValue,3):polishVal(item.textValue)))).join('');
  return '<section class="data-section"><div class="data-section-head"><h2>Historik för beräknade nyckeltal</h2><span>'+num(items.length)+' observationer</span></div><div class="card-pad"><div class="history-list">'+rows+'</div></div></section>';
}
function bettingHistory(items){
  if(!items||!items.length)return '';
  const rows=items.map(item=>historyRow(item.capturedAt||item.observedAt,esc((item.betPercent==null?'—':pct(item.betPercent))+(item.marketRank==null?'':' · rankning '+item.marketRank)))).join('');
  return '<section class="data-section"><div class="data-section-head"><h2>Streckhistorik</h2><span>'+num(items.length)+' observationer</span></div><div class="card-pad"><div class="history-list">'+rows+'</div></div></section>';
}
function xlabsHistory(items){
  if(!items||!items.length)return '';
  const rows=items.map(item=>historyRow(item.observedAt||item.capturedAt,esc([item.convertedKmTime,item.actualDistanceM==null?null:item.actualDistanceM+' m',item.extraDistanceM==null?null:'extra distans '+item.extraDistanceM+' m'].filter(Boolean).join(' · ')||'—'))).join('');
  return '<section class="data-section"><div class="data-section-head"><h2>X-Labs historik</h2><span>'+num(items.length)+' observationer</span></div><div class="card-pad"><div class="history-list">'+rows+'</div></div></section>';
}
historySection=function(title,items,renderValue){
  if(title==='Utrustningshistorik')return equipmentHistory(items);
  if(title==='Featurehistorik')return featureHistory(items);
  if(title==='Streckhistorik')return bettingHistory(items);
  if(title==='X-Labs historik')return xlabsHistory(items);
  return priorLocalizedHistorySection(title,items,renderValue);
};
featureTags=function(features){
  if(!features||!features.length)return '<span class="kentaurai-empty-features" hidden></span>';
  return '<div class="history-list">'+features.map(item=>'<div class="history-row"><div class="history-time">'+esc(localDateTime(item.asOf)||'—')+'</div><div class="history-value"><strong>'+esc(featureLabel(item.name))+'</strong> · '+esc(item.numericValue!=null?dec(item.numericValue,3):polishVal(item.textValue))+(item.dataQuality?' · datakvalitet '+esc(qualityLabel(item.dataQuality)):'')+'</div></div>').join('')+'</div>';
};

function polishVocabulary(){
  document.querySelectorAll('.coverage-label').forEach(node=>{const text=node.textContent.trim();if(text==='Features')node.textContent='Nyckeltal';if(text==='Editorial')node.textContent='Redaktionellt'});
  document.querySelectorAll('.analysis-head strong').forEach(node=>{let text=node.textContent;text=text.replace(/^reference_import\b/,'Referensanalys').replace(/^analysis_exchange\b/,'AI-analys').replace(/ · rank /g,' · rankning ');node.textContent=text});
  document.querySelectorAll('.data-section-head h2').forEach(node=>{if(node.textContent.trim()==='Beräknade features')node.textContent='Beräknade nyckeltal'});
}
const priorLocalizedRenderDetail=renderDetail;
renderDetail=async function(){await priorLocalizedRenderDetail();polishVocabulary()};
const priorLocalizedGameDetail=renderGameDetailView;
renderGameDetailView=function(detail){priorLocalizedGameDetail(detail);polishVocabulary()};
polishVocabulary();
})();
</script>`;

export function renderAppPage() {
  return renderPresentationAppPage().replace('</body>', `${localizationScript}</body>`);
}
