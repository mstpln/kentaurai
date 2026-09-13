from pathlib import Path

p = Path('src/import/official-live-scheduled.js')
text = p.read_text()

old = "      const id = typeof game?.id === 'string' ? game.id.trim() : '';\n      if (!new RegExp(`^${gameType}_${date}_[A-Za-z0-9_-]+$`).test(id)) {"
new = "      const id = typeof game?.id === 'string' ? game.id.trim() : '';\n      const unpublishedScheduled = game?.status === 'scheduled' && !id && Array.isArray(game.races) && game.races.length === 0;\n      if (unpublishedScheduled) continue;\n      if (!new RegExp(`^${gameType}_${date}_[A-Za-z0-9_-]+$`).test(id)) {"
if old not in text:
    raise SystemExit('calendar publication guard insertion point not found')
text = text.replace(old, new, 1)

old = "WHERE sr.source_type = ? AND sr.quality_status = ?"
new = "WHERE sr.source_type = ? AND (sr.quality_status = ? OR (sr.quality_status = 'captured_source_gap' AND json_extract(sr.metadata_json, '$.sourceGap.code') = 'missing_horse_identity'))"
if text.count(old) != 2:
    raise SystemExit(f'expected two source selector clauses, found {text.count(old)}')
text = text.replace(old, new, 2)

old = """      AND (
        SELECT COUNT(*)
        FROM import_runs ir
        WHERE ir.source_type = ?
          AND ir.status = 'failed'
          AND json_extract(ir.metadata_json, '$.sourceRecordId') = sr.id
      ) < ?
    ORDER BY
"""
new = """      AND (
        sr.quality_status = 'captured_source_gap'
        OR (
          SELECT COUNT(*)
          FROM import_runs ir
          WHERE ir.source_type = ?
            AND ir.status = 'failed'
            AND json_extract(ir.metadata_json, '$.sourceRecordId') = sr.id
        ) < ?
      )
    ORDER BY
"""
if old not in text:
    raise SystemExit('pending failure-limit clause not found')
text = text.replace(old, new, 1)

old = "if (message && officialGameSourceGap(new Error(message))) {"
new = "if (message && /^races\\[\\d+\\]\\.starts\\[\\d+\\]\\.horse\\.id is required$/.test(message)) {"
if old not in text:
    raise SystemExit('legacy exhausted-source predicate not found')
text = text.replace(old, new, 1)
p.write_text(text)

print('final v109 scheduled-source edits applied')
