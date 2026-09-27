export const DEFAULT_COST_SAFETY_THRESHOLDS = Object.freeze({
  rowsRead: 250000,
  rowsWritten: 25000,
  durationMs: 45000
});

const RAW_STATEMENT = Symbol('rawD1Statement');

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function addMeta(target, meta) {
  if (!meta || typeof meta !== 'object') return;
  target.rowsRead += finite(meta.rows_read);
  target.rowsWritten += finite(meta.rows_written ?? meta.changes);
  target.d1DurationMs += finite(meta.duration);
}

function wrapStatement(statement, metrics) {
  const wrapper = {
    bind(...values) {
      return wrapStatement(statement.bind(...values), metrics);
    }
  };
  wrapper[RAW_STATEMENT] = statement;
  for (const method of ['all', 'run', 'raw']) {
    if (typeof statement?.[method] !== 'function') continue;
    wrapper[method] = async (...args) => {
      const result = await statement[method](...args);
      addMeta(metrics, result?.meta);
      return result;
    };
  }
  if (typeof statement?.first === 'function' && typeof statement?.all === 'function') {
    wrapper.first = async (columnName) => {
      const result = await statement.all();
      addMeta(metrics, result?.meta);
      const row = result?.results?.[0] ?? null;
      if (row == null) return null;
      if (columnName === undefined) return row;
      if (!Object.prototype.hasOwnProperty.call(row, columnName)) {
        throw new Error(`D1_ERROR: column not found: ${columnName}`);
      }
      return row[columnName];
    };
  }
  return wrapper;
}

function instrumentDb(db, metrics) {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') return (sql) => wrapStatement(target.prepare(sql), metrics);
      if (property === 'batch' && typeof target.batch === 'function') {
        return async (statements) => {
          const result = await target.batch(statements.map((statement) => statement?.[RAW_STATEMENT] || statement));
          for (const item of result || []) addMeta(metrics, item?.meta);
          return result;
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export function exceedsCostSafety(metrics, thresholds = DEFAULT_COST_SAFETY_THRESHOLDS) {
  return metrics.rowsRead > thresholds.rowsRead
    || metrics.rowsWritten > thresholds.rowsWritten
    || metrics.durationMs > thresholds.durationMs;
}

export async function observeD1Operation(env, operation, action, thresholds = DEFAULT_COST_SAFETY_THRESHOLDS) {
  const started = Date.now();
  const metrics = { rowsRead: 0, rowsWritten: 0, d1DurationMs: 0, durationMs: 0 };
  const observedEnv = env?.DB ? { ...env, DB: instrumentDb(env.DB, metrics) } : env;
  try {
    const value = await action(observedEnv);
    metrics.durationMs = Date.now() - started;
    const safetyStop = exceedsCostSafety(metrics, thresholds);
    console.info(JSON.stringify({ event: 'd1_cost_operation', operation, ...metrics, safetyStop, ok: true }));
    return { value, metrics, safetyStop };
  } catch (error) {
    metrics.durationMs = Date.now() - started;
    const safetyStop = exceedsCostSafety(metrics, thresholds);
    console.info(JSON.stringify({ event: 'd1_cost_operation', operation, ...metrics, safetyStop, ok: false, errorClass: error?.name || 'Error' }));
    error.costSafety = { operation, metrics, safetyStop };
    throw error;
  }
}

export function createRunSafetyState(thresholds = DEFAULT_COST_SAFETY_THRESHOLDS) {
  return { stopped: false, reason: null, thresholds };
}

export function applyRunSafetyResult(state, operation, observed) {
  if (!state.stopped && observed?.safetyStop) {
    state.stopped = true;
    state.reason = `abnormal_cost:${operation}`;
  }
  return state;
}
