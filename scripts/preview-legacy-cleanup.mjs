// Read-only dependency preflight for a later, separately reviewed cleanup.
// Public logs: aggregate counts ONLY, never individual systems, source IDs,
// racing payloads or raw private editorial data.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCloudflareReadonlyQuery } from './diagnose-storage-anomalies.mjs';

export const FIRST_CLEANUP_TABLES=Object.freeze([
  'editorial_signals','editorial_items','external_horse_stat_snapshots',
  'ai_horse_predictions','ai_race_analyses','analysis_external_exports'
]);
export const PRESERVED_TABLES=Object.freeze([
  'systems','system_selections','travdata_manual_systems','travdata_horse_notes',
  'source_records','import_runs','race_results','game_round_final_results',
  'race_entries','xlabs_data','analysis_entry_form_snapshots',
  'reference_round_exports','reference_observations','post_race_reviews',
  'analysis_external_runs','post_race_reviews_external_v1',
  'learning_hypotheses','learning_observations'
]);
export const PREFLIGHT_SQL=Object.freeze({
  candidates: 'SELECT '+FIRST_CLEANUP_TABLES.map(t=>
    '(SELECT COUNT(*) FROM '+t+') AS '+t).join(','),
  protected: [
    'SELECT',
    '(SELECT COUNT(*) FROM systems) AS systems,',
    '(SELECT COUNT(*) FROM system_selections) AS system_selections,',
    '(SELECT COUNT(*) FROM travdata_manual_systems) AS travdata_manual_systems,',
    '(SELECT COUNT(*) FROM travdata_horse_notes) AS travdata_horse_notes,',
    '(SELECT COUNT(*) FROM game_round_final_results) AS game_round_final_results,',
    '(SELECT COUNT(*) FROM analysis_external_runs) AS analysis_external_runs,',
    '(SELECT COUNT(*) FROM post_race_reviews_external_v1) AS post_race_reviews_external_v1,',
    '(SELECT COUNT(*) FROM post_race_learning_links_external_v1) AS post_race_learning_links_external_v1,',
    '(SELECT COUNT(*) FROM learning_hypotheses) AS learning_hypotheses,',
    '(SELECT COUNT(*) FROM learning_observations) AS learning_observations,',
    '(SELECT COUNT(*) FROM reference_round_exports) AS reference_round_exports,',
    '(SELECT COUNT(*) FROM reference_observations) AS reference_observations,',
    '(SELECT COUNT(*) FROM post_race_reviews) AS post_race_reviews'
  ].join(' '),
  linked: [
    'SELECT',
    '(SELECT COUNT(DISTINCT aer.main_system_id) FROM analysis_external_runs aer',
    'JOIN systems s ON s.id=aer.main_system_id) AS systems_with_external_analysis,',
    '(SELECT COUNT(*) FROM post_race_reviews_external_v1 pr',
    'JOIN systems s ON s.id=pr.system_id) AS external_reviews_linked_to_systems,',
    '(SELECT COUNT(*) FROM post_race_reviews pr',
    'JOIN systems s ON s.id=pr.system_id) AS legacy_reviews_linked_to_systems,',
    '(SELECT COUNT(*) FROM editorial_items ei',
    'JOIN reference_round_exports rre ON rre.game_round_id=ei.game_round_id)',
    'AS editorial_items_linked_to_reference_round,',
    '(SELECT COUNT(*) FROM ai_race_analyses ara',
    'JOIN reference_round_exports rre ON rre.game_round_id =',
    '(SELECT gl.game_round_id FROM game_legs gl WHERE gl.race_id=ara.race_id LIMIT 1))',
    'AS ai_analyses_in_reference_round'
  ].join(' '),
  consistency: [
    'SELECT',
    '(SELECT COUNT(*) FROM editorial_signals es LEFT JOIN editorial_items ei',
    'ON ei.id=es.editorial_item_id WHERE ei.id IS NULL) AS orphan_editorial_signals,',
    '(SELECT COUNT(*) FROM ai_horse_predictions hp LEFT JOIN ai_race_analyses ra',
    'ON ra.id=hp.ai_race_analysis_id WHERE ra.id IS NULL) AS orphan_predictions,',
    '(SELECT COUNT(*) FROM external_horse_stat_snapshots xs LEFT JOIN source_records sr',
    'ON sr.id=xs.source_record_id WHERE sr.id IS NULL) AS orphan_external_sources,',
    '(SELECT COUNT(*) FROM post_race_reviews_external_v1 pr LEFT JOIN analysis_external_runs ar',
    'ON ar.id=pr.external_run_id WHERE ar.id IS NULL) AS orphan_external_reviews,',
    '(SELECT COUNT(*) FROM analysis_external_runs ar LEFT JOIN systems s',
    'ON s.id=ar.main_system_id WHERE s.id IS NULL) AS orphan_system_lineage'
  ].join(' ')
});

function countsOnly(rows,label,required){
  if(!Array.isArray(rows)||rows.length!==1||!rows[0]||typeof rows[0]!=='object')
    throw new Error('legacy_preflight_invalid_'+label);
  const result={};
  for(const key of required){
    const n=rows[0][key];
    if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)
      throw new Error('legacy_preflight_bad_count_'+key);
    result[key]=n;
  }
  return result;
}

export async function previewLegacyCleanup(query){
  if(typeof query!=='function')throw new Error('legacy_preflight_readonly_query_required');
  const results={};
  for(const [group,sql] of Object.entries(PREFLIGHT_SQL)){
    if(!/^SELECT \(/.test(sql) || /\b(?:DELETE|UPDATE|INSERT|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/i.test(sql))
      throw new Error('legacy_preflight_sql_not_readonly');
    const fields=group==='candidates'?FIRST_CLEANUP_TABLES:group==='protected'
      ?['systems','system_selections','travdata_manual_systems','travdata_horse_notes',
        'game_round_final_results','analysis_external_runs','post_race_reviews_external_v1',
        'post_race_learning_links_external_v1','learning_hypotheses',
        'learning_observations','reference_round_exports',
        'reference_observations','post_race_reviews']
      :group==='linked'
      ?['systems_with_external_analysis','external_reviews_linked_to_systems',
        'legacy_reviews_linked_to_systems','editorial_items_linked_to_reference_round',
        'ai_analyses_in_reference_round']
      :['orphan_editorial_signals','orphan_predictions','orphan_external_sources',
        'orphan_external_reviews','orphan_system_lineage'];
    results[group]=countsOnly(await query(sql),group,fields);
  }
  const inconsistent=Object.values(results.consistency).some(x=>x!==0);
  const potential=Object.values(results.candidates).reduce((a,b)=>a+b,0);
  return {
    mode:'read_only_legacy_cleanup_dependency_preflight',
    potentialFirstStageRows:potential,
    candidates:results.candidates,
    protected:results.protected,
    linked:results.linked,
    referentialIntegrityWarnings:results.consistency,
    allOrphanChecksPassed:!inconsistent,
    releaseEligibleForDeletion:false,
    sqlRowsWritten:0,
    rawPayloadReturned:false
  };
}
async function main(){
  const client=createCloudflareReadonlyQuery(process.env);
  const out=await previewLegacyCleanup(client.query);
  const cost=client.getCost();
  console.log(JSON.stringify({...out,cost}));
  if(process.env.GITHUB_STEP_SUMMARY){
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## Read-only legacy cleanup dependency preflight\n\n'
      +'- First-stage **potential** rows (NOT authorized for deletion): '
      +out.potentialFirstStageRows+'\n'
      +'- Preserved legacy systems: '+out.protected.systems+'\n'
      +'- Preserved selections: '+out.protected.system_selections+'\n'
      +'- Legacy systems linked to external AI: '+out.linked.systems_with_external_analysis+'\n'
      +'- Legacy post-race reviews referencing systems: '+out.linked.legacy_reviews_linked_to_systems+'\n'
      +'- External reviews referencing systems: '+out.linked.external_reviews_linked_to_systems+'\n'
      +'- Referential check passed: '+out.allOrphanChecksPassed+'\n'
      +'- D1 rows read: '+cost.rowsRead+'; written: '+cost.rowsWritten+'\n\n'
      +'**This preflight cannot authorize a delete.** The old system-history '
      +'views read external analysis lineage; preserve all system associations '
      +'until the exact consumer changes, private backup and zero-write deletion '
      +'rehearsal are reviewed.\n');
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  main().catch(error=>{
    console.error('legacy_preflight_stopped: '+String(error?.message||'unknown_error'));
    process.exitCode=1;
  });
