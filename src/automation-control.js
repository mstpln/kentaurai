const CONTROL_ID = 'automatic_workflows';

function requireDb(env) {
  if (!env?.DB) throw new Error('DB is not configured');
  return env.DB;
}

function normalizedRow(row) {
  if (!row) {
    return {
      enabled: true,
      updatedAt: null,
      updatedVia: 'default'
    };
  }
  return {
    enabled: Number(row.enabled) === 1,
    updatedAt: row.updated_at || null,
    updatedVia: row.updated_via || null
  };
}

export async function getAutomationControl(env) {
  const row = await requireDb(env).prepare(`
    SELECT enabled, updated_at, updated_via
    FROM automation_controls
    WHERE id = ?
    LIMIT 1
  `).bind(CONTROL_ID).first();
  return normalizedRow(row);
}

export async function setAutomationControl(env, enabled, { now = new Date(), via = 'app' } = {}) {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
  const updatedAt = now.toISOString();
  const updatedVia = String(via || 'app').slice(0, 40);
  await requireDb(env).prepare(`
    INSERT INTO automation_controls (id, enabled, updated_at, updated_via)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at,
      updated_via = excluded.updated_via
  `).bind(CONTROL_ID, enabled ? 1 : 0, updatedAt, updatedVia).run();
  return { enabled, updatedAt, updatedVia };
}

export async function automaticWorkflowGate(env) {
  try {
    const control = await getAutomationControl(env);
    return {
      ...control,
      allowed: control.enabled,
      reason: control.enabled ? null : 'automation_paused'
    };
  } catch (error) {
    console.error(JSON.stringify({
      event: 'automation_control_read_failed',
      errorClass: error?.name || 'Error'
    }));
    return {
      enabled: false,
      updatedAt: null,
      updatedVia: null,
      allowed: false,
      reason: 'automation_control_unavailable'
    };
  }
}

export function nextAutomaticRunAt(nowValue = new Date()) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (!Number.isFinite(now.getTime())) throw new Error('now must be a valid date');
  const candidate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    5,
    15,
    0,
    0
  ));
  if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate.toISOString();
}
