import { getOfficialPersonAnnualSnapshotsAsOf } from './import/official-snapshots.js';
import { personEvidence } from './person-context-stats.js';

function empty(type,asOf,version){return {status:'unavailable',stat_year:null,starts:null,win_rate:personEvidence({value:null,source:`${type}_provider_unavailable`,asOf,version}),top3_rate:personEvidence({value:null,source:`${type}_provider_unavailable`,asOf,version}),observed_at:null,source_record_id:null};}
function summarize(type,snapshot,asOf,version){
  if(!snapshot)return empty(type,asOf,version);
  const starts=Number.isInteger(snapshot.starts)?snapshot.starts:null,wins=Number.isInteger(snapshot.wins)?snapshot.wins:null,seconds=Number.isInteger(snapshot.seconds)?snapshot.seconds:null,thirds=Number.isInteger(snapshot.thirds)?snapshot.thirds:null;
  const winRate=starts>0&&wins!=null?wins/starts:null,top3Rate=starts>0&&wins!=null&&seconds!=null&&thirds!=null?(wins+seconds+thirds)/starts:null;
  return {status:starts==null?'partial':'available',stat_year:snapshot.statYear,starts,win_rate:personEvidence({value:winRate,source:`${type}_provider_annual_snapshot`,context:starts||0,asOf,version}),top3_rate:personEvidence({value:top3Rate,source:`${type}_provider_annual_snapshot`,context:starts||0,asOf,version}),observed_at:snapshot.observedAt,source_record_id:snapshot.sourceRecordId};
}

export async function loadPersonProviderFallbacks(env,type,ids,asOf,version){
  const unique=[...new Set((ids||[]).filter(Boolean))];
  const snapshots=unique.length?await getOfficialPersonAnnualSnapshotsAsOf(env,type,unique,asOf):new Map();
  return new Map(unique.map((id)=>[id,summarize(type,snapshots.get(id)||null,asOf,version)]));
}
export function unavailablePersonProvider(type,asOf,version){return empty(type,asOf,version);}
