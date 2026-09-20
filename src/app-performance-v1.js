function performanceClient() {
  const cache = new Map();
  const inflight = new Map();
  function ttl(path) {
    if (/\/statistics\/filter-options(?:\?|$)/.test(path) || path.startsWith('/trend/filter-options')) return 600000;
    if (/\/calendar-(statistics|specialties|form)(?:\?|$)/.test(path)) return 180000;
    if (path.startsWith('/trend?')) return 60000;
    if (/^\/entities\/(horses|trainers|drivers)\/[^/?]+(?:\?|$)/.test(path) || /^\/tracks\/[^/?]+(?:\?|$)/.test(path)) return 90000;
    if (/^\/entities\/(horses|trainers|drivers)(?:\?|$)/.test(path) || /^\/tracks(?:\?|$)/.test(path)) return 180000;
    if (/\/starts(?:\?|$)|\/horses(?:\?|$)|\/home-trainers(?:\?|$)|\/lane-stats(?:\?|$)/.test(path)) return 90000;
    if (path.startsWith('/search?')) return 20000;
    return 45000;
  }
  function fresh(path) { const hit=cache.get(path); return Boolean(hit && hit.expiresAt>Date.now()); }
  const originalApi = api;
  api = async function(path,options={}) {
    const signal=options?.signal;
    if(signal){
      const hit=cache.get(path);
      if(hit&&hit.expiresAt>Date.now())return hit.value;
      return originalApi(path,options).then(value=>{cache.set(path,{value,expiresAt:Date.now()+ttl(path)});return value});
    }
    const hit=cache.get(path);
    if (hit && hit.expiresAt>Date.now()) return hit.value;
    if (inflight.has(path)) return inflight.get(path);
    const pending=originalApi(path,options).then(value=>{cache.set(path,{value,expiresAt:Date.now()+ttl(path)});return value}).finally(()=>inflight.delete(path));
    inflight.set(path,pending);
    return pending;
  };
  function warm(path){ if(!path||fresh(path)||inflight.has(path)) return; api(path).catch(()=>{}); }
  function listPath(page){
    if(page==='tracks') return '/tracks?limit=20&offset='+Number(state.trackOffsets||0);
    if(page==='games') return state.gameTab==='overview'?'/games/summary':'/games?type='+String(state.gameTab||'v85').toUpperCase()+'&sort='+encodeURIComponent(state.gameSort||'latest')+'&limit=20&offset='+Number(state.gameOffsets?.[String(state.gameTab||'v85').toUpperCase()]||0);
    if(['trainers','horses','drivers'].includes(page)) return '/entities/'+page+'?limit='+PAGE_SIZE+'&offset='+Number(state.listOffsets?.[page]||0);
    return null;
  }
  function defaultCalendarPath(page,id){
    if(!['trainers','horses','drivers'].includes(page)||!id)return null;
    const q=new URLSearchParams({year:String(new Date().getFullYear()),race_scope:'all',race_type:'all',breed_type:'all',sex:'all',age:'all',start_method:'all',distance_group:'all'});
    if(page!=='horses'){q.set('volt_lane','all');q.set('handicap_m','all')}
    q.set('specials','0');
    return '/'+page+'/'+encodeURIComponent(id)+'/calendar-statistics?'+q.toString();
  }
  function loading(label){ return '<div class="kentaurai-fast-loading" role="status"><div class="kentaurai-fast-line"></div><div class="kentaurai-fast-line short"></div><span>'+esc(label)+'</span></div>'; }
  function show(page,label){ setNav(page); app.innerHTML=loading(label); }
  const oldEntityList=renderEntityList;
  renderEntityList=async function(page){ const path=listPath(page); if(!fresh(path)) show(page,'Läser '+String(labels?.[page]||'').toLowerCase()+'…'); return oldEntityList(page); };
  const oldOpenDetail=openDetail;
  openDetail=async function(page,id){ const path='/entities/'+page+'/'+encodeURIComponent(id); if(!fresh(path)) show(page,'Öppnar profil…'); return oldOpenDetail(page,id); };
  if(typeof renderTracks==='function'){ const old=renderTracks; renderTracks=async function(){ const path=listPath('tracks'); if(!fresh(path)) show('tracks','Läser banor…'); return old(); }; }
  if(typeof openTrackDetail==='function'){ const old=openTrackDetail; openTrackDetail=async function(id){ const path='/tracks/'+encodeURIComponent(id); if(!fresh(path)) show('tracks','Öppnar bana…'); return old(id); }; }
  const oldGames=renderGames;
  renderGames=async function(){ const path=listPath('games'); if(!fresh(path)) show('games','Läser spel…'); return oldGames(); };
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    const trackNav=target?.closest('.nav-item[data-page="tracks"]');
    if(trackNav&&!fresh(listPath('tracks'))) show('tracks','Läser banor…');
    const trackRow=target?.closest('[data-track-id]');
    if(trackRow){ const path='/tracks/'+encodeURIComponent(trackRow.dataset.trackId); if(!fresh(path)) show('tracks','Öppnar bana…'); }
  },true);
  let entityStatsWarmTimer=null;
  document.addEventListener('pointerover',event=>{
    const target=event.target instanceof Element?event.target:null;
    const row=target?.closest('.entity-row[data-id]');
    if(row&&['trainers','horses','drivers'].includes(state.page)){
      const page=state.page,id=row.dataset.id;
      warm('/entities/'+page+'/'+encodeURIComponent(id));
      clearTimeout(entityStatsWarmTimer);
      entityStatsWarmTimer=setTimeout(()=>warm(defaultCalendarPath(page,id)),140);
      const name=row.querySelector('.entity-name')?.textContent?.trim(); if(name&&(page==='trainers'||page==='drivers')) warm('/search?q='+encodeURIComponent(name)+'&limit=40');
    }
    const track=target?.closest('[data-track-id]'); if(track) warm('/tracks/'+encodeURIComponent(track.dataset.trackId));
    const nav=target?.closest('.nav-item[data-page]'); if(nav) warm(listPath(nav.dataset.page));
    const statisticsCategory=target?.closest('[data-statistics-page]'); if(statisticsCategory) warm(listPath(statisticsCategory.dataset.statisticsPage));
  },{passive:true});
  document.addEventListener('pointerout',event=>{const target=event.target instanceof Element?event.target:null;if(target?.closest('.entity-row[data-id]'))clearTimeout(entityStatsWarmTimer)},{passive:true});
  document.addEventListener('focusin',event=>{
    const target=event.target instanceof Element?event.target:null;
    const row=target?.closest('.entity-row[data-id]'); if(row&&['trainers','horses','drivers'].includes(state.page)){ warm('/entities/'+state.page+'/'+encodeURIComponent(row.dataset.id)); warm(defaultCalendarPath(state.page,row.dataset.id)); const name=row.querySelector('.entity-name')?.textContent?.trim(); if(name&&(state.page==='trainers'||state.page==='drivers')) warm('/search?q='+encodeURIComponent(name)+'&limit=40'); }
    const track=target?.closest('[data-track-id]'); if(track) warm('/tracks/'+encodeURIComponent(track.dataset.trackId));
    const statisticsCategory=target?.closest('[data-statistics-page]'); if(statisticsCategory) warm(listPath(statisticsCategory.dataset.statisticsPage));
  });
  const idle=window.requestIdleCallback||((fn)=>setTimeout(fn,250));
  idle(()=>setTimeout(()=>{
    const paths=['/entities/trainers?limit=20&offset=0','/entities/horses?limit=20&offset=0','/entities/drivers?limit=20&offset=0','/tracks?limit=20&offset=0','/games/summary'];
    paths.forEach((path,index)=>setTimeout(()=>warm(path),index*220));
  },1500),{timeout:3000});
  window.__kentauraiApiCache={hasFresh:fresh,clear:()=>cache.clear(),size:()=>cache.size};
}

const performanceCss = `
<style id="kentaurai-performance-v1-style">
.kentaurai-fast-loading{min-height:190px;border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:22px;display:flex;flex-direction:column;gap:11px;color:var(--muted);font-size:11px}
.kentaurai-fast-line{height:18px;max-width:390px;border-radius:8px;background:linear-gradient(90deg,#171715,#22211d,#171715);background-size:200% 100%;animation:kentauraiFastPulse 1.1s linear infinite}
.kentaurai-fast-line.short{max-width:230px;height:12px}
@keyframes kentauraiFastPulse{to{background-position:-200% 0}}
</style>`;

export function enhanceAppPerformanceHtml(html) {
  const text=String(html);
  if(text.includes('kentaurai-performance-v1-script')) return text;
  return text.replace('</head>',performanceCss+'</head>').replace('</body>','<script id="kentaurai-performance-v1-script">('+performanceClient.toString()+')();</script></body>');
}
