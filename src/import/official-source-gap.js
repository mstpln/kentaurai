export const OFFICIAL_SOURCE_GAP_QUALITY = 'captured_source_gap';
export const OFFICIAL_NORMALIZED_QUALITY = 'normalized_verified_subset';

function sourceMetadata(value) {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function recoverableMissingHorseIdentitySource(source) {
  if (source?.quality_status !== OFFICIAL_SOURCE_GAP_QUALITY) return false;
  return sourceMetadata(source.metadata_json).sourceGap?.code === 'missing_horse_identity';
}

export function officialSourceCanNormalize(source) {
  return source?.quality_status === 'captured_unmapped' || recoverableMissingHorseIdentitySource(source);
}

export async function markOfficialSourceNormalized(env, source) {
  const metadata = sourceMetadata(source?.metadata_json);
  if (recoverableMissingHorseIdentitySource(source)) {
    metadata.normalizationStatus = 'normalized_recovered';
    metadata.sourceGapRecovery = {
      code: 'nullable_official_participant_identity_v1',
      preservedSourceGap: true
    };
  }
  await env.DB.prepare(`
    UPDATE source_records
    SET quality_status = ?, metadata_json = ?
    WHERE id = ? AND source_type = 'official_provider'
  `).bind(OFFICIAL_NORMALIZED_QUALITY, JSON.stringify(metadata), source.id).run();
}

export function officialRaceSourceGap(error) {
  const message = String(error?.message || '');
  const match = /^official race start (\d+) is missing horse identity$/.exec(message);
  if (!match) return null;
  return {
    code: 'missing_horse_identity',
    startNumber: Number(match[1])
  };
}

export function officialGameSourceGap(error) {
  const message = String(error?.message || '');
  const match = /^races\[(\d+)\]\.starts\[(\d+)\]\.horse\.id is required$/.exec(message);
  if (!match) return null;
  return {
    code: 'missing_horse_identity',
    raceIndex: Number(match[1]),
    startIndex: Number(match[2])
  };
}

export async function markOfficialRaceSourceGap(env, sourceRecordId, gap) {
  if (!env.DB) throw new Error('DB is not configured');
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');
  if (!gap?.code) throw new Error('source gap code is required');

  const source = await env.DB.prepare(`
    SELECT metadata_json
    FROM source_records
    WHERE id = ? AND source_type = 'official_provider'
    LIMIT 1
  `).bind(id).first();
  if (!source) throw new Error('official source record was not found');

  const metadata = sourceMetadata(source.metadata_json);
  metadata.normalizationStatus = 'source_gap';
  metadata.sourceGap = { code: gap.code };
  for (const field of ['startNumber', 'raceIndex', 'startIndex']) {
    if (Number.isInteger(gap[field])) metadata.sourceGap[field] = gap[field];
  }

  const result = await env.DB.prepare(`
    UPDATE source_records
    SET quality_status = ?, metadata_json = ?
    WHERE id = ? AND source_type = 'official_provider'
  `).bind(OFFICIAL_SOURCE_GAP_QUALITY, JSON.stringify(metadata), id).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error('official source gap status was not persisted');
  return { sourceRecordId: id, qualityStatus: OFFICIAL_SOURCE_GAP_QUALITY, gap: metadata.sourceGap };
}
