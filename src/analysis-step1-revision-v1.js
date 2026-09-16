import { stableFeatureJson } from './analysis-v3-foundations.js';
import { createPreMarketAnalysisPackV3 } from './analysis-pack-v3.js';
import { assertAnalysisPackReplaySafe } from './analysis-pack-v3-asof-guard.js';
import {
  ANALYSIS_STEP1_LOCK_CONTRACT,
  assertStep1MarketBlind,
  getStep1LockV1
} from './analysis-step1-lock-v1.js';
import {
  buildStep1RevisionBasisFromPack,
  compareStep1RevisionBasis,
  logicalStep1RevisionLegs,
  ANALYSIS_STEP1_REVISION_BASIS_VERSION
} from './analysis-step1-revision-basis-v1.js';
import { composeStep1RevisionChildLockV1 } from './analysis-step1-revision-contract-v1.js';
import {
  ANALYSIS_STEP1_REVISION_CONTRACT,
  ANALYSIS_STEP1_REVISION_PACK_CONTRACT,
  ANALYSIS_STEP1_REVISION_PROMPT_VERSION,
  ANALYSIS_STEP1_REVISION_VERSION
} from './analysis-step1-revision-prompt-v1.js';

export {
  ANALYSIS_STEP1_REVISION_CONTRACT,
  ANALYSIS_STEP1_REVISION_PACK_CONTRACT,
  ANALYSIS_STEP1_REVISION_PROMPT_VERSION,
  ANALYSIS_STEP1_REVISION_VERSION,
  ANALYSIS_STEP1_REVISION_BASIS_VERSION,
  buildStep1RevisionBasisFromPack,
  compareStep1RevisionBasis,
  composeStep1RevisionChildLockV1
};

function requiredText(value, field, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function timestamp(value, field) {
  const text = requiredText(value, field, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function hashValue(value) {
  return sha256Text(stableFeatureJson(value));
}

function basisFromRow(row) {
  if (!row) return null;
  let legHashes;
  let volatileFacts;
  try { legHashes = JSON.parse(row.leg_material_hashes_json); } catch { throw new Error('stored Step 1 revision basis leg hashes are invalid JSON'); }
  try { volatileFacts = JSON.parse(row.volatile_facts_json); } catch { throw new Error('stored Step 1 revision basis facts are invalid JSON'); }
  return {
    basis_version: row.basis_version,
    lock_id: row.lock_id,
    round_id: row.game_round_id,
    pack_id: row.pack_id,
    pack_as_of: row.pack_as_of,
    facts_fingerprint: row.facts_fingerprint,
    round_material_hash: row.round_material_hash,
    leg_material_hashes: legHashes,
    volatile_facts: volatileFacts
  };
}

async function getLockRow(env, lockId) {
  return env.DB.prepare(`SELECT * FROM analysis_step1_locks WHERE id=? LIMIT 1`).bind(String(lockId)).first();
}

async function latestLockRow(env, roundId) {
  return env.DB.prepare(`
    SELECT * FROM analysis_step1_locks
    WHERE game_round_id=?
    ORDER BY datetime(created_at) DESC,id DESC
    LIMIT 1
  `).bind(String(roundId)).first();
}

async function getBasisRow(env, lockId) {
  return env.DB.prepare(`SELECT * FROM analysis_step1_lock_revision_bases WHERE lock_id=? LIMIT 1`).bind(String(lockId)).first();
}

async function childRevisionRow(env, parentLockId) {
  return env.DB.prepare(`SELECT * FROM analysis_step1_lock_revisions WHERE parent_lock_id=? LIMIT 1`).bind(String(parentLockId)).first();
}

function rowMetadata(row) {
  if (!row) return null;
  return {
    contract_version: row.contract_version,
    lock_id: row.id,
    round_id: row.game_round_id,
    pack_id: row.pack_id,
    pack_as_of: row.pack_as_of,
    facts_fingerprint: row.facts_fingerprint,
    provider: row.provider,
    model: row.model,
    prompt_version: row.prompt_version,
    lock_hash: row.lock_hash,
    created_at: row.created_at,
    sealed: true
  };
}

async function insertBasis(env, basis, createdAt) {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO analysis_step1_lock_revision_bases (
      lock_id,game_round_id,basis_version,pack_id,pack_as_of,facts_fingerprint,
      round_material_hash,leg_material_hashes_json,volatile_facts_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(
    basis.lock_id,basis.round_id,basis.basis_version,basis.pack_id,basis.pack_as_of,basis.facts_fingerprint,
    basis.round_material_hash,stableFeatureJson(basis.leg_material_hashes),stableFeatureJson(basis.volatile_facts),createdAt
  ).run();
}

export async function captureStep1RevisionBasisForLock(env, { lockId } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const id = requiredText(lockId, 'lock_id', 160);
  const existing = await getBasisRow(env, id);
  if (existing) return basisFromRow(existing);
  const lock = await getLockRow(env, id);
  if (!lock) throw new Error('sealed Step 1 lock was not found');
  await assertAnalysisPackReplaySafe(env, lock.game_round_id, lock.pack_as_of);
  const pack = await createPreMarketAnalysisPackV3(env, lock.game_round_id, { asOf: lock.pack_as_of, generatedAt: lock.pack_as_of });
  if (pack.manifest.pack_id !== lock.pack_id || pack.manifest.facts_fingerprint !== lock.facts_fingerprint) {
    throw new Error('cannot capture revision basis because the sealed parent pack no longer reproduces exactly');
  }
  const basis = await buildStep1RevisionBasisFromPack(pack, { lockId: id, roundId: lock.game_round_id });
  await insertBasis(env, basis, new Date().toISOString());
  return basisFromRow(await getBasisRow(env, id));
}

function parseLockJson(row) {
  try { return JSON.parse(row.lock_json); } catch { throw new Error('stored Step 1 lock JSON is invalid'); }
}

async function prepareRevisionContext(env, { roundId, parentLockId = null, targetAsOf = null } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const round = requiredText(roundId, 'round_id');
  const latest = await latestLockRow(env, round);
  if (!latest) throw new Error('a sealed Step 1 lock is required before creating a revision');
  const parent = parentLockId ? await getLockRow(env, requiredText(parentLockId, 'parent_lock_id', 160)) : latest;
  if (!parent || parent.game_round_id !== round) throw new Error('parent Step 1 lock does not belong to this round');
  if (parent.id !== latest.id) throw new Error('parent Step 1 lock is stale; revisions must reference the newest sealed lock');
  if (await childRevisionRow(env, parent.id)) throw new Error('parent Step 1 lock already has a child revision; use the newest child lock');

  const requestedAsOf = targetAsOf == null ? new Date().toISOString() : timestamp(targetAsOf, 'target_as_of');
  await assertAnalysisPackReplaySafe(env, round, requestedAsOf);
  const targetPack = await createPreMarketAnalysisPackV3(env, round, { asOf: requestedAsOf, generatedAt: requestedAsOf });
  const fingerprintChanged = parent.facts_fingerprint !== targetPack.manifest.facts_fingerprint;
  const basis = basisFromRow(await getBasisRow(env, parent.id));
  if (basis && basis.facts_fingerprint !== parent.facts_fingerprint) throw new Error('stored revision basis does not match parent facts fingerprint');

  let comparison;
  let basisStatus = basis ? 'available' : 'missing';
  if (basis) {
    comparison = await compareStep1RevisionBasis(basis, targetPack);
  } else if (fingerprintChanged) {
    const targetBasis = await buildStep1RevisionBasisFromPack(targetPack, { lockId: parent.id, roundId: round });
    comparison = {
      structural_changed: true,
      revision_scope: 'full_round',
      affected_legs: [1, 2, 3, 4, 5, 6, 7, 8],
      section_changes: [1, 2, 3, 4, 5, 6, 7, 8].map((leg) => ({ leg_number: leg, changed_sections: ['baseline_unavailable'] })),
      fact_changes: [],
      target_basis: targetBasis
    };
    basisStatus = 'missing_full_round_fallback';
  } else {
    const targetBasis = await buildStep1RevisionBasisFromPack(targetPack, { lockId: parent.id, roundId: round });
    comparison = {
      structural_changed: false,
      revision_scope: null,
      affected_legs: [],
      section_changes: [],
      fact_changes: [],
      target_basis: targetBasis
    };
  }

  const materialChanged = comparison.affected_legs.length > 0;
  const revisionRequired = fingerprintChanged && materialChanged;
  const logicalLegs = logicalStep1RevisionLegs(targetPack);
  const parentLock = parseLockJson(parent);
  const affected = new Set(revisionRequired ? comparison.affected_legs : []);
  const revisionPack = {
    contract_version: ANALYSIS_STEP1_REVISION_PACK_CONTRACT,
    revision_version: ANALYSIS_STEP1_REVISION_VERSION,
    round_id: round,
    generated_at: targetPack.manifest.as_of,
    contains_current_market: false,
    revision_required: revisionRequired,
    revision_reason: !fingerprintChanged
      ? 'facts_fingerprint_unchanged'
      : (materialChanged ? 'material_pre_market_facts_changed' : 'fingerprint_changed_without_material_leg_change'),
    basis_status: basisStatus,
    parent_lock: {
      lock_id: parent.id,
      lock_hash: parent.lock_hash,
      pack_id: parent.pack_id,
      pack_as_of: parent.pack_as_of,
      facts_fingerprint: parent.facts_fingerprint
    },
    target_pack: {
      pack_id: targetPack.manifest.pack_id,
      as_of: targetPack.manifest.as_of,
      facts_fingerprint: targetPack.manifest.facts_fingerprint
    },
    fingerprint_changed: fingerprintChanged,
    revision_scope: revisionRequired ? comparison.revision_scope : null,
    affected_legs: revisionRequired ? comparison.affected_legs : [],
    fact_delta: {
      structural_changed: revisionRequired ? comparison.structural_changed : false,
      section_changes: revisionRequired ? comparison.section_changes : [],
      fact_changes: revisionRequired ? comparison.fact_changes : []
    },
    current_context_legs: logicalLegs.filter((leg) => affected.has(Number(leg.leg_number))),
    previous_analysis_legs: (parentLock.legs || []).filter((leg) => affected.has(Number(leg.leg_number)))
  };
  assertStep1MarketBlind(revisionPack, 'Step 1 revision pack');
  revisionPack.revision_pack_hash = await hashValue(revisionPack);
  return { parent, parentLock, targetPack, comparison, revisionPack };
}

export async function buildStep1RevisionPackV1(env, options = {}) {
  return (await prepareRevisionContext(env, options)).revisionPack;
}

function revisionRowMetadata(row, childRow, { reused = false } = {}) {
  if (!row) return null;
  let affectedLegs = [];
  try { affectedLegs = JSON.parse(row.affected_legs_json || '[]'); } catch { affectedLegs = []; }
  return {
    contract_version: ANALYSIS_STEP1_REVISION_CONTRACT,
    revision_id: row.id,
    round_id: row.game_round_id,
    parent_lock_id: row.parent_lock_id,
    child_lock_id: row.child_lock_id,
    parent_lock_hash: row.parent_lock_hash,
    child_lock_hash: row.child_lock_hash,
    revision_scope: row.revision_scope,
    affected_legs: affectedLegs,
    revision_pack_hash: row.revision_pack_hash,
    revision_hash: row.revision_hash,
    created_at: row.created_at,
    child_lock: rowMetadata(childRow),
    sealed: true,
    reused
  };
}

export async function importStep1RevisionV1(env, payload, { now = new Date().toISOString() } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const revisionId = requiredText(payload?.revision_id, 'revision_id', 160);
  const existing = await env.DB.prepare(`SELECT * FROM analysis_step1_lock_revisions WHERE id=? LIMIT 1`).bind(revisionId).first();
  if (existing) {
    const child = await getLockRow(env, existing.child_lock_id);
    const quickJson = stableFeatureJson(payload);
    if (existing.request_json !== quickJson) throw new Error('revision_id is already sealed with different content');
    return revisionRowMetadata(existing, child, { reused: true });
  }

  const roundId = requiredText(payload?.round_id, 'round_id');
  const parentLockId = requiredText(payload?.parent_lock_id, 'parent_lock_id', 160);
  const targetAsOf = timestamp(payload?.target_pack?.as_of, 'target_pack.as_of');
  const context = await prepareRevisionContext(env, { roundId, parentLockId, targetAsOf });
  const composed = await composeStep1RevisionChildLockV1({
    payload,
    revisionPack: context.revisionPack,
    parentLock: context.parentLock,
    targetPack: context.targetPack
  });
  if (await getLockRow(env, composed.childLock.lock_id)) throw new Error('child_lock_id already exists; create a new child lock id');

  const createdAt = timestamp(now, 'created_at');
  const childBasis = await buildStep1RevisionBasisFromPack(context.targetPack, { lockId: composed.childLock.lock_id, roundId });
  if (typeof env.DB.batch !== 'function') throw new Error('D1 batch support is required for atomic revision sealing');
  const statements = [
    env.DB.prepare(`
      INSERT INTO analysis_step1_locks (
        id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      composed.childLock.lock_id,roundId,ANALYSIS_STEP1_LOCK_CONTRACT,composed.childLock.pack.pack_id,
      composed.childLock.pack.as_of,composed.childLock.pack.facts_fingerprint,composed.childLock.provider,composed.childLock.model,
      composed.childLock.prompt_version,composed.childLockJson,composed.childLockHash,createdAt
    ),
    env.DB.prepare(`
      INSERT INTO analysis_step1_lock_revisions (
        id,game_round_id,parent_lock_id,child_lock_id,parent_lock_hash,child_lock_hash,
        parent_facts_fingerprint,child_facts_fingerprint,revision_scope,affected_legs_json,
        revision_pack_hash,request_json,revision_json,revision_hash,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      composed.normalizedRevision.revision_id,roundId,context.parent.id,composed.childLock.lock_id,
      context.parent.lock_hash,composed.childLockHash,context.parent.facts_fingerprint,composed.childLock.pack.facts_fingerprint,
      context.revisionPack.revision_scope,stableFeatureJson(context.revisionPack.affected_legs),context.revisionPack.revision_pack_hash,
      stableFeatureJson(payload),composed.revisionJson,composed.revisionHash,createdAt
    ),
    env.DB.prepare(`
      INSERT INTO analysis_step1_lock_revision_bases (
        lock_id,game_round_id,basis_version,pack_id,pack_as_of,facts_fingerprint,
        round_material_hash,leg_material_hashes_json,volatile_facts_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).bind(
      childBasis.lock_id,childBasis.round_id,childBasis.basis_version,childBasis.pack_id,childBasis.pack_as_of,
      childBasis.facts_fingerprint,childBasis.round_material_hash,stableFeatureJson(childBasis.leg_material_hashes),
      stableFeatureJson(childBasis.volatile_facts),createdAt
    )
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const raced = await env.DB.prepare(`SELECT * FROM analysis_step1_lock_revisions WHERE id=? LIMIT 1`).bind(revisionId).first();
    if (raced && raced.request_json === stableFeatureJson(payload) && raced.revision_hash === composed.revisionHash) {
      return revisionRowMetadata(raced, await getLockRow(env, raced.child_lock_id), { reused: true });
    }
    throw error;
  }
  const inserted = await env.DB.prepare(`SELECT * FROM analysis_step1_lock_revisions WHERE id=? LIMIT 1`).bind(revisionId).first();
  if (!inserted) throw new Error('sealed Step 1 revision could not be read after insert');
  return revisionRowMetadata(inserted, await getLockRow(env, inserted.child_lock_id));
}

export async function requireCurrentStep1LockV1(env, { roundId, lockId = null, asOf = null } = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const round = requiredText(roundId, 'round_id');
  const latest = await latestLockRow(env, round);
  if (!latest) throw new Error('a valid sealed Step 1 lock is required before current market export');
  const candidate = lockId ? await getLockRow(env, requiredText(lockId, 'lock_id', 160)) : latest;
  if (!candidate || candidate.game_round_id !== round) throw new Error('requested Step 1 lock does not belong to this round');
  if (candidate.id !== latest.id) throw new Error('requested Step 1 lock is stale; newest valid lock is required');
  if (await childRevisionRow(env, candidate.id)) throw new Error('requested Step 1 lock is stale because a child revision exists');

  const requestedAsOf = asOf == null ? new Date().toISOString() : timestamp(asOf, 'as_of');
  await assertAnalysisPackReplaySafe(env, round, requestedAsOf);
  const targetPack = await createPreMarketAnalysisPackV3(env, round, { asOf: requestedAsOf, generatedAt: requestedAsOf });
  const basis = basisFromRow(await getBasisRow(env, candidate.id));
  if (basis) {
    const comparison = await compareStep1RevisionBasis(basis, targetPack);
    if (comparison.affected_legs.length || comparison.structural_changed) {
      throw new Error('sealed Step 1 lock is stale because material pre-market facts changed; create a child revision first');
    }
  } else if (candidate.facts_fingerprint !== targetPack.manifest.facts_fingerprint) {
    throw new Error('sealed Step 1 lock cannot be proven current because its revision basis is unavailable and facts fingerprint changed');
  }
  return getStep1LockV1(env, { roundId: round, lockId: candidate.id });
}
