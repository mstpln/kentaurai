export const v064RacePresentationScript = `
<script id="kentaurai-v064-race-presentation">
(function(){
const RACE_TYPES=[
  ['Stolopp',/\bstolopp\b|\bsto lopp\b/],
  ['Kallblodslopp',/\bkallblod/],
  ['Spårtrappa',/\bspartrappa\b/],
  ['Lärlingslopp',/\blarlingslopp\b|\blarling\b/],
  ['Amatörlopp',/\bamatorlopp\b|\bamator\b/],
  ['Montélopp',/\bmontelopp\b|\bmonte\b/],
  ['Unghästlopp',/\bunghast/],
  ['Årgångslopp',/\bargang/],
  ['Stayerlopp / långlopp',/\bstayer\b|\blanglopp\b/],
  ['Snabblopp',/\bsnabblopp\b/],
  ['Fördelslopp / Fördel ston',/\bfordelslopp\b|\bfordel ston\b/],
  ['P21-lopp',/\bp21\b/],
  ['Breddlopp',/\bbreddlopp\b|\bbreddplus\b/],
  ['Dubbelklasslopp',/\bdubbelklass/]
];
function norm(value){return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function findStartSection(section){const details=section.closest('.start-details');if(!details)return null;return [...details.querySelectorAll(':scope > .data-section')].find(item=>item.querySelector('.data-section-head h2')?.textContent.trim()==='Lopp & start')||null}
function currentClass(startSection){for(const item of startSection?.querySelectorAll('.data-item')||[]){const label=item.querySelector('.data-label')?.textContent.trim();if(label==='Klass'||label==='Loppklass')return item.querySelector('.data-value')?.textContent.trim()||''}return ''}
function processClassFlags(root=document){
  root.querySelectorAll('.data-section').forEach(section=>{
    const title=section.querySelector('.data-section-head h2');if(title?.textContent.trim()!=='Klassflaggor'||section.dataset.classProcessed)return;
    section.dataset.classProcessed='1';const start=findStartSection(section);const pre=section.querySelector('.json-block');let flags=[];try{const parsed=JSON.parse(pre?.textContent||'[]');if(Array.isArray(parsed))flags=parsed}catch{}
    const combined=norm([currentClass(start),...flags].join(' '));const labels=RACE_TYPES.filter(([,pattern])=>pattern.test(combined)).map(([label])=>label);
    if(start){for(const item of start.querySelectorAll('.data-item')){const label=item.querySelector('.data-label');if(label?.textContent.trim()==='Klass')label.textContent='Loppklass'}const grid=start.querySelector('.data-grid');if(grid&&labels.length){const item=document.createElement('div');item.className='data-item';item.innerHTML='<div class="data-label">Lopptyp</div><div class="data-value">'+labels.join(' · ')+'</div>';grid.append(item)}}
    section.remove();
  });
}
const host=document.getElementById('app')||document.body;const observer=new MutationObserver(()=>processClassFlags(host));observer.observe(host,{childList:true,subtree:true});processClassFlags(host);
})();
</script>`;
