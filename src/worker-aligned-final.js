import worker from './worker-settings.js';
import { finalizeStatisticsHtml } from './statistics-ui-finalize.js';

const finalHeaderCss = `
<style id="kentaurai-aligned-header-final">
@media(max-width:760px){
  .top-inner{
    position:static!important;
    grid-template-columns:minmax(0,1fr) 32px!important;
    grid-template-areas:"brand settings" "search search"!important;
    align-items:center!important;
    gap:9px 10px!important;
  }
  .brand{grid-area:brand!important;padding-right:0!important;align-self:center!important}
  .search-wrap{grid-area:search!important;min-width:0!important}
  .settings-button{
    grid-area:settings!important;
    position:static!important;
    top:auto!important;
    right:auto!important;
    justify-self:end!important;
    align-self:center!important;
    width:32px!important;
    height:32px!important;
    padding:5px!important;
  }
  .settings-button svg{width:21px!important;height:21px!important}
}
</style>`;

const brokenSettingsHook = `const priorAlignedRenderData=renderData;
renderData=async function(){await priorAlignedRenderData();if(state.settingsOpen&&state.settingsTab==='data')alignSettingsStatuses()};`;
const compactBrokenSettingsHook = `const priorAlignedRenderData=renderData;renderData=async function(){await priorAlignedRenderData();if(state.settingsOpen&&state.settingsTab==='data')alignSettingsStatuses()};`;

const settingsObserverHook = `const settingsStatusHost=document.getElementById('app');
if(settingsStatusHost){
  const settingsStatusObserver=new MutationObserver(()=>{if(state.settingsOpen&&state.settingsTab==='data')alignSettingsStatuses()});
  settingsStatusObserver.observe(settingsStatusHost,{childList:true,subtree:true});
}`;

const legacyTrackHistoryHook = `function patchTrackHistory(id,tab){const current=history.state;if(!current||current.marker!=='kentaurai-nav-v1'||!current.view)return;history.replaceState({...current,view:{...current.view,page:'tracks',trackDetail:id||null,trackTab:tab||'overview'},signature:JSON.stringify({...current.view,page:'tracks',trackDetail:id||null,trackTab:tab||'overview'})},'')}`;

const finalTrackHistoryHook = `function patchTrackHistory(id,tab){
  const current=history.state;if(!current||current.marker!=='kentaurai-nav-v1'||!current.view)return;
  const trackDetail=id||null,trackTab=tab||'overview';
  if(trackDetail&&current.trackDetail!==trackDetail){history.pushState({...current,depth:Number(current.depth||0)+1,trackDetail,trackTab},'');return}
  history.replaceState({...current,trackDetail,trackTab},'')
}`;

const legacyTrackRestoreHook = `const priorAlignedRenderStart=renderStart;
renderStart=async function(){const view=history.state?.view;if(view?.page==='tracks'){state.trackTab=view.trackTab||'overview';if(view.trackDetail)return renderTrackDetail(view.trackDetail);return renderTracks()}return priorAlignedRenderStart()};`;
const compactLegacyTrackRestoreHook = `const priorAlignedRenderStart=renderStart;renderStart=async function(){const view=history.state?.view;if(view?.page==='tracks'){state.trackTab=view.trackTab||'overview';if(view.trackDetail)return renderTrackDetail(view.trackDetail);return renderTracks()}return priorAlignedRenderStart()};`;

const finalTrackRestoreHook = `const priorAlignedRenderStart=renderStart;
renderStart=async function(){const navState=history.state,view=navState?.view;if(view?.page==='tracks'){state.trackTab=navState.trackTab||'overview';if(navState.trackDetail)return renderTrackDetail(navState.trackDetail);return renderTracks()}return priorAlignedRenderStart()};`;

const legacyInitialTrendBoot = `renderStart().catch(err=>{app.innerHTML='<div class="notice">Kunde inte läsa data: '+esc(err.message)+'</div>'});`;

async function withFinalAlignment(request, response) {
  if (request.method !== 'GET') return response;
  const path = new URL(request.url).pathname;
  if (path !== '/app/') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const alignedBody = body
    .replace(brokenSettingsHook, settingsObserverHook)
    .replace(compactBrokenSettingsHook, settingsObserverHook)
    .replace(legacyTrackHistoryHook, finalTrackHistoryHook)
    .replace(legacyTrackRestoreHook, finalTrackRestoreHook)
    .replace(compactLegacyTrackRestoreHook, finalTrackRestoreHook)
    .replace(legacyInitialTrendBoot, '')
    .replace('</head>', `${finalHeaderCss}</head>`);
  return new Response(finalizeStatisticsHtml(alignedBody), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    return withFinalAlignment(request, await worker.fetch(request, env, ctx));
  },
  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
