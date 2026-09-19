import {
  EXTERNAL_EVIDENCE_IMPORT_CONTEXT_CONTRACT,
  EXTERNAL_EVIDENCE_IMPORT_CONTRACT,
  buildExternalEvidenceImportContext,
  loadRoundEvidenceIdentity
} from './external-evidence-model-v1.js';

export const STEP3_CONTEXT_CONTRACT = 'kentaurai-step3-context-v1';
const SQL_CHUNK = 60;

function chunks(values) {
  const out = [];
  for (let i = 0; i < values.length; i += SQL_CHUNK) out.push(values.slice(i, i + SQL_CHUNK));
  return out;
}
function ph(values) { return values.map(() => '?').join(','); }
function providerKey(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'chatgpt') return 'openai';
  if (provider === 'anthropic' || provider === 'claude') return 'anthropic';
  throw new Error('provider must be openai or anthropic');
}
function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

async function loadStatistics(env, horseIds, asOf = null) {
  const out = new Map(horseIds.map((id) => [id, []]));
  for (const group of chunks(horseIds)) {
    const { results } = await env.DB.prepare(
      'SELECT * FROM (' +
      ' SELECT s.*,ROW_NUMBER() OVER (PARTITION BY s.horse_id,s.context_type,s.context_key ORDER BY datetime(s.available_at) DESC,s.id DESC) AS rn' +
      ' FROM external_horse_stat_snapshots s WHERE s.horse_id IN (' + ph(group) + ')' +
      (asOf ? ' AND datetime(s.available_at)<=datetime(?)' : '') +
      ') WHERE rn<=5 ORDER BY horse_id,context_type,context_key,datetime(available_at) DESC,id DESC'
    ).bind(...group,...(asOf?[asOf]:[])).all();
    for (const row of results || []) out.get(row.horse_id)?.push({
      context_type:row.context_type,
      context_key:row.context_key || '',
      context_label:row.context_label || null,
      track_id:row.track_id || null,
      context:parseJson(row.context_json),
      starts:Number(row.starts),
      wins:row.wins == null ? null : Number(row.wins),
      seconds:row.seconds == null ? null : Number(row.seconds),
      thirds:row.thirds == null ? null : Number(row.thirds),
      win_percent:row.win_percent == null ? null : Number(row.win_percent),
      roi_percent:row.roi_percent == null ? null : Number(row.roi_percent),
      observed_at:row.observed_at || null,
      available_at:row.available_at
    });
  }
  return out;
}

async function loadInterviewRows(env, horseIds, trainerIds, asOf = null) {
  const rows = new Map();
  for (const group of chunks(horseIds)) {
    const { results } = await env.DB.prepare(
      'SELECT * FROM (' +
      ' SELECT i.*,ROW_NUMBER() OVER (PARTITION BY i.horse_id ORDER BY datetime(COALESCE(i.published_at,i.available_at)) DESC,i.id DESC) AS rn' +
      ' FROM external_interviews i WHERE i.horse_id IN (' + ph(group) + ')' +
      (asOf ? ' AND datetime(i.available_at)<=datetime(?)' : '') +
      ') WHERE rn<=12'
    ).bind(...group,...(asOf?[asOf]:[])).all();
    for (const row of results || []) rows.set(row.id,row);
  }
  for (const group of chunks(trainerIds)) {
    const { results } = await env.DB.prepare(
      'SELECT * FROM (' +
      ' SELECT i.*,ROW_NUMBER() OVER (PARTITION BY i.trainer_id ORDER BY datetime(COALESCE(i.published_at,i.available_at)) DESC,i.id DESC) AS rn' +
      ' FROM external_interviews i WHERE i.trainer_id IN (' + ph(group) + ')' +
      (asOf ? ' AND datetime(i.available_at)<=datetime(?)' : '') +
      ') WHERE rn<=20'
    ).bind(...group,...(asOf?[asOf]:[])).all();
    for (const row of results || []) rows.set(row.id,row);
  }
  const horseNames=new Map(),trainerNames=new Map();
  const rowHorseIds=[...new Set([...rows.values()].map((row)=>row.horse_id).filter(Boolean))];
  const rowTrainerIds=[...new Set([...rows.values()].map((row)=>row.trainer_id).filter(Boolean))];
  for(const group of chunks(rowHorseIds)){
    const {results}=await env.DB.prepare('SELECT id,canonical_name FROM horses WHERE id IN ('+ph(group)+')').bind(...group).all();
    for(const row of results||[]) horseNames.set(row.id,row.canonical_name);
  }
  for(const group of chunks(rowTrainerIds)){
    const {results}=await env.DB.prepare('SELECT id,canonical_name FROM trainers WHERE id IN ('+ph(group)+')').bind(...group).all();
    for(const row of results||[]) trainerNames.set(row.id,row.canonical_name);
  }
  const ids=[...rows.keys()];
  const signals=new Map(ids.map((id)=>[id,[]]));
  for (const group of chunks(ids)) {
    const { results }=await env.DB.prepare(
      'SELECT interview_id,signal_type,value_text,polarity,signal_class,confidence FROM external_interview_signals ' +
      'WHERE interview_id IN (' + ph(group) + ') ORDER BY interview_id,id'
    ).bind(...group).all();
    for(const row of results||[]) signals.get(row.interview_id)?.push({
      type:row.signal_type,value:row.value_text||null,polarity:row.polarity||null,
      class:row.signal_class,confidence:row.confidence==null?null:Number(row.confidence)
    });
  }
  return [...rows.values()].map((row)=>({
    id:row.id,horse_id:row.horse_id,horse_name:horseNames.get(row.horse_id)||null,
    trainer_id:row.trainer_id||null,trainer_name:row.trainer_id?trainerNames.get(row.trainer_id)||null:null,
    speaker_name:row.speaker_name,speaker_role:row.speaker_role||null,speaker_relation:row.speaker_relation||null,
    published_at:row.published_at||null,available_at:row.available_at,
    interview_text:row.interview_text,summary:row.summary_text||null,signals:signals.get(row.id)||[]
  })).sort((a,b)=>String(b.published_at||b.available_at).localeCompare(String(a.published_at||a.available_at))||a.id.localeCompare(b.id));
}

export async function buildStep3Context(env, roundId) {
  const identity=await loadRoundEvidenceIdentity(env,roundId);
  const active=identity.entries.filter((row)=>!row.scratched);
  const raceStarts=active.map((row)=>row.scheduled_start_at).filter(Boolean).sort();
  const contextAsOf=identity.round.bet_stop_at||identity.round.scheduled_start_at||raceStarts[0]||new Date().toISOString();
  const roundContext=await buildExternalEvidenceImportContext(env,roundId,{asOf:contextAsOf});
  const horseIds=[...new Set(active.map((row)=>row.horse_id))];
  const trainerIds=[...new Set(active.map((row)=>row.trainer_id).filter(Boolean))];
  const [stats,interviews]=await Promise.all([
    loadStatistics(env,horseIds,contextAsOf),
    loadInterviewRows(env,horseIds,trainerIds,contextAsOf)
  ]);
  const byHorse=new Map(horseIds.map((id)=>[id,[]]));
  const byTrainer=new Map(trainerIds.map((id)=>[id,[]]));
  for(const item of interviews){
    if(byHorse.has(item.horse_id)&&byHorse.get(item.horse_id).length<12) byHorse.get(item.horse_id).push(item);
    if(item.trainer_id&&byTrainer.has(item.trainer_id)&&byTrainer.get(item.trainer_id).length<20) byTrainer.get(item.trainer_id).push(item);
  }
  const horseNames=new Map(active.map((row)=>[row.horse_id,row.horse_name]));
  const trainerNames=new Map(active.filter((row)=>row.trainer_id).map((row)=>[row.trainer_id,row.trainer_name]));
  const currentContextByHorse=new Map(
    (roundContext.entries||[]).filter((row)=>!row.scratched).map((row)=>[row.horse.id,row.external_stat_context])
  );
  return {
    contract_version:STEP3_CONTEXT_CONTRACT,
    generated_at:new Date().toISOString(),
    round:identity.round,
    context_as_of:contextAsOf,
    purpose:'historical_external_context_for_step3_only',
    horses:horseIds.map((id)=>({
      horse_id:id,horse_name:horseNames.get(id)||null,
      current_round_context:currentContextByHorse.get(id)||null,
      external_statistics:stats.get(id)||[],
      interview_history:byHorse.get(id)||[]
    })),
    trainers:trainerIds.map((id)=>({
      trainer_id:id,trainer_name:trainerNames.get(id)||null,
      interview_history:byTrainer.get(id)||[]
    }))
  };
}

export async function getHorseExternalStatistics(env, horseId) {
  const id=String(horseId||'').trim();
  if(!id) throw new Error('horse_id is required');
  const horse=await env.DB.prepare('SELECT id,canonical_name FROM horses WHERE id=? LIMIT 1').bind(id).first();
  if(!horse) return null;
  const {results}=await env.DB.prepare(
    'SELECT context_type,context_key,context_label,track_id,context_json,starts,wins,seconds,thirds,win_percent,roi_percent,observed_at,available_at ' +
    'FROM external_horse_stat_snapshots WHERE horse_id=? ORDER BY context_type,context_key,datetime(available_at) DESC,id DESC LIMIT 500'
  ).bind(id).all();
  return {
    horse:{id:horse.id,name:horse.canonical_name},
    snapshots:(results||[]).map((row)=>({
      context_type:row.context_type,context_key:row.context_key||'',context_label:row.context_label||null,
      track_id:row.track_id||null,context:parseJson(row.context_json),starts:Number(row.starts),
      wins:row.wins==null?null:Number(row.wins),seconds:row.seconds==null?null:Number(row.seconds),
      thirds:row.thirds==null?null:Number(row.thirds),win_percent:row.win_percent==null?null:Number(row.win_percent),
      roi_percent:row.roi_percent==null?null:Number(row.roi_percent),observed_at:row.observed_at||null,available_at:row.available_at
    }))
  };
}

export async function getExternalInterviews(env, type, entityId) {
  const normalized=String(type||'').toLowerCase();
  if(!['horses','trainers'].includes(normalized)) throw new Error('interviews are available only for horses and trainers');
  const id=String(entityId||'').trim();
  if(!id) throw new Error('entity_id is required');
  const table=normalized==='horses'?'horses':'trainers';
  const entity=await env.DB.prepare('SELECT id,canonical_name FROM '+table+' WHERE id=? LIMIT 1').bind(id).first();
  if(!entity) return null;
  const interviews=normalized==='horses'
    ? await loadInterviewRows(env,[id],[])
    : await loadInterviewRows(env,[],[id]);
  return {
    entity:{id:entity.id,name:entity.canonical_name,type:normalized==='horses'?'horse':'trainer'},
    interviews:interviews.filter((item)=>normalized==='horses'?item.horse_id===id:item.trainer_id===id)
  };
}

export function getStep3Prompt(provider='openai') {
  const label=providerKey(provider)==='openai'?'ChatGPT':'Claude';
  return [
    '# KentaurAI - Steg 3: Intervjuer och extern statistik','',
    'Fortsätt i samma '+label+'-konversation efter Steg 1 och Steg 2.',
    'Läs Step 3-kontexten och dagens PDF:er/skärmbilder som jag laddar upp.','',
    'REGLER:',
    '- Extern statistik används främst där den tillför information som KentaurAI saknar: lifetime, ROI, aktuell bana, årstid, V85/V86, spets, aktuell balans och aktuell vagn.',
    '- Håll intervjuer separat från statistik. Skilj fakta, intention, mjuk signal och åsikt.',
    '- Historiska intervjuer för samma häst/tränare får användas som språk-/tonkontext, men inte som säker trovärdighetspoäng från små urval.',
    '- Tipskommentarer och extern ranking/spik ändrar inte i sig sportslig styrka.',
    '- ROI är marknadsberoende historik, inte ren kapacitet.',
    '- Marknaden är redan synlig: låt inte streck/odds styra tolkningen av ny sportslig information.','',
    'Om ny sportslig evidens motiverar ändring, visa Steg 1 -> dagsjusterad chans och låt varje avdelning summera till 100 %. Bevara Steg 1 som baslinje.',
    'Sammanfatta vad som ändras per avdelning och de viktigaste nya faktorerna. Bygg inte ett färdigt system ännu; invänta min dialog.'
  ].join('\n');
}

export function getExternalEvidenceImportPrompt(provider='openai') {
  const key=providerKey(provider);
  return [
    '# KentaurAI - importera extern statistik och intervjuer','',
    'Materialet finns redan i denna konversation. Läs importunderlaget med contract_version "'+EXTERNAL_EVIDENCE_IMPORT_CONTEXT_CONTRACT+'".',
    'Skapa en enda JSON-fil med contract_version "'+EXTERNAL_EVIDENCE_IMPORT_CONTRACT+'". Ingen text utanför JSON.','',
    'Använd bara race_entry_id från importunderlaget. KentaurAI binder själv häst, tränare, bana, aktuell balans och aktuell vagn. Spara ingen kuskdata.','',
    'JSON-fält:',
    '- submission_id: nytt stabilt id med gemener/siffror/bindestreck',
    '- round_id: exakt från importunderlaget',
    '- generated_at: aktuell ISO-tid',
    '- source_reference: kort privat källreferens från materialet, om den framgår',
    '- producer: {"provider":"'+key+'","model":"<verklig modell>"}',
    '- statistics: race_entry_id, context_type, starts, wins, seconds, thirds, win_percent, roi_percent, observed_at',
    '- interviews: race_entry_id, speaker_name, speaker_role, speaker_relation, published_at, interview_text, summary, signals','',
    'Tillåtna context_type: all_starts, current_track, season, v85, v86, lead, current_balance, current_wagon.',
    'Ett "-" i källan är saknad data, inte noll. Hitta inte på värden.',
    'För current_track/current_balance/current_wagon anger du bara context_type; KentaurAI binder verifierad kontext.',
    'interview_text ska innehålla intervjun och faktisk talare, inte tipskommentar eller övrig artikeltext.',
    'Koppla via race_entry_id så sparas intervjun på både hästen och tränaren/stallet. Skapa inga kuskposter.',
    'Om något inte kan mappas entydigt ska det utelämnas.'
  ].join('\n');
}

export { buildExternalEvidenceImportContext };
