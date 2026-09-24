export const GAME_FINAL_RESULT_VERSION = 'game-final-result-v1';

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function moneyFromHundredths(value) {
  const raw = finiteNumber(value);
  if (raw == null || raw < 0) return null;
  return Math.round((raw / 100) * 100) / 100;
}

function gameTypeFromId(value) {
  const id = String(value || '').trim();
  const type = id.split('_', 1)[0].toUpperCase();
  return type === 'V85' || type === 'V86' ? type : null;
}

function payoutRows(pool) {
  const value = pool?.result?.payouts;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value)
    .map(([level, item]) => {
      const rightLevel = Number(level);
      if (!Number.isInteger(rightLevel) || rightLevel < 1) return null;
      const record = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      const payoutRaw = finiteNumber(record.payout);
      const systems = finiteNumber(record.systems);
      return {
        level:rightLevel,
        payoutRaw:payoutRaw == null ? null : payoutRaw,
        payoutSek:moneyFromHundredths(payoutRaw),
        systems:systems == null ? null : Math.max(0, Math.trunc(systems)),
        jackpot:record.jackpot === true
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.level - a.level);
}

export function parseFinalGameResultPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('official final game payload must be an object');
  const gameRoundId = String(payload.id || '').trim();
  const gameType = gameTypeFromId(gameRoundId);
  if (!gameRoundId || !gameType) throw new Error('official final game payload must identify a V85/V86 game');
  const status = String(payload.status || '').trim().toLowerCase();
  if (status !== 'results') return { ready:false, gameRoundId, gameType, status:status || null };

  const pool = payload.pools?.[gameType];
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) throw new Error(`official final game payload is missing pools.${gameType}`);
  const payouts = payoutRows(pool);
  if (!payouts.length) throw new Error('official final game payload is missing result payouts');

  const highestLevel = payouts.reduce((max, row) => Math.max(max, row.level), 0);
  const highest = payouts.find((row) => row.level === highestLevel) || null;
  const turnoverRaw = finiteNumber(pool.turnover);
  const systemCountRaw = finiteNumber(pool.systemCount);

  return {
    ready:true,
    version:GAME_FINAL_RESULT_VERSION,
    gameRoundId,
    gameType,
    status:'results',
    turnoverRaw:turnoverRaw == null ? null : Math.max(0, Math.trunc(turnoverRaw)),
    turnoverSek:moneyFromHundredths(turnoverRaw),
    systemCount:systemCountRaw == null ? null : Math.max(0, Math.trunc(systemCountRaw)),
    payouts,
    highestPayoutLevel:highestLevel || null,
    highestPayoutRaw:highest?.payoutRaw ?? null,
    highestPayoutSek:highest?.payoutSek ?? null
  };
}

export async function persistFinalGameResult(env, payload, { sourceRecordId, capturedAt } = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const sourceId = String(sourceRecordId || '').trim();
  const observedAt = String(capturedAt || '').trim();
  if (!sourceId) throw new Error('sourceRecordId is required');
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) throw new Error('capturedAt must be an ISO timestamp');

  const parsed = parseFinalGameResultPayload(payload);
  if (!parsed.ready) return parsed;

  const source = await env.DB.prepare(`
    SELECT source_type, external_id
    FROM source_records
    WHERE id=? LIMIT 1
  `).bind(sourceId).first();
  if (!source || source.source_type !== 'official_provider' || source.external_id !== `game:${parsed.gameRoundId}`) {
    throw new Error('final game source record does not match the official game payload');
  }

  const round = await env.DB.prepare('SELECT game_type FROM game_rounds WHERE id=? LIMIT 1').bind(parsed.gameRoundId).first();
  if (!round || round.game_type !== parsed.gameType) throw new Error('final game payload does not match the stored game round');

  const payoutsJson = JSON.stringify(Object.fromEntries(parsed.payouts.map((row) => [
    String(row.level),
    { payoutRaw:row.payoutRaw, payoutSek:row.payoutSek, systems:row.systems, jackpot:row.jackpot }
  ])));

  await env.DB.prepare(`
    INSERT INTO game_round_final_results
      (game_round_id,game_type,source_record_id,captured_at,status,turnover_raw,turnover_sek,
       system_count,payouts_json,highest_payout_level,highest_payout_raw,highest_payout_sek)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(game_round_id) DO UPDATE SET
      game_type=excluded.game_type,
      source_record_id=excluded.source_record_id,
      captured_at=excluded.captured_at,
      status=excluded.status,
      turnover_raw=excluded.turnover_raw,
      turnover_sek=excluded.turnover_sek,
      system_count=excluded.system_count,
      payouts_json=excluded.payouts_json,
      highest_payout_level=excluded.highest_payout_level,
      highest_payout_raw=excluded.highest_payout_raw,
      highest_payout_sek=excluded.highest_payout_sek,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    parsed.gameRoundId, parsed.gameType, sourceId, new Date(Date.parse(observedAt)).toISOString(), parsed.status,
    parsed.turnoverRaw, parsed.turnoverSek, parsed.systemCount, payoutsJson,
    parsed.highestPayoutLevel, parsed.highestPayoutRaw, parsed.highestPayoutSek
  ).run();

  await env.DB.prepare(`
    UPDATE game_rounds
    SET status='results',
        turnover_sek=COALESCE(?,turnover_sek),
        payout_json=?,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(parsed.turnoverSek, payoutsJson, parsed.gameRoundId).run();

  return { ...parsed, sourceRecordId:sourceId, capturedAt:new Date(Date.parse(observedAt)).toISOString(), payoutsJson };
}

export async function getFinalGameResult(env, roundId) {
  if (!env.DB) throw new Error('DB is not configured');
  const id = String(roundId || '').trim();
  if (!id) return null;
  const row = await env.DB.prepare(`
    SELECT game_round_id,game_type,source_record_id,captured_at,status,turnover_raw,turnover_sek,
           system_count,payouts_json,highest_payout_level,highest_payout_raw,highest_payout_sek
    FROM game_round_final_results
    WHERE game_round_id=? LIMIT 1
  `).bind(id).first();
  if (!row) return null;
  let payouts = {};
  try { payouts = JSON.parse(row.payouts_json || '{}'); } catch {}
  return {
    gameRoundId:row.game_round_id,
    gameType:row.game_type,
    sourceRecordId:row.source_record_id,
    capturedAt:row.captured_at,
    status:row.status,
    turnoverRaw:row.turnover_raw == null ? null : Number(row.turnover_raw),
    turnoverSek:row.turnover_sek == null ? null : Number(row.turnover_sek),
    systemCount:row.system_count == null ? null : Number(row.system_count),
    payouts,
    highestPayoutLevel:row.highest_payout_level == null ? null : Number(row.highest_payout_level),
    highestPayoutRaw:row.highest_payout_raw == null ? null : Number(row.highest_payout_raw),
    highestPayoutSek:row.highest_payout_sek == null ? null : Number(row.highest_payout_sek)
  };
}
