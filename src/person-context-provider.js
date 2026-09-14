import { getOfficialPersonAnnualSnapshotsAsOf } from './import/official-snapshots.js';
import { personEvidence } from './person-context-stats.js';

export async function loadPersonProviderFallback(env,type,id,asOf,version) {
  if (!id) return { status:'unavailable',stat_year:null,starts:null,win_rate:personEvidence({value:null,source:`${type}_provider_unavailable`,asOf,version}),top3_rate:personEvidence({value:null,source:`${type}_provider_unavailable`,asOf,version}),observed_at:null,source_record_id:null };
  const snapshot=(await getOfficialPersonAnnualSnapshotsAsOf(env,type,[id],asOf)).get(id)||null;
  if (!snapshot) return { status:'unavailable',stat_year:null,starts:null,win_rate:personEvidence({value:null,source:`${type}_provider_unavailable`,asOf,version}),top3_rate:personEvidence({value:null,source:`${type}_provider_unavailable`,asOf,version}),observed_at:null,source_record_id:null };
  const starts=Number.isInteger(snapshot.starts)?snapshot.starts:null;
  const wins=Number.isInteger(snapshot.wins)?snapshot.wins:null;
  const seconds=Number.isInteger(snapshot.seconds)?snapshot.seconds:null;
  const thirds=Number.isInteger(snapshot.thirds)?snapshot.thirds:null;
  const winRate=starts>0&&wins!=null?wins/starts:null;
  const top3Rate=starts>0&&wins!=null&&seconds!=null&&thirds!=null?(wins+seconds+thirds)/starts:null;
  return {
    status:starts==null?'partial':'available',stat_year:snapshot.statYear,starts,
    win_rate:personEvidence({value:winRate,source:`${type}_provider_annual_snapshot`,known:0,total:0,context:starts||0,asOf,version}),
    top3_rate:personEvidence({value:top3Rate,source:`${type}_provider_annual_snapshot`,known:0,total:0,context:starts||0,asOf,version}),
    observed_at:snapshot.observedAt,source_record_id:snapshot.sourceRecordId
  };
}
