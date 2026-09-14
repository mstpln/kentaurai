import { createFeatureProvenance,createFeatureVersionRegistry } from './analysis-v3-foundations.js';
import { buildRelevantHistoryForEntries } from './relevant-history-v1.js';
import { loadPersonContextTarget } from './person-context-target.js';
import { loadDriverHistory } from './person-context-driver-history.js';
import { loadTrainerHistory } from './person-context-trainer-history.js';
import { loadHorsePersonHistory } from './person-context-horse-history.js';
import { buildWindows } from './person-context-summary.js';
import { buildPersonSegments } from './person-context-segments.js';
import { loadPersonProviderFallback } from './person-context-provider.js';
import { buildDriverHorseContext } from './person-context-combo.js';
import { personContextInstant } from './person-context-time.js';

export const PERSON_CONTEXT_CONTRACT_VERSION='kentaurai-person-context-v1';
export const PERSON_CONTEXT_FEATURE_VERSION='person_context_v1';
export const PERSON_CONTEXT_WINDOWS_DAYS=Object.freeze([14,30,90,365]);
export const PERSON_CONTEXT_BASELINE_DAYS=365;

const REGISTRY=createFeatureVersionRegistry([{family:'person_context',version:PERSON_CONTEXT_FEATURE_VERSION,semantics:'Market-blind driver, trainer and driver-horse sport context with own-history baselines, provider fallback and explicit sample evidence.',parameters:{windowsDays:PERSON_CONTEXT_WINDOWS_DAYS,baselineDays:PERSON_CONTEXT_BASELINE_DAYS,segmentMinSamples:3,distanceToleranceM:250}}]);
export function getPersonContextVersionRegistry(){return REGISTRY.snapshot();}

function availability(rows,provider){if(rows.length)return 'own_history';if((provider?.starts??0)>0)return 'provider_fallback';return 'unavailable';}
function refsFrom(rows){return rows.map((row)=>({source_record_id:row.result_source_record_id,selected_at:row.result_observed_at,time_basis:'result_observed_at'})).filter((ref)=>ref.source_record_id&&ref.selected_at);}
function dedupe(refs){const m=new Map();for(const ref of refs.filter(Boolean))m.set(`${ref.source_record_id}|${ref.selected_at}|${ref.time_basis}`,ref);return [...m.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}

export async function buildPersonContextV1ForEntries(env,raceEntryIds,asOf,options={}){
  if(!env?.DB)throw new Error('DB is not configured');
  if(!Array.isArray(raceEntryIds))throw new Error('raceEntryIds must be an array');
  const requested=personContextInstant(asOf);
  const ids=[...new Set(raceEntryIds.map((value)=>String(value??'').trim()).filter(Boolean))];
  if(!ids.length)return new Map();
  const relevant=await buildRelevantHistoryForEntries(env,ids,requested.iso,options.relevantHistoryOptions||{});
  const out=new Map();
  for(const id of ids){
    const target=await loadPersonContextTarget(env,id);
    const cutoff=personContextInstant(relevant.get(id)?.targetCutoff,`targetCutoff for ${id}`);
    const [driverRows,trainerRows,horseRows,driverProvider,trainerProvider]=await Promise.all([
      loadDriverHistory(env,target.driver_id,cutoff.iso),loadTrainerHistory(env,target.trainer_id,cutoff.iso),loadHorsePersonHistory(env,target.horse_id,cutoff.iso),
      loadPersonProviderFallback(env,'driver',target.driver_id,cutoff.iso,PERSON_CONTEXT_FEATURE_VERSION),loadPersonProviderFallback(env,'trainer',target.trainer_id,cutoff.iso,PERSON_CONTEXT_FEATURE_VERSION)
    ]);
    const driverWindow=buildWindows(driverRows,cutoff,'driver',PERSON_CONTEXT_FEATURE_VERSION,PERSON_CONTEXT_WINDOWS_DAYS);
    const trainerWindow=buildWindows(trainerRows,cutoff,'trainer',PERSON_CONTEXT_FEATURE_VERSION,PERSON_CONTEXT_WINDOWS_DAYS);
    const combo=await buildDriverHorseContext(env,horseRows,target.driver_id,cutoff.iso,PERSON_CONTEXT_FEATURE_VERSION);
    const sourceRefs=dedupe([
      ...refsFrom(driverRows),...refsFrom(trainerRows),...refsFrom(horseRows),...combo.xlabs_source_refs,
      driverProvider.source_record_id?{source_record_id:driverProvider.source_record_id,selected_at:driverProvider.observed_at,time_basis:'provider_person_snapshot_observed_at'}:null,
      trainerProvider.source_record_id?{source_record_id:trainerProvider.source_record_id,selected_at:trainerProvider.observed_at,time_basis:'provider_person_snapshot_observed_at'}:null
    ]);
    const provenance=createFeatureProvenance({featureFamily:'person_context',featureVersion:PERSON_CONTEXT_FEATURE_VERSION,asOf:cutoff.iso,sourceRefs,inputVersions:{relevantHistory:relevant.get(id)?.contractVersion||'kentaurai-relevant-history-v1',evidence:'kentaurai-evidence-v1'},parameters:{windowsDays:PERSON_CONTEXT_WINDOWS_DAYS,baselineDays:365,segmentMinSamples:3,distanceToleranceM:250}});
    const {xlabs_source_refs,...driverHorse}=combo;
    out.set(id,{contractVersion:PERSON_CONTEXT_CONTRACT_VERSION,featureVersion:PERSON_CONTEXT_FEATURE_VERSION,requestedAsOf:requested.iso,effectiveAsOf:cutoff.iso,raceEntryId:id,horseId:target.horse_id,driverId:target.driver_id||null,trainerId:target.trainer_id||null,
      driver:{availability:availability(driverRows,driverProvider),baseline_365d:driverWindow.baseline,windows:driverWindow.windows,segments:buildPersonSegments(driverRows,target,cutoff.iso,'driver',PERSON_CONTEXT_FEATURE_VERSION),provider_annual_fallback:driverProvider},
      trainer:{availability:availability(trainerRows,trainerProvider),baseline_365d:trainerWindow.baseline,windows:trainerWindow.windows,segments:buildPersonSegments(trainerRows,target,cutoff.iso,'trainer',PERSON_CONTEXT_FEATURE_VERSION),provider_annual_fallback:trainerProvider,equipment_change_context:{feature_owner:'equipment_response_v1',duplicated:false}},
      driverHorse,provenance});
  }
  return out;
}
