import {
  renderAppPage as renderReleaseAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-release.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

const releaseBootstrap = `<script id="kentaurai-release-bootstrap">
renderStart().catch(err=>{app.innerHTML='<div class="notice">Kunde inte läsa data: '+esc(err.message)+'</div>'});
</script>`;

const historyCss = `
<style id="kentaurai-history-pagination">
.history-pager{margin-top:12px}.linked-horse-meta{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:11px}.linked-horse-meta span+span:before{content:'·';margin-right:10px;color:#5f5a53}
</style>`;

const historyScript = `
<script id="kentaurai-history-pagination-script">
state.startHistoryOffsets=state.startHistoryOffsets||{};
state.linkedHorseOffsets=state.linkedHorseOffsets||{};
const HISTORY_PAGE_SIZE=20;
const previousHistoryOpenDetail=openDetail;
openDetail=async function(page,id){state.startHistoryOffsets[page+':'+id]=0;state.linkedHorseOffsets[page+':'+id]=0;return previousHistoryOpenDetail(page,id)};
const previousHistoryRenderDetail=renderDetail;
function replaceDetailBody(html){const tabBar=document.querySelector('.tabs');if(!tabBar)return;let node=tabBar.nextSibling;while(node){const next=node.nextSibling;node.remove();node=next}tabBar.insertAdjacentHTML('afterend',html)}
function stillCurrentDetail(page,id,tab){return Boolean(state.detail&&state.detail.page===page&&state.detail.id===id&&state.tab===tab)}
function linkedHorsesPage(data){if(!data.items.length)return empty('Inga hästar ännu','Ingen hästhistorik är kopplad till denna profil i databasen.');return '<div class="card"><div class="card-pad">'+data.items.map(item=>'<button class="profile-horse-row" data-history-horse="'+esc(item.id)+'"><span><span class="profile-horse-name">'+esc(item.name)+'</span><span class="linked-horse-meta"><span>'+num(item.starts)+' starter</span><span>senast '+esc(item.latestStartDate||'—')+'</span></span></span><span class="profile-horse-open">Öppna ↗</span></button>').join('')+'</div></div>'+pager(data,'linkedHorse')}
renderDetail=async function(){await previousHistoryRenderDetail();if(!state.detail)return;const {page,id}=state.detail;const requestedTab=state.tab;const key=page+':'+id;
 if(requestedTab==='starts'){
   const offset=state.startHistoryOffsets[key]||0;
   const history=await api('/entities/'+page+'/'+encodeURIComponent(id)+'/starts?limit='+HISTORY_PAGE_SIZE+'&offset='+offset);
   if(!stillCurrentDetail(page,id,requestedTab))return;
   if(history.total>0&&!history.items.length&&offset>0){state.startHistoryOffsets[key]=Math.max(0,Math.floor((history.total-1)/history.limit)*history.limit);return renderDetail()}
   replaceDetailBody((history.items.length?startCards({entity:{name:''},starts:history.items}):empty('Inga starter att visa','Databasen har ännu inga starter kopplade till denna profil.'))+pager(history,'history'));
   bindHorseLinks({starts:history.items});
   const prev=document.getElementById('historyprevPage');const next=document.getElementById('historynextPage');
   if(prev)prev.onclick=()=>{state.startHistoryOffsets[key]=Math.max(0,history.offset-history.limit);renderDetail()};
   if(next)next.onclick=()=>{state.startHistoryOffsets[key]=history.offset+history.limit;renderDetail()};
 }
 if(requestedTab==='horses'&&(page==='trainers'||page==='drivers')){
   const offset=state.linkedHorseOffsets[key]||0;
   const data=await api('/entities/'+page+'/'+encodeURIComponent(id)+'/horses?limit='+HISTORY_PAGE_SIZE+'&offset='+offset);
   if(!stillCurrentDetail(page,id,requestedTab))return;
   if(data.total>0&&!data.items.length&&offset>0){state.linkedHorseOffsets[key]=Math.max(0,Math.floor((data.total-1)/data.limit)*data.limit);return renderDetail()}
   replaceDetailBody(linkedHorsesPage(data));
   document.querySelectorAll('[data-history-horse]').forEach(x=>x.onclick=()=>openDetail('horses',x.dataset.historyHorse));
   const prev=document.getElementById('linkedHorseprevPage');const next=document.getElementById('linkedHorsenextPage');
   if(prev)prev.onclick=()=>{state.linkedHorseOffsets[key]=Math.max(0,data.offset-data.limit);renderDetail()};
   if(next)next.onclick=()=>{state.linkedHorseOffsets[key]=data.offset+data.limit;renderDetail()};
 }
};
</script>`;

export function renderAppPage() {
  return renderReleaseAppPage()
    .replace(releaseBootstrap, '')
    .replace('</head>', `${historyCss}</head>`)
    .replace('</body>', `${historyScript}${releaseBootstrap}</body>`);
}
