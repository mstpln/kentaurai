const finalizeScript = `
<script id="kentaurai-statistics-finalize-script">
(function(){
function aggregateDistanceRows(rows){
  const standards=[640,1640,2140,2640,3140,3640,4140];
  const tolerance=100;
  const otherLong='Övrigt >2640';
  function labelFor(value){
    if(value===null||value===undefined||value===''||value==='unknown')return 'unknown';
    const distance=Number(value);
    if(!Number.isFinite(distance))return String(value);
    for(const standard of standards){if(Math.abs(distance-standard)<=tolerance)return String(standard)}
    if(distance>2640)return otherLong;
    return String(Math.round(distance));
  }
  const groups=new Map();
  for(const row of rows||[]){
    const label=labelFor(row&&row.label);
    const current=groups.get(label)||{label,starts:0,resultStarts:0,wins:0,top3:0,gallops:0,gallopVerifiedStarts:0,disqualifications:0,prizeVerifiedStarts:0,prizeSek:0};
    current.starts+=Number(row&&row.starts||0);
    current.resultStarts+=Number(row&&row.resultStarts||0);
    current.wins+=Number(row&&row.wins||0);
    current.top3+=Number(row&&row.top3||0);
    current.gallops+=Number(row&&row.gallops||0);
    current.gallopVerifiedStarts+=Number(row&&row.gallopVerifiedStarts||0);
    current.disqualifications+=Number(row&&row.disqualifications||0);
    const verified=Number(row&&row.prizeVerifiedStarts||0);
    current.prizeVerifiedStarts+=verified;
    if(verified&&row.prizeSek!=null)current.prizeSek+=Number(row.prizeSek);
    groups.set(label,current);
  }
  const order=new Map(standards.map((value,index)=>[String(value),index]));
  return Array.from(groups.values()).map(row=>({
    ...row,
    prizeSek:row.prizeVerifiedStarts?row.prizeSek:null,
    winRate:row.starts?row.wins/row.starts:null,
    top3Rate:row.resultStarts?row.top3/row.resultStarts:null,
    gallopRate:row.gallopVerifiedStarts?row.gallops/row.gallopVerifiedStarts:null
  })).sort((a,b)=>{
    const ai=order.has(a.label)?order.get(a.label):a.label===otherLong?100:a.label==='unknown'?102:101;
    const bi=order.has(b.label)?order.get(b.label):b.label===otherLong?100:b.label==='unknown'?102:101;
    return ai-bi||String(a.label).localeCompare(String(b.label),'sv');
  });
}
if(typeof groupDistanceRows==='function')groupDistanceRows=aggregateDistanceRows;
if(typeof state!=='undefined'&&state.page==='start'&&typeof renderStart==='function'){
  Promise.resolve(renderStart()).catch(function(error){
    if(typeof app!=='undefined'&&app)app.innerHTML='<div class="notice">Kunde inte läsa Trend: '+(typeof esc==='function'?esc(error&&error.message||error):String(error))+'</div>';
  });
}
})();
</script>`;

export function finalizeStatisticsHtml(html) {
  return String(html).replace('</body>', `${finalizeScript}</body>`);
}
