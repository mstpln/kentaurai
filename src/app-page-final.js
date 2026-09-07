import {
  renderAppPage as renderCompleteAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-complete.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

const logoutMarkup = '    <form method="post" action="/app/logout"><button class="logout" type="submit">Logga ut</button></form>\n';
const featureProvenanceMarkup = "+(f.provenance?'<pre class=\"json-block\">'+esc(jsonText(f.provenance))+'</pre>':'')";

const refinementCss = `
<style id="kentaurai-final-refinement">
.structured-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.structured-item{padding:11px 13px;border-right:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft);min-width:0}
.structured-item:nth-child(3n){border-right:0}.structured-key{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}.structured-value{font-size:12px;margin-top:4px;overflow-wrap:anywhere}.analysis-subsection{margin-top:10px;border-top:1px solid var(--line-soft);padding-top:10px}.analysis-subsection-title{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:7px}
@media(max-width:900px){.structured-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.structured-item:nth-child(3n){border-right:1px solid var(--line-soft)}.structured-item:nth-child(2n){border-right:0}}
@media(max-width:430px){.structured-grid{grid-template-columns:1fr}.structured-item{border-right:0!important}}
</style>`;

const refinementScript = `
<script id="kentaurai-final-refinement-script">
function structuredLabel(key){return String(key||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase())}
function structuredText(value){if(value===null||value===undefined)return '—';if(Array.isArray(value))return value.map(v=>typeof v==='object'?jsonText(v):String(v)).join(' · ');if(typeof value==='object')return Object.entries(value).map(([k,v])=>structuredLabel(k)+': '+structuredText(v)).join(' · ');if(typeof value==='boolean')return value?'Ja':'Nej';return String(value)}
function structuredGrid(value){if(value===null||value===undefined)return '';if(Array.isArray(value)){return '<div class="structured-grid">'+value.map((v,i)=>'<div class="structured-item"><div class="structured-key">'+esc('Post '+(i+1))+'</div><div class="structured-value">'+esc(structuredText(v))+'</div></div>').join('')+'</div>'}if(typeof value==='object'){return '<div class="structured-grid">'+Object.entries(value).map(([k,v])=>'<div class="structured-item"><div class="structured-key">'+esc(structuredLabel(k))+'</div><div class="structured-value">'+esc(structuredText(v))+'</div></div>').join('')+'</div>'}return '<div class="structured-grid"><div class="structured-item"><div class="structured-value">'+esc(String(value))+'</div></div></div>'}
rawJsonSection=function(title,value,note=''){if(value===null||value===undefined)return '';return '<section class="data-section"><div class="data-section-head"><h2>'+esc(title)+'</h2>'+(note?'<span>'+esc(note)+'</span>':'')+'</div>'+structuredGrid(value)+'</section>'};
positionTags=function(items){if(!items||!items.length)return '<span class="metric-note">Inga positionsmätningar lagrade.</span>';return '<div class="history-list">'+items.map(p=>'<div class="history-row"><div class="history-time">'+esc(p.observedAtM==null?'Position':p.observedAtM+' m')+'</div><div class="history-value">'+esc((p.position==null?'—':'#'+p.position)+(p.lane==null?'':' · spår '+p.lane)+(p.leader?' · spets':'')+(p.pocket?' · rygg ledaren':'')+(p.deathSeat?' · dödens':'')+(p.secondOver?' · 2:a utv':'')+(p.thirdOver?' · 3:e utv':'')+(p.wideTrip?' · brett':'')+(p.uncoveredMove?' · utan rygg':'')+(p.trafficEvent?' · '+p.trafficEvent:''))+(p.event?'<div class="analysis-subsection"><div class="analysis-subsection-title">Händelsedata</div>'+structuredGrid(p.event)+'</div>':'')+'</div></div>').join('')+'</div>'};
aiSection=function(items){if(!items||!items.length)return '';return '<section class="data-section"><div class="data-section-head"><h2>Lagrade AI-bedömningar</h2><span>separerat från råfakta</span></div><div class="card-pad">'+items.map(a=>'<div class="analysis-card"><div class="analysis-head"><strong>'+esc((a.analysisOrigin||'AI')+(a.abcdGroup?' · '+a.abcdGroup:'')+(a.rawRank!=null?' · rank '+a.rawRank:''))+'</strong><span>'+esc(a.dataSnapshotAt||a.createdAt||'')+'</span></div><div class="data-grid">'+[['Vinstsannolikhet',a.winProbability==null?null:pct(a.winProbability)],['Osäkerhet låg',a.uncertaintyLow==null?null:pct(a.uncertaintyLow)],['Osäkerhet hög',a.uncertaintyHigh==null?null:pct(a.uncertaintyHigh)],['Value ratio',a.valueRatio==null?null:dec(a.valueRatio,2)],['Scenario robustness',a.scenarioRobustness==null?null:dec(a.scenarioRobustness,2)],['Market blind',yesNo(a.marketBlind)],['Race shape',a.raceShapeSummary],['Slutsats',a.conclusion],['Datakvalitet',a.dataQuality],['Metod',a.methodNote],['Feature-version',a.featureVersion],['Prompt-version',a.promptVersion],['AI-modell',a.aiModel]].map(x=>dataItem(x[0],x[1])).join('')+'</div>'+(a.scenarios?'<div class="analysis-subsection"><div class="analysis-subsection-title">Scenarier</div>'+structuredGrid(a.scenarios)+'</div>':'')+(a.reasoning?'<div class="analysis-subsection"><div class="analysis-subsection-title">Resonemangsdata</div>'+structuredGrid(a.reasoning)+'</div>':'')+'</div>').join('')+'</div></section>'};
editorialSection=function(items){if(!items||!items.length)return '';return '<section class="data-section"><div class="data-section-head"><h2>Redaktionella signaler</h2><span>strukturerade signaler</span></div><div class="card-pad">'+items.map(x=>'<div class="analysis-card"><div class="analysis-head"><strong>'+esc(x.signalType||'Signal')+'</strong><span>'+esc(x.publishedAt||'')+'</span></div><div class="data-grid">'+[['Värde',x.valueText],['Polaritet',x.polarity],['Styrka',x.strength],['Fakta / åsikt',x.factOrOpinion],['Säkerhet',x.confidence],['Sammanfattning',x.summary],['Evidens',x.evidenceExcerpt]].map(v=>dataItem(v[0],v[1])).join('')+'</div></div>').join('')+'</div></section>'};
</script>`;

export function renderAppPage() {
  return renderCompleteAppPage()
    .replace(logoutMarkup, '')
    .replace(featureProvenanceMarkup, '')
    .replace('</head>', `${refinementCss}</head>`)
    .replace('</body>', `${refinementScript}</body>`);
}
