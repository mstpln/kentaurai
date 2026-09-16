import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  ANALYSIS_STEP1_REVISION_CONTRACT,
  ANALYSIS_STEP1_REVISION_PROMPT_VERSION,
  buildStep1RevisionBasisFromPack,
  compareStep1RevisionBasis,
  composeStep1RevisionChildLockV1,
  requireCurrentStep1LockV1
} from '../src/analysis-step1-revision-v1.js';
import { ANALYSIS_STEP1_LOCK_CONTRACT } from '../src/analysis-step1-prompt-v3.js';

globalThis.crypto ??= webcrypto;

function entry(leg, suffix) {
  return {
    race_entry_id: `entry-${leg}-${suffix}`,
    current_facts: {
      analysis_eligible: true,
      scratched: false,
      scratch_status_verified: true,
      horse: { id: `horse-${leg}-${suffix}`, name: `Horse ${leg}${suffix}` },
      driver: { id: `driver-${leg}-${suffix}`, name: `Driver ${leg}${suffix}` },
      trainer: { id: `trainer-${leg}-${suffix}`, name: `Trainer ${leg}${suffix}` },
      equipment: { shoes_front: 'shoes', shoes_rear: 'shoes', sulky: 'VA' }
    },
    features: { performance: { capacity: suffix === 'a' ? 0.7 : 0.5 } },
    xlabs: null,
    history_aggregates: { starts: 10 },
    relevant_history: [],
    history_selection: { counts: { total: 10 } },
    current_signals: []
  };
}

function syntheticPack({ asOf = '2026-09-16T08:00:00.000Z', fingerprint = 'sha256:facts-a', mutate = null } = {}) {
  const legPayloads = Array.from({ length: 8 }, (_, index) => {
    const leg = index + 1;
    return {
      contract_version: 'kentaurai-analysis-pack-v3',
      pack_version: 'analysis-pack-v3-d1',
      as_of: asOf,
      contains_current_market: false,
      leg_number: leg,
      race: {
        race_id: `race-${leg}`,
        track: { id: `track-${leg}` },
        field: { total_entries: 2, analysis_eligible_entries: 2 }
      },
      entries: [entry(leg, 'a'), entry(leg, 'b')],
      warnings: []
    };
  });
  const roundPayload = {
    contract_version: 'kentaurai-analysis-pack-v3',
    pack_version: 'analysis-pack-v3-d1',
    as_of: asOf,
    contains_current_market: false,
    round: { round_id: 'round-v85-synthetic', game_type: 'V85', round_date: '2026-09-16' },
    pre_market_cutoff: { source: 'first_leg_start' },
    legs: legPayloads.map((leg) => ({ leg_number: leg.leg_number, race_id: leg.race.race_id, track: leg.race.track })),
    source_family_coverage: {},
    source_freshness: {},
    warnings: []
  };
  if (mutate) mutate({ roundPayload, legPayloads });
  const packId = `pack_${fingerprint.replace(/[^a-z0-9]/gi, '').slice(-12)}`;
  return {
    manifest: {
      contract_version: 'kentaurai-analysis-pack-v3',
      pack_version: 'analysis-pack-v3-d1',
      pack_id: packId,
      round_id: 'round-v85-synthetic',
      generated_at: asOf,
      as_of: asOf,
      facts_fingerprint: fingerprint,
      contains_current_market: false
    },
    files: [
      { name: '00_round_pre_market.json', payload: roundPayload },
      ...legPayloads.map((payload) => ({ name: `${String(payload.leg_number).padStart(2, '0')}_leg_${payload.leg_number}.json`, payload }))
    ]
  };
}

function parentLock(pack) {
  return {
    contract_version: ANALYSIS_STEP1_LOCK_CONTRACT,
    lock_id: 'step1-parent',
    round_id: 'round-v85-synthetic',
    pack: {
      pack_id: pack.manifest.pack_id,
      as_of: pack.manifest.as_of,
      facts_fingerprint: pack.manifest.facts_fingerprint
    },
    provider: 'openai',
    model: 'synthetic-model',
    prompt_version: 'step1-prompt-v3-d2',
    legs: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      return {
        leg_number: leg,
        race_id: `race-${leg}`,
        data_quality_summary: 'Synthetic evidence.',
        race_shape_summary: 'Synthetic shape.',
        scenario_confidence: 0.5,
        scenarios: [],
        predictions: [
          { race_entry_id: `entry-${leg}-a`, blind_probability: 0.6, uncertainty_low: 0.5, uncertainty_high: 0.7, raw_rank: 1, abcd_group: 'A', assessment_confidence: 0.7, reasoning: 'Stronger supplied evidence.' },
          { race_entry_id: `entry-${leg}-b`, blind_probability: 0.4, uncertainty_low: 0.3, uncertainty_high: 0.5, raw_rank: 2, abcd_group: 'B', assessment_confidence: 0.6, reasoning: 'Weaker supplied evidence.' }
        ]
      };
    })
  };
}

test('D3 detects a scratch as an affected-leg-only material revision', async () => {
  const before = syntheticPack();
  const basis = await buildStep1RevisionBasisFromPack(before, { lockId: 'step1-parent' });
  const after = syntheticPack({ fingerprint: 'sha256:facts-scratch', mutate: ({ legPayloads }) => {
    const target = legPayloads[2];
    target.entries[1].current_facts.scratched = true;
    target.entries[1].current_facts.analysis_eligible = false;
    target.race.field.analysis_eligible_entries = 1;
  } });
  const change = await compareStep1RevisionBasis(basis, after);
  assert.equal(change.revision_scope, 'affected_legs');
  assert.deepEqual(change.affected_legs, [3]);
  assert.ok(change.fact_changes.some((item) => item.path.includes('scratched')));
});

test('D3 detects driver and equipment changes only in their affected legs', async () => {
  const before = syntheticPack();
  const basis = await buildStep1RevisionBasisFromPack(before, { lockId: 'step1-parent' });
  const after = syntheticPack({ fingerprint: 'sha256:facts-context', mutate: ({ legPayloads }) => {
    legPayloads[3].entries[0].current_facts.driver = { id: 'driver-new', name: 'New Driver' };
    legPayloads[4].entries[1].current_facts.equipment.sulky = 'AM';
  } });
  const change = await compareStep1RevisionBasis(basis, after);
  assert.equal(change.revision_scope, 'affected_legs');
  assert.deepEqual(change.affected_legs, [4, 5]);
  assert.ok(change.fact_changes.some((item) => item.path.includes('driver')));
  assert.ok(change.fact_changes.some((item) => item.path.includes('equipment')));
});

test('D3 ignores as_of-only fingerprint movement but promotes round identity change to full-round revision', async () => {
  const before = syntheticPack();
  const basis = await buildStep1RevisionBasisFromPack(before, { lockId: 'step1-parent' });
  const asOfOnly = syntheticPack({ asOf: '2026-09-16T09:00:00.000Z', fingerprint: 'sha256:facts-asof-only' });
  const metadataOnly = await compareStep1RevisionBasis(basis, asOfOnly);
  assert.equal(metadataOnly.revision_scope, null);
  assert.deepEqual(metadataOnly.affected_legs, []);

  const structural = syntheticPack({ fingerprint: 'sha256:facts-structural', mutate: ({ roundPayload, legPayloads }) => {
    legPayloads[1].race.race_id = 'race-2-replacement';
    roundPayload.legs[1].race_id = 'race-2-replacement';
  } });
  const structuralChange = await compareStep1RevisionBasis(basis, structural);
  assert.equal(structuralChange.revision_scope, 'full_round');
  assert.deepEqual(structuralChange.affected_legs, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('D3 revision basis rejects any current-market contamination', async () => {
  const leaked = syntheticPack({ mutate: ({ legPayloads }) => {
    legPayloads[0].entries[0].market_percent = 25;
  } });
  await assert.rejects(() => buildStep1RevisionBasisFromPack(leaked), /denied current-market fields/);
});

test('D3 composes an immutable child lock by replacing only revised legs and validates current active identity', async () => {
  const before = syntheticPack();
  const after = syntheticPack({ fingerprint: 'sha256:facts-scratch', mutate: ({ legPayloads }) => {
    legPayloads[2].entries[1].current_facts.scratched = true;
    legPayloads[2].entries[1].current_facts.analysis_eligible = false;
    legPayloads[2].race.field.analysis_eligible_entries = 1;
  } });
  const parent = parentLock(before);
  const revisionPack = {
    revision_required: true,
    round_id: 'round-v85-synthetic',
    parent_lock: { lock_id: 'step1-parent', lock_hash: 'sha256:parent' },
    target_pack: {
      pack_id: after.manifest.pack_id,
      as_of: after.manifest.as_of,
      facts_fingerprint: after.manifest.facts_fingerprint
    },
    affected_legs: [3]
  };
  const revisedLeg = {
    leg_number: 3,
    race_id: 'race-3',
    data_quality_summary: 'Scratch reflected.',
    race_shape_summary: 'One active contender remains in this synthetic fixture.',
    scenario_confidence: 0.5,
    scenarios: [],
    predictions: [
      { race_entry_id: 'entry-3-a', blind_probability: 1, uncertainty_low: 1, uncertainty_high: 1, raw_rank: 1, abcd_group: 'A', assessment_confidence: 0.7, reasoning: 'Only active synthetic entry.' }
    ]
  };
  const payload = {
    contract_version: ANALYSIS_STEP1_REVISION_CONTRACT,
    revision_id: 'revision-001',
    child_lock_id: 'step1-child',
    round_id: 'round-v85-synthetic',
    parent_lock_id: 'step1-parent',
    parent_lock_hash: 'sha256:parent',
    target_pack: revisionPack.target_pack,
    provider: 'openai',
    model: 'synthetic-model',
    prompt_version: ANALYSIS_STEP1_REVISION_PROMPT_VERSION,
    revised_legs: [revisedLeg]
  };
  const composed = await composeStep1RevisionChildLockV1({ payload, revisionPack, parentLock: parent, targetPack: after });
  assert.equal(composed.childLock.prompt_version, ANALYSIS_STEP1_REVISION_PROMPT_VERSION);
  assert.deepEqual(composed.childLock.legs[0], parent.legs[0]);
  assert.equal(composed.childLock.legs[2].predictions.length, 1);
  assert.equal(composed.childLock.legs[2].predictions[0].race_entry_id, 'entry-3-a');
  assert.notEqual(composed.childLockHash, 'sha256:parent');
});

test('D3 revision output fails closed on market fields and wrong affected-leg scope', async () => {
  const target = syntheticPack({ fingerprint: 'sha256:target' });
  const parent = parentLock(syntheticPack());
  const revisionPack = {
    revision_required: true,
    round_id: 'round-v85-synthetic',
    parent_lock: { lock_id: 'step1-parent', lock_hash: 'sha256:parent' },
    target_pack: { pack_id: target.manifest.pack_id, as_of: target.manifest.as_of, facts_fingerprint: target.manifest.facts_fingerprint },
    affected_legs: [1]
  };
  const base = {
    contract_version: ANALYSIS_STEP1_REVISION_CONTRACT,
    revision_id: 'revision-002', child_lock_id: 'step1-child-2', round_id: 'round-v85-synthetic',
    parent_lock_id: 'step1-parent', parent_lock_hash: 'sha256:parent', target_pack: revisionPack.target_pack,
    provider: 'openai', model: 'synthetic-model', prompt_version: ANALYSIS_STEP1_REVISION_PROMPT_VERSION,
    revised_legs: [parent.legs[0]]
  };
  const leaked = structuredClone(base);
  leaked.market_percent = 12;
  await assert.rejects(() => composeStep1RevisionChildLockV1({ payload: leaked, revisionPack, parentLock: parent, targetPack: target }), /denied current-market fields/);
  const wrongLeg = structuredClone(base);
  wrongLeg.revised_legs = [parent.legs[1]];
  await assert.rejects(() => composeStep1RevisionChildLockV1({ payload: wrongLeg, revisionPack, parentLock: parent, targetPack: target }), /match affected_legs exactly/);
});

test('D3 current-lock gate rejects an older lock before any market/pack work', async () => {
  const latest = {
    id: 'step1-child', game_round_id: 'round-v85-synthetic', contract_version: ANALYSIS_STEP1_LOCK_CONTRACT,
    pack_id: 'pack-child', pack_as_of: '2026-09-16T09:00:00.000Z', facts_fingerprint: 'sha256:child',
    provider: 'openai', model: 'synthetic-model', prompt_version: ANALYSIS_STEP1_REVISION_PROMPT_VERSION,
    lock_json: '{}', lock_hash: 'sha256:child-lock', created_at: '2026-09-16T09:05:00.000Z'
  };
  const parent = { ...latest, id: 'step1-parent', pack_id: 'pack-parent', facts_fingerprint: 'sha256:parent', lock_hash: 'sha256:parent-lock', created_at: '2026-09-16T08:05:00.000Z' };
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (sql.includes('WHERE game_round_id=?') && sql.includes('ORDER BY')) return latest;
                if (sql.includes('WHERE id=?')) return args[0] === parent.id ? parent : latest;
                throw new Error(`unexpected SQL: ${sql}`);
              }
            };
          }
        };
      }
    }
  };
  await assert.rejects(
    () => requireCurrentStep1LockV1(env, { roundId: 'round-v85-synthetic', lockId: 'step1-parent' }),
    /stale; newest valid lock is required/
  );
});

test('D3 current-lock gate rejects a parent that already has a child revision', async () => {
  const latest = {
    id: 'step1-parent', game_round_id: 'round-v85-synthetic', contract_version: ANALYSIS_STEP1_LOCK_CONTRACT,
    pack_id: 'pack-parent', pack_as_of: '2026-09-16T08:00:00.000Z', facts_fingerprint: 'sha256:parent',
    provider: 'openai', model: 'synthetic-model', prompt_version: 'step1-prompt-v3-d2',
    lock_json: '{}', lock_hash: 'sha256:parent-lock', created_at: '2026-09-16T08:05:00.000Z'
  };
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.includes('WHERE game_round_id=?') && sql.includes('ORDER BY')) return latest;
                if (sql.includes('analysis_step1_lock_revisions')) return { id: 'revision-001', child_lock_id: 'step1-child' };
                throw new Error(`unexpected SQL: ${sql}`);
              }
            };
          }
        };
      }
    }
  };
  await assert.rejects(
    () => requireCurrentStep1LockV1(env, { roundId: 'round-v85-synthetic' }),
    /stale because a child revision exists/
  );
});
