export function buildReferenceRound() {
  const races = [];
  const analysisLegs = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    races.push({
      leg,
      race: {
        race_id: `race-${leg}`,
        race_number: leg,
        race_name: `Synthetic ${leg}`,
        track: 'Testtrack',
        date: '2026-09-06',
        scheduled_start: `2026-09-06T1${leg}:00:00+02:00`,
        distance_m: 2140,
        start_method: 'auto',
        field_size: 1,
        starters_declared: 1,
        first_prize_sek: 100000,
        main_class: 'synthetic',
        class_flags: [],
        conditions: {}
      },
      entries: [{
        start_number: 1,
        horse: { name: `Horse ${leg}`, external_id: 1000 + leg },
        driver: { name: `Driver ${leg}`, external_id: 2000 + leg },
        trainer: { name: `Trainer ${leg}`, external_id: 3000 + leg },
        start_position: { start_number: 1, actual_lane: 1, tier: 1, handicap_m: 0 },
        scratched: false,
        equipment_today: {},
        market: { betting_snapshots: [], odds_snapshots: [] },
        recent_starts: [],
        historical_stats_used: {},
        editorial_signals: [],
        source_refs: ['src-001']
      }]
    });
    analysisLegs.push({
      leg,
      race_id: `race-${leg}`,
      horses: [{
        horse_name: `Horse ${leg}`,
        start_number: 1,
        own_win_probability: 100,
        uncertainty_low: null,
        uncertainty_high: null,
        rank: 1,
        abcd: 'A',
        value_assessment: null,
        spike_candidate: leg <= 3,
        data_quality: 'synthetic',
        scenario_notes: null,
        reasoning_summary: null,
        scratched: false
      }]
    });
  }

  const systemLegs = races.map((race) => ({
    leg: race.leg,
    selected_horses: [{ start_number: 1, horse_name: `Horse ${race.leg}` }]
  }));

  return {
    export_version: 'kentaurai-reference-v1',
    round: {
      game_type: 'V85',
      date: '2026-09-06',
      track: 'Testtrack',
      round_id: 'synthetic-round',
      captured_at: '2026-09-06T12:00:00+02:00'
    },
    races,
    sources: [{ source_id: 'src-001', source_type: 'official', name: 'Synthetic source' }],
    editorial_items: [],
    analysis_snapshot: {
      captured_at: '2026-09-06T12:00:00+02:00',
      method_note: 'Synthetic fixture',
      legs: analysisLegs,
      chosen_main_system: {
        label: 'Synthetic main',
        budget_sek: 1,
        rows: 1,
        spikes: [1, 2, 3].map((leg) => ({ leg, start_number: 1, horse_name: `Horse ${leg}` })),
        legs: systemLegs
      },
      alternative_systems: [],
      other_data_used: { known_gaps: [] }
    }
  };
}
