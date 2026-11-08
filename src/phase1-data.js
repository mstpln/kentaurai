async function get(path, options = {}) {
  const response = await fetch(`/app/api${path}`, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin'
  });
  if (response.status === 401) {
    location.href = '/app/login';
    throw new Error('Inloggningen har gått ut.');
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `Kunde inte läsa data (${response.status}).`);
  }
  return response.json();
}

export const phase1Api = Object.freeze({
  upcomingRounds: (gameType = '') => get(`/games/upcoming${gameType ? `?type=${encodeURIComponent(gameType)}` : ''}`),
  upcomingRound: (id) => get(`/games/upcoming/${encodeURIComponent(id)}`),
  upcomingLeg: (id, leg) => get(`/games/upcoming/${encodeURIComponent(id)}/legs/${Number(leg)}`),
  horseFacts: (roundId, leg, entryId) => get(`/games/upcoming/${encodeURIComponent(roundId)}/legs/${Number(leg)}/entries/${encodeURIComponent(entryId)}/facts`),
  horseForms: (roundId, leg) => get(`/games/upcoming/${encodeURIComponent(roundId)}/legs/${Number(leg)}/forms`),
  async horseProfile(horseId) {
    const path = `/entities/horses/${encodeURIComponent(horseId)}`;
    const [profile, history] = await Promise.all([
      get(path),
      get(`${path}/starts?limit=30&offset=0`).catch(error => ({ error: error.message, items: [] }))
    ]);
    return { ...profile, starts: completedPhase1Starts(history.items), historyError: history.error || null, historyHasMore: Boolean(history.hasMore) };
  },
  entityList: (page, offset = 0) => get(`/entities/${encodeURIComponent(page)}?limit=20&offset=${Number(offset)}`),
  tracks: (offset = 0) => get(`/tracks?limit=20&offset=${Number(offset)}`),
  searchTracks: (query) => get(`/tracks?q=${encodeURIComponent(query)}&limit=10&offset=0`),
  historicalRounds: (gameType = '') => get(`/games?limit=50&offset=0${gameType ? `&type=${encodeURIComponent(gameType)}` : ''}`),
  settingsStatus: () => get('/settings/status'),
  search: (query) => get(`/search?q=${encodeURIComponent(query)}`)
});

export function completedPhase1Starts(items = [], asOfDate) {
  const cutoff = asOfDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm' }).format(new Date());
  return items.filter(start =>
    !start.scratched && start.race_date && start.race_date <= cutoff &&
    (start.race_status === 'completed' || start.placing != null || start.placing_text != null)
  ).slice(0, 5);
}

export const phase1ApiBrowserSource = `
const completedPhase1Starts=(${completedPhase1Starts.toString()});
const phase1Api={
  async get(path,options={}){
    const response=await fetch('/app/api'+path,{...options,headers:{accept:'application/json',...(options.headers||{})},credentials:'same-origin'});
    if(response.status===401){location.href='/app/login';throw new Error('Inloggningen har gått ut.')}
    if(!response.ok){const body=await response.text().catch(()=> '');throw new Error(body||'Kunde inte läsa data ('+response.status+').')}
    return response.json()
  },
  upcomingRounds(type=''){return this.get('/games/upcoming'+(type?'?type='+encodeURIComponent(type):''))},
  upcomingRound(id){return this.get('/games/upcoming/'+encodeURIComponent(id))},
  upcomingLeg(id,leg){return this.get('/games/upcoming/'+encodeURIComponent(id)+'/legs/'+Number(leg))},
  horseFacts(roundId,leg,entryId){return this.get('/games/upcoming/'+encodeURIComponent(roundId)+'/legs/'+Number(leg)+'/entries/'+encodeURIComponent(entryId)+'/facts')},
  horseForms(roundId,leg){return this.get('/games/upcoming/'+encodeURIComponent(roundId)+'/legs/'+Number(leg)+'/forms')},
  async horseProfile(id){const path='/entities/horses/'+encodeURIComponent(id);const [profile,history]=await Promise.all([this.get(path),this.get(path+'/starts?limit=30&offset=0').catch(error=>({error:error.message,items:[]}))]);return{...profile,starts:completedPhase1Starts(history.items),historyError:history.error||null,historyHasMore:Boolean(history.hasMore)}},
  entityList(page,offset=0){return this.get('/entities/'+encodeURIComponent(page)+'?limit=20&offset='+Number(offset))},
  tracks(offset=0){return this.get('/tracks?limit=20&offset='+Number(offset))},
  searchTracks(query){return this.get('/tracks?q='+encodeURIComponent(query)+'&limit=10&offset=0')},
  search(query){return this.get('/search?q='+encodeURIComponent(query))},
  settingsStatus(){return this.get('/settings/status')},
  personalPage(offset=0){return this.get('/travdata/personal?limit=100&offset='+Number(offset))},
  personalSync(payload){return this.get('/travdata/personal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})},

  historicalRounds(type=''){return this.get('/games?limit=50&offset=0'+(type?'&type='+encodeURIComponent(type):''))}
};`;
