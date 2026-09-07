function normalizeGameType(value) {
  const type = String(value || '').toUpperCase();
  return type === 'V85' || type === 'V86' ? type : null;
}

function clampLimit(value, fallback = 50, max = 200) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function clampOffset(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 100000);
}

const SYSTEM_HISTORY_SELECT = `
  SELECT
    s.id,
    s.game_round_id,
    gr.game_type,
    gr.round_date,
    gr.status AS round_status,
    s.system_type,
    s.budget_sek,
    s.row_count,
    s.spike_count,
    s.created_at,
    (
      SELECT COUNT(DISTINCT gl.leg_number)
      FROM game_legs gl
      JOIN race_entries re ON re.race_id = gl.race_id
      JOIN race_results rr ON rr.race_entry_id = re.id AND rr.placing = 1
      WHERE gl.game_round_id = s.game_round_id
    ) AS settled_legs,
    (
      SELECT COUNT(DISTINCT ss.leg_number)
      FROM system_selections ss
      JOIN race_results rr ON rr.race_entry_id = ss.race_entry_id AND rr.placing = 1
      WHERE ss.system_id = s.id
    ) AS correct_legs,
    (
      SELECT COUNT(DISTINCT ss.leg_number)
      FROM system_selections ss
      JOIN race_results rr ON rr.race_entry_id = ss.race_entry_id AND rr.placing = 1
      WHERE ss.system_id = s.id AND ss.is_spike = 1
    ) AS correct_spikes,
    (
      SELECT COUNT(*)
      FROM post_race_reviews prr
      WHERE prr.system_id = s.id AND prr.error_type IS NOT NULL
    ) AS reviewed_errors,
    (
      SELECT COUNT(*)
      FROM learning_observations lo
      WHERE lo.game_round_id = s.game_round_id
    ) AS learning_count
  FROM systems s
  JOIN game_rounds gr ON gr.id = s.game_round_id
`;

function mapSystemRow(row) {
  const settledLegs = Number(row.settled_legs ?? 0);
  const correctLegs = Number(row.correct_legs ?? 0);
  const spikeCount = Number(row.spike_count ?? 0);
  const correctSpikes = Number(row.correct_spikes ?? 0);
  return {
    id: row.id,
    gameRoundId: row.game_round_id,
    gameType: row.game_type,
    roundDate: row.round_date,
    roundStatus: row.round_status,
    systemType: row.system_type,
    budgetSek: Number(row.budget_sek ?? 0),
    rowCount: Number(row.row_count ?? 0),
    spikeCount,
    createdAt: row.created_at,
    settledLegs,
    correctLegs: settledLegs ? correctLegs : null,
    wrongLegs: settledLegs ? settledLegs - correctLegs : null,
    correctSpikes: settledLegs ? correctSpikes : null,
    spikeHitRate: settledLegs && spikeCount ? correctSpikes / spikeCount : null,
    resultComplete: settledLegs === 8,
    reviewedErrors: Number(row.reviewed_errors ?? 0),
    learningCount: Number(row.learning_count ?? 0)
  };
}

export async function listSystemHistory(env, options = {}) {
  const gameType = normalizeGameType(options.gameType);
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const where = gameType ? 'WHERE gr.game_type = ?' : '';

  const statement = env.DB.prepare(`${SYSTEM_HISTORY_SELECT}\n${where}\nORDER BY gr.round_date DESC, s.created_at DESC, s.id ASC\nLIMIT ? OFFSET ?`);
  const countStatement = env.DB.prepare(`SELECT COUNT(*) AS total FROM systems s JOIN game_rounds gr ON gr.id = s.game_round_id ${where}`);

  const [{ results }, countRow] = gameType
    ? await Promise.all([
        statement.bind(gameType, limit, offset).all(),
        countStatement.bind(gameType).first()
      ])
    : await Promise.all([
        statement.bind(limit, offset).all(),
        countStatement.first()
      ]);

  const total = Number(countRow?.total ?? 0);
  return {
    gameType,
    items: results.map(mapSystemRow),
    total,
    limit,
    offset,
    hasMore: offset + results.length < total
  };
}

export async function getSystemHistorySummary(env) {
  const { results } = await env.DB.prepare(`${SYSTEM_HISTORY_SELECT}\nORDER BY gr.round_date DESC, s.created_at DESC, s.id ASC`).all();
  const systems = results.map(mapSystemRow);
  const settled = systems.filter((system) => system.resultComplete);

  function summarize(items) {
    const completed = items.filter((system) => system.resultComplete);
    const totalCorrect = completed.reduce((sum, system) => sum + Number(system.correctLegs ?? 0), 0);
    const totalSpikes = completed.reduce((sum, system) => sum + system.spikeCount, 0);
    const correctSpikes = completed.reduce((sum, system) => sum + Number(system.correctSpikes ?? 0), 0);
    return {
      systems: items.length,
      completedSystems: completed.length,
      fullHits: completed.filter((system) => system.correctLegs === 8).length,
      averageCorrect: completed.length ? totalCorrect / completed.length : null,
      spikeHitRate: totalSpikes ? correctSpikes / totalSpikes : null
    };
  }

  const { results: errorRows } = await env.DB.prepare(`
    SELECT error_type, COUNT(*) AS count
    FROM post_race_reviews
    WHERE error_type IS NOT NULL
    GROUP BY error_type
    ORDER BY count DESC, error_type ASC
  `).all();

  const { results: learningRows } = await env.DB.prepare(`
    SELECT lh.status, COUNT(*) AS count
    FROM learning_observations lo
    JOIN learning_hypotheses lh ON lh.id = lo.hypothesis_id
    GROUP BY lh.status
    ORDER BY lh.status ASC
  `).all();

  return {
    all: summarize(systems),
    v85: summarize(systems.filter((system) => system.gameType === 'V85')),
    v86: summarize(systems.filter((system) => system.gameType === 'V86')),
    completedSystemCount: settled.length,
    errorTypes: errorRows.map((row) => ({ type: row.error_type, count: Number(row.count ?? 0) })),
    learnings: learningRows.map((row) => ({ status: row.status, count: Number(row.count ?? 0) }))
  };
}
