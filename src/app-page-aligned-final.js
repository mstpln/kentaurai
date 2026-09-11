import {
  renderAppPage as renderAlignedAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-aligned.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

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
  .brand{
    grid-area:brand!important;
    padding-right:0!important;
    align-self:center!important;
  }
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

const settingsObserverHook = `const settingsStatusHost=document.getElementById('app');
if(settingsStatusHost){
  const settingsStatusObserver=new MutationObserver(()=>{if(state.settingsOpen&&state.settingsTab==='data')alignSettingsStatuses()});
  settingsStatusObserver.observe(settingsStatusHost,{childList:true,subtree:true});
}`;

export function renderAppPage() {
  return renderAlignedAppPage()
    .replace(brokenSettingsHook, settingsObserverHook)
    .replace('</head>', `${finalHeaderCss}</head>`);
}
