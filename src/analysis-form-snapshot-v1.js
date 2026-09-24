import { stableId } from './ids.js';
import { getCalendarYearDetailForm } from './entity-detail-calendar-statistics.js';
import { HORSE_FORM_INDEX_VERSION } from './statistics/horse-form-index.js';

export const ANALYSIS_FORM_SNAPSHOT_VERSION = 'analysis-form-snapshot-v1';

function parsePayload(file) {
  if (file?.payload && typeof file.payload === 'object') return file.payload;
  try { return JSON.parse(file?.content || '{}'); } catch { return {}; }
}

function finiteScore(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 100 ? Math.round(number) : null;
}

function formRank(rows, score) {
  if (score == null) return null;
  return 1 + rows.filter((row) => row.score != null && row.score > score).length;
}

async function snapshotLeg(env, roundId, packId, asOf, payload) {
  const legNumber = Number(payload?.leg_number);
  if (!Number.isInteger(legNumber) || legNumber < 1 || legNumber > 8) return [];
  const entries = (payload.entries || []).filter((entry) =>
    entry?.current_facts?.analysis_eligible === true && entry?.race_entry_id && entry?.horse_id
  );
  const scored = await Promise.all(entries.map(async (entry) => {
    const form = await getCalendarYearDetailForm(env, 'horses', String(entry.horse_id), {
      asOfDate:asOf.slice(0, 10),
      asOfInstant:asOf,
      year:Number(asOf.slice(0, 4)),
      raceScope:'all',
      startMethod:'all',
      distanceGroup:'all'
    });
    return {
      raceEntryId:String(entry.race_entry_id),
      score:finiteScore(form?.formLast?.score),
      usedStarts:Number(form?.formLast?.usedStarts || 0)
    };
  }));
  return scored.map((row) => ({
    ...row,
    roundId,
    packId,
    legNumber,
    asOf,
    version:HORSE_FORM_INDEX_VERSION,
    rank:formRank(scored, row.score)
  }));
}


async function persistSnapshotRows(env, rows) {
  const inserted = await persistSnapshotRows(env, rows);
  return inserted;
}

async function scoreExplicitLeg(env, roundId, snapshotRef, legNumber, asOf, entries) {
  const scored = await Promise.all(entries.map(async (entry) => {
    const form = await getCalendarYearDetailForm(env, 'horses', String(entry.horseId), {
      asOfDate:asOf.slice(0, 10),
      asOfInstant:asOf,
      year:Number(asOf.slice(0, 4)),
      raceScope:'all',
      startMethod:'all',
      distanceGroup:'all'
    });
    return {
      raceEntryId:String(entry.raceEntryId),
      score:finiteScore(form?.formLast?.score),
      usedStarts:Number(form?.formLast?.usedStarts || 0)
    };
  }));
  return scored.map((row) => ({
    ...row,
    roundId,
    packId:snapshotRef,
    legNumber,
    asOf,
    version:HORSE_FORM_INDEX_VERSION,
    rank:formRank(scored,row.score)
  }));
}

export async function persistHistoricalFormSnapshots(env, { roundId, snapshotRef, asOfByLeg } = {}) {
  if (!env?.DB || typeof env.DB.batch !== 'function') throw new Error('D1 batch support is required');
  const id=String(roundId || '').trim();
  const ref=String(snapshotRef || '').trim();
  if (!id || !ref) throw new Error('roundId and snapshotRef are required');
  if (!(asOfByLeg instanceof Map)) throw new Error('asOfByLeg must be a Map');

  const {results}=await env.DB.prepare(`
    SELECT gl.leg_number,re.id AS race_entry_id,re.horse_id
    FROM game_legs gl
    JOIN race_entries re ON re.race_id=gl.race_id
    WHERE gl.game_round_id=? AND re.scratched=0 AND re.horse_id IS NOT NULL
    ORDER BY gl.leg_number,re.start_number,re.id
  `).bind(id).all();

  const rows=[];
  for(let legNumber=1;legNumber<=8;legNumber+=1){
    const asOf=String(asOfByLeg.get(legNumber) || '').trim();
    if(!asOf || !Number.isFinite(Date.parse(asOf))) throw new Error(`verified Form as-of is missing for leg ${legNumber}`);
    const entries=(results || [])
      .filter((row)=>Number(row.leg_number)===legNumber)
      .map((row)=>({raceEntryId:row.race_entry_id,horseId:row.horse_id}));
    if(!entries.length) throw new Error(`round leg ${legNumber} has no active horse entries`);
    rows.push(...await scoreExplicitLeg(env,id,ref,legNumber,new Date(Date.parse(asOf)).toISOString(),entries));
  }
  const inserted=await persistSnapshotRows(env,rows);
  return {
    version:ANALYSIS_FORM_SNAPSHOT_VERSION,
    roundId:id,
    packId:ref,
    entryCount:rows.length,
    inserted
  };
}

export async function persistAnalysisFormSnapshots(env, pack) {
  if (!env?.DB || typeof env.DB.batch !== 'function') throw new Error('D1 batch support is required');
  const roundId = String(pack?.manifest?.round_id || '').trim();
  const packId = String(pack?.manifest?.pack_id || '').trim();
  const asOf = String(pack?.manifest?.as_of || '').trim();
  if (!roundId || !packId || !Number.isFinite(Date.parse(asOf))) throw new Error('analysis pack identity is incomplete');

  const byLeg = new Map();
  for (const file of pack.files || []) {
    const payload = parsePayload(file);
    const legNumber = Number(payload?.leg_number);
    if (!Number.isInteger(legNumber) || legNumber < 1 || legNumber > 8) continue;
    if (!byLeg.has(legNumber)) byLeg.set(legNumber, payload);
    else {
      const current = byLeg.get(legNumber);
      current.entries = [...(current.entries || []), ...(payload.entries || [])];
    }
  }

  const rows = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    const payload = byLeg.get(leg);
    if (payload) rows.push(...await snapshotLeg(env, roundId, packId, asOf, payload));
  }

  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += 50) {
    const group = rows.slice(offset, offset + 50);
    const results = await env.DB.batch(group.map((row) => env.DB.prepare(`
      INSERT OR IGNORE INTO analysis_entry_form_snapshots
        (id,game_round_id,step1_pack_id,leg_number,race_entry_id,as_of,form_version,form_score,used_starts,form_rank)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).bind(
      stableId('analysis-form', row.packId, row.raceEntryId),
      row.roundId, row.packId, row.legNumber, row.raceEntryId, row.asOf, row.version,
      row.score, row.usedStarts, row.rank
    )));
    inserted += results.reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
  }

  return {
    version:ANALYSIS_FORM_SNAPSHOT_VERSION,
    roundId,
    packId,
    asOf,
    entryCount:rows.length,
    inserted
  };
}
