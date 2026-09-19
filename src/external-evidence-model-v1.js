import { stableId } from './ids.js';
import { archiveRawPayload } from './raw.js';
import { startImportRun, finishImportRun } from './import/common.js';

export const EXTERNAL_EVIDENCE_IMPORT_CONTEXT_CONTRACT = 'kentaurai-external-evidence-import-context-v1';
export const EXTERNAL_EVIDENCE_IMPORT_CONTRACT = 'kentaurai-external-evidence-import-v1';
export const EXTERNAL_EVIDENCE_SOURCE_TYPE = 'external_evidence_manual';

const STAT_CONTEXTS = new Set(['all_starts','current_track','season','v85','v86','lead','current_balance','current_wagon']);
const SIGNAL_CLASSES = new Set(['fact','intention','soft_signal','opinion','mixed']);
const SQL_CHUNK = 60;

function chunks(values) {
  const out = [];
  for (let i = 0; i < values.length; i += SQL_CHUNK) out.push(values.slice(i, i + SQL_CHUNK));
  return out;
}
function ph(values) { return values.map(() => '?').join(','); }
function requiredText(value, field, max = 200) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(field + ' is required and must be at most ' + max + ' characters');
  return text;
}
function optionalText(value, field, max = 4000) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (text.length > max) throw new Error(field + ' must be at most ' + max + ' characters');
  return text;
}
function iso(value, field, nullable = false) {
  if (value == null && nullable) return null;
  const text = requiredText(value, field, 80);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error(field + ' must be a valid ISO timestamp');
  return new Date(parsed).toISOString();
}
function int(value, field, nullable = false) {
  if (value == null && nullable) return null;
  if (!Number.isInteger(value) || value < 0) throw new Error(field + ' must be a non-negative integer');
  return value;
}
function num(value, field, min, max = Infinity, nullable = false) {
  if (value == null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(field + ' must be a valid JSON number');
  }
  return value;
}
function cleanRole(value) {
  if (value == null || value === '') return null;
  const role = String(value).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!role || role.length > 80) throw new Error('speaker_role is invalid');
  return role;
}
function shoeState(value, barefoot) {
  const text = String(value || '').trim().toLowerCase();
  const textState = !text ? null
    : /(barefoot|barfota)/.test(text) ? 'barefoot'
      : /(shod|shoe|skor|with_shoes|med skor)/.test(text) ? 'shod'
        : 'reported:' + text.slice(0, 60);
  const boolState = barefoot === 1 || barefoot === true ? 'barefoot'
    : barefoot === 0 || barefoot === false ? 'shod'
      : null;
  if (boolState && (textState === 'barefoot' || textState === 'shod') && boolState !== textState) return 'conflict';
  return boolState || textState;
}
export function equipmentContexts(row) {
  if (!row) return { balance:null, wagon:null };
  const front = shoeState(row.shoes_front, row.barefoot_front);
  const rear = shoeState(row.shoes_rear, row.barefoot_rear);
  let balance = null;
  const balanceConflict = front === 'conflict' || rear === 'conflict';
  if (!balanceConflict && (front || rear)) {
    let label;
    if (front === 'barefoot' && rear === 'barefoot') label = 'Barfota runt om';
    else if (front === 'shod' && rear === 'shod') label = 'Skor runt om';
    else if (front === 'barefoot' && rear === 'shod') label = 'Barfota fram';
    else if (front === 'shod' && rear === 'barefoot') label = 'Barfota bak';
    else label = 'Balans: ' + [front || 'okänt fram', rear || 'okänt bak'].join(' / ');
    balance = {
      key: JSON.stringify({ front, rear }),
      label,
      metadata: {
        shoes_front: row.shoes_front || null,
        shoes_rear: row.shoes_rear || null,
        barefoot_front: row.barefoot_front == null ? null : Boolean(row.barefoot_front),
        barefoot_rear: row.barefoot_rear == null ? null : Boolean(row.barefoot_rear),
        observed_at: row.observed_at || null
      }
    };
  }
  const sulky = String(row.sulky_type || '').trim() || null;
  const exact = String(row.exact_sulky || '').trim() || null;
  let wagon = null;
  if (sulky || exact) {
    const normalized = String(sulky || exact).toLowerCase();
    const label = /american|amerik/.test(normalized) ? 'Amerikansk vagn'
      : /regular|vanlig|standard/.test(normalized) ? 'Vanlig vagn'
        : (exact || sulky);
    wagon = {
      key: JSON.stringify({ sulky_type:sulky, exact_sulky:exact }),
      label,
      metadata: { sulky_type:sulky, exact_sulky:exact, observed_at:row.observed_at || null }
    };
  }
  return { balance, wagon };
}

export async function loadRoundEvidenceIdentity(env, roundId) {
  const id = requiredText(roundId, 'round_id');
  const round = await env.DB.prepare(
    "SELECT id,game_type,round_date,scheduled_start_at,bet_stop_at,status FROM game_rounds WHERE id=? AND game_type IN ('V85','V86') LIMIT 1"
  ).bind(id).first();
  if (!round) throw new Error('V85/V86 round was not found');
  const { results } = await env.DB.prepare(
    "SELECT gl.leg_number,r.id AS race_id,r.track_id,r.scheduled_start_at,t.canonical_name AS track_name," +
    "re.id AS race_entry_id,re.start_number,re.scratched,h.id AS horse_id,h.canonical_name AS horse_name," +
    "tr.id AS trainer_id,tr.canonical_name AS trainer_name " +
    "FROM game_legs gl JOIN races r ON r.id=gl.race_id LEFT JOIN tracks t ON t.id=r.track_id " +
    "JOIN race_entries re ON re.race_id=r.id JOIN horses h ON h.id=re.horse_id " +
    "LEFT JOIN trainers tr ON tr.id=re.trainer_id WHERE gl.game_round_id=? " +
    "ORDER BY gl.leg_number,CASE WHEN re.start_number IS NULL THEN 999 ELSE re.start_number END,re.id"
  ).bind(id).all();
  const entries = (results || []).map((row) => ({
    leg_number:Number(row.leg_number), race_id:row.race_id, track_id:row.track_id || null,
    track_name:row.track_name || null, scheduled_start_at:row.scheduled_start_at || null,
    race_entry_id:row.race_entry_id, start_number:row.start_number == null ? null : Number(row.start_number),
    scratched:Number(row.scratched || 0) === 1, horse_id:row.horse_id, horse_name:row.horse_name,
    trainer_id:row.trainer_id || null, trainer_name:row.trainer_name || null
  }));
  if (new Set(entries.map((row) => row.leg_number)).size !== 8) throw new Error('round must contain exactly eight populated legs');
  return { round, entries };
}

export async function loadRoundEquipment(env, entries) {
  const ids = [...new Set(entries.map((row) => row.race_entry_id))];
  const cutoffs = new Map(entries.map((row) => [row.race_entry_id, row.scheduled_start_at]));
  const out = new Map();
  for (const group of chunks(ids)) {
    const { results } = await env.DB.prepare(
      "SELECT e.race_entry_id,e.shoes_front,e.shoes_rear,e.barefoot_front,e.barefoot_rear,e.sulky_type,e.exact_sulky," +
      "sr.fetched_at AS observed_at,e.id FROM equipment e LEFT JOIN source_records sr ON sr.id=e.source_record_id " +
      "WHERE e.race_entry_id IN (" + ph(group) + ") ORDER BY e.race_entry_id,COALESCE(sr.fetched_at,'') DESC,e.id DESC"
    ).bind(...group).all();
    for (const row of results || []) {
      if (out.has(row.race_entry_id)) continue;
      const cutoff = cutoffs.get(row.race_entry_id);
      if (cutoff && row.observed_at && Date.parse(row.observed_at) > Date.parse(cutoff)) continue;
      out.set(row.race_entry_id, row);
    }
  }
  return out;
}

export async function buildExternalEvidenceImportContext(env, roundId) {
  const identity = await loadRoundEvidenceIdentity(env, roundId);
  const equipment = await loadRoundEquipment(env, identity.entries);
  return {
    contract_version:EXTERNAL_EVIDENCE_IMPORT_CONTEXT_CONTRACT,
    output_contract:EXTERNAL_EVIDENCE_IMPORT_CONTRACT,
    generated_at:new Date().toISOString(),
    round:identity.round,
    allowed_stat_contexts:[...STAT_CONTEXTS],
    rules:{ append_only:true, no_driver_data:true, current_context_is_server_bound:true },
    entries:identity.entries.map((row) => {
      const contexts = equipmentContexts(equipment.get(row.race_entry_id));
      return {
        leg_number:row.leg_number, race_id:row.race_id, race_entry_id:row.race_entry_id,
        start_number:row.start_number, scratched:row.scratched,
        horse:{ id:row.horse_id, name:row.horse_name },
        trainer:row.trainer_id ? { id:row.trainer_id, name:row.trainer_name } : null,
        track:row.track_id ? { id:row.track_id, name:row.track_name } : null,
        external_stat_context:{
          current_track:row.track_id ? { key:row.track_id, label:row.track_name } : null,
          current_balance:contexts.balance, current_wagon:contexts.wagon
        }
      };
    })
  };
}

function normalizeStats(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 1000) throw new Error('statistics must be an array with at most 1000 rows');
  return value.map((row, index) => {
    const type = requiredText(row?.context_type, 'statistics[' + index + '].context_type', 40).toLowerCase();
    if (!STAT_CONTEXTS.has(type)) throw new Error('unsupported statistics context: ' + type);
    const starts = int(row.starts, 'statistics[' + index + '].starts');
    const wins = int(row.wins, 'statistics[' + index + '].wins', true);
    const seconds = int(row.seconds, 'statistics[' + index + '].seconds', true);
    const thirds = int(row.thirds, 'statistics[' + index + '].thirds', true);
    if ([wins,seconds,thirds].some((v) => v != null && v > starts)) throw new Error('placing count cannot exceed starts');
    if ([wins,seconds,thirds].every((v) => v != null) && wins + seconds + thirds > starts) throw new Error('placing counts cannot exceed starts');
    return {
      raceEntryId:requiredText(row.race_entry_id, 'statistics[' + index + '].race_entry_id'),
      type, starts, wins, seconds, thirds,
      winPercent:num(row.win_percent, 'statistics[' + index + '].win_percent', 0, 100, true),
      roiPercent:num(row.roi_percent, 'statistics[' + index + '].roi_percent', 0, Infinity, true),
      observedAt:iso(row.observed_at, 'statistics[' + index + '].observed_at', true)
    };
  });
}
function normalizeInterviews(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 300) throw new Error('interviews must be an array with at most 300 rows');
  return value.map((row, index) => {
    const signals = row?.signals == null ? [] : row.signals;
    if (!Array.isArray(signals) || signals.length > 50) throw new Error('interview signals must be an array with at most 50 rows');
    return {
      raceEntryId:requiredText(row.race_entry_id, 'interviews[' + index + '].race_entry_id'),
      speakerName:requiredText(row.speaker_name, 'interviews[' + index + '].speaker_name'),
      speakerRole:cleanRole(row.speaker_role),
      speakerRelation:optionalText(row.speaker_relation, 'speaker_relation', 300),
      publishedAt:iso(row.published_at, 'published_at', true),
      interviewText:requiredText(row.interview_text, 'interview_text', 24000),
      summary:optionalText(row.summary, 'summary', 4000),
      signals:signals.map((signal, signalIndex) => {
        const klass = requiredText(signal?.class, 'signal.class', 30).toLowerCase();
        if (!SIGNAL_CLASSES.has(klass)) throw new Error('unsupported signal class: ' + klass);
        return {
          index:signalIndex, type:requiredText(signal.type, 'signal.type', 80),
          value:optionalText(signal.value, 'signal.value', 1000),
          polarity:optionalText(signal.polarity, 'signal.polarity', 40),
          klass, confidence:num(signal.confidence, 'signal.confidence', 0, 1, true)
        };
      })
    };
  });
}
function statContext(type, entry, equipment) {
  if (type === 'current_track') {
    if (!entry.track_id) throw new Error('current_track cannot be imported because track is unknown');
    return { key:entry.track_id, label:entry.track_name, trackId:entry.track_id, metadata:{ track_id:entry.track_id, track_name:entry.track_name } };
  }
  const contexts = equipmentContexts(equipment);
  if (type === 'current_balance') {
    if (!contexts.balance) throw new Error('current_balance cannot be imported because race-day balance is unknown');
    return { ...contexts.balance, trackId:null };
  }
  if (type === 'current_wagon') {
    if (!contexts.wagon) throw new Error('current_wagon cannot be imported because race-day wagon is unknown');
    return { ...contexts.wagon, trackId:null };
  }
  const labels = { all_starts:'Alla starter', season:'Årstid', v85:'V85', v86:'V86', lead:'Spets' };
  return { key:'', label:labels[type], trackId:null, metadata:null };
}

export async function importExternalEvidence(env, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('import must be a JSON object');
  if (payload.contract_version !== EXTERNAL_EVIDENCE_IMPORT_CONTRACT) throw new Error('unsupported contract_version');
  const submissionId = requiredText(payload.submission_id, 'submission_id', 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(submissionId)) throw new Error('submission_id must use lowercase letters, numbers and hyphens');
  const roundId = requiredText(payload.round_id, 'round_id');
  const generatedAt = iso(payload.generated_at, 'generated_at');
  const sourceReference = optionalText(payload.source_reference, 'source_reference', 500);
  const stats = normalizeStats(payload.statistics);
  const interviews = normalizeInterviews(payload.interviews);
  if (!stats.length && !interviews.length) throw new Error('import must contain statistics and/or interviews');

  const existingSource = await env.DB.prepare(
    'SELECT id,fetched_at FROM source_records WHERE source_type=? AND external_id=? ORDER BY fetched_at LIMIT 1'
  ).bind(EXTERNAL_EVIDENCE_SOURCE_TYPE, submissionId).first();
  if (existingSource && existingSource.fetched_at !== generatedAt) throw new Error('submission_id was already used by another import');

  const identity = await loadRoundEvidenceIdentity(env, roundId);
  const byEntry = new Map(identity.entries.map((row) => [row.race_entry_id,row]));
  for (const id of [...stats.map((x) => x.raceEntryId), ...interviews.map((x) => x.raceEntryId)]) {
    if (!byEntry.has(id)) throw new Error('race_entry_id does not belong to selected round: ' + id);
  }
  const equipment = await loadRoundEquipment(env, identity.entries);
  const run = await startImportRun(env, EXTERNAL_EVIDENCE_SOURCE_TYPE, { roundId, stats:stats.length, interviews:interviews.length });
  const counts = { inserted:0, updated:0, skipped:0, errors:0 };
  try {
    const raw = await archiveRawPayload(env, {
      sourceType:EXTERNAL_EVIDENCE_SOURCE_TYPE, externalId:submissionId, fetchedAt:generatedAt, payload,
      qualityStatus:'manual_structured', rightsStatus:'private_evidence',
      metadata:{ roundId, contractVersion:EXTERNAL_EVIDENCE_IMPORT_CONTRACT, sourceReference }
    });
    for (const [index, stat] of stats.entries()) {
      const entry = byEntry.get(stat.raceEntryId);
      const ctx = statContext(stat.type, entry, equipment.get(stat.raceEntryId) || null);
      const result = await env.DB.prepare(
        'INSERT OR IGNORE INTO external_horse_stat_snapshots ' +
        '(id,horse_id,race_entry_id,game_round_id,context_type,context_key,context_label,track_id,context_json,starts,wins,seconds,thirds,win_percent,roi_percent,observed_at,available_at,source_record_id) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(
        stableId('external-stat',raw.sourceRecordId,index,stat.raceEntryId,stat.type,ctx.key || 'default'),
        entry.horse_id,stat.raceEntryId,roundId,stat.type,ctx.key || '',ctx.label,ctx.trackId,
        ctx.metadata ? JSON.stringify(ctx.metadata) : null,stat.starts,stat.wins,stat.seconds,stat.thirds,
        stat.winPercent,stat.roiPercent,stat.observedAt,generatedAt,raw.sourceRecordId
      ).run();
      if (Number(result.meta?.changes || 0)) counts.inserted += 1; else counts.skipped += 1;
    }
    for (const [index, interview] of interviews.entries()) {
      const entry = byEntry.get(interview.raceEntryId);
      const interviewId = stableId('external-interview',raw.sourceRecordId,index,interview.raceEntryId,interview.speakerName);
      const result = await env.DB.prepare(
        'INSERT OR IGNORE INTO external_interviews ' +
        '(id,horse_id,trainer_id,race_entry_id,game_round_id,speaker_name,speaker_role,speaker_relation,published_at,available_at,interview_text,summary_text,source_record_id) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(
        interviewId,entry.horse_id,entry.trainer_id,interview.raceEntryId,roundId,interview.speakerName,
        interview.speakerRole,interview.speakerRelation,interview.publishedAt,generatedAt,interview.interviewText,interview.summary,raw.sourceRecordId
      ).run();
      if (!Number(result.meta?.changes || 0)) { counts.skipped += 1; continue; }
      counts.inserted += 1;
      for (const signal of interview.signals) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO external_interview_signals ' +
          '(id,interview_id,signal_type,value_text,polarity,signal_class,confidence) VALUES (?,?,?,?,?,?,?)'
        ).bind(
          stableId('external-signal',interviewId,signal.index,signal.type),interviewId,signal.type,signal.value,signal.polarity,signal.klass,signal.confidence
        ).run();
      }
    }
    await finishImportRun(env, run.id, counts);
    return { contractVersion:EXTERNAL_EVIDENCE_IMPORT_CONTRACT, submissionId, roundId, reused:raw.reused && counts.inserted === 0, counts };
  } catch (error) {
    counts.errors += 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
