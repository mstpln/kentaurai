import { assertObject, optionalIsoDate, optionalNumber, requireString } from '../validation.js';
import { stableId } from '../ids.js';
import { startImportRun, finishImportRun } from './common.js';
import { archiveRawPayload } from '../raw.js';

const ALLOWED_FACT_OR_OPINION = new Set(['fact', 'opinion', 'mixed']);

export function validateEditorialImport(payload) {
  assertObject(payload, 'payload');
  const source = assertObject(payload.source, 'source');
  requireString(source.name, 'source.name');
  requireString(source.export_id, 'source.export_id');
  const exportedAt = optionalIsoDate(source.exported_at, 'source.exported_at');
  if (!exportedAt) throw new Error('source.exported_at is required for idempotent imports');
  if (!Array.isArray(payload.items)) throw new Error('items must be an array');

  return payload.items.map((item, i) => {
    assertObject(item, `items[${i}]`);
    const horseName = requireString(item.horse_name, `items[${i}].horse_name`);
    const raceExternalId = item.race_external_id
      ? requireString(item.race_external_id, `items[${i}].race_external_id`)
      : null;
    const speakerName = item.speaker_name
      ? requireString(item.speaker_name, `items[${i}].speaker_name`)
      : null;
    const publishedAt = optionalIsoDate(item.published_at, `items[${i}].published_at`);

    if (!Array.isArray(item.signals) || item.signals.length === 0) {
      throw new Error(`items[${i}].signals must be a non-empty array`);
    }

    const signals = item.signals.map((signal, j) => {
      assertObject(signal, `items[${i}].signals[${j}]`);
      const factOrOpinion = requireString(
        signal.fact_or_opinion,
        `items[${i}].signals[${j}].fact_or_opinion`
      );
      if (!ALLOWED_FACT_OR_OPINION.has(factOrOpinion)) {
        throw new Error(`Unsupported fact_or_opinion: ${factOrOpinion}`);
      }

      const confidence = optionalNumber(
        signal.confidence,
        `items[${i}].signals[${j}].confidence`
      );
      if (confidence != null && (confidence < 0 || confidence > 1)) {
        throw new Error('confidence must be 0..1');
      }

      const strength = optionalNumber(signal.strength, `items[${i}].signals[${j}].strength`);
      if (strength != null && (strength < 0 || strength > 1)) {
        throw new Error('strength must be 0..1');
      }

      return {
        type: requireString(signal.type, `items[${i}].signals[${j}].type`),
        value: signal.value == null ? null : String(signal.value),
        polarity: signal.polarity == null ? null : String(signal.polarity),
        strength,
        factOrOpinion,
        confidence,
        evidenceExcerpt:
          signal.evidence_excerpt == null ? null : String(signal.evidence_excerpt).slice(0, 400)
      };
    });

    return {
      sourceIndex: i,
      horseName,
      raceExternalId,
      speakerName,
      speakerRole: item.speaker_role == null ? null : String(item.speaker_role),
      publishedAt,
      sourceUrl: item.source_url == null ? null : String(item.source_url),
      summary: item.summary == null ? null : String(item.summary),
      signals
    };
  });
}

async function resolveEditorialTarget(env, raceExternalId, horseName) {
  if (raceExternalId) {
    const { results } = await env.DB.prepare(`
      SELECT h.id AS horse_id, re.id AS race_entry_id
      FROM race_external_ids rx
      JOIN race_entries re ON re.race_id = rx.race_id
      JOIN horses h ON h.id = re.horse_id
      WHERE rx.external_id = ? AND lower(h.canonical_name) = lower(?)
      LIMIT 2
    `).bind(raceExternalId, horseName).all();

    if (results.length === 1) {
      return { horseId: results[0].horse_id, raceEntryId: results[0].race_entry_id, reason: null };
    }
    if (results.length > 1) return { horseId: null, raceEntryId: null, reason: 'ambiguous_race_entry' };
    return { horseId: null, raceEntryId: null, reason: 'race_entry_not_found' };
  }

  const { results } = await env.DB.prepare(`
    SELECT id
    FROM horses
    WHERE lower(canonical_name) = lower(?)
    LIMIT 2
  `).bind(horseName).all();

  if (results.length === 1) return { horseId: results[0].id, raceEntryId: null, reason: null };
  if (results.length > 1) return { horseId: null, raceEntryId: null, reason: 'ambiguous_horse_name' };
  return { horseId: null, raceEntryId: null, reason: 'horse_not_found' };
}

export async function importEditorial(env, payload) {
  const items = validateEditorialImport(payload);
  const run = await startImportRun(env, 'editorial_manual', { itemCount: items.length });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    const raw = await archiveRawPayload(env, {
      sourceType: 'editorial_manual',
      externalId: payload.source.export_id,
      sourceUrl: payload.source.url || null,
      fetchedAt: payload.source.exported_at,
      payload,
      qualityStatus: 'manual_structured',
      rightsStatus: 'structured_only',
      metadata: { sourceName: payload.source.name }
    });

    const unresolved = [];
    for (const item of items) {
      const target = await resolveEditorialTarget(env, item.raceExternalId, item.horseName);
      if (!target.horseId) {
        unresolved.push({
          horse_name: item.horseName,
          race_external_id: item.raceExternalId,
          reason: target.reason
        });
        counts.skipped += 1;
        continue;
      }

      const editorialItemId = stableId(
        'edi',
        raw.sourceRecordId,
        item.sourceIndex,
        item.raceExternalId || 'no-race',
        item.horseName
      );

      const inserted = await env.DB.prepare(`
        INSERT OR IGNORE INTO editorial_items
          (id, race_entry_id, horse_id, speaker_name, speaker_role, published_at,
           source_name, source_url, summary_text, rights_status, source_record_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'structured_only', ?)
      `).bind(
        editorialItemId,
        target.raceEntryId,
        target.horseId,
        item.speakerName,
        item.speakerRole,
        item.publishedAt,
        payload.source.name,
        item.sourceUrl,
        item.summary,
        raw.sourceRecordId
      ).run();

      for (const [signalIndex, signal] of item.signals.entries()) {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO editorial_signals
            (id, editorial_item_id, signal_type, value_text, polarity, strength,
             fact_or_opinion, confidence, evidence_excerpt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          stableId('sig', editorialItemId, signalIndex, signal.type),
          editorialItemId,
          signal.type,
          signal.value,
          signal.polarity,
          signal.strength,
          signal.factOrOpinion,
          signal.confidence,
          signal.evidenceExcerpt
        ).run();
      }

      const changes = inserted?.meta?.changes;
      if (typeof changes === 'number') counts.inserted += changes;
      else if (!raw.reused) counts.inserted += 1;
    }

    await finishImportRun(env, run.id, counts);
    return { importRunId: run.id, counts, unresolved, reusedRawSnapshot: raw.reused };
  } catch (error) {
    counts.errors += 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
