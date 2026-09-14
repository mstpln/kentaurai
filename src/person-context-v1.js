import { createFeatureProvenance,createFeatureVersionRegistry } from './analysis-v3-foundations.js';
import { buildRelevantHistoryForEntries } from './relevant-history-v1.js';
import { loadPersonContextTargets } from './person-context-target.js';
import { loadDriverHistories } from './person-context-driver-history.js';
import { loadTrainerHistories } from './person-context-trainer-history.js';
import { loadHorsePersonHistories } from './person-context-horse-history.js';
import { buildWindows } from './person-context-summary.js';
import { buildPersonSegments } from './person-context-segments.js';
import { loadPersonProviderFallbacks,unavailablePersonProvider } from './person-context-provider.js';
import { buildDriverHorseContext,loadDriverHorseXlabs } from './person-context-combo.js';
import { personContextInstant } from './person-context-time.js';

export const PERSON_CONTEXT_CONTRACT_VERSION='kentaurai-person-context-v1';
export const PERSON_CONTEXT_FEATURE_VERSION='person_context_v1';
export const PERSON_CONTEXT_WINDOWS_DAYS=Object.freeze([14,30,90,365]);
export const PERSON_CONTEXT_BASELINE_DAYS=365;
const REGISTRY=createFeatureVersionRegistry([{family:'person_context',version:PERSON_CONTEXT_FEATURE_VERSION,semantics:'Market-blind driver, trainer and driver-horse sport context with own-history baselines, provider fallback and explicit sample evidence.',parameters:{windowsDays:PERSON_CONTEXT_WINDOWS_DAYS,baselineDays:365,segmentMinSamples:3,distanceToleranceM:250}}]);
export function getPersonContextVersionRegistry(){return REGISTRY.snapshot();}
function availability(rows,provider){if(rows.length)return 'own_history';if((provider?.starts??0)>0)return 'provider_fallback';return 'unavailable';}
function resultRefs(rows){return rows.map((row)=>({source_record_id:row.result_source_record_id,selected_at:row.result_observed_at,time_basis:'result_observed_at'})).filter((ref)=>ref.source_record_id&&ref.selected_at);}
function dedupe(refs){const m=new Map();for(const ref of refs.filter(Boolean))m.set(`${ref.source_record_id}|${ref.selected_at}|${ref.time_basis}`,ref);return [...m.values()].sort((a,b)=>`${a.source_record_id}|${a.selected_at}`.localeCompare(`${b.source_record_id}|${b.selected_at}`));}

export async function buildPersonContextV1ForEntries(env,raceEntryIds,asOf,options={}){
  if(!env?.DB)throw new Error('DB is not configured');if(!Array.isArray(raceEntryIds))throw new Error('raceEntryIds must be an array');
  const requested=personContextInstant(asOf),ids=[...new Set(raceEntryIds.map((v)=>String(v??'').trim()).filter(Boolean))];if(!ids.length)return new Map();
  const [targets,relevant]=await Promise.all([loadPersonContextTargets(env,ids),buildRelevantHistoryForEntries(env,ids,requested.iso,options.relevantHistoryOptions||{})]);
  const groups=new Map();
  for(const id of ids){const cutoff=personContextInstant(relevant.get(id)?.targetCutoff,`targetCutoff for ${id}`);if(!groups.has(cutoff.iso))groups.set(cutoff.iso,[]);groups.get(cutoff.iso).push(targets.get(id));}
  const cache=new Map();
  for(const [cutoffIso,group] of groups){
    const [drivers,trainers,horses,driverProviders,trainerProviders]=await Promise.all([
      loadDriverHistories(env,group.map((x)=>x.driver_id),cutoffIso),loadTrainerHistories(env,group.map((x)=>x.trainer_id),cutoffIso),loadHorsePersonHistories(env,group.map((x)=>x.horse_id),cutoffIso),
      loadPersonProviderFallbacks(env,'driver',group.map((x)=>x.driver_id),cutoffIso,PERSON_CONTEXT_FEATURE_VERSION),loadPersonProviderFallbacks(env,'trainer',group.map((x)=>x.trainer_id),cutoffIso,PERSON_CONTEXT_FEATURE_VERSION)
    ]);
    const allHorseRows=[...horses.values()].flat(),xlabs=await loadDriverHorseXlabs(env,allHorseRows.map((row)=>row.race_entry_id),cutoffIso);
    cache.set(cutoffIso,{drivers,trainers,horses,driverProviders,trainerProviders,xlabs});
  }
  const out=new Map();
  for(const id of ids){
    const target=targets.get(id),cutoff=personContextInstant(relevant.get(id)?.targetCutoff),data=cache.get(cutoff.iso);
    const driverRows=data.drivers.get(target.driver_id)||[],trainerRows=data.trainers.get(target.trainer_id)||[],horseRows=data.horses.get(target.horse_id)||[];
    const driverProvider=data.driverProviders.get(target.driver_id)||unavailablePersonProvider('driver',cutoff.iso,PERSON_CONTEXT_FEATURE_VERSION),trainerProvider=data.trainerProviders.get(target.trainer_id)||unavailablePersonProvider('trainer',cutoff.iso,PERSON_CONTEXT_FEATURE_VERSION);
    const dw=buildWindows(driverRows,cutoff,'driver',PERSON_CONTEXT_FEATURE_VERSION,PERSON_CONTEXT_WINDOWS_DAYS),tw=buildWindows(trainerRows,cutoff,'trainer',PERSON_CONTEXT_FEATURE_VERSION,PERSON_CONTEXT_WINDOWS_DAYS),combo=buildDriverHorseContext(horseRows,target.driver_id,data.xlabs,cutoff.iso,PERSON_CONTEXT_FEATURE_VERSION);
    const sourceRefs=dedupe([...resultRefs(driverRows),...resultRefs(trainerRows),...resultRefs(horseRows),...combo.xlabs_source_refs,driverProvider.source_record_id?{source_record_id:driverProvider.source_record_id,selected_at:driverProvider.observed_at,time_basis:'provider_person_snapshot_observed_at'}:null,trainerProvider.source_record_id?{source_record_id:trainerProvider.source_record_id,selected_at:trainerProvider.observed_at,time_basis:'provider_person_snapshot_observed_at'}:null]);
    const provenance=createFeatureProvenance({featureFamily:'person_context',featureVersion:PERSON_CONTEXT_FEATURE_VERSION,asOf:cutoff.iso,sourceRefs,inputVersions:{relevantHistory:relevant.get(id)?.contractVersion||'kentaurai-relevant-history-v1',evidence:'kentaurai-evidence-v1'},parameters:{windowsDays:PERSON_CONTEXT_WINDOWS_DAYS,baselineDays:365,segmentMinSamples:3,distanceToleranceM:250}});
    const {xlabs_source_refs,...driverHorse}=combo;
    out.set(id,{contractVersion:PERSON_CONTEXT_CONTRACT_VERSION,featureVersion:PERSON_CONTEXT_FEATURE_VERSION,requestedAsOf:requested.iso,effectiveAsOf:cutoff.iso,raceEntryId:id,horseId:target.horse_id,driverId:target.driver_id||null,trainerId:target.trainer_id||null,
      driver:{availability:availability(driverRows,driverProvider),baseline_365d:dw.baseline,windows:dw.windows,segments:buildPersonSegments(driverRows,target,cutoff.iso,'driver',PERSON_CONTEXT_FEATURE_VERSION),provider_annual_fallback:driverProvider},
      trainer:{availability:availability(trainerRows,trainerProvider),baseline_365d:tw.baseline,windows:tw.windows,segments:buildPersonSegments(trainerRows,target,cutoff.iso,'trainer',PERSON_CONTEXT_FEATURE_VERSION),provider_annual_fallback:trainerProvider,equipment_change_context:{feature_owner:'equipment_response_v1',duplicated:false}},driverHorse,provenance});
  }
  return out;
}
