import { randomId } from '../ids.js';

export async function startImportRun(env, sourceType, metadata = null) {
  const id = randomId('imp');
  const startedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO import_runs (id, source_type, started_at, status, metadata_json)
    VALUES (?, ?, ?, 'running', ?)
  `).bind(id, sourceType, startedAt, metadata ? JSON.stringify(metadata) : null).run();
  return { id, startedAt };
}

export async function finishImportRun(env, id, counts, error = null) {
  const status = error ? 'failed' : 'success';
  await env.DB.prepare(`
    UPDATE import_runs
    SET finished_at = ?, status = ?, inserted_count = ?, updated_count = ?, skipped_count = ?, error_count = ?, error_json = ?
    WHERE id = ?
  `).bind(
    new Date().toISOString(),
    status,
    counts.inserted ?? 0,
    counts.updated ?? 0,
    counts.skipped ?? 0,
    counts.errors ?? (error ? 1 : 0),
    error ? JSON.stringify({ message: error.message }) : null,
    id
  ).run();
}
