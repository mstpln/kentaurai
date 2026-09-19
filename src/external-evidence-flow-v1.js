import { stableId } from './ids.js';
import { archiveRawPayload } from './raw.js';

export const EXTERNAL_EVIDENCE_CONTEXT_CONTRACT = 'kentaurai-external-evidence-context-v1';
export const EXTERNAL_EVIDENCE_IMPORT_CONTRACT = 'kentaurai-external-evidence-import-v1';
export const EXTERNAL_EVIDENCE_PROMPT_VERSION = 'external-evidence-prompt-v1';

const CONTEXT_TYPES = new Set(['all_starts','current_track','season','v85','v86','lead','balance','wagon']);
const FACT_OR_OPINION = new Set(['fact','opinion','mixed','intention','soft_signal']);
const MAX_SUMMARY = 5000;
const MAX_SIGNAL_VALUE = 1200;
const ID_CHUNK = 40;

function requiredText(value, field, max = 300) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(field + ' is required and must be at most ' + max + ' characters');
  return text;
}

function optionalText(value, field, max = 300) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (text.length > max) throw new Error(field + ' must be at most ' + max + ' characters');
  return text || null;
}

function numberOrNull(value, field, { integer = false, min = -Infinity, max = Infinity } = {}) {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    throw new Error(field + ' is invalid');
  }
  return value;
}

function iso(value, field) {
  const text = requiredText(value, field, 80);
  if (!Number.isFinite(Date.parse(text))) throw new Error(field + ' must be a valid ISO timestamp');
  return new Date(Date.parse(text)).toISOString();
}

function chunks(values, size = ID_CHUNK) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function providerKey(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'chatgpt') return 'openai';
  if (provider === 'anthropic' || provider === 'claude') return 'anthropic';
  throw new Error('provider must be openai or anthropic');
}

function balanceDescriptor(row) {
  const frontBare = row.barefoot_front === 1 ? true : row.barefoot_front === 0 ? false : null;
  const rearBare = row.barefoot_rear === 1 ? true : row.barefoot_rear === 0 ? false : null;
  let label = null;
  if (frontBare === true && rearBare === true) label = 'Barfota runt om';
  else if (frontBare === false && rearBare === false) label = 'Skor runt om';
  else if (frontBare === true && rearBare === false) label = 'Barfota fram';
  else if (frontBare === false && rearBare === true) label = 'Barfota bak';
  else {
    const parts = [
      row.shoes_front ? 'fram: ' + row.shoes_front : null,
      row.shoes_rear ? 'bak: ' + row.shoes_rear : null
    ].filter(Boolean);
    if (parts.length) label = parts.join(' · ');
  }
  if (!label) return null;
  const key = 'balance:' + [
    frontBare == null ? String(row.shoes_front || 'unknown') : (frontBare ? 'barefoot' : 'shod'),
    rearBare == null ? String(row.shoes_rear || 'unknown') : (rearBare ? 'barefoot' : 'shod')
  ].join('|').toLowerCase();
  return { key, label };
}

function wagonDescriptor(row) {
  const raw = String(row.exact_sulky || row.sulky_type || '').trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const label = normalized === 'american' ? 'Amerikansk vagn' : normalized === 'regular' ? 'Vanlig vagn' : raw;
  return { key: 'wagon:' + normalized, label };
}

async function roundIdentity(env, roundId, { equipmentAsOf = null } = {}) {
  const id = requiredText(roundId, 'round_id', 200);
  const round = await env.DB.prepare(
    "SELECT id,game_type,round_date,scheduled_start_at,bet_stop_at,status FROM game_rounds WHERE id=? AND game_type IN ('V85','V86') LIMIT 1"
  ).bind(id).first();
  if (!round) throw new Error('V85/V86 round was not found');

  const { results } = await env.DB.prepare(
    "SELECT gl.leg_number,r.id AS race_id,r.track_id,t.canonical_name AS track_name," +
    " re.id AS race_entry_id,re.start_number,re.horse_id,h.canonical_name AS horse_name," +
    " re.trainer_id,tr.canonical_name AS trainer_name," +
    " eq.shoes_front,eq.shoes_rear,eq.barefoot_front,eq.barefoot_rear,eq.sulky_type,eq.exact_sulky " +
    "FROM game_legs gl JOIN races r ON r.id=gl.race_id LEFT JOIN tracks t ON t.id=r.track_id " +
    "JOIN race_entries re ON re.race_id=r.id JOIN horses h ON h.id=re.horse_id " +
    "LEFT JOIN trainers tr ON tr.id=re.trainer_id " +
    "LEFT JOIN equipment eq ON eq.id=(" +
      "SELECT e2.id FROM equipment e2 LEFT JOIN source_records sr2 ON sr2.id=e2.source_record_id " +
      "WHERE e2.race_entry_id=re.id " +
      (equipmentAsOf ? "AND julianday(sr2.fetched_at)<=julianday(?) " : "") +
      "ORDER BY sr2.fetched_at DESC,e2.id DESC LIMIT 1" +
    ") WHERE gl.game_round_id=? ORDER BY gl.leg_number,COALESCE(re.start_number,999),re.id"
  ).bind(...(equipmentAsOf ? [equipmentAsOf] : []), id).all();

  const entries = (results || []).map((row) => {
    const balance = balanceDescriptor(row);
    const wagon = wagonDescriptor(row);
    const contexts = [
      { context_type:'all_starts', context_key:null, context_label:'Alla starter' },
      row.track_id ? { context_type:'current_track', context_key:'track:' + row.track_id, context_label:row.track_name || 'Aktuell bana' } : null,
      { context_type:'season', context_key:'source_defined_current_season', context_label:'Årstid' },
      { context_type:String(round.game_type).toLowerCase(), context_key:String(round.game_type).toLowerCase(), context_label:round.game_type },
      { context_type:'lead', context_key:'lead', context_label:'Spets' },
      balance ? { context_type:'balance', context_key:balance.key, context_label:'Balans: ' + balance.label } : null,
      wagon ? { context_type:'wagon', context_key:wagon.key, context_label:'Vagn: ' + wagon.label } : null
    ].filter(Boolean);
    return {
      leg_number:Number(row.leg_number),
      race_id:row.race_id,
      race_entry_id:row.race_entry_id,
      start_number:row.start_number == null ? null : Number(row.start_number),
      horse_id:row.horse_id,
      horse_name:row.horse_name,
      trainer_id:row.trainer_id || null,
      trainer_name:row.trainer_name || null,
      track_id:row.track_id || null,
      track_name:row.track_name || null,
      current_balance:balance,
      current_wagon:wagon,
      allowed_stat_contexts:contexts
    };
  });
  const legNumbers = new Set(entries.map((row) => row.leg_number));
  if (legNumbers.size !== 8 || [...legNumbers].some((leg) => !Number.isInteger(leg) || leg < 1 || leg > 8)) {
    throw new Error('round must contain exactly eight populated legs');
  }
  return { round:{ id:round.id, game_type:round.game_type, round_date:round.round_date, scheduled_start_at:round.scheduled_start_at || null, bet_stop_at:round.bet_stop_at || null, status:round.status || null }, entries };
}

async function loadStats(env, horseIds, asOf = null) {
  const out = [];
  for (const group of chunks([...new Set(horseIds)].filter(Boolean))) {
    const { results } = await env.DB.prepare(
      "SELECT id,horse_id,race_entry_id,game_round_id,context_type,context_key,context_label,starts,wins,seconds,thirds,win_rate_percent,roi_percent,observed_at " +
      "FROM external_horse_stat_snapshots WHERE horse_id IN (" + placeholders(group) + ") " +
      (asOf ? "AND julianday(observed_at)<=julianday(?) " : "") +
      "ORDER BY observed_at DESC,id DESC LIMIT 2400"
    ).bind(...group, ...(asOf ? [asOf] : [])).all();
    out.push(...(results || []));
  }
  const counts = new Map();
  return out.filter((row) => {
    const key = row.horse_id + '|' + row.context_type + '|' + String(row.context_key || '');
    const n = counts.get(key) || 0;
    if (n >= 5) return false;
    counts.set(key, n + 1);
    return true;
  }).map((row) => ({
    id:row.id,
    horse_id:row.horse_id,
    race_entry_id:row.race_entry_id || null,
    game_round_id:row.game_round_id || null,
    context_type:row.context_type,
    context_key:row.context_key || null,
    context_label:row.context_label,
    starts:row.starts == null ? null : Number(row.starts),
    wins:row.wins == null ? null : Number(row.wins),
    seconds:row.seconds == null ? null : Number(row.seconds),
    thirds:row.thirds == null ? null : Number(row.thirds),
    win_rate_percent:row.win_rate_percent == null ? null : Number(row.win_rate_percent),
    roi_percent:row.roi_percent == null ? null : Number(row.roi_percent),
    observed_at:row.observed_at
  }));
}

async function loadSignals(env, itemIds) {
  const map = new Map();
  for (const group of chunks(itemIds, 70)) {
    const { results } = await env.DB.prepare(
      "SELECT editorial_item_id,signal_type,value_text,polarity,strength,fact_or_opinion,confidence,evidence_excerpt " +
      "FROM editorial_signals WHERE editorial_item_id IN (" + placeholders(group) + ") ORDER BY editorial_item_id,id"
    ).bind(...group).all();
    for (const row of results || []) {
      if (!map.has(row.editorial_item_id)) map.set(row.editorial_item_id, []);
      map.get(row.editorial_item_id).push({
        type:row.signal_type,
        value:row.value_text,
        polarity:row.polarity,
        strength:row.strength == null ? null : Number(row.strength),
        fact_or_opinion:row.fact_or_opinion,
        confidence:row.confidence == null ? null : Number(row.confidence),
        evidence_excerpt:row.evidence_excerpt
      });
    }
  }
  return map;
}

async function loadInterviews(env, horseIds, trainerIds, asOf = null) {
  const byId = new Map();
  for (const group of chunks([...new Set(horseIds)].filter(Boolean), 35)) {
    const { results } = await env.DB.prepare(
      "SELECT ei.id,ei.horse_id,ei.trainer_id,ei.race_entry_id,ei.race_id,ei.game_round_id,ei.speaker_name,ei.speaker_role,ei.published_at,ei.summary_text " +
      "FROM editorial_items ei JOIN source_records sr ON sr.id=ei.source_record_id " +
      "WHERE sr.source_type='manual_editorial_import' AND ei.horse_id IN (" + placeholders(group) + ") " +
      (asOf ? "AND julianday(COALESCE(ei.published_at,sr.fetched_at))<=julianday(?) " : "") +
      "ORDER BY COALESCE(ei.published_at,ei.created_at) DESC,ei.id DESC LIMIT 1600"
    ).bind(...group, ...(asOf ? [asOf] : [])).all();
    for (const row of results || []) byId.set(row.id, row);
  }
  for (const group of chunks([...new Set(trainerIds)].filter(Boolean), 35)) {
    const { results } = await env.DB.prepare(
      "SELECT ei.id,ei.horse_id,ei.trainer_id,ei.race_entry_id,ei.race_id,ei.game_round_id,ei.speaker_name,ei.speaker_role,ei.published_at,ei.summary_text " +
      "FROM editorial_items ei JOIN source_records sr ON sr.id=ei.source_record_id " +
      "WHERE sr.source_type='manual_editorial_import' AND ei.trainer_id IN (" + placeholders(group) + ") " +
      (asOf ? "AND julianday(COALESCE(ei.published_at,sr.fetched_at))<=julianday(?) " : "") +
      "ORDER BY COALESCE(ei.published_at,ei.created_at) DESC,ei.id DESC LIMIT 1600"
    ).bind(...group, ...(asOf ? [asOf] : [])).all();
    for (const row of results || []) byId.set(row.id, row);
  }
  const rows = [...byId.values()].sort((a,b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
  const horseCount = new Map(), trainerCount = new Map(), selected = [];
  for (const row of rows) {
    const hc = horseCount.get(row.horse_id) || 0;
    const tc = row.trainer_id ? (trainerCount.get(row.trainer_id) || 0) : 0;
    if (hc >= 10 && (!row.trainer_id || tc >= 15)) continue;
    selected.push(row);
    horseCount.set(row.horse_id, hc + 1);
    if (row.trainer_id) trainerCount.set(row.trainer_id, tc + 1);
  }
  const signals = await loadSignals(env, selected.map((row) => row.id));
  return selected.map((row) => ({
    id:row.id,
    horse_id:row.horse_id,
    trainer_id:row.trainer_id || null,
    race_entry_id:row.race_entry_id || null,
    race_id:row.race_id || null,
    game_round_id:row.game_round_id || null,
    speaker_name:row.speaker_name || null,
    speaker_role:row.speaker_role || null,
    published_at:row.published_at || null,
    summary:row.summary_text || null,
    signals:signals.get(row.id) || []
  }));
}

export async function buildExternalEvidenceContext(env, roundId, { purpose = 'analysis' } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  let identity = await roundIdentity(env, roundId);
  const normalizedPurpose = purpose === 'import' ? 'import' : 'analysis';
  const generatedAt = new Date().toISOString();
  const deadline = identity.round.bet_stop_at || identity.round.scheduled_start_at || null;
  const analysisAsOf = deadline && Date.parse(deadline) < Date.parse(generatedAt)
    ? new Date(Date.parse(deadline)).toISOString()
    : generatedAt;
  if (normalizedPurpose === 'analysis') {
    identity = await roundIdentity(env, roundId, { equipmentAsOf: analysisAsOf });
  }
  const stats = normalizedPurpose === 'analysis'
    ? await loadStats(env, identity.entries.map((row) => row.horse_id), analysisAsOf)
    : [];
  const interviews = normalizedPurpose === 'analysis'
    ? await loadInterviews(
      env,
      identity.entries.map((row) => row.horse_id),
      identity.entries.map((row) => row.trainer_id),
      analysisAsOf
    )
    : [];
  return {
    contract_version:EXTERNAL_EVIDENCE_CONTEXT_CONTRACT,
    purpose:normalizedPurpose,
    generated_at:generatedAt,
    analysis_as_of:normalizedPurpose === 'analysis' ? analysisAsOf : null,
    round:identity.round,
    entries:identity.entries,
    historical_external_statistics:stats,
    historical_interviews:interviews,
    rules:{
      drivers_are_out_of_scope:true,
      external_statistics_attach_to_horses_only:true,
      interviews_attach_to_horse_and_trainer_context:true,
      snapshots_are_append_only:true,
      unknown_facts_remain_null:true,
      no_full_paid_article_text:true
    }
  };
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload must be a JSON object');
  if (payload.interview_text != null || payload.full_text != null || payload.article_text != null) {
    throw new Error('full paid article/interview text is not accepted; use structured signals plus summary');
  }
  if (requiredText(payload.contract_version, 'contract_version', 100) !== EXTERNAL_EVIDENCE_IMPORT_CONTRACT) throw new Error('unsupported contract_version');
  const roundId = requiredText(payload.round_id, 'round_id', 200);
  const source = payload.source && typeof payload.source === 'object' && !Array.isArray(payload.source) ? payload.source : {};
  const exportId = requiredText(source.export_id, 'source.export_id', 300);
  const exportedAt = iso(source.exported_at, 'source.exported_at');
  const sourceName = optionalText(source.name, 'source.name', 200) || 'manual_editorial_import';

  const statistics = Array.isArray(payload.statistics) ? payload.statistics.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('statistics[' + index + '] must be an object');
    const contextType = requiredText(row.context_type, 'statistics[' + index + '].context_type', 50);
    if (!CONTEXT_TYPES.has(contextType)) throw new Error('unsupported context_type: ' + contextType);
    return {
      horseId:requiredText(row.horse_id, 'statistics[' + index + '].horse_id', 200),
      raceEntryId:requiredText(row.race_entry_id, 'statistics[' + index + '].race_entry_id', 200),
      contextType,
      contextKey:optionalText(row.context_key, 'statistics[' + index + '].context_key', 300),
      contextLabel:requiredText(row.context_label, 'statistics[' + index + '].context_label', 300),
      starts:numberOrNull(row.starts, 'statistics[' + index + '].starts', { integer:true, min:0 }),
      wins:numberOrNull(row.wins, 'statistics[' + index + '].wins', { integer:true, min:0 }),
      seconds:numberOrNull(row.seconds, 'statistics[' + index + '].seconds', { integer:true, min:0 }),
      thirds:numberOrNull(row.thirds, 'statistics[' + index + '].thirds', { integer:true, min:0 }),
      winRate:numberOrNull(row.win_rate_percent, 'statistics[' + index + '].win_rate_percent', { min:0, max:100 }),
      roi:numberOrNull(row.roi_percent, 'statistics[' + index + '].roi_percent', { min:0 }),
      observedAt:iso(row.observed_at || exportedAt, 'statistics[' + index + '].observed_at')
    };
  }).map((row, index) => {
    if (row.starts != null) {
      for (const [label, value] of [['wins',row.wins],['seconds',row.seconds],['thirds',row.thirds]]) {
        if (value != null && value > row.starts) throw new Error('statistics[' + index + '].' + label + ' cannot exceed starts');
      }
      const placingTotal = [row.wins,row.seconds,row.thirds].filter((value) => value != null).reduce((sum,value) => sum + value, 0);
      if (placingTotal > row.starts) throw new Error('statistics[' + index + '] placing counts cannot exceed starts');
    }
    return row;
  }) : [];

  const interviews = Array.isArray(payload.interviews) ? payload.interviews.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('interviews[' + index + '] must be an object');
    if (row.interview_text != null || row.full_text != null || row.article_text != null) throw new Error('full interview text is not accepted');
    const signals = Array.isArray(row.signals) ? row.signals.map((signal, signalIndex) => {
      if (!signal || typeof signal !== 'object' || Array.isArray(signal)) throw new Error('interview signal must be an object');
      const fact = requiredText(signal.fact_or_opinion, 'interviews[' + index + '].signals[' + signalIndex + '].fact_or_opinion', 40);
      if (!FACT_OR_OPINION.has(fact)) throw new Error('unsupported fact_or_opinion: ' + fact);
      return {
        type:requiredText(signal.type, 'signal.type', 120),
        value:optionalText(signal.value, 'signal.value', MAX_SIGNAL_VALUE),
        polarity:optionalText(signal.polarity, 'signal.polarity', 40),
        strength:numberOrNull(signal.strength, 'signal.strength', { min:0, max:1 }),
        factOrOpinion:fact,
        confidence:numberOrNull(signal.confidence, 'signal.confidence', { min:0, max:1 }),
        evidenceExcerpt:optionalText(signal.evidence_excerpt, 'signal.evidence_excerpt', 400)
      };
    }) : [];
    return {
      horseId:requiredText(row.horse_id, 'interviews[' + index + '].horse_id', 200),
      raceEntryId:requiredText(row.race_entry_id, 'interviews[' + index + '].race_entry_id', 200),
      trainerId:optionalText(row.trainer_id, 'interviews[' + index + '].trainer_id', 200),
      speakerName:optionalText(row.speaker_name, 'interviews[' + index + '].speaker_name', 300),
      speakerRole:optionalText(row.speaker_role, 'interviews[' + index + '].speaker_role', 120),
      publishedAt:row.published_at ? iso(row.published_at, 'interviews[' + index + '].published_at') : exportedAt,
      summary:requiredText(row.summary, 'interviews[' + index + '].summary', MAX_SUMMARY),
      signals
    };
  }) : [];

  if (!statistics.length && !interviews.length) throw new Error('payload must contain statistics or interviews');
  return { roundId, source:{ exportId, exportedAt, sourceName }, statistics, interviews };
}

function entryMap(identity) {
  return new Map(identity.entries.map((row) => [row.race_entry_id, row]));
}

function assertContextAllowed(entry, stat) {
  if (entry.horse_id !== stat.horseId) throw new Error('statistic horse_id does not match race_entry_id');
  const allowed = entry.allowed_stat_contexts.find((row) =>
    row.context_type === stat.contextType && String(row.context_key || '') === String(stat.contextKey || '')
  );
  if (!allowed) throw new Error('statistic context is not allowed by the round import context');
  if (allowed.context_label !== stat.contextLabel) throw new Error('statistic context_label must match the import context');
}

export async function importExternalEvidence(env, payload) {
  if (!env?.DB) throw new Error('DB is not configured');
  const validated = validatePayload(payload);
  const identity = await roundIdentity(env, validated.roundId);
  const entries = entryMap(identity);

  for (const stat of validated.statistics) {
    const entry = entries.get(stat.raceEntryId);
    if (!entry) throw new Error('statistic race_entry_id is not part of selected round');
    assertContextAllowed(entry, stat);
  }
  for (const interview of validated.interviews) {
    const entry = entries.get(interview.raceEntryId);
    if (!entry) throw new Error('interview race_entry_id is not part of selected round');
    if (entry.horse_id !== interview.horseId) throw new Error('interview horse_id does not match race_entry_id');
    if (interview.trainerId && entry.trainer_id !== interview.trainerId) throw new Error('interview trainer_id does not match race_entry_id');
  }

  const raw = await archiveRawPayload(env, {
    sourceType:'manual_editorial_import',
    externalId:validated.source.exportId,
    sourceUrl:null,
    fetchedAt:validated.source.exportedAt,
    payload,
    qualityStatus:'manual_structured',
    rightsStatus:'structured_only',
    metadata:{ sourceName:validated.source.sourceName, contractVersion:EXTERNAL_EVIDENCE_IMPORT_CONTRACT }
  });

  const counts = { statistics:0, interviews:0, signals:0 };
  for (const [index, stat] of validated.statistics.entries()) {
    const entry = entries.get(stat.raceEntryId);
    const id = stableId('external-stat', raw.sourceRecordId, index, stat.raceEntryId, stat.contextType, stat.contextKey || 'null');
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO external_horse_stat_snapshots " +
      "(id,horse_id,race_entry_id,game_round_id,context_type,context_key,context_label,starts,wins,seconds,thirds,win_rate_percent,roi_percent,observed_at,source_record_id) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      id, stat.horseId, stat.raceEntryId, validated.roundId, stat.contextType, stat.contextKey, stat.contextLabel,
      stat.starts, stat.wins, stat.seconds, stat.thirds, stat.winRate, stat.roi, stat.observedAt, raw.sourceRecordId
    ).run();
    counts.statistics += Number(result?.meta?.changes || 0);
  }

  for (const [index, interview] of validated.interviews.entries()) {
    const entry = entries.get(interview.raceEntryId);
    const itemId = stableId('external-interview', raw.sourceRecordId, index, interview.raceEntryId, interview.speakerName || 'unknown');
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO editorial_items " +
      "(id,race_entry_id,horse_id,trainer_id,race_id,game_round_id,speaker_name,speaker_role,published_at,source_name,source_url,summary_text,rights_status,source_record_id) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,'structured_only',?)"
    ).bind(
      itemId, interview.raceEntryId, interview.horseId, interview.trainerId || entry.trainer_id || null,
      entry.race_id, validated.roundId, interview.speakerName, interview.speakerRole, interview.publishedAt,
      validated.source.sourceName, interview.summary, raw.sourceRecordId
    ).run();
    const inserted = Number(result?.meta?.changes || 0);
    counts.interviews += inserted;
    if (inserted) {
      for (const [signalIndex, signal] of interview.signals.entries()) {
        const signalResult = await env.DB.prepare(
          "INSERT OR IGNORE INTO editorial_signals " +
          "(id,editorial_item_id,signal_type,value_text,polarity,strength,fact_or_opinion,confidence,evidence_excerpt) VALUES (?,?,?,?,?,?,?,?,?)"
        ).bind(
          stableId('external-interview-signal', itemId, signalIndex, signal.type),
          itemId, signal.type, signal.value, signal.polarity, signal.strength, signal.factOrOpinion, signal.confidence, signal.evidenceExcerpt
        ).run();
        counts.signals += Number(signalResult?.meta?.changes || 0);
      }
    }
  }
  return { contract_version:EXTERNAL_EVIDENCE_IMPORT_CONTRACT, round_id:validated.roundId, reused_raw_snapshot:raw.reused, counts };
}

export async function getHorseExternalStats(env, horseId) {
  const id = requiredText(horseId, 'horse_id', 200);
  const horse = await env.DB.prepare("SELECT id,canonical_name FROM horses WHERE id=? LIMIT 1").bind(id).first();
  if (!horse) return null;
  const { results } = await env.DB.prepare(
    "SELECT id,context_type,context_key,context_label,starts,wins,seconds,thirds,win_rate_percent,roi_percent,observed_at " +
    "FROM external_horse_stat_snapshots WHERE horse_id=? ORDER BY " +
    "CASE context_type WHEN 'all_starts' THEN 1 WHEN 'current_track' THEN 2 WHEN 'season' THEN 3 WHEN 'v85' THEN 4 WHEN 'v86' THEN 4 WHEN 'lead' THEN 5 WHEN 'balance' THEN 6 WHEN 'wagon' THEN 7 ELSE 99 END," +
    "context_key,observed_at DESC,id DESC"
  ).bind(id).all();
  return {
    horse:{ id:horse.id, name:horse.canonical_name },
    items:(results || []).map((row) => ({
      id:row.id, contextType:row.context_type, contextKey:row.context_key || null, contextLabel:row.context_label,
      starts:row.starts == null ? null : Number(row.starts), wins:row.wins == null ? null : Number(row.wins),
      seconds:row.seconds == null ? null : Number(row.seconds), thirds:row.thirds == null ? null : Number(row.thirds),
      winRatePercent:row.win_rate_percent == null ? null : Number(row.win_rate_percent),
      roiPercent:row.roi_percent == null ? null : Number(row.roi_percent), observedAt:row.observed_at
    }))
  };
}

async function interviewsFor(env, column, id) {
  const { results } = await env.DB.prepare(
    "SELECT ei.id,ei.horse_id,h.canonical_name AS horse_name,ei.trainer_id,tr.canonical_name AS trainer_name," +
    "ei.speaker_name,ei.speaker_role,ei.published_at,ei.summary_text " +
    "FROM editorial_items ei JOIN source_records sr ON sr.id=ei.source_record_id LEFT JOIN horses h ON h.id=ei.horse_id LEFT JOIN trainers tr ON tr.id=ei.trainer_id " +
    "WHERE sr.source_type='manual_editorial_import' AND ei." + column + "=? ORDER BY COALESCE(ei.published_at,ei.created_at) DESC,ei.id DESC LIMIT 200"
  ).bind(id).all();
  const signals = await loadSignals(env, (results || []).map((row) => row.id));
  return (results || []).map((row) => ({
    id:row.id,
    horseId:row.horse_id,
    horseName:row.horse_name,
    trainerId:row.trainer_id || null,
    trainerName:row.trainer_name || null,
    speakerName:row.speaker_name || null,
    speakerRole:row.speaker_role || null,
    publishedAt:row.published_at || null,
    summary:row.summary_text || null,
    signals:signals.get(row.id) || []
  }));
}

export async function getHorseInterviews(env, horseId) {
  const id = requiredText(horseId, 'horse_id', 200);
  const horse = await env.DB.prepare("SELECT id,canonical_name FROM horses WHERE id=? LIMIT 1").bind(id).first();
  if (!horse) return null;
  return { entity:{ id:horse.id, name:horse.canonical_name }, items:await interviewsFor(env, 'horse_id', id) };
}

export async function getTrainerInterviews(env, trainerId) {
  const id = requiredText(trainerId, 'trainer_id', 200);
  const trainer = await env.DB.prepare("SELECT id,canonical_name FROM trainers WHERE id=? LIMIT 1").bind(id).first();
  if (!trainer) return null;
  return { entity:{ id:trainer.id, name:trainer.canonical_name }, items:await interviewsFor(env, 'trainer_id', id) };
}

export function getExternalEvidenceStep3Prompt(provider = 'openai') {
  const key = providerKey(provider);
  const label = key === 'openai' ? 'ChatGPT' : 'Claude';
  return [
    '# KentaurAI - Steg 3: Intervjuer och extern statistik',
    '',
    'Fortsätt i samma ' + label + '-konversation efter Steg 1 och Steg 2.',
    'Läs KentaurAI-filen med sparad extern kontext och dagens uppladdade PDF:er/skärmbilder.',
    '',
    'Använd bara sådant som tillför ny information efter den blinda analysen och marknadsanalysen.',
    '- Extern häststatistik: framför allt Alla starter, aktuell bana, årstid, V85/V86, spets, dagens faktiska balans och dagens faktiska vagn.',
    '- Intervjuer: skilj fakta, intentioner, soft signals och åsikter.',
    '- Tidigare intervjuer får användas som historisk tränar-/stallkontext, men dra inga starka slutsatser från små urval.',
    '- Kuskintervjuer och extern kuskstatistik ingår inte i detta flöde.',
    '- Marknaden får inte användas som bevis för att en intervju eller statistisk uppgift är sann.',
    '',
    'Om ny sportslig fakta motiverar det får du göra en tydligt versionerad dagsjustering av sannolikheterna. Den blinda Steg 1-bedömningen ska alltid bevaras separat.',
    'Stanna efter Steg 3. Bygg inget färdigt system förrän jag fortsätter dialogen.'
  ].join('\n');
}

export function getExternalEvidenceImportPrompt(provider = 'openai') {
  providerKey(provider);
  return [
    '# KentaurAI - skapa importfil för extern statistik och intervjuer',
    '',
    'Använd materialet som redan finns i denna konversation tillsammans med den uppladdade KentaurAI-importkontexten.',
    'Skapa en enda giltig JSON-fil med contract_version "' + EXTERNAL_EVIDENCE_IMPORT_CONTRACT + '". Ingen markdown och ingen text utanför JSON.',
    '',
    'VIKTIGT:',
    '- Importera inte PDF:er eller bilder direkt. Extrahera strukturerad data.',
    '- Använd endast horse_id, trainer_id, race_entry_id och tillåtna statistik-kontexter från importkontexten.',
    '- Spara endast extern statistik som faktiskt finns i materialet. Hitta aldrig på saknade värden.',
    '- För balans, vagn och bana måste context_key och context_label kopieras exakt från importkontextens allowed_stat_contexts.',
    '- Intervjuer kopplas till hästen och tränaren/stallet. Ange den faktiska talaren och rollen när den framgår.',
    '- Ta med en fyllig sammanfattning och alla relevanta strukturerade signaler, men inkludera inte full betald artikel- eller intervjutext.',
    '- Ingen data ska skapas för kuskar.',
    '- Varje observation ska ha observed_at/published_at från materialet när möjligt.',
    '',
    'JSON-form:',
    '{',
    '  "contract_version": "' + EXTERNAL_EVIDENCE_IMPORT_CONTRACT + '",',
    '  "round_id": "<exakt från importkontexten>",',
    '  "source": {"name":"manual_editorial_import","export_id":"<stabilt id>","exported_at":"<ISO>"},',
    '  "statistics": [{"horse_id":"...","race_entry_id":"...","context_type":"all_starts|current_track|season|v85|v86|lead|balance|wagon","context_key":null,"context_label":"...","starts":null,"wins":null,"seconds":null,"thirds":null,"win_rate_percent":null,"roi_percent":null,"observed_at":"<ISO>"}],',
    '  "interviews": [{"horse_id":"...","trainer_id":"...","race_entry_id":"...","speaker_name":"...","speaker_role":"trainer|stable_representative|other","published_at":"<ISO>","summary":"...","signals":[{"type":"form|training|tactics|distance|start|equipment|expectation|other","value":"...","polarity":"positive|neutral|negative","strength":null,"fact_or_opinion":"fact|intention|soft_signal|opinion|mixed","confidence":null,"evidence_excerpt":"kort utdrag"}]}]',
    '}'
  ].join('\n');
}
