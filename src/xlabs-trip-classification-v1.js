import { stableId } from './ids.js';

export const XLABS_TRIP_CLASSIFICATION_VERSION = 'xlabs-trip-classification-v1';
export const XLABS_TRIP_CLASSIFICATION_CONTRACT = 'kentaurai-xlabs-trip-classification-v1';

export const XLABS_TRIP_CLASSIFICATION_POLICY = Object.freeze({
  decisionDistanceRemainingM: 500,
  decisionWindowMinM: 400,
  decisionWindowMaxM: 600,
  minFieldCoverage: 0.6,
  minLongitudinalConfidence: 0.65,
  minLateralConfidence: 0.55,
  innerBandAbsM: 1.25,
  outerBandMinAbsM: 1.5,
  outerBandMaxAbsM: 5.25,
  deathSeatMaxGapM: 5.5,
  pocketMaxGapM: 8,
  outerChainMaxGapM: 8,
  minStableVotes: 2,
  singleCheckpointMinConfidence: 0.9
});

const LABELS = Object.freeze({
  leader: 'Spets',
  pocket: 'Rygg ledaren',
  death_seat: 'Dödens',
  second_over: '2:a utvändigt',
  third_over: '3:e utvändigt',
  back: 'Bakifrån'
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function sign(value) {
  const number = finite(value);
  if (number == null || Math.abs(number) < 0.05) return 0;
  return number < 0 ? -1 : 1;
}

function baseConfidence(row, needsLateral = false) {
  const values = [
    finite(row?.fieldCoverage),
    finite(row?.longitudinalConfidence)
  ].filter((value) => value != null);
  if (needsLateral) values.push(finite(row?.lateralConfidence));
  const usable = values.filter((value) => value != null);
  return usable.length ? clamp01(Math.min(...usable)) : 0;
}

function usableLongitudinal(row) {
  return row?.positionRank != null &&
    row?.metersBehindLeader != null &&
    Number(row.fieldCoverage || 0) >= XLABS_TRIP_CLASSIFICATION_POLICY.minFieldCoverage &&
    Number(row.longitudinalConfidence || 0) >= XLABS_TRIP_CLASSIFICATION_POLICY.minLongitudinalConfidence;
}

function usableLateral(row) {
  return usableLongitudinal(row) &&
    row.relativeLateralOffsetM != null &&
    Number(row.lateralConfidence || 0) >= XLABS_TRIP_CLASSIFICATION_POLICY.minLateralConfidence;
}

function checkpointGroups(checkpoints) {
  const groups = new Map();
  for (const row of checkpoints || []) {
    if (!groups.has(row.checkpointKey)) groups.set(row.checkpointKey, []);
    groups.get(row.checkpointKey).push(row);
  }
  return [...groups.values()];
}

function leaderFor(rows) {
  const leaders = rows.filter((row) =>
    usableLongitudinal(row) &&
    Number(row.positionRank) === 1 &&
    Math.abs(Number(row.metersBehindLeader || 0)) <= 0.75
  );
  if (leaders.length !== 1) return null;
  return leaders[0];
}

function classifyCheckpoint(rows) {
  const leader = leaderFor(rows);
  if (!leader) return null;
  const leaderDistance = finite(leader.distanceToFinishM);
  if (leaderDistance == null ||
      leaderDistance < XLABS_TRIP_CLASSIFICATION_POLICY.decisionWindowMinM ||
      leaderDistance > XLABS_TRIP_CLASSIFICATION_POLICY.decisionWindowMaxM) return null;

  const classifications = new Map();
  classifications.set(leader.raceEntryId, {
    scenarioKey: 'leader',
    scenarioLabel: LABELS.leader,
    confidence: baseConfidence(leader, false),
    row: leader
  });

  const inner = rows
    .filter((row) => row.raceEntryId !== leader.raceEntryId && usableLateral(row))
    .filter((row) => Math.abs(Number(row.relativeLateralOffsetM)) <= XLABS_TRIP_CLASSIFICATION_POLICY.innerBandAbsM)
    .filter((row) => Number(row.metersBehindLeader) > 0.75)
    .sort((a, b) => Number(a.metersBehindLeader) - Number(b.metersBehindLeader));

  const pocket = inner[0];
  if (pocket && Number(pocket.metersBehindLeader) <= XLABS_TRIP_CLASSIFICATION_POLICY.pocketMaxGapM) {
    classifications.set(pocket.raceEntryId, {
      scenarioKey: 'pocket',
      scenarioLabel: LABELS.pocket,
      confidence: baseConfidence(pocket, true),
      row: pocket
    });
  }

  const outerCandidates = rows
    .filter((row) => row.raceEntryId !== leader.raceEntryId && usableLateral(row))
    .filter((row) => {
      const lateral = Math.abs(Number(row.relativeLateralOffsetM));
      return lateral >= XLABS_TRIP_CLASSIFICATION_POLICY.outerBandMinAbsM &&
        lateral <= XLABS_TRIP_CLASSIFICATION_POLICY.outerBandMaxAbsM &&
        Number(row.metersBehindLeader) >= 0;
    })
    .sort((a, b) => {
      const gap = Number(a.metersBehindLeader) - Number(b.metersBehindLeader);
      if (gap) return gap;
      return Math.abs(Number(a.relativeLateralOffsetM)) - Math.abs(Number(b.relativeLateralOffsetM));
    });

  const death = outerCandidates.find((row) =>
    Number(row.metersBehindLeader) <= XLABS_TRIP_CLASSIFICATION_POLICY.deathSeatMaxGapM
  );

  if (death) {
    const outerSign = sign(death.relativeLateralOffsetM);
    classifications.set(death.raceEntryId, {
      scenarioKey: 'death_seat',
      scenarioLabel: LABELS.death_seat,
      confidence: baseConfidence(death, true),
      row: death
    });

    const chain = outerCandidates
      .filter((row) => row.raceEntryId !== death.raceEntryId)
      .filter((row) => sign(row.relativeLateralOffsetM) === outerSign)
      .filter((row) => Math.abs(Math.abs(Number(row.relativeLateralOffsetM)) - Math.abs(Number(death.relativeLateralOffsetM))) <= 1.5)
      .filter((row) => Number(row.metersBehindLeader) > Number(death.metersBehindLeader))
      .sort((a, b) => Number(a.metersBehindLeader) - Number(b.metersBehindLeader));

    let previous = death;
    const second = chain[0];
    if (second && Number(second.metersBehindLeader) - Number(previous.metersBehindLeader) <= XLABS_TRIP_CLASSIFICATION_POLICY.outerChainMaxGapM) {
      classifications.set(second.raceEntryId, {
        scenarioKey: 'second_over',
        scenarioLabel: LABELS.second_over,
        confidence: baseConfidence(second, true),
        row: second
      });
      previous = second;
      const third = chain[1];
      if (third && Number(third.metersBehindLeader) - Number(previous.metersBehindLeader) <= XLABS_TRIP_CLASSIFICATION_POLICY.outerChainMaxGapM) {
        classifications.set(third.raceEntryId, {
          scenarioKey: 'third_over',
          scenarioLabel: LABELS.third_over,
          confidence: baseConfidence(third, true),
          row: third
        });
      }
    }
  }

  for (const row of rows) {
    if (classifications.has(row.raceEntryId) || !usableLongitudinal(row)) continue;
    if (Number(row.positionRank) >= 4 || Number(row.metersBehindLeader) > XLABS_TRIP_CLASSIFICATION_POLICY.pocketMaxGapM) {
      classifications.set(row.raceEntryId, {
        scenarioKey: 'back',
        scenarioLabel: LABELS.back,
        confidence: baseConfidence(row, false),
        row
      });
    }
  }

  return {
    checkpointKey: leader.checkpointKey,
    leaderDistanceRemainingM: leaderDistance,
    classifications
  };
}

function selectedScenario(votes) {
  if (!votes.length) return null;
  const ordered = [...votes].sort((a, b) =>
    Math.abs(a.distanceRemainingM - XLABS_TRIP_CLASSIFICATION_POLICY.decisionDistanceRemainingM) -
      Math.abs(b.distanceRemainingM - XLABS_TRIP_CLASSIFICATION_POLICY.decisionDistanceRemainingM) ||
    b.confidence - a.confidence
  );
  const byKey = new Map();
  for (const vote of votes) {
    const current = byKey.get(vote.scenarioKey) || [];
    current.push(vote);
    byKey.set(vote.scenarioKey, current);
  }
  const ranked = [...byKey.entries()].sort((a, b) =>
    b[1].length - a[1].length ||
    Math.max(...b[1].map((item) => item.confidence)) - Math.max(...a[1].map((item) => item.confidence))
  );
  const [scenarioKey, matching] = ranked[0];
  const nearest = ordered[0];
  if (votes.length > 1) {
    if (matching.length < XLABS_TRIP_CLASSIFICATION_POLICY.minStableVotes) return null;
    if (nearest.scenarioKey !== scenarioKey && matching.length === votes.length / 2) return null;
  } else if (nearest.confidence < XLABS_TRIP_CLASSIFICATION_POLICY.singleCheckpointMinConfidence) {
    return null;
  }
  const representative = matching.sort((a, b) =>
    Math.abs(a.distanceRemainingM - XLABS_TRIP_CLASSIFICATION_POLICY.decisionDistanceRemainingM) -
      Math.abs(b.distanceRemainingM - XLABS_TRIP_CLASSIFICATION_POLICY.decisionDistanceRemainingM)
  )[0];
  return {
    scenarioKey,
    scenarioLabel: LABELS[scenarioKey],
    representative,
    confidence: clamp01(matching.reduce((sum, item) => sum + item.confidence, 0) / matching.length),
    stableVotes: matching.length,
    observedVotes: votes.length
  };
}

function flags(key) {
  return {
    leader: key === 'leader' ? 1 : 0,
    pocket: key === 'pocket' ? 1 : 0,
    deathSeat: key === 'death_seat' ? 1 : 0,
    secondOver: key === 'second_over' ? 1 : 0,
    thirdOver: key === 'third_over' ? 1 : 0
  };
}

export function classifyXlabsTripScenarios(reconstruction) {
  if (!reconstruction || !Array.isArray(reconstruction.checkpoints)) throw new Error('position reconstruction checkpoints are required');
  const usableCheckpoints = checkpointGroups(reconstruction.checkpoints)
    .map(classifyCheckpoint)
    .filter(Boolean)
    .sort((a, b) => a.leaderDistanceRemainingM - b.leaderDistanceRemainingM);

  const votesByEntry = new Map();
  for (const checkpoint of usableCheckpoints) {
    for (const [raceEntryId, value] of checkpoint.classifications.entries()) {
      if (!votesByEntry.has(raceEntryId)) votesByEntry.set(raceEntryId, []);
      votesByEntry.get(raceEntryId).push({
        ...value,
        checkpointKey: checkpoint.checkpointKey,
        distanceRemainingM: checkpoint.leaderDistanceRemainingM
      });
    }
  }

  const rows = [];
  for (const [raceEntryId, votes] of votesByEntry.entries()) {
    const selected = selectedScenario(votes);
    if (!selected) continue;
    const representative = selected.representative;
    const f = flags(selected.scenarioKey);
    rows.push({
      id: stableId(
        'racepos',
        reconstruction.sourceRecordId,
        raceEntryId,
        XLABS_TRIP_CLASSIFICATION_VERSION,
        XLABS_TRIP_CLASSIFICATION_POLICY.decisionDistanceRemainingM
      ),
      raceEntryId,
      sourceRecordId: reconstruction.sourceRecordId,
      observedAtM: XLABS_TRIP_CLASSIFICATION_POLICY.decisionDistanceRemainingM,
      position: representative.row.positionRank == null ? null : Number(representative.row.positionRank),
      lane: null,
      ...f,
      wideTrip: null,
      uncoveredMove: null,
      trafficEvent: null,
      confidence: selected.confidence,
      evidenceType: 'calculated_xlabs',
      classificationVersion: XLABS_TRIP_CLASSIFICATION_VERSION,
      event: {
        contract_version: XLABS_TRIP_CLASSIFICATION_CONTRACT,
        scenario_key: selected.scenarioKey,
        scenario_label: selected.scenarioLabel,
        decision_distance_remaining_m: XLABS_TRIP_CLASSIFICATION_POLICY.decisionDistanceRemainingM,
        representative_distance_remaining_m: representative.distanceRemainingM,
        representative_checkpoint_key: representative.checkpointKey,
        stable_votes: selected.stableVotes,
        observed_votes: selected.observedVotes,
        confidence: selected.confidence,
        reconstruction_version: reconstruction.reconstructionVersion
      }
    });
  }
  return rows.sort((a, b) => String(a.raceEntryId).localeCompare(String(b.raceEntryId)));
}

function insertStatement(env, row) {
  return env.DB.prepare(`
    INSERT INTO race_positions
      (id,race_entry_id,observed_at_m,position,lane,leader,pocket,death_seat,second_over,third_over,
       wide_trip,uncovered_move,traffic_event,event_json,source_record_id,evidence_type,confidence,classification_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO NOTHING
  `).bind(
    row.id,row.raceEntryId,row.observedAtM,row.position,row.lane,row.leader,row.pocket,row.deathSeat,row.secondOver,row.thirdOver,
    row.wideTrip,row.uncoveredMove,row.trafficEvent,JSON.stringify(row.event),row.sourceRecordId,row.evidenceType,row.confidence,row.classificationVersion
  );
}

export async function persistXlabsTripScenarios(env, reconstruction) {
  if (!env?.DB) throw new Error('DB is not configured');
  const rows = classifyXlabsTripScenarios(reconstruction);
  let inserted = 0;
  let skipped = 0;
  for (let offset = 0; offset < rows.length; offset += 50) {
    const results = await env.DB.batch(rows.slice(offset, offset + 50).map((row) => insertStatement(env, row)));
    for (const result of results) {
      if ((result?.meta?.changes || 0) > 0) inserted += 1;
      else skipped += 1;
    }
  }
  return { rows, inserted, skipped };
}
