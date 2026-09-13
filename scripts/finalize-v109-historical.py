from pathlib import Path

chunked = Path('src/import/official-live-chunked.js')
chunked_text = chunked.read_text()
old = 'function personName(person) {'
new = 'export function personName(person) {'
if old not in chunked_text:
    raise SystemExit('personName export point not found')
chunked.write_text(chunked_text.replace(old, new, 1))

p = Path('src/import/official-historical-race.js')
text = p.read_text()

old = """  maybeText,
  recordObservation,
  startPosition,
  upsertHorse,
"""
new = """  maybeText,
  participantExternalId,
  personName,
  recordObservation,
  resolveRaceEntryId,
  startPosition,
  upsertHorse,
"""
if old not in text:
    raise SystemExit('historical import insertion point not found')
text = text.replace(old, new, 1)

old = """    if (start.horse?.id == null || !maybeText(start.horse?.name)) throw new Error(`official race start ${number} is missing horse identity`);
"""
new = """    if (!maybeText(start.id)) throw new Error(`official race start ${number} is missing source start identity`);
    if (!maybeText(start.horse?.name)) throw new Error(`official race start ${number} is missing horse name`);
"""
if old not in text:
    raise SystemExit('historical validator identity guard not found')
text = text.replace(old, new, 1)

start = text.index('async function mapHistoricalStart(')
end = text.index('\nexport async function normalizeCapturedOfficialRace', start)
old_block = text[start:end]
result_section = old_block[old_block.index('  const result = start.result'):]
mapper_prefix = r'''async function mapHistoricalStart(env, race, start, ctx) {
  const trainerName = personName(start.horse?.trainer);
  const driverName = personName(start.driver);
  const horseName = maybeText(start.horse?.name);
  const trainerId = await upsertPerson(env, 'trainer', start.horse?.trainer, ctx);
  const driverId = await upsertPerson(env, 'driver', start.driver, ctx);
  const horseId = await upsertHorse(env, start.horse, trainerId, ctx);
  const entryId = await resolveRaceEntryId(env, race.id, start, horseId);
  const pos = startPosition(race, start);
  const scratched = start.scratched === true;

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
      scratched = excluded.scratched,
      data_quality = excluded.data_quality,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    entryId, race.id, horseId, driverId, trainerId, start.id, horseName, driverName, trainerName,
    start.number, pos.lane, pos.tier, pos.handicapM, pos.actualDistance, Number(scratched), ENTRY_QUALITY
  ).run();

  await recordObservation(env, ctx.counts, 'race_entry', entryId, ctx.sourceRecordId, ctx.observedAt, {
    externalStartId: maybeText(start.id),
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
    scratched,
    scratchSemanticsVerified: true
  });
  await insertEquipment(env, entryId, start.horse, ctx);

'''
text = text[:start] + mapper_prefix + result_section + text[end:]
p.write_text(text)

print('historical participant identity edits applied')
