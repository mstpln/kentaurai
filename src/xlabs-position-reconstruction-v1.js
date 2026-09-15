import { stableId, randomId } from './ids.js';
import { finishImportRun, startImportRun } from './import/common.js';
import { deriveCapturedXlabsIntervalsV2 } from './xlabs-intervals-v2.js';
import { validateXlabsRacePayload } from './provider/xlabs-race.js';

export const XLABS_POSITION_RECONSTRUCTION_CONTRACT = 'kentaurai-xlabs-position-reconstruction-v1';
export const XLABS_POSITION_RECONSTRUCTION_VERSION = 'xlabs-position-reconstruction-v1';

export const XLABS_POSITION_RECONSTRUCTION_POLICY = Object.freeze({
  checkpointMeters: 100,
  smoothingRadiusFrames: 2,
  rankTieToleranceM: 0.5,
  checkpointMaxErrorM: 25,
  finishToleranceM: 5,
  minFieldCoverageForRank: 0.5,
  minLocalTargetCoverage: 0.6,
  minTangentDistanceM: 0.25,
  maxTangentWindowMs: 1500,
  movementMinProgressM: 200,
  movementMinRankChange: 2,
  movementMinGapChangeM: 5,
  wideOffsetThresholdM: 2.5,
  wideOffsetMinProgressM: 200
});

const SOURCE_TYPE = 'xlabs_race_json';
const PERSIST_BATCH_SIZE = 50;

function requiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be finite`);
  return number;
}

function positiveInteger(value, field, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`${field} must be a positive integer`);
  return number;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function normalizeFrames(payload, trackId, raceNumber, activeStartNumbers) {
  validateXlabsRacePayload(payload, trackId, raceNumber);
  const allowed = new Set(activeStartNumbers);
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  return payload.map((frame, frameIndex) => {
    const timestampMs = Date.parse(frame.timestamp);
    if (!(timestampMs > previousTimestamp)) throw new Error('X-Labs telemetry timestamps must be strictly increasing');
    previousTimestamp = timestampMs;
    const targets = new Map();
    for (const target of frame.targets) {
      if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
      const number = positiveInteger(target.number, `frame ${frameIndex} target number`, 99);
      if (!allowed.has(number)) continue;
      if (targets.has(number)) throw new Error(`frame ${frameIndex} contains duplicate target ${number}`);
      targets.set(number, {
        number,
        posX: finiteNumber(target.posX, `frame ${frameIndex} target ${number} posX`),
        posY: finiteNumber(target.posY, `frame ${frameIndex} target ${number} posY`),
        distanceToFinish: finiteNumber(target.distanceToFinish, `frame ${frameIndex} target ${number} distanceToFinish`)
      });
    }
    return { frameIndex, timestampMs, timestamp: new Date(timestampMs).toISOString(), targets };
  });
}

function smoothTargetAt(frames, frameIndex, startNumber, radius) {
  const current = frames[frameIndex]?.targets.get(startNumber);
  if (!current) return null;
  const from = Math.max(0, frameIndex - radius);
  const to = Math.min(frames.length - 1, frameIndex + radius);
  const samples = [];
  for (let index = from; index <= to; index += 1) {
    const target = frames[index].targets.get(startNumber);
    if (target) samples.push(target);
  }
  const windowCount = to - from + 1;
  const localCoverage = windowCount > 0 ? samples.length / windowCount : 0;
  return {
    number: startNumber,
    posX: mean(samples.map((sample) => sample.posX)),
    posY: mean(samples.map((sample) => sample.posY)),
    distanceToFinish: current.distanceToFinish,
    localCoverage,
    sampleCount: samples.length,
    windowCount
  };
}

function tangentAt(frames, frameIndex, startNumber, radius) {
  let before = null;
  let after = null;
  for (let offset = 1; offset <= radius + 2; offset += 1) {
    const left = frameIndex - offset;
    if (!before && left >= 0 && frames[left].targets.has(startNumber)) before = { index: left };
    const right = frameIndex + offset;
    if (!after && right < frames.length && frames[right].targets.has(startNumber)) after = { index: right };
    if (before && after) break;
  }
  if (!before || !after) return null;
  const elapsedMs = frames[after.index].timestampMs - frames[before.index].timestampMs;
  if (!(elapsedMs > 0) || elapsedMs > XLABS_POSITION_RECONSTRUCTION_POLICY.maxTangentWindowMs) return null;
  const beforeTarget = smoothTargetAt(frames, before.index, startNumber, radius);
  const afterTarget = smoothTargetAt(frames, after.index, startNumber, radius);
  if (!beforeTarget || !afterTarget) return null;
  const dx = afterTarget.posX - beforeTarget.posX;
  const dy = afterTarget.posY - beforeTarget.posY;
  const norm = Math.hypot(dx, dy);
  if (norm < XLABS_POSITION_RECONSTRUCTION_POLICY.minTangentDistanceM) return null;
  return { x: dx / norm, y: dy / norm, elapsedMs };
}

function frameState(frames, frameIndex, entriesByStart) {
  const frame = frames[frameIndex];
  const observed = [];
  for (const startNumber of entriesByStart.keys()) {
    const smoothed = smoothTargetAt(frames, frameIndex, startNumber, XLABS_POSITION_RECONSTRUCTION_POLICY.smoothingRadiusFrames);
    if (smoothed) observed.push(smoothed);
  }
  observed.sort((a, b) => a.distanceToFinish - b.distanceToFinish || a.number - b.number);
  return { frame, observed };
}

function initialLeaderDistance(frames, entriesByStart) {
  for (let index = 0; index < frames.length; index += 1) {
    const state = frameState(frames, index, entriesByStart);
    if (state.observed.length) return state.observed[0].distanceToFinish;
  }
  throw new Error('X-Labs telemetry contains no active official starters');
}

function leaderProgressAt(frames, frameIndex, entriesByStart, startLeaderDistance) {
  const state = frameState(frames, frameIndex, entriesByStart);
  if (!state.observed.length) return null;
  return Math.max(0, startLeaderDistance - state.observed[0].distanceToFinish);
}

function checkpointFrameIndices(frames, entriesByStart, startLeaderDistance) {
  const states = [];
  let maxProgress = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const state = frameState(frames, index, entriesByStart);
    if (!state.observed.length) continue;
    const progress = Math.max(0, startLeaderDistance - state.observed[0].distanceToFinish);
    maxProgress = Math.max(maxProgress, progress);
    states.push({ index, progress, leaderDistance: state.observed[0].distanceToFinish });
  }
  const wanted = [];
  for (let checkpointM = 0; checkpointM <= maxProgress; checkpointM += XLABS_POSITION_RECONSTRUCTION_POLICY.checkpointMeters) {
    wanted.push({ key: `${checkpointM}m`, checkpointM });
  }
  const finalState = states.at(-1);
  if (finalState && finalState.leaderDistance <= XLABS_POSITION_RECONSTRUCTION_POLICY.finishToleranceM) {
    wanted.push({ key: 'finish', checkpointM: null });
  }
  const used = new Set();
  const selected = [];
  for (const checkpoint of wanted) {
    let best = null;
    for (const state of states) {
      const error = checkpoint.key === 'finish' ? state.leaderDistance : Math.abs(state.progress - checkpoint.checkpointM);
      if (!best || error < best.error || (error === best.error && state.index < best.state.index)) best = { state, error };
    }
    if (!best) continue;
    const allowedError = checkpoint.key === 'finish'
      ? XLABS_POSITION_RECONSTRUCTION_POLICY.finishToleranceM
      : XLABS_POSITION_RECONSTRUCTION_POLICY.checkpointMaxErrorM;
    if (best.error > allowedError || used.has(best.state.index)) continue;
    used.add(best.state.index);
    selected.push({ ...checkpoint, frameIndex: best.state.index, leaderProgressM: best.state.progress });
  }
  return selected.sort((a, b) => a.frameIndex - b.frameIndex || a.key.localeCompare(b.key));
}

function ambiguousRank(observed, index) {
  const value = observed[index].distanceToFinish;
  const before = index > 0 ? Math.abs(value - observed[index - 1].distanceToFinish) : Number.POSITIVE_INFINITY;
  const after = index + 1 < observed.length ? Math.abs(observed[index + 1].distanceToFinish - value) : Number.POSITIVE_INFINITY;
  return Math.min(before, after) <= XLABS_POSITION_RECONSTRUCTION_POLICY.rankTieToleranceM;
}

function buildCheckpointRows({ frames, checkpoints, entriesByStart, sourceRecordId, activeFieldSize }) {
  const rows = [];
  const firstTimestampMs = frames[0].timestampMs;
  const previousByEntry = new Map();
  for (const checkpoint of checkpoints) {
    const state = frameState(frames, checkpoint.frameIndex, entriesByStart);
    const observedFieldCount = state.observed.length;
    const fieldCoverage = activeFieldSize > 0 ? observedFieldCount / activeFieldSize : 0;
    const leader = state.observed[0] ?? null;
    const leaderTangent = leader ? tangentAt(frames, checkpoint.frameIndex, leader.number, XLABS_POSITION_RECONSTRUCTION_POLICY.smoothingRadiusFrames) : null;
    const leaderEntry = leader ? entriesByStart.get(leader.number) : null;
    const leaderAmbiguous = leader ? ambiguousRank(state.observed, 0) : true;
    for (let index = 0; index < state.observed.length; index += 1) {
      const target = state.observed[index];
      const entry = entriesByStart.get(target.number);
      if (!entry) continue;
      const rankUsable = fieldCoverage >= XLABS_POSITION_RECONSTRUCTION_POLICY.minFieldCoverageForRank && !ambiguousRank(state.observed, index);
      const positionRank = rankUsable ? index + 1 : null;
      const metersBehindLeader = leader && !leaderAmbiguous
        ? Math.max(0, target.distanceToFinish - leader.distanceToFinish)
        : null;
      let lateralOffset = null;
      let lateralConfidence = null;
      if (leader && leaderTangent && target.localCoverage >= XLABS_POSITION_RECONSTRUCTION_POLICY.minLocalTargetCoverage) {
        const normalX = -leaderTangent.y;
        const normalY = leaderTangent.x;
        lateralOffset = ((target.posX - leader.posX) * normalX) + ((target.posY - leader.posY) * normalY);
        lateralConfidence = clamp01(Math.min(fieldCoverage, target.localCoverage, leader.localCoverage));
      }
      const longitudinalConfidence = clamp01(Math.min(fieldCoverage, target.localCoverage) * (positionRank == null ? 0.75 : 1));
      const previous = previousByEntry.get(entry.race_entry_id) ?? null;
      const positionsGained = previous?.positionRank != null && positionRank != null ? previous.positionRank - positionRank : null;
      const gapGain = previous?.metersBehindLeader != null && metersBehindLeader != null ? previous.metersBehindLeader - metersBehindLeader : null;
      const row = {
        id: stableId('xlabspos', sourceRecordId, entry.race_entry_id, checkpoint.key, XLABS_POSITION_RECONSTRUCTION_VERSION),
        raceEntryId: entry.race_entry_id,
        sourceRecordId,
        checkpointKey: checkpoint.key,
        checkpointM: checkpoint.checkpointM,
        frameIndex: checkpoint.frameIndex,
        observedAt: state.frame.timestamp,
        elapsedMs: state.frame.timestampMs - firstTimestampMs,
        leaderProgressM: checkpoint.leaderProgressM,
        distanceToFinishM: target.distanceToFinish,
        positionRank,
        metersBehindLeader,
        relativeLateralOffsetM: Number.isFinite(lateralOffset) ? lateralOffset : null,
        positionsGainedSincePrevious: positionsGained,
        gapGainMSincePrevious: Number.isFinite(gapGain) ? gapGain : null,
        observedFieldCount,
        activeFieldSize,
        fieldCoverage,
        localTargetCoverage: target.localCoverage,
        longitudinalConfidence,
        lateralConfidence,
        leaderRaceEntryId: leaderEntry?.race_entry_id ?? null,
        reconstructionVersion: XLABS_POSITION_RECONSTRUCTION_VERSION
      };
      rows.push(row);
      previousByEntry.set(entry.race_entry_id, row);
    }
  }
  return rows;
}

function checkpointOrder(rows) {
  const keys = [];
  const seen = new Set();
  for (const row of [...rows].sort((a, b) => a.frameIndex - b.frameIndex || a.checkpointKey.localeCompare(b.checkpointKey))) {
    if (!seen.has(row.checkpointKey)) {
      seen.add(row.checkpointKey);
      keys.push(row.checkpointKey);
    }
  }
  return keys;
}

function buildLeadChangeEpisodes(rows, raceId, sourceRecordId) {
  const keys = checkpointOrder(rows);
  const byKey = new Map(keys.map((key) => [key, rows.filter((row) => row.checkpointKey === key)]));
  const leaders = keys.map((key) => {
    const candidates = byKey.get(key).filter((row) => row.positionRank === 1 && row.longitudinalConfidence >= 0.5);
    return candidates.length === 1 ? candidates[0] : null;
  });
  const episodes = [];
  for (let index = 1; index + 1 < leaders.length; index += 1) {
    const previous = leaders[index - 1];
    const current = leaders[index];
    const next = leaders[index + 1];
    if (!previous || !current || !next) continue;
    if (previous.raceEntryId === current.raceEntryId || current.raceEntryId !== next.raceEntryId) continue;
    const start = previous;
    const end = next;
    episodes.push({
      id: stableId('xlabspos_ep', sourceRecordId, raceId, current.raceEntryId, 'lead_change_candidate', start.checkpointKey, end.checkpointKey, XLABS_POSITION_RECONSTRUCTION_VERSION),
      raceId,
      raceEntryId: current.raceEntryId,
      sourceRecordId,
      episodeType: 'lead_change_candidate',
      startCheckpointKey: start.checkpointKey,
      endCheckpointKey: end.checkpointKey,
      startFrameIndex: start.frameIndex,
      endFrameIndex: end.frameIndex,
      startObservedAt: start.observedAt,
      endObservedAt: end.observedAt,
      durationMs: Math.max(0, end.elapsedMs - start.elapsedMs),
      progressSpanM: Math.max(0, end.leaderProgressM - start.leaderProgressM),
      confidence: clamp01(Math.min(previous.longitudinalConfidence, current.longitudinalConfidence, next.longitudinalConfidence)),
      details: { previous_leader_race_entry_id: previous.raceEntryId, new_leader_race_entry_id: current.raceEntryId },
      reconstructionVersion: XLABS_POSITION_RECONSTRUCTION_VERSION
    });
  }
  return episodes;
}

function buildMovementEpisodes(rows, raceId, sourceRecordId) {
  const byEntry = new Map();
  for (const row of rows) {
    const bucket = byEntry.get(row.raceEntryId) ?? [];
    bucket.push(row);
    byEntry.set(row.raceEntryId, bucket);
  }
  const episodes = [];
  for (const [raceEntryId, entryRows] of byEntry) {
    entryRows.sort((a, b) => a.frameIndex - b.frameIndex || a.checkpointKey.localeCompare(b.checkpointKey));
    for (let startIndex = 0; startIndex < entryRows.length; startIndex += 1) {
      const start = entryRows[startIndex];
      let end = null;
      for (let endIndex = startIndex + 1; endIndex < entryRows.length; endIndex += 1) {
        const candidate = entryRows[endIndex];
        if (candidate.leaderProgressM - start.leaderProgressM >= XLABS_POSITION_RECONSTRUCTION_POLICY.movementMinProgressM) {
          end = candidate;
          break;
        }
      }
      if (!end) continue;
      if (start.positionRank == null || end.positionRank == null || start.metersBehindLeader == null || end.metersBehindLeader == null) continue;
      const rankGain = start.positionRank - end.positionRank;
      const gapGain = start.metersBehindLeader - end.metersBehindLeader;
      let episodeType = null;
      if (rankGain >= XLABS_POSITION_RECONSTRUCTION_POLICY.movementMinRankChange || gapGain >= XLABS_POSITION_RECONSTRUCTION_POLICY.movementMinGapChangeM) episodeType = 'forward_movement_candidate';
      else if (rankGain <= -XLABS_POSITION_RECONSTRUCTION_POLICY.movementMinRankChange || gapGain <= -XLABS_POSITION_RECONSTRUCTION_POLICY.movementMinGapChangeM) episodeType = 'relative_loss_candidate';
      if (!episodeType) continue;
      episodes.push({
        id: stableId('xlabspos_ep', sourceRecordId, raceId, raceEntryId, episodeType, start.checkpointKey, end.checkpointKey, XLABS_POSITION_RECONSTRUCTION_VERSION),
        raceId,
        raceEntryId,
        sourceRecordId,
        episodeType,
        startCheckpointKey: start.checkpointKey,
        endCheckpointKey: end.checkpointKey,
        startFrameIndex: start.frameIndex,
        endFrameIndex: end.frameIndex,
        startObservedAt: start.observedAt,
        endObservedAt: end.observedAt,
        durationMs: Math.max(0, end.elapsedMs - start.elapsedMs),
        progressSpanM: Math.max(0, end.leaderProgressM - start.leaderProgressM),
        confidence: clamp01(Math.min(start.longitudinalConfidence, end.longitudinalConfidence)),
        details: { rank_gain: rankGain, gap_gain_m: gapGain },
        reconstructionVersion: XLABS_POSITION_RECONSTRUCTION_VERSION
      });
      startIndex = entryRows.indexOf(end) - 1;
    }
  }
  return episodes;
}

function buildWideOffsetEpisodes(rows, raceId, sourceRecordId) {
  const byEntry = new Map();
  for (const row of rows) {
    const bucket = byEntry.get(row.raceEntryId) ?? [];
    bucket.push(row);
    byEntry.set(row.raceEntryId, bucket);
  }
  const episodes = [];
  for (const [raceEntryId, entryRows] of byEntry) {
    const ordered = entryRows.sort((a, b) => a.frameIndex - b.frameIndex || a.checkpointKey.localeCompare(b.checkpointKey));
    let run = [];
    const flush = () => {
      if (run.length < 2) { run = []; return; }
      const start = run[0];
      const end = run.at(-1);
      const progressSpanM = Math.max(0, end.leaderProgressM - start.leaderProgressM);
      if (progressSpanM >= XLABS_POSITION_RECONSTRUCTION_POLICY.wideOffsetMinProgressM) {
        const confidence = clamp01(Math.min(...run.map((row) => row.lateralConfidence ?? 0)));
        episodes.push({
          id: stableId('xlabspos_ep', sourceRecordId, raceId, raceEntryId, 'wide_offset_candidate', start.checkpointKey, end.checkpointKey, XLABS_POSITION_RECONSTRUCTION_VERSION),
          raceId,
          raceEntryId,
          sourceRecordId,
          episodeType: 'wide_offset_candidate',
          startCheckpointKey: start.checkpointKey,
          endCheckpointKey: end.checkpointKey,
          startFrameIndex: start.frameIndex,
          endFrameIndex: end.frameIndex,
          startObservedAt: start.observedAt,
          endObservedAt: end.observedAt,
          durationMs: Math.max(0, end.elapsedMs - start.elapsedMs),
          progressSpanM,
          confidence,
          details: {
            mean_absolute_lateral_offset_m: mean(run.map((row) => Math.abs(row.relativeLateralOffsetM))),
            orientation_semantics: 'unsigned_only'
          },
          reconstructionVersion: XLABS_POSITION_RECONSTRUCTION_VERSION
        });
      }
      run = [];
    };
    for (const row of ordered) {
      if (row.relativeLateralOffsetM != null && row.lateralConfidence != null && Math.abs(row.relativeLateralOffsetM) >= XLABS_POSITION_RECONSTRUCTION_POLICY.wideOffsetThresholdM) run.push(row);
      else flush();
    }
    flush();
  }
  return episodes;
}

function buildSummaries({ frames, rows, episodes, entries, sourceRecordId }) {
  return entries.map((entry) => {
    const entryRows = rows.filter((row) => row.raceEntryId === entry.race_entry_id);
    const entryEpisodes = episodes.filter((episode) => episode.raceEntryId === entry.race_entry_id);
    const observedFrameCount = frames.reduce((count, frame) => count + Number(frame.targets.has(Number(entry.start_number))), 0);
    const frameCoverage = frames.length ? observedFrameCount / frames.length : 0;
    const ranked = entryRows.filter((row) => row.positionRank != null);
    const lateral = entryRows.filter((row) => row.relativeLateralOffsetM != null && row.lateralConfidence != null);
    const longitudinalConfidence = entryRows.length ? mean(entryRows.map((row) => row.longitudinalConfidence)) : 0;
    const lateralConfidence = lateral.length ? mean(lateral.map((row) => row.lateralConfidence)) : null;
    let reconstructionStatus = 'insufficient';
    if (entryRows.length >= 3 && ranked.length >= 2 && frameCoverage >= 0.8) reconstructionStatus = 'usable';
    else if (entryRows.length >= 1) reconstructionStatus = 'partial';
    return {
      id: stableId('xlabspos_sum', sourceRecordId, entry.race_entry_id, XLABS_POSITION_RECONSTRUCTION_VERSION),
      raceEntryId: entry.race_entry_id,
      sourceRecordId,
      totalFrameCount: frames.length,
      observedFrameCount,
      frameCoverage,
      checkpointCount: entryRows.length,
      rankedCheckpointCount: ranked.length,
      lateralCheckpointCount: lateral.length,
      episodeCount: entryEpisodes.length,
      longitudinalConfidence: clamp01(longitudinalConfidence),
      lateralConfidence: lateralConfidence == null ? null : clamp01(lateralConfidence),
      reconstructionStatus,
      reconstructionVersion: XLABS_POSITION_RECONSTRUCTION_VERSION
    };
  });
}

export function buildXlabsPositionReconstruction(payload, {
  trackId,
  raceNumber,
  raceId,
  entries,
  sourceRecordId
}) {
  const sourceId = requiredText(sourceRecordId, 'sourceRecordId');
  const normalizedRaceId = requiredText(raceId, 'raceId');
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('normalized official race entries are required');
  const activeEntries = entries.filter((entry) => Number(entry.scratched || 0) !== 1);
  if (!activeEntries.length) throw new Error('normalized official race has no active entries');
  const entriesByStart = new Map();
  for (const entry of activeEntries) {
    const number = positiveInteger(entry.start_number, 'official race entry start_number', 99);
    if (entriesByStart.has(number)) throw new Error(`official race contains duplicate start number ${number}`);
    entriesByStart.set(number, entry);
  }
  const frames = normalizeFrames(payload, trackId, raceNumber, [...entriesByStart.keys()]);
  const startLeaderDistance = initialLeaderDistance(frames, entriesByStart);
  const checkpoints = checkpointFrameIndices(frames, entriesByStart, startLeaderDistance);
  const checkpointRows = buildCheckpointRows({
    frames,
    checkpoints,
    entriesByStart,
    sourceRecordId: sourceId,
    activeFieldSize: activeEntries.length
  });
  const episodes = [
    ...buildLeadChangeEpisodes(checkpointRows, normalizedRaceId, sourceId),
    ...buildMovementEpisodes(checkpointRows, normalizedRaceId, sourceId),
    ...buildWideOffsetEpisodes(checkpointRows, normalizedRaceId, sourceId)
  ].sort((a, b) => a.startFrameIndex - b.startFrameIndex || a.episodeType.localeCompare(b.episodeType) || String(a.raceEntryId ?? '').localeCompare(String(b.raceEntryId ?? '')));
  const summaries = buildSummaries({ frames, rows: checkpointRows, episodes, entries: activeEntries, sourceRecordId: sourceId });
  const fieldCoverage = checkpoints.map((checkpoint) => {
    const observed = checkpointRows.filter((row) => row.checkpointKey === checkpoint.key).length;
    return {
      checkpoint_key: checkpoint.key,
      checkpoint_m: checkpoint.checkpointM,
      frame_index: checkpoint.frameIndex,
      observed_entries: observed,
      active_field_size: activeEntries.length,
      observed_share: activeEntries.length ? observed / activeEntries.length : 0
    };
  });
  return {
    contractVersion: XLABS_POSITION_RECONSTRUCTION_CONTRACT,
    reconstructionVersion: XLABS_POSITION_RECONSTRUCTION_VERSION,
    raceId: normalizedRaceId,
    sourceRecordId: sourceId,
    frameCount: frames.length,
    activeFieldSize: activeEntries.length,
    checkpoints: checkpointRows,
    episodes,
    summaries,
    fieldCoverage,
    semantics: {
      longitudinal_axis: 'distance_to_finish_lower_is_ahead',
      lateral_offset_sign: 'orientation_unvalidated_no_inner_outer_semantics',
      named_trip_labels_enabled: false,
      legacy_race_positions_written: false
    }
  };
}

export async function deriveCapturedXlabsPositionReconstruction(env, sourceRecordId) {
  if (!env?.DB) throw new Error('DB is not configured');
  if (!env?.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = requiredText(sourceRecordId, 'source_record_id');
  const captured = await deriveCapturedXlabsIntervalsV2(env, id);
  return {
    ...captured,
    positionReconstruction: buildXlabsPositionReconstruction(captured.payload, {
      trackId: captured.metadata.trackId,
      raceNumber: captured.metadata.raceNumber,
      raceId: captured.race.id,
      entries: captured.entries,
      sourceRecordId: id
    })
  };
}

function checkpointInsert(env, row) {
  return env.DB.prepare(`
    INSERT INTO race_position_checkpoints
      (id,race_entry_id,source_record_id,checkpoint_key,checkpoint_m,frame_index,observed_at,elapsed_ms,
       leader_progress_m,distance_to_finish_m,position_rank,meters_behind_leader,relative_lateral_offset_m,
       positions_gained_since_previous,gap_gain_m_since_previous,observed_field_count,active_field_size,
       field_coverage,local_target_coverage,longitudinal_confidence,lateral_confidence,reconstruction_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(race_entry_id,source_record_id,checkpoint_key,reconstruction_version) DO NOTHING
  `).bind(
    row.id,row.raceEntryId,row.sourceRecordId,row.checkpointKey,row.checkpointM,row.frameIndex,row.observedAt,row.elapsedMs,
    row.leaderProgressM,row.distanceToFinishM,row.positionRank,row.metersBehindLeader,row.relativeLateralOffsetM,
    row.positionsGainedSincePrevious,row.gapGainMSincePrevious,row.observedFieldCount,row.activeFieldSize,
    row.fieldCoverage,row.localTargetCoverage,row.longitudinalConfidence,row.lateralConfidence,row.reconstructionVersion
  );
}

function episodeInsert(env, row) {
  return env.DB.prepare(`
    INSERT INTO race_trajectory_episodes
      (id,race_id,race_entry_id,source_record_id,episode_type,start_checkpoint_key,end_checkpoint_key,
       start_frame_index,end_frame_index,start_observed_at,end_observed_at,duration_ms,progress_span_m,
       confidence,details_json,reconstruction_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(race_id,race_entry_id,source_record_id,episode_type,start_checkpoint_key,end_checkpoint_key,reconstruction_version) DO NOTHING
  `).bind(
    row.id,row.raceId,row.raceEntryId,row.sourceRecordId,row.episodeType,row.startCheckpointKey,row.endCheckpointKey,
    row.startFrameIndex,row.endFrameIndex,row.startObservedAt,row.endObservedAt,row.durationMs,row.progressSpanM,
    row.confidence,JSON.stringify(row.details),row.reconstructionVersion
  );
}

function summaryInsert(env, row) {
  return env.DB.prepare(`
    INSERT INTO race_trajectory_summaries
      (id,race_entry_id,source_record_id,total_frame_count,observed_frame_count,frame_coverage,checkpoint_count,
       ranked_checkpoint_count,lateral_checkpoint_count,episode_count,longitudinal_confidence,lateral_confidence,
       reconstruction_status,reconstruction_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(race_entry_id,source_record_id,reconstruction_version) DO NOTHING
  `).bind(
    row.id,row.raceEntryId,row.sourceRecordId,row.totalFrameCount,row.observedFrameCount,row.frameCoverage,row.checkpointCount,
    row.rankedCheckpointCount,row.lateralCheckpointCount,row.episodeCount,row.longitudinalConfidence,row.lateralConfidence,
    row.reconstructionStatus,row.reconstructionVersion
  );
}

async function persistBatches(env, statements, counts) {
  for (let offset = 0; offset < statements.length; offset += PERSIST_BATCH_SIZE) {
    const results = await env.DB.batch(statements.slice(offset, offset + PERSIST_BATCH_SIZE));
    for (const result of results) {
      if ((result?.meta?.changes || 0) > 0) counts.inserted += 1;
      else counts.skipped += 1;
    }
  }
}

export async function normalizeCapturedXlabsPositionReconstruction(env, sourceRecordId) {
  const id = requiredText(sourceRecordId, 'source_record_id');
  const run = await startImportRun(env, 'xlabs_position_reconstruction_v1_normalize', {
    sourceRecordId: id,
    version: XLABS_POSITION_RECONSTRUCTION_VERSION
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  try {
    const derived = await deriveCapturedXlabsPositionReconstruction(env, id);
    const reconstruction = derived.positionReconstruction;
    await persistBatches(env, reconstruction.checkpoints.map((row) => checkpointInsert(env, row)), counts);
    await persistBatches(env, reconstruction.episodes.map((row) => episodeInsert(env, row)), counts);
    await persistBatches(env, reconstruction.summaries.map((row) => summaryInsert(env, row)), counts);
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      sourceRecordId: id,
      raceId: reconstruction.raceId,
      reconstructionVersion: XLABS_POSITION_RECONSTRUCTION_VERSION,
      checkpointRows: reconstruction.checkpoints.length,
      episodeRows: reconstruction.episodes.length,
      summaryRows: reconstruction.summaries.length,
      counts,
      sourceQualityStatus: derived.source.quality_status,
      namedTripLabelsEnabled: false
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}

export async function createXlabsPositionReconstructionJob(env, { startDate, endDate } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const start = requiredText(startDate, 'startDate');
  const end = requiredText(endDate, 'endDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('startDate and endDate must use YYYY-MM-DD');
  if (start > end) throw new Error('startDate cannot be after endDate');
  const id = randomId('xposjob');
  await env.DB.prepare(`
    INSERT INTO xlabs_position_reconstruction_jobs
      (id,start_date,end_date,status,reconstruction_version)
    VALUES (?,?,?,'running',?)
  `).bind(id,start,end,XLABS_POSITION_RECONSTRUCTION_VERSION).run();
  return { id, startDate: start, endDate: end, status: 'running', reconstructionVersion: XLABS_POSITION_RECONSTRUCTION_VERSION };
}

async function loadPositionJob(env, jobId) {
  const job = await env.DB.prepare(`
    SELECT * FROM xlabs_position_reconstruction_jobs WHERE id=? LIMIT 1
  `).bind(requiredText(jobId, 'jobId')).first();
  if (!job) throw new Error('X-Labs position reconstruction job was not found');
  return job;
}

async function nextJobSource(env, job) {
  return env.DB.prepare(`
    SELECT id, external_id, fetched_at
    FROM source_records
    WHERE source_type=?
      AND SUBSTR(external_id,1,10) BETWEEN ? AND ?
      AND raw_object_key IS NOT NULL
      AND (
        ? IS NULL OR external_id > ? OR
        (external_id = ? AND julianday(fetched_at) > julianday(?)) OR
        (external_id = ? AND fetched_at = ? AND id > ?)
      )
    ORDER BY external_id, julianday(fetched_at), id
    LIMIT 1
  `).bind(
    SOURCE_TYPE,job.start_date,job.end_date,
    job.cursor_external_id,job.cursor_external_id,
    job.cursor_external_id,job.cursor_fetched_at,
    job.cursor_external_id,job.cursor_fetched_at,job.cursor_source_record_id
  ).first();
}

export async function stepXlabsPositionReconstructionJob(env, jobId) {
  const job = await loadPositionJob(env, jobId);
  if (job.reconstruction_version !== XLABS_POSITION_RECONSTRUCTION_VERSION) throw new Error('job reconstruction version does not match current C3 version');
  if (job.status !== 'running') return { jobId: job.id, status: job.status, done: job.status === 'completed' };
  const source = await nextJobSource(env, job);
  if (!source) {
    await env.DB.prepare(`UPDATE xlabs_position_reconstruction_jobs SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(job.id).run();
    return { jobId: job.id, status: 'completed', done: true };
  }
  try {
    const result = await normalizeCapturedXlabsPositionReconstruction(env, source.id);
    await env.DB.prepare(`
      UPDATE xlabs_position_reconstruction_jobs
      SET cursor_external_id=?,cursor_fetched_at=?,cursor_source_record_id=?,processed_sources=processed_sources+1,
          inserted_rows=inserted_rows+?,skipped_rows=skipped_rows+?,consecutive_errors=0,last_error=NULL,
          last_attempt_source_record_id=?,last_run_at=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(
      source.external_id,source.fetched_at,source.id,result.counts.inserted,result.counts.skipped,source.id,new Date().toISOString(),job.id
    ).run();
    return { jobId: job.id, status: 'running', done: false, sourceRecordId: source.id, result };
  } catch (error) {
    const nextErrors = Number(job.consecutive_errors || 0) + 1;
    const status = nextErrors >= 3 ? 'failed' : 'running';
    await env.DB.prepare(`
      UPDATE xlabs_position_reconstruction_jobs
      SET consecutive_errors=?,status=?,last_error=?,last_attempt_source_record_id=?,last_run_at=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(nextErrors,status,error.message,source.id,new Date().toISOString(),job.id).run();
    throw error;
  }
}