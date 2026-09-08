const PERSON_RELATIONS = {
  trainers: 'trainer_id',
  drivers: 'driver_id'
};

function clampLimit(value, fallback = 20, max = 50) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function clampOffset(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 1_000_000);
}

export async function getLinkedHorses(env, type, id, options = {}) {
  const relationColumn = PERSON_RELATIONS[type];
  if (!relationColumn) throw new Error('linked horses are supported for trainers and drivers only');
  const entityId = String(id || '').trim();
  if (!entityId) throw new Error('entity id is required');
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);

  const count = await env.DB.prepare(`
    SELECT COUNT(*) AS total FROM (
      SELECT re.horse_id
      FROM race_entries re
      WHERE re.${relationColumn} = ?
      GROUP BY re.horse_id
    )
  `).bind(entityId).first();

  const { results } = await env.DB.prepare(`
    SELECT
      h.id,
      h.canonical_name AS name,
      COUNT(*) AS starts,
      MAX(r.race_date) AS latest_start_date
    FROM race_entries re
    JOIN horses h ON h.id = re.horse_id
    JOIN races r ON r.id = re.race_id
    WHERE re.${relationColumn} = ?
    GROUP BY h.id, h.canonical_name
    ORDER BY latest_start_date DESC, h.canonical_name COLLATE NOCASE ASC, h.id ASC
    LIMIT ? OFFSET ?
  `).bind(entityId, limit, offset).all();

  const total = Number(count?.total ?? 0);
  const items = results.map((row) => ({
    id: row.id,
    name: row.name,
    starts: Number(row.starts ?? 0),
    latestStartDate: row.latest_start_date
  }));
  return {
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total
  };
}
