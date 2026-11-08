import { calculateSystem } from './phase1-model.js';

const MAX_BATCH_ITEMS = 60;
const MAX_PAGE_SIZE = 250;
const MAX_SYSTEM_NAME = 120;

function invalid(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function stringId(value, prefix) {
  const s = String(value ?? '');
  if (!s.startsWith(prefix + '-') || s.length > 160 || !/^[A-Za-z0-9_.-]+$/.test(s)) throw invalid('invalid_personal_id');
  return s;
}
function entityId(value) {
  const s = String(value ?? '').trim();
  if (!s || s.length > 160) throw invalid('invalid_entity_id');
  return s;
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) throw invalid('invalid_timestamp');
  return new Date(value).toISOString();
}
function note(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('invalid_note');
  const text = String(value.text ?? '').trim();
  if (!text || text.length > 2000) throw invalid('invalid_note_text');
  const createdAt = timestamp(value.createdAt);
  const updatedAt = timestamp(value.updatedAt || value.createdAt);
  if (updatedAt < createdAt) throw invalid('invalid_note_revision');
  return {
    id:stringId(value.id, 'note'), horseId:entityId(value.horseId),
    raceEntryId:value.raceEntryId ? entityId(value.raceEntryId) : null,
    text, createdAt, updatedAt
  };
}
function manualSystem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('invalid_system');
  if (!Array.isArray(value.legs) || value.legs.length !== 8) throw invalid('system_requires_eight_legs');
  const legs = value.legs.map((numbers) => {
    if (!Array.isArray(numbers) || numbers.length < 1 || numbers.length > 15) throw invalid('invalid_system_leg');
    const picks = numbers.map(Number);
    if (picks.some((n) => !Number.isInteger(n) || n < 1 || n > 15) || new Set(picks).size !== picks.length) {
      throw invalid('invalid_system_numbers');
    }
    return [...picks].sort((a,b)=>a-b);
  });
  const type = String(value.gameType || '').toUpperCase();
  if (type !== 'V85' && type !== 'V86') throw invalid('invalid_game_type');
  const calc = calculateSystem(legs, type);
  if (!calc.complete || !Number.isSafeInteger(calc.rows) || !Number.isFinite(calc.cost)) throw invalid('invalid_system_rows');
  const createdAt = timestamp(value.createdAt);
  const updatedAt = timestamp(value.updatedAt || value.createdAt);
  if (updatedAt < createdAt) throw invalid('invalid_system_revision');
  const name = String(value.systemName || 'Manuellt system').trim().slice(0, MAX_SYSTEM_NAME);
  if (!name) throw invalid('invalid_system_name');
  return { id:stringId(value.id, 'system'), roundId:entityId(value.roundId),
    gameType:type, name, legs, rowCount:calc.rows, stakeSek:calc.cost, createdAt, updatedAt };
}
function tombstone(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['note','system'].includes(value.kind)) throw invalid('invalid_tombstone');
  return {
    kind:value.kind,
    id:stringId(value.id, value.kind === 'note' ? 'note':'system'),
    deletedAt:timestamp(value.deletedAt)
  };
}
function array(value, name) {
  if (!Array.isArray(value) || value.length > MAX_BATCH_ITEMS) throw invalid('invalid_' + name + '_batch');
  return value;
}
function uniqueItems(values, group) {
  const ids = new Set();
  for (const value of values) {
    if (ids.has(value.id)) throw invalid('duplicate_' + group + '_id');
    ids.add(value.id);
  }
}

async function validateReferences(env, notes, systems) {
  for (const n of notes) {
    const horse = await env.DB.prepare('SELECT 1 AS found FROM horses WHERE id=? LIMIT 1').bind(n.horseId).first();
    if (!horse) throw invalid('unknown_horse_id');
    if (n.raceEntryId) {
      const entry = await env.DB.prepare('SELECT 1 AS found FROM race_entries WHERE id=? AND horse_id=? LIMIT 1')
        .bind(n.raceEntryId, n.horseId).first();
      if (!entry) throw invalid('invalid_race_entry_link');
    }
  }
  for (const s of systems) {
    const round = await env.DB.prepare(
      'SELECT gr.game_type, COUNT(gl.leg_number) AS legs ' +
      'FROM game_rounds gr LEFT JOIN game_legs gl ON gl.game_round_id=gr.id ' +
      'WHERE gr.id=? GROUP BY gr.id'
    ).bind(s.roundId).first();
    if (!round || round.game_type !== s.gameType || Number(round.legs) !== 8) throw invalid('invalid_canonical_round');
  }
}

export async function syncTravdataPersonal(env, payload) {
  if (!env?.DB) throw invalid('database_unavailable');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('invalid_sync_payload');
  const notes = array(payload.notes || [], 'notes').map(note);
  const systems = array(payload.systems || [], 'systems').map(manualSystem);
  const tombstones = array(payload.tombstones || [], 'tombstones').map(tombstone);
  uniqueItems(notes, 'note');
  uniqueItems(systems, 'system');
  uniqueItems(tombstones.map(t=>({ id:t.kind+':'+t.id })), 'tombstone');
  await validateReferences(env, notes, systems);
  const statements = [];

  for (const n of notes) {
    statements.push(env.DB.prepare(
      'INSERT INTO travdata_horse_notes (id,horse_id,race_entry_id,note_text,created_at,updated_at) ' +
      'SELECT ?,?,?,?,?,? WHERE NOT EXISTS (' +
      'SELECT 1 FROM travdata_personal_tombstones t WHERE t.kind=\'note\' AND t.id=?) ' +
      'ON CONFLICT(id) DO UPDATE SET horse_id=excluded.horse_id, race_entry_id=excluded.race_entry_id, ' +
      'note_text=excluded.note_text, updated_at=excluded.updated_at ' +
      'WHERE excluded.updated_at>travdata_horse_notes.updated_at AND travdata_horse_notes.deleted_at IS NULL'
    ).bind(n.id,n.horseId,n.raceEntryId,n.text,n.createdAt,n.updatedAt,n.id));
  }
  for (const s of systems) {
    statements.push(env.DB.prepare(
      'INSERT INTO travdata_manual_systems (id,game_round_id,game_type,system_name,selections_json,' +
      'row_count,stake_sek,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? ' +
      'WHERE NOT EXISTS (SELECT 1 FROM travdata_personal_tombstones t ' +
      'WHERE t.kind=\'system\' AND t.id=?) ' +
      'ON CONFLICT(id) DO NOTHING'
    ).bind(s.id,s.roundId,s.gameType,s.name,JSON.stringify(s.legs),s.rowCount,
      s.stakeSek,s.createdAt,s.updatedAt,s.id));
  }
  for (const t of tombstones) {
    statements.push(env.DB.prepare(
      'INSERT INTO travdata_personal_tombstones(kind,id,deleted_at) VALUES (?,?,?) ' +
      'ON CONFLICT(kind,id) DO UPDATE SET deleted_at=excluded.deleted_at ' +
      'WHERE excluded.deleted_at>travdata_personal_tombstones.deleted_at'
    ).bind(t.kind,t.id,t.deletedAt));
    const table = t.kind === 'note' ? 'travdata_horse_notes' : 'travdata_manual_systems';
    // Physically delete user content; retain only the opaque tombstone ID.
    statements.push(env.DB.prepare('DELETE FROM ' + table + ' WHERE id=?').bind(t.id));
  }
  if (statements.length) await env.DB.batch(statements);
  return { ok:true, accepted:{ notes:notes.length, systems:systems.length, tombstones:tombstones.length } };
}
function pageLimit(value, fallback) {
  const n = value == null ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) throw invalid('invalid_page_size');
  return n;
}
function pageOffset(value) {
  const n = value == null ? 0 : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw invalid('invalid_offset');
  return n;
}
export async function getTravdataPersonal(env, options = {}) {
  if (!env?.DB) throw invalid('database_unavailable');
  const limit = pageLimit(options.limit, 100);
  const offset = pageOffset(options.offset);
  const [notes, systems, tombstones] = await Promise.all([
    env.DB.prepare(
      'SELECT id,horse_id,race_entry_id,note_text,created_at,updated_at FROM travdata_horse_notes ' +
      'WHERE deleted_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?'
    ).bind(limit+1,offset).all(),
    env.DB.prepare(
      'SELECT s.id,s.game_round_id,s.game_type,s.system_name,s.selections_json,s.row_count,' +
      's.stake_sek,s.created_at,s.updated_at,s.settlement_state,s.payout_sek,s.net_sek,' +
      's.winner_numbers_json,s.correct_legs,s.review_reason,gr.round_date, ' +
      '(SELECT GROUP_CONCAT(name, \' · \') FROM (' +
      ' SELECT DISTINCT t2.canonical_name AS name FROM game_legs gl2' +
      ' JOIN races r2 ON r2.id=gl2.race_id JOIN tracks t2 ON t2.id=r2.track_id' +
      ' WHERE gl2.game_round_id=s.game_round_id ORDER BY t2.canonical_name COLLATE NOCASE' +
      ')) AS track_names ' +
      'FROM travdata_manual_systems s JOIN game_rounds gr ON gr.id=s.game_round_id ' +
      'WHERE s.deleted_at IS NULL ' +
      'ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?'
    ).bind(limit+1,offset).all(),
    env.DB.prepare(
      'SELECT kind,id,deleted_at FROM travdata_personal_tombstones ' +
      'ORDER BY deleted_at DESC,id DESC LIMIT ? OFFSET ?'
    ).bind(limit+1,offset).all()
  ]);
  const nr = notes.results || [], sr = systems.results || [], tr = tombstones.results || [];
  return {
    notes:nr.slice(0,limit).map(n=>({
      id:n.id, horseId:n.horse_id, raceEntryId:n.race_entry_id,
      text:n.note_text, createdAt:n.created_at,updatedAt:n.updated_at
    })),
    systems:sr.slice(0,limit).map(s=>({
      id:s.id,roundId:s.game_round_id,gameType:s.game_type,
      systemName:s.system_name,roundDate:s.round_date,trackNames:s.track_names || null,
      legs:JSON.parse(s.selections_json),rowCount:s.row_count,stakeSek:s.stake_sek,
      createdAt:s.created_at,updatedAt:s.updated_at,source:'server',
      settlementState:s.settlement_state,payoutSek:s.payout_sek,
      netSek:s.net_sek,winnerNumbers:s.winner_numbers_json ? JSON.parse(s.winner_numbers_json) : null,
      correctLegs:s.correct_legs,reviewReason:s.review_reason
    })),
    tombstones:tr.slice(0,limit).map(t=>({kind:t.kind,id:t.id,deletedAt:t.deleted_at})),
    hasMore:Math.max(nr.length,sr.length,tr.length)>limit,
    nextOffset:offset+limit
  };
}
export const TRAVDATA_PERSONAL_LIMITS = Object.freeze({ maxBatchItems:MAX_BATCH_ITEMS,maxPageSize:MAX_PAGE_SIZE });
