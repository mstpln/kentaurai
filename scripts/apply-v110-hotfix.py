from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing expected text in {path}: {old[:80]!r}')
    p.write_text(text.replace(old, new, 1))

# Live validator: a verified source start + horse name is valid even if permanent horse id is absent.
replace(
    'src/import/official-live.js',
    "  externalId(horse.id, `races[${raceIndex}].starts[${startIndex}].horse.id`);\n  requireText(horse.name, `races[${raceIndex}].starts[${startIndex}].horse.name`);",
    "  requireText(horse.name, `races[${raceIndex}].starts[${startIndex}].horse.name`);\n  if (start.scratched != null && typeof start.scratched !== 'boolean') {\n    throw new Error(`races[${raceIndex}].starts[${startIndex}].scratched must be boolean`);\n  }"
)

# Shared source-gap helpers are already committed on this branch. Wire them into both live paths.
replace(
    'src/import/official-live.js',
    "import { finishImportRun, startImportRun } from './common.js';",
    "import { finishImportRun, startImportRun } from './common.js';\nimport { markOfficialSourceNormalized, officialSourceCanNormalize } from './official-source-gap.js';"
)
replace(
    'src/import/official-live-chunked.js',
    "import { validateOfficialGamePayload } from './official-live.js';",
    "import { validateOfficialGamePayload } from './official-live.js';\nimport { markOfficialSourceNormalized, officialSourceCanNormalize } from './official-source-gap.js';"
)

# Treat non-positive participant identifiers as unavailable, never as canonical identities.
for path in ['src/import/official-live.js', 'src/import/official-live-chunked.js']:
    marker = "function personName(person) {" if path.endswith('official-live.js') else "function scaledHundredths(value, label, max = null) {"
    helper = "function participantExternalId(value) {\n  if (value == null) return null;\n  const text = String(value).trim();\n  if (!text) return null;\n  const numeric = Number(text);\n  if (Number.isFinite(numeric) && numeric <= 0) return null;\n  return text;\n}\n\n"
    if path.endswith('official-live.js'):
        replace(path, marker, helper + marker)
    else:
        replace(path, marker, "export " + helper + marker)

replace(
    'src/import/official-live.js',
    "  const name = personName(personValue);\n  if (!name || personValue.id == null) return null;\n  const ext = externalId(personValue.id, `${kind}.id`);",
    "  const name = personName(personValue);\n  const ext = participantExternalId(personValue.id);\n  if (!name || !ext) return null;"
)
replace(
    'src/import/official-live-chunked.js',
    "  if (!personValue || typeof personValue !== 'object' || personValue.id == null) return null;\n  const name = personName(personValue);\n  if (!name) return null;\n  const ext = String(personValue.id);",
    "  if (!personValue || typeof personValue !== 'object') return null;\n  const name = personName(personValue);\n  const ext = participantExternalId(personValue.id);\n  if (!name || !ext) return null;"
)

replace(
    'src/import/official-live.js',
    "  const ext = externalId(horse.id, 'horse.id');\n  const name = requireText(horse.name, 'horse.name');",
    "  const name = requireText(horse.name, 'horse.name');\n  const ext = participantExternalId(horse.id);\n  if (!ext) return null;"
)
replace(
    'src/import/official-live-chunked.js',
    "  const ext = String(horse.id);\n  const name = maybeText(horse.name);\n  if (!name) throw new Error('horse name is required');",
    "  const name = maybeText(horse.name);\n  if (!name) throw new Error('horse name is required');\n  const ext = participantExternalId(horse.id);\n  if (!ext) return null;"
)

# Stable race-entry resolution. Never adopt a legacy row on start number alone.
resolver = """async function resolveRaceEntryId(env, raceId, start, horseId) {
  const sourceStartId = String(start.id).trim();
  let existing = await env.DB.prepare('SELECT id FROM race_entries WHERE race_id = ? AND source_start_id = ? LIMIT 1')
    .bind(raceId, sourceStartId).first();
  if (!existing && horseId) {
    existing = await env.DB.prepare('SELECT id FROM race_entries WHERE race_id = ? AND horse_id = ? LIMIT 1')
      .bind(raceId, horseId).first();
  }
  if (!existing) {
    existing = await env.DB.prepare(`
      SELECT re.id
      FROM race_entries re
      LEFT JOIN horses h ON h.id = re.horse_id
      WHERE re.race_id = ?
        AND re.start_number = ?
        AND re.source_start_id IS NULL
        AND COALESCE(re.declared_horse_name, h.canonical_name) = ?
      LIMIT 1
    `).bind(raceId, start.number, String(start.horse?.name || '').trim()).first();
  }
  return existing?.id || stableId('entry', EXTERNAL_SOURCE, raceId, sourceStartId);
}

"""
replace('src/import/official-live.js', 'async function mapRace(env, game, race, legNumber, ctx) {', resolver + 'async function mapRace(env, game, race, legNumber, ctx) {')
replace('src/import/official-live-chunked.js', 'export function startPosition(race, start) {', 'export ' + resolver + 'export function startPosition(race, start) {')

# Replace the chunked one-start mapper with nullable identity + declared names + explicit scratch semantics.
p = Path('src/import/official-live-chunked.js')
text = p.read_text()
start = text.index('async function mapOneStart(')
end = text.index('\nfunction workItems(', start)
mapper = r'''async function mapOneStart(env, game, race, legNumber, start, ctx) {
  const horseName = maybeText(start.horse?.name);
  const driverName = personName(start.driver);
  const trainerName = personName(start.horse?.trainer);
  const trainerId = await upsertPerson(env, 'trainer', start.horse?.trainer, ctx);
  const driverId = await upsertPerson(env, 'driver', start.driver, ctx);
  const horseId = await upsertHorse(env, start.horse, trainerId, ctx);
  const raceEntryId = await resolveRaceEntryId(env, race.id, start, horseId);
  const pos = startPosition(race, start);
  const scratched = typeof start.scratched === 'boolean' ? Number(start.scratched) : null;
  const entryQuality = scratched == null ? ENTRY_QUALITY : 'official_declared_start_scratch_source_backed';

  await env.DB.prepare(`
    INSERT INTO race_entries
      (id, race_id, horse_id, driver_id, trainer_id, source_start_id, declared_horse_name,
       declared_driver_name, declared_trainer_name, start_number, actual_lane, start_tier,
       handicap_m, actual_start_distance_m, scratched, scratch_reason, data_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      horse_id = COALESCE(excluded.horse_id, race_entries.horse_id),
      driver_id = COALESCE(excluded.driver_id, race_entries.driver_id),
      trainer_id = COALESCE(excluded.trainer_id, race_entries.trainer_id),
      source_start_id = COALESCE(excluded.source_start_id, race_entries.source_start_id),
      declared_horse_name = COALESCE(excluded.declared_horse_name, race_entries.declared_horse_name),
      declared_driver_name = COALESCE(excluded.declared_driver_name, race_entries.declared_driver_name),
      declared_trainer_name = COALESCE(excluded.declared_trainer_name, race_entries.declared_trainer_name),
      start_number = excluded.start_number,
      actual_lane = excluded.actual_lane,
      start_tier = excluded.start_tier,
      handicap_m = excluded.handicap_m,
      actual_start_distance_m = excluded.actual_start_distance_m,
      scratched = COALESCE(excluded.scratched, race_entries.scratched),
      data_quality = CASE
        WHEN excluded.scratched IS NULL AND race_entries.data_quality = 'official_declared_start_scratch_source_backed'
          THEN race_entries.data_quality
        ELSE excluded.data_quality
      END,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    raceEntryId, race.id, horseId, driverId, trainerId, start.id, horseName, driverName, trainerName,
    start.number, pos.lane, pos.tier, pos.handicapM, pos.actualDistance, scratched, entryQuality
  ).run();

  await recordObservation(env, ctx.counts, 'race_entry', raceEntryId, ctx.sourceRecordId, ctx.observedAt, {
    externalStartId: start.id,
    raceExternalId: race.id,
    horseExternalId: participantExternalId(start.horse?.id),
    horseName,
    driverExternalId: participantExternalId(start.driver?.id),
    driverName,
    trainerExternalId: participantExternalId(start.horse?.trainer?.id),
    trainerName,
    startNumber: start.number,
    postPosition: finiteNumber(start.postPosition),
    actualStartDistanceM: pos.actualDistance,
    handicapM: pos.handicapM,
    startTier: pos.tier,
    scratched: scratched == null ? null : Boolean(scratched),
    scratchSemanticsVerified: scratched != null
  });

  await insertEquipment(env, raceEntryId, start.horse, ctx);
  const distributionRaw = finiteNumber(start.pools?.[ctx.gameType]?.betDistribution);
  if (distributionRaw != null) {
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO betting_snapshots
        (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank, source_record_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      stableId('bet', game.id, legNumber, raceEntryId, ctx.observedAt), game.id, legNumber, raceEntryId,
      ctx.observedAt, scaledHundredths(distributionRaw, `${ctx.gameType} betDistribution`, 10000),
      marketRank(race.starts, ctx.gameType, start), ctx.sourceRecordId
    ).run();
    ctx.counts.inserted += Number(result.meta?.changes ?? 0);
  }
  await insertOdds(env, raceEntryId, 'vinnare', start.pools?.vinnare?.odds, ctx);
  await insertOdds(env, raceEntryId, 'plats_min', start.pools?.plats?.minOdds, ctx);
  await insertOdds(env, raceEntryId, 'plats_max', start.pools?.plats?.maxOdds, ctx);
}
'''
p.write_text(text[:start] + mapper + text[end:])

# Source-gap snapshots are explicitly recoverable and retain their old provenance metadata.
replace(
    'src/import/official-live-chunked.js',
    'SELECT source_type, external_id, fetched_at, raw_object_key, quality_status',
    'SELECT source_type, external_id, fetched_at, raw_object_key, quality_status, metadata_json'
)
replace(
    'src/import/official-live-chunked.js',
    "  if (source.quality_status !== 'captured_unmapped') {\n    throw new Error(`source record has unsupported quality status: ${source.quality_status}`);\n  }",
    "  if (!officialSourceCanNormalize(source)) {\n    throw new Error(`source record has unsupported quality status: ${source.quality_status}`);\n  }"
)
replace(
    'src/import/official-live-chunked.js',
    "    await env.DB.prepare('UPDATE source_records SET quality_status = ? WHERE id = ?')\n      .bind(NORMALIZED_QUALITY, sourceRecordId).run();",
    "    await markOfficialSourceNormalized(env, { ...source, id: sourceRecordId });"
)

# Put old missing-horse gaps back into the automatic queue.
replace(
    'src/import/official-live-scheduled.js',
    "    WHERE sr.source_type = ? AND sr.quality_status = ?\n      AND (sr.external_id LIKE 'game:V85\\_%' ESCAPE '\\' OR sr.external_id LIKE 'game:V86\\_%' ESCAPE '\\')",
    "    WHERE sr.source_type = ?\n      AND (sr.quality_status = ? OR (sr.quality_status = 'captured_source_gap' AND json_extract(sr.metadata_json, '$.sourceGap.code') = 'missing_horse_identity'))\n      AND (sr.external_id LIKE 'game:V85\\_%' ESCAPE '\\' OR sr.external_id LIKE 'game:V86\\_%' ESCAPE '\\')"
)
# second occurrence
replace(
    'src/import/official-live-scheduled.js',
    "    WHERE sr.source_type = ? AND sr.quality_status = ?\n      AND (sr.external_id LIKE 'game:V85\\_%' ESCAPE '\\' OR sr.external_id LIKE 'game:V86\\_%' ESCAPE '\\')",
    "    WHERE sr.source_type = ?\n      AND (sr.quality_status = ? OR (sr.quality_status = 'captured_source_gap' AND json_extract(sr.metadata_json, '$.sourceGap.code') = 'missing_horse_identity'))\n      AND (sr.external_id LIKE 'game:V85\\_%' ESCAPE '\\' OR sr.external_id LIKE 'game:V86\\_%' ESCAPE '\\')"
)
replace(
    'src/import/official-live-scheduled.js',
    "      AND (\n        SELECT COUNT(*)\n        FROM import_runs ir\n        WHERE ir.source_type = ?\n          AND ir.status = 'failed'\n          AND json_extract(ir.metadata_json, '$.sourceRecordId') = sr.id\n      ) < ?\n    ORDER BY",
    "      AND (\n        sr.quality_status = 'captured_source_gap'\n        OR (\n          SELECT COUNT(*)\n          FROM import_runs ir\n          WHERE ir.source_type = ?\n            AND ir.status = 'failed'\n            AND json_extract(ir.metadata_json, '$.sourceRecordId') = sr.id\n        ) < ?\n      )\n    ORDER BY"
)

# Current analysis must retain starts whose permanent horse/person identity is unknown.
for path in ['src/analysis-exchange.js', 'src/analysis-workflow-v2.js']:
    p = Path(path)
    text = p.read_text()
    text = text.replace('JOIN horses h ON h.id = re.horse_id', 'LEFT JOIN horses h ON h.id = re.horse_id')
    text = text.replace('h.canonical_name AS horse_name', 'COALESCE(h.canonical_name, re.declared_horse_name) AS horse_name')
    text = text.replace('d.canonical_name AS driver_name', 'COALESCE(d.canonical_name, re.declared_driver_name) AS driver_name')
    text = text.replace('tr.canonical_name AS trainer_name', 'COALESCE(tr.canonical_name, re.declared_trainer_name) AS trainer_name')
    p.write_text(text)

print('v110 hotfix edits applied')
