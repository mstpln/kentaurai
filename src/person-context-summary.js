import { placingStats, binaryStats, personEvidence, shrinkRate, shrinkDelta } from './person-context-stats.js';
import { PERSON_CONTEXT_DAY_MS } from './person-context-time.js';

export function selectWindow(rows, cutoffMs, days) {
  const lower = cutoffMs - days * PERSON_CONTEXT_DAY_MS;
  return rows.filter((row) => row.event_ms >= lower && row.event_ms < cutoffMs);
}

export function summarizeRows(rows, asOf, source, version) {
  const placing = placingStats(rows);
  const gallop = binaryStats(rows, 'gallop');
  const dq = binaryStats(rows, 'disqualified');
  return {
    starts: rows.length,
    placing_samples: placing.known,
    gallop_samples: gallop.known,
    disqualification_samples: dq.known,
    win_rate: personEvidence({ value: placing.winRate, source, known: placing.known, total: rows.length, asOf, version }),
    top3_rate: personEvidence({ value: placing.top3Rate, source, known: placing.known, total: rows.length, asOf, version }),
    gallop_rate: personEvidence({ value: gallop.rate, source, known: gallop.known, total: rows.length, asOf, version }),
    disqualification_rate: personEvidence({ value: dq.rate, source, known: dq.known, total: rows.length, asOf, version })
  };
}

export function buildWindows(rows, cutoff, role, version, windowsDays) {
  const baselineRows = selectWindow(rows, cutoff.ms, 365);
  const baseline = summarizeRows(baselineRows, cutoff.iso, `${role}_own_365d_history`, version);
  const baselinePlacing = placingStats(baselineRows);
  const baselineGallop = binaryStats(baselineRows, 'gallop');
  const windows = {};
  for (const days of windowsDays) {
    const selected = selectWindow(rows, cutoff.ms, days);
    const summary = summarizeRows(selected, cutoff.iso, `${role}_own_${days}d_history`, version);
    const placing = placingStats(selected);
    const gallop = binaryStats(selected, 'gallop');
    const winDelta = placing.winRate == null || baselinePlacing.winRate == null ? null : placing.winRate - baselinePlacing.winRate;
    const top3Delta = placing.top3Rate == null || baselinePlacing.top3Rate == null ? null : placing.top3Rate - baselinePlacing.top3Rate;
    const gallopDelta = gallop.rate == null || baselineGallop.rate == null ? null : gallop.rate - baselineGallop.rate;
    windows[String(days)] = {
      ...summary,
      win_rate_delta_vs_365d: personEvidence({ value: winDelta, source: `${role}_${days}d_vs_365d`, known: placing.known, total: selected.length, asOf: cutoff.iso, version }),
      top3_rate_delta_vs_365d: personEvidence({ value: top3Delta, source: `${role}_${days}d_vs_365d`, known: placing.known, total: selected.length, asOf: cutoff.iso, version }),
      gallop_rate_delta_vs_365d: personEvidence({ value: gallopDelta, source: `${role}_${days}d_vs_365d`, known: gallop.known, total: selected.length, asOf: cutoff.iso, version }),
      estimates: {
        shrunk_win_rate: shrinkRate(placing.winRate, placing.known, baselinePlacing.winRate, baselinePlacing.known),
        shrunk_top3_rate: shrinkRate(placing.top3Rate, placing.known, baselinePlacing.top3Rate, baselinePlacing.known),
        shrunk_gallop_rate: shrinkRate(gallop.rate, gallop.known, baselineGallop.rate, baselineGallop.known),
        shrunk_win_delta_vs_365d: shrinkDelta(winDelta, placing.known),
        shrunk_top3_delta_vs_365d: shrinkDelta(top3Delta, placing.known),
        shrunk_gallop_delta_vs_365d: shrinkDelta(gallopDelta, gallop.known)
      }
    };
  }
  return { baseline, windows };
}
