import { summarizeRows } from './person-context-summary.js';
import { personEvidence } from './person-context-stats.js';

export const PERSON_CONTEXT_SEGMENT_MIN_SAMPLES = 3;
export const PERSON_CONTEXT_DISTANCE_TOLERANCE_M = 250;

function guarded(rows, asOf, role, name, version) {
  if (rows.length >= PERSON_CONTEXT_SEGMENT_MIN_SAMPLES) return { status:'available',...summarizeRows(rows,asOf,`${role}_${name}_segment`,version) };
  const base=summarizeRows(rows,asOf,`${role}_${name}_segment`,version);
  return {
    status:rows.length?'insufficient_sample':'unavailable',starts:rows.length,
    placing_samples:base.placing_samples,gallop_samples:base.gallop_samples,disqualification_samples:base.disqualification_samples,
    win_rate:personEvidence({value:null,source:`${role}_${name}_segment_insufficient`,known:base.placing_samples,total:rows.length,asOf,version}),
    top3_rate:personEvidence({value:null,source:`${role}_${name}_segment_insufficient`,known:base.placing_samples,total:rows.length,asOf,version}),
    gallop_rate:personEvidence({value:null,source:`${role}_${name}_segment_insufficient`,known:base.gallop_samples,total:rows.length,asOf,version}),
    disqualification_rate:personEvidence({value:null,source:`${role}_${name}_segment_insufficient`,known:base.disqualification_samples,total:rows.length,asOf,version})
  };
}

export function buildPersonSegments(rows,target,asOf,role,version) {
  const targetDistance=target.actual_start_distance_m??target.distance_m;
  const sameMethod=target.start_method?rows.filter((r)=>r.start_method===target.start_method):[];
  const similarDistance=targetDistance==null?[]:rows.filter((r)=>{const d=r.actual_start_distance_m??r.distance_m;return d!=null&&Math.abs(Number(d)-Number(targetDistance))<=PERSON_CONTEXT_DISTANCE_TOLERANCE_M;});
  const sameTrack=target.track_id?rows.filter((r)=>r.track_id===target.track_id):[];
  const sameTier=target.start_tier==null?[]:rows.filter((r)=>Number(r.start_tier)===Number(target.start_tier));
  return {
    same_start_method:guarded(sameMethod,asOf,role,'same_start_method',version),
    similar_distance:guarded(similarDistance,asOf,role,'similar_distance',version),
    same_track:guarded(sameTrack,asOf,role,'same_track',version),
    same_tier:guarded(sameTier,asOf,role,'same_tier',version)
  };
}
