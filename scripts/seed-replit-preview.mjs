import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const RESET_ONLY = process.argv.includes('--reset-only');
const SQL_PATH = resolve('.wrangler/preview-synthetic.sql');
const sql = [];

const quote = (value) => {
  if (value == null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Synthetic fixture contains a non-finite number');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll("'", "''")}'`;
};

function insert(table, values) {
  const columns = Object.keys(values);
  sql.push(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((key) => quote(values[key])).join(',')});`
  );
}

const previewTables = [
  ['post_race_reviews', 'id'],
  ['system_selections', 'system_id'],
  ['analysis_external_exports', 'game_round_id'],
  ['systems', 'id'],
  ['analysis_entry_form_snapshots', 'id'],
  ['game_round_final_results', 'game_round_id'],
  ['betting_snapshots', 'id'],
  ['game_legs', 'game_round_id'],
  ['ai_horse_predictions', 'id'],
  ['ai_race_analyses', 'id'],
  ['analysis_features', 'id'],
  ['race_positions', 'id'],
  ['xlabs_intervals', 'id'],
  ['xlabs_data', 'id'],
  ['equipment', 'id'],
  ['race_results', 'race_entry_id'],
  ['race_conditions', 'race_id'],
  ['editorial_signals', 'id'],
  ['editorial_items', 'id'],
  ['external_horse_stat_snapshots', 'id'],
  ['horse_start_points', 'id'],
  ['track_profile_fact_observations', 'id'],
  ['track_first_turn_distances', 'id'],
  ['race_entries', 'id'],
  ['races', 'id'],
  ['game_rounds', 'id'],
  ['model_versions', 'id'],
  ['horses', 'id'],
  ['trainers', 'id'],
  ['drivers', 'id'],
  ['tracks', 'id'],
  ['normalized_observations', 'id'],
  ['source_records', 'id'],
  ['import_runs', 'id']
];

function writeReset() {
  for (const [table, key] of previewTables) {
    sql.push(`DELETE FROM ${table} WHERE ${key} LIKE 'demo\\_%' ESCAPE '\\';`);
  }
}

writeReset();
if (!RESET_ONLY) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm' }).format(new Date());
  const dateAtOffset = (offset) => {
    const value = new Date(`${today}T12:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  const stamp = (day, hour = 16) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const paceString = (seconds) =>
    `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

  const tracks = [
    { id:'demo_track_north', name:'Demo Norrskensbanan', city:'Demo Nord', lap:1000, stretch:205, curve:92, bank:11, width:21, lanes:1, surface:'synthetic clay' },
    { id:'demo_track_south', name:'Demo Söderloopen', city:'Demo Söder', lap:1000, stretch:190, curve:88, bank:10, width:20, lanes:2, surface:'synthetic sand' },
    { id:'demo_track_forest', name:'Demo Skogsvallen', city:'Demo Skog', lap:1050, stretch:220, curve:98, bank:12, width:22, lanes:1, surface:'synthetic clay' },
    { id:'demo_track_winter', name:'Demo Vinterovalen', city:'Demo Frost', lap:1000, stretch:200, curve:90, bank:11, width:21, lanes:2, surface:'synthetic sand' },
    { id:'demo_track_meadow', name:'Demo Ängsbanan', city:'Demo Äng', lap:1050, stretch:215, curve:96, bank:12, width:22, lanes:1, surface:'synthetic clay' }
  ];
  for (const track of tracks) {
    insert('tracks', {
      id:track.id, canonical_name:track.name, city:track.city, country_code:'SE',
      lap_length_m:track.lap, home_stretch_m:track.stretch, curve_radius_m:track.curve,
      banking_degrees:track.bank, width_m:track.width, surface:track.surface,
      open_stretch_lanes:track.lanes, angled_mobile_wing:1,
      start_notes:'Synthetic preview fixture; not an existing venue.',
      track_notes:'All geometry and race history on this track are generated demo values.'
    });
    for (const [fact, value] of [
      ['lap_length_m', track.lap], ['home_stretch_m', track.stretch],
      ['open_stretch_lanes', track.lanes], ['width_2140_m', track.width],
      ['large_curve_radius_m', track.curve], ['first_turn_banking_percent', track.bank]
    ]) {
      insert('track_profile_fact_observations', {
        id:`demo_trackfact_${track.id}_${fact}`, track_id:track.id, fact_type:fact,
        numeric_value:value, evidence_type:'calculated', source_type:'calculation',
        source_url:`synthetic://kentaurai/${track.id}/${fact}`,
        verified_at:`${today}T12:00:00.000Z`, layout_effective_from:today,
        status:'active', calculation_note:'Generated synthetic preview value; not measured or verified.'
      });
    }
    for (const distance of [1640, 2140, 2640]) {
      for (const method of ['auto', 'volt']) {
        insert('track_first_turn_distances', {
          id:`demo_turn_${track.id}_${distance}_${method}`, track_id:track.id,
          race_distance_m:distance, start_method:method,
          distance_to_first_turn_m:distance === 1640 ? 165 : 190,
          evidence_type:'calculated', source_type:'calculation',
          source_url:`synthetic://kentaurai/${track.id}/first-turn`,
          verified_at:`${today}T12:00:00.000Z`, layout_effective_from:today,
          status:'active', calculation_note:'Generated synthetic preview value; not measured or verified.'
        });
      }
    }
  }

  const trainers = Array.from({ length:12 }, (_, i) => ({
    id:`demo_trainer_${String(i + 1).padStart(2, '0')}`,
    name:`Demo Tränare ${String(i + 1).padStart(2, '0')}`
  }));
  const drivers = Array.from({ length:18 }, (_, i) => ({
    id:`demo_driver_${String(i + 1).padStart(2, '0')}`,
    name:`Demo Kusk ${String(i + 1).padStart(2, '0')}`
  }));
  trainers.forEach((person) => insert('trainers', {
    id:person.id, canonical_name:person.name, country_code:'SE', active:1
  }));
  drivers.forEach((person, i) => insert('drivers', {
    id:person.id, canonical_name:person.name, country_code:'SE',
    home_track_id:tracks[i % tracks.length].id, active:1
  }));

  const horses = Array.from({ length:40 }, (_, i) => {
    const number = String(i + 1).padStart(2, '0');
    const trainer = trainers[i % trainers.length];
    const breed = i % 4 === 0 ? 'synthetic cold-blood demo' : 'synthetic warm-blood demo';
    const sex = ['sto', 'hingst', 'valack'][i % 3];
    return {
      id:`demo_horse_${number}`, name:`Demo ${['Aurora','Silversteg','Norrskensdröm','Vinterljus','Månskugga'][i % 5]} ${number}`,
      trainer, breed, sex, birthYear:2016 + (i % 7)
    };
  });
  for (const [i, horse] of horses.entries()) {
    insert('horses', {
      id:horse.id, canonical_name:horse.name, sex:horse.sex, birth_year:horse.birthYear,
      breed:horse.breed, color:['brun','fux','svart'][i % 3],
      sire_name:`Demo Far ${String((i % 12) + 1).padStart(2, '0')}`,
      dam_name:`Demo Mor ${String((i % 20) + 1).padStart(2, '0')}`,
      damsire_name:`Demo Morfar ${String((i % 10) + 1).padStart(2, '0')}`,
      breeder:'Synthetic Preview Stable', owner:'Synthetic Preview Stable',
      current_trainer_id:horse.trainer.id, home_track_id:tracks[i % tracks.length].id,
      country_code:'SE', active:1
    });
  }

  sql.push(`INSERT INTO runtime_controls (control_key,control_value,updated_at,updated_by) VALUES ('automatic_workflows_enabled','0',${quote(`${today}T12:00:00.000Z`)},'synthetic_preview_seed') ON CONFLICT(control_key) DO UPDATE SET control_value='0',updated_at=excluded.updated_at,updated_by=excluded.updated_by;`);

  const modelId = 'demo_model_synthetic_preview_v1';
  insert('model_versions', {
    id:modelId, created_at:`${today}T12:00:00.000Z`,
    feature_version:'synthetic-preview-v1', prompt_version:'synthetic-preview-v1',
    ai_provider:'local-demo', ai_model:'deterministic-synthetic-fixture',
    config_json:JSON.stringify({ synthetic:true, note:'Generated fixture only; not an AI model output.' }),
    notes:'Synthetic preview model fixture. No external AI provider is called.'
  });

  const races = [];
  for (let i = 0; i < 30; i += 1) {
    const day = dateAtOffset(-(10 + i * 11));
    races.push({
      id:`demo_race_standalone_${String(i + 1).padStart(2, '0')}`,
      date:day, track:tracks[i % tracks.length], number:(i % 8) + 1,
      type:'standalone', round:null, leg:null, upcoming:false, index:races.length
    });
  }
  const completedRounds = [];
  for (let i = 0; i < 4; i += 1) {
    const day = dateAtOffset(-[200, 150, 100, 50][i]);
    const round = { id:`demo_round_history_${i + 1}`, type:i % 2 === 0 ? 'V85' : 'V86', date:day, upcoming:false, legs:[] };
    completedRounds.push(round);
    for (let leg = 1; leg <= 8; leg += 1) {
      const race = {
        id:`demo_race_${round.id}_leg_${leg}`, date:day,
        track:tracks[(i + leg - 1) % tracks.length], number:leg,
        type:'game', round, leg, upcoming:false, index:races.length
      };
      races.push(race);
      round.legs.push(race);
    }
  }
  const upcomingRounds = [];
  for (const [i, offset] of [2, 5].entries()) {
    const day = dateAtOffset(offset);
    const round = { id:`demo_round_upcoming_${i + 1}`, type:i === 0 ? 'V85' : 'V86', date:day, upcoming:true, legs:[] };
    upcomingRounds.push(round);
    for (let leg = 1; leg <= 8; leg += 1) {
      const race = {
        id:`demo_race_${round.id}_leg_${leg}`, date:day,
        track:tracks[(i + leg - 1) % tracks.length], number:leg,
        type:'game', round, leg, upcoming:true, index:races.length
      };
      races.push(race);
      round.legs.push(race);
    }
  }

  const raceEntries = new Map();
  const raceWinners = new Map();
  const raceSources = new Map();
  const xlabsByEntry = [];
  const featureAsOf = new Map();
  for (const race of races) {
    const startMethod = race.index % 4 === 0 ? 'volt' : 'auto';
    const distance = [1640, 2140, 2640][race.index % 3];
    const startAt = stamp(race.date, 16 + (race.index % 3));
    const fieldSize = 8 + (race.index % 3);
    const sourceId = `demo_source_${race.id}`;
    raceSources.set(race.id, sourceId);
    const className = ['Klass I','Bronsdivisionen','Silverdivisionen','Demo Stayern'][race.index % 4];
    insert('source_records', {
      id:sourceId, source_type:'synthetic_demo_results',
      source_url:`synthetic://kentaurai/${race.id}/results`,
      fetched_at:startAt, effective_at:startAt, content_hash:`synthetic-${race.id}`,
      quality_status:'synthetic_preview', rights_status:'synthetic_preview',
      metadata_json:JSON.stringify({ synthetic:true, label:'Generated Preview race/result fixture.' })
    });
    insert('races', {
      id:race.id, track_id:race.track.id, race_date:race.date, race_number:race.number,
      scheduled_start_at:startAt, distance_m:distance, start_method:startMethod,
      field_size:fieldSize, first_prize_sek:[30000,50000,80000,120000][race.index % 4],
      race_name:`Demo ${className} · lopp ${race.number}`,
      main_class:className, class_flags_json:JSON.stringify({ synthetic:true, class:className }),
      status:race.upcoming ? 'scheduled' : 'completed', source_quality:'synthetic_preview'
    });

    const field = [];
    for (let lane = 0; lane < fieldSize; lane += 1) {
      const horseIndex = (race.index * 5 + lane * 11) % horses.length;
      const horse = horses[horseIndex];
      const entryId = `demo_entry_${race.id}_${lane + 1}`;
      field.push({ id:entryId, horse, horseIndex, lane, score:(horseIndex * 37 + race.index * 19 + lane * 13) % 101 });
    }
    const ordered = [...field].sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    if (!race.upcoming) raceWinners.set(race.id, ordered[0].id);
    raceEntries.set(race.id, field);
    featureAsOf.set(race.id, startAt);
    for (const entry of field) {
      const startNumber = entry.lane + 1;
      const scratched = !race.round && race.index % 13 === 0 && entry.lane === fieldSize - 1;
      insert('race_entries', {
        id:entry.id, race_id:race.id, horse_id:entry.horse.id,
        driver_id:drivers[(entry.horseIndex + race.index) % drivers.length].id,
        trainer_id:entry.horse.trainer.id, start_number:startNumber,
        actual_lane:((startNumber - 1) % 8) + 1, start_tier:startNumber > 8 ? 2 : 1,
        handicap_m:distance === 2640 && entry.lane === fieldSize - 1 ? 20 : 0,
        actual_start_distance_m:distance + (distance === 2640 && entry.lane === fieldSize - 1 ? 20 : 0),
        springspar:distance === 2640 && entry.lane === fieldSize - 1 ? 1 : 0,
        inner_lane:startNumber <= 4 ? 1 : 0, back_row:startNumber > 8 ? 1 : 0,
        scratched:scratched ? 1 : 0, scratch_reason:scratched ? 'Demo strykning' : null,
        data_quality:'synthetic_preview'
      });

      const historicUnverified = !race.upcoming && !race.round && race.index % 17 === 0 && entry.lane === 0;
      const placing = ordered.findIndex((item) => item.id === entry.id) + 1;
      if (!race.upcoming && !historicUnverified && !scratched) {
        const kmSeconds = 73 + ((entry.score + race.index) % 85) / 10;
        const mm = Math.floor(kmSeconds / 60);
        const ss = (kmSeconds % 60).toFixed(1).padStart(4, '0');
        const finishSeconds = kmSeconds * distance / 1000;
        const finishMin = Math.floor(finishSeconds / 60);
        const finishRemainder = (finishSeconds % 60).toFixed(1).padStart(4, '0');
        insert('race_results', {
          race_entry_id:entry.id, placing, placing_text:String(placing),
          finish_time:`${finishMin}:${finishRemainder}`, km_time:`${mm}:${ss}`,
          prize_sek:placing === 1 ? 50000 : placing <= 3 ? 12000 : 0,
          gallop:placing === fieldSize && entry.score % 7 === 0 ? 1 : 0,
          disqualified:0, distance_behind_winner_m:placing === 1 ? 0 : (placing - 1) * (1.2 + (race.index % 4) / 10),
          official_odds:Number((1.6 + (entry.score % 50) / 5).toFixed(2)),
          result_status:'synthetic_preview', source_record_id:sourceId
        });
      }

      if (!race.upcoming) {
        insert('race_positions', {
          id:`demo_position_${entry.id}`, race_entry_id:entry.id,
          observed_at_m:500, position:Math.min(fieldSize, Math.max(1, placing)),
          lane:entry.lane % 4 + 1, leader:placing === 1 ? 1 : 0,
          pocket:placing === 2 ? 1 : 0, death_seat:placing === 3 ? 1 : 0,
          second_over:placing === 4 ? 1 : 0, third_over:placing === 5 ? 1 : 0,
          wide_trip:entry.lane % 5 === 0 ? 1 : 0,
          uncovered_move:entry.lane % 6 === 0 ? 1 : 0,
          traffic_event:entry.lane % 7 === 0 ? 1 : 0,
          event_json:JSON.stringify({ synthetic:true, scenario:['inside','covered','wide','uncovered'][entry.lane % 4] }),
          evidence_type:'calculated', confidence:0.6,
          classification_version:'synthetic-preview-trip-v1',
          source_record_id:sourceId
        });
        if (entry.lane % 2 === 0) {
          insert('equipment', {
            id:`demo_equipment_${entry.id}`, race_entry_id:entry.id,
            shoes_front:entry.lane % 3 === 0 ? 'synthetic shoe A' : 'synthetic shoe B',
            shoes_rear:'synthetic shoe B', barefoot_front:entry.lane % 4 === 0 ? 1 : 0,
            barefoot_rear:entry.lane % 5 === 0 ? 1 : 0,
            sulky_type:entry.lane % 2 ? 'synthetic standard' : 'synthetic lightweight',
            exact_sulky:null, headgear:entry.lane % 3 ? 'synthetic open' : 'synthetic closed',
            earplugs:'synthetic demo', other_equipment:null,
            change_from_previous_json:JSON.stringify({ synthetic:true, changed:entry.lane % 3 === 0 }),
            verification_status:'synthetic_preview', source_record_id:sourceId
          });
        }
        if (entry.lane % 3 === 0) xlabsByEntry.push({ race, entry, sourceId, kmSeconds:73 + ((entry.score + race.index) % 70) / 10 });
      }

      const analysis = {
        id:`demo_analysis_${race.id}`, race, entry, score:entry.score,
        probability:0
      };
      if (!raceEntries.has(`${race.id}:predictions`)) raceEntries.set(`${race.id}:predictions`, []);
      raceEntries.get(`${race.id}:predictions`).push(analysis);
    }
    if (race.upcoming) {
      const observationAt = stamp(today, 0);
      const observationSourceId = `demo_preview_observation_source_${race.id}`;
      insert('source_records', {
        id:observationSourceId, source_type:'synthetic_preview_observation',
        source_url:`synthetic://kentaurai/${race.id}/pre-market-observation`,
        fetched_at:observationAt, effective_at:observationAt,
        content_hash:`synthetic-pre-market-${race.id}`,
        quality_status:'synthetic_preview', rights_status:'synthetic_preview',
        metadata_json:JSON.stringify({
          synthetic:true,
          label:'Generated local as-of fixture; not an official-provider observation.'
        })
      });
      insert('normalized_observations', {
        id:`demo_preview_race_observation_${race.id}`, entity_type:'race',
        entity_id:race.id, source_record_id:observationSourceId,
        observed_at:observationAt,
        fields_json:JSON.stringify({
          trackExternalId:null, date:race.date,
          raceName:`Demo ${className} · lopp ${race.number}`,
          distanceM:distance, startMethod,
          scheduledStartAt:startAt
        }),
        quality_status:'synthetic_preview'
      });
      for (const entry of field) {
        const startNumber = entry.lane + 1;
        const handicapM = distance === 2640 && entry.lane === fieldSize - 1 ? 20 : 0;
        insert('normalized_observations', {
          id:`demo_preview_entry_observation_${entry.id}`, entity_type:'race_entry',
          entity_id:entry.id, source_record_id:observationSourceId,
          observed_at:observationAt,
          fields_json:JSON.stringify({
            startNumber, postPosition:((startNumber - 1) % 8) + 1,
            startTier:startNumber > 8 ? 2 : 1, handicapM,
            actualStartDistanceM:distance + handicapM,
            horseExternalId:null, driverExternalId:null, trainerExternalId:null,
            scratchSemanticsVerified:true, scratched:false
          }),
          quality_status:'synthetic_preview'
        });
      }
    }
    insert('race_conditions', {
      race_id:race.id, track_status:['synthetic dry','synthetic damp','synthetic fast'][race.index % 3],
      temperature_c:4 + (race.index % 17), wind_mps:1 + (race.index % 8),
      wind_direction:['N','S','E','W'][race.index % 4],
      precipitation_mm:race.index % 5, weather_text:'Generated synthetic weather fixture.',
      day_profile_json:JSON.stringify({ synthetic:true, conditions:['dry','damp','fast'][race.index % 3] }),
      source_record_id:sourceId
    });
  }

  for (const { race, entry, sourceId, kmSeconds } of xlabsByEntry) {
    const xlabsSourceId = `demo_xlabs_source_${entry.id}`;
    const captured = stamp(race.date, 19);
    insert('source_records', {
      id:xlabsSourceId, source_type:'xlabs_race_json',
      source_url:`synthetic://kentaurai/${race.id}/${entry.id}/telemetry`,
      fetched_at:captured, effective_at:captured, content_hash:`synthetic-telemetry-${entry.id}`,
      quality_status:'synthetic_preview', rights_status:'synthetic_preview',
      metadata_json:JSON.stringify({ synthetic:true, label:'Generated synthetic telemetry; not an X-Labs export.' })
    });
    insert('xlabs_data', {
      id:`demo_xlabs_${entry.id}`, race_entry_id:entry.id,
      first_200_time:paceString(kmSeconds - 0.8),
      last_200_time:paceString(kmSeconds + 0.4),
      last_400_time:paceString(kmSeconds + 1.2),
      last_500_time:paceString(kmSeconds + 1.8),
      last_800_time:paceString(kmSeconds + 2.8),
      last_1000_time:paceString(kmSeconds + 3.3),
      actual_distance_m:2140 + (entry.lane % 4) * 8, extra_distance_m:(entry.lane % 4) * 8,
      converted_km_time:paceString(kmSeconds),
      slipstream_m:entry.lane % 4 * 20,
      segments_json:JSON.stringify({ synthetic:true, source:'synthetic preview fixture' }),
      quality_status:'xlabs-telemetry-v1', source_record_id:xlabsSourceId
    });
    for (let interval = 0; interval < 5; interval += 1) {
      const elapsed = (kmSeconds + interval * 0.18) * 100;
      insert('xlabs_intervals', {
        id:`demo_xlabs_interval_${entry.id}_${interval}`,
        race_entry_id:entry.id, source_record_id:xlabsSourceId,
        interval_start_m:interval * 100, interval_end_m:(interval + 1) * 100,
        elapsed_ms:elapsed, km_pace_ms:elapsed * 10, measured_distance_m:100,
        local_target_frame_count:10, local_window_frame_count:10,
        local_frame_coverage:1, start_endpoint_error_m:0, end_endpoint_error_m:0,
        eligibility_status:'valid', mapper_version:'xlabs-intervals-v2'
      });
    }
  }

  for (const [horseIndex, horse] of horses.entries()) {
    const sourceId = `demo_start_points_source_${horse.id}`;
    const observedAt = `${today}T12:00:00.000Z`;
    const latestEntry = races
      .filter((race) => !race.upcoming)
      .flatMap((race) => raceEntries.get(race.id) || [])
      .find((entry) => entry.horse.id === horse.id);
    insert('source_records', {
      id:sourceId, source_type:'synthetic_preview_start_points',
      source_url:`synthetic://kentaurai/${horse.id}/start-points`,
      fetched_at:observedAt, effective_at:observedAt,
      content_hash:`synthetic-start-points-${horse.id}`,
      quality_status:'synthetic_preview', rights_status:'synthetic_preview',
      metadata_json:JSON.stringify({ synthetic:true, label:'Generated demo start-points value.' })
    });
    const points = 15 + ((horseIndex * 17) % 86);
    insert('horse_start_points', {
      id:`demo_start_points_${horse.id}`, horse_id:horse.id, points,
      observed_at:observedAt, race_entry_id:latestEntry?.id || null,
      source_record_id:sourceId
    });
    sql.push(`UPDATE horses SET current_start_points=${points}, current_start_points_observed_at=${quote(observedAt)}, current_start_points_source_record_id=${quote(sourceId)} WHERE id=${quote(horse.id)};`);
  }

  for (const race of races) {
    const field = raceEntries.get(race.id);
    const startAt = stamp(race.date, 16 + (race.index % 3));
    const asOf = stamp(race.date, 14 + (race.index % 2));
    const predictions = raceEntries.get(`${race.id}:predictions`) || [];
    const weights = predictions.map((row) => 1 + ((100 - row.score) / 25));
    const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
    predictions.forEach((prediction, index) => {
      prediction.probability = weights[index] / weightTotal;
      insert('analysis_features', {
        id:`demo_feature_${prediction.entry.id}_form`, race_entry_id:prediction.entry.id,
        feature_version:'synthetic-preview-v1', as_of:asOf, feature_name:'form_score',
        numeric_value:35 + ((prediction.score + race.index) % 61),
        uncertainty_low:null, uncertainty_high:null, data_quality:'synthetic_preview',
        provenance_json:JSON.stringify({ synthetic:true })
      });
      insert('analysis_features', {
        id:`demo_feature_${prediction.entry.id}_speed`, race_entry_id:prediction.entry.id,
        feature_version:'synthetic-preview-v1', as_of:asOf, feature_name:'speed_index',
        numeric_value:80 + ((100 - prediction.score + race.index) % 31),
        uncertainty_low:null, uncertainty_high:null, data_quality:'synthetic_preview',
        provenance_json:JSON.stringify({ synthetic:true })
      });
    });
    const analysisId = `demo_ai_race_${race.id}`;
    insert('ai_race_analyses', {
      id:analysisId, race_id:race.id, model_version_id:modelId,
      data_snapshot_at:asOf, market_blind:1,
      scenarios_json:JSON.stringify({ synthetic:true, scenarios:['clean lead','covered trip','wide early move'] }),
      race_shape_summary:'Synthetic preview scenario fixture; generated for interface testing only.',
      conclusion:'Synthetic demo output; not a real prediction.',
      data_quality:'synthetic_preview', created_at:asOf
    });
    predictions.sort((a, b) => b.probability - a.probability || a.entry.id.localeCompare(b.entry.id));
    predictions.forEach((prediction, index) => {
      const group = index < 2 ? 'A' : index < 5 ? 'B' : index < 8 ? 'C' : 'D';
      insert('ai_horse_predictions', {
        id:`demo_ai_prediction_${prediction.entry.id}`,
        ai_race_analysis_id:analysisId, race_entry_id:prediction.entry.id,
        win_probability:Number(prediction.probability.toFixed(6)),
        uncertainty_low:Number(Math.max(0, prediction.probability - 0.035).toFixed(6)),
        uncertainty_high:Number(Math.min(1, prediction.probability + 0.035).toFixed(6)),
        raw_rank:index + 1, abcd_group:group,
        value_ratio:Number((0.7 + prediction.probability * 4).toFixed(4)),
        scenario_robustness:Number((0.4 + ((prediction.score + race.index) % 55) / 100).toFixed(2)),
        reasoning_json:JSON.stringify({ synthetic:true, note:'Deterministic fixture ranking.' })
      });
    });
  }

  for (const round of [...completedRounds, ...upcomingRounds]) {
    const isUpcoming = round.upcoming;
    const firstStart = stamp(round.date, 16);
    const sourceId = `demo_round_result_source_${round.id}`;
    if (!isUpcoming) insert('source_records', {
      id:sourceId, source_type:'synthetic_demo_game_result',
      source_url:`synthetic://kentaurai/${round.id}/settlement`,
      fetched_at:stamp(round.date, 22), effective_at:stamp(round.date, 22),
      content_hash:`synthetic-settlement-${round.id}`, quality_status:'synthetic_preview',
      rights_status:'synthetic_preview',
      metadata_json:JSON.stringify({ synthetic:true, label:'Generated Preview payout fixture.' })
    });
    insert('game_rounds', {
      id:round.id, game_type:round.type, round_date:round.date,
      primary_track_id:round.legs[0].track.id, scheduled_start_at:firstStart,
      bet_stop_at:stamp(round.date, 15), jackpot_sek:isUpcoming ? null : 15000000 + (round.date.charCodeAt(8) * 1000),
      turnover_sek:isUpcoming ? null : 82000000 + (round.date.charCodeAt(9) * 10000),
      payout_json:isUpcoming ? null : JSON.stringify({ synthetic:true, eightCorrect:420000, sevenCorrect:5600, sixCorrect:280 }),
      status:isUpcoming ? 'scheduled' : 'settled'
    });
    round.legs.forEach((race, legIndex) => {
      const leg = legIndex + 1;
      insert('game_legs', { game_round_id:round.id, leg_number:leg, race_id:race.id });
      const field = raceEntries.get(race.id);
      const ranked = [...field].sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
      const percentages = ranked.map((entry, rank) => ({
        entry, rank, percent:Math.max(1, 42 - rank * 5 + ((race.index + rank) % 4))
      }));
      const totalPercent = percentages.reduce((sum, item) => sum + item.percent, 0);
      percentages.forEach(({ entry, rank, percent }) => {
        insert('betting_snapshots', {
          id:`demo_bet_${round.id}_${leg}_${entry.id}`,
          game_round_id:round.id, leg_number:leg, race_entry_id:entry.id,
          captured_at:stamp(round.date, 14 + (isUpcoming ? 0 : 1)),
          bet_percent:Number((percent * 100 / totalPercent).toFixed(3)),
          market_rank:rank + 1, source_record_id:isUpcoming ? null : sourceId
        });
        const formScore = 40 + ((entry.horseIndex * 11 + race.index) % 56);
        insert('analysis_entry_form_snapshots', {
          id:`demo_form_${round.id}_${leg}_${entry.id}`,
          game_round_id:round.id, step1_pack_id:`demo_form_pack_${round.id}`,
          leg_number:leg, race_entry_id:entry.id,
          as_of:stamp(round.date, 14), form_version:'synthetic-form-v1',
          form_score:formScore, used_starts:Math.max(1, Math.floor((entry.horseIndex % 18) + 1)),
          form_rank:rank + 1
        });
      });
    });

    if (isUpcoming) continue;

    insert('game_round_final_results', {
      game_round_id:round.id, game_type:round.type, source_record_id:sourceId,
      captured_at:stamp(round.date, 22), status:'synthetic_settled',
      turnover_raw:82000000, turnover_sek:82000000, system_count:1,
      payouts_json:JSON.stringify({ synthetic:true, payouts:[420000,5600,280] }),
      highest_payout_level:8, highest_payout_raw:420000, highest_payout_sek:420000
    });
    const systemId = `demo_system_${round.id}`;
    const linePrice = round.type === 'V85' ? 0.5 : 0.25;
    const spikeLegs = new Set([1, 4, 7]);
    const chosenByLeg = [];
    const selections = [];
    round.legs.forEach((race, legIndex) => {
      const ranked = [...raceEntries.get(race.id)].sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
      const chosen = ranked.slice(0, spikeLegs.has(legIndex + 1) ? 1 : 2);
      chosenByLeg.push(chosen.length);
      for (const entry of chosen) {
        selections.push({
          system_id:systemId, leg_number:legIndex + 1, race_entry_id:entry.id,
          is_spike:spikeLegs.has(legIndex + 1) ? 1 : 0,
          own_probability:Number((0.08 + ((100 - entry.score) % 35) / 100).toFixed(3)),
          market_percent:25, selection_reason:'Synthetic preview system selection.'
        });
      }
    });
    const rowCount = chosenByLeg.reduce((product, count) => product * count, 1);
    insert('systems', {
      id:systemId, game_round_id:round.id, model_version_id:modelId,
      system_type:'main', budget_sek:rowCount * linePrice, row_count:rowCount,
      line_price_sek:linePrice, spike_count:3,
      estimated_hit_probability:0.012, estimated_market_ownership:0.08,
      value_metric:1.07, risk_profile:'synthetic_preview',
      created_at:stamp(round.date, 15)
    });
    selections.forEach((selection) => insert('system_selections', selection));
    for (const [legIndex, race] of round.legs.entries()) {
      const winner = raceWinners.get(race.id);
      insert('post_race_reviews', {
        id:`demo_review_${round.id}_${legIndex + 1}`, game_round_id:round.id,
        race_id:race.id, race_entry_id:winner, system_id:systemId,
        model_version_id:modelId,
        winner_rank:1, winner_probability:0.18, winner_market_percent:28,
        selected_in_system:1, error_type:null, scenario_match:'matched',
        review_json:JSON.stringify({ synthetic:true, note:'Demonstration review; not a real post-race finding.' }),
        created_at:stamp(round.date, 22)
      });
    }
  }

  for (const [i, entry] of xlabsByEntry.entries()) {
    if (i % 4 !== 0) continue;
    insert('external_horse_stat_snapshots', {
      id:`demo_external_stats_${entry.entry.horse.id}_${entry.race.id}`,
      horse_id:entry.entry.horse.id, race_entry_id:entry.entry.id,
      game_round_id:entry.race.round?.id || null,
      context_type:'all_starts', context_key:null, context_label:'Synthetic demo summary',
      starts:6 + (entry.entry.horseIndex % 20), wins:entry.entry.horseIndex % 5,
      seconds:entry.entry.horseIndex % 4, thirds:entry.entry.horseIndex % 3,
      win_rate_percent:Number((entry.entry.horseIndex % 30).toFixed(1)),
      roi_percent:null, observed_at:stamp(entry.race.date, 20),
      source_record_id:`demo_xlabs_source_${entry.entry.id}`
    });
  }

  insert('import_runs', {
    id:'demo_import_run_seed', source_type:'synthetic_preview_seed',
    started_at:`${today}T12:00:00.000Z`, finished_at:`${today}T12:00:01.000Z`,
    status:'complete', inserted_count:races.length, updated_count:0,
    skipped_count:0, error_count:0, checkpoint:null, error_json:null,
    metadata_json:JSON.stringify({ synthetic:true, note:'Local fixture generation only.' })
  });
}

sql.push('PRAGMA foreign_keys = ON;');
sql.push('SELECT changes() AS preview_seed_complete;');
mkdirSync(resolve('.wrangler'), { recursive:true });
writeFileSync(SQL_PATH, `${sql.join('\n')}\n`, { mode:0o600 });
const wrangler = resolve('node_modules/.bin/wrangler');
const result = spawnSync(wrangler, [
  'd1', 'execute', 'kentaurai-local', '--config', 'wrangler.local.jsonc',
  '--local', '--file', SQL_PATH
], { stdio:'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(RESET_ONLY ? 'Removed only synthetic demo rows from local D1.' : 'Seeded deterministic synthetic data into local D1.');
