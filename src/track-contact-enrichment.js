const FACT_COLUMNS = Object.freeze({
  street_address: 'street_address',
  postal_code: 'postal_code',
  website_url: 'website_url'
});

const SOURCE_TYPES = new Set(['official_track', 'official_sport', 'secondary']);

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function httpsUrl(value, label) {
  const raw = text(value);
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label} must be a valid HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label} must be a valid HTTPS URL`);
  return url.toString();
}

function verifiedAt(value) {
  const raw = text(value);
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) throw new Error('verified_at must be an ISO date/time');
  return date.toISOString();
}

async function digestId(parts) {
  const bytes = new TextEncoder().encode(parts.join('\u001f'));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `track-contact-${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function sourceFor(item, kind) {
  const source = item?.[`${kind}_source`];
  if (!source || typeof source !== 'object') throw new Error(`${kind}_source is required`);
  const sourceUrl = httpsUrl(source.url, `${kind}_source.url`);
  const sourceType = text(source.type);
  if (!sourceUrl || !SOURCE_TYPES.has(sourceType)) throw new Error(`${kind}_source.type is unsupported`);
  return { sourceUrl, sourceType };
}

function factsForItem(item) {
  const facts = [];
  const street = text(item.street_address);
  const postal = text(item.postal_code);
  const website = item.website_url == null ? null : httpsUrl(item.website_url, 'website_url');
  if (street || postal) {
    const source = sourceFor(item, 'address');
    if (street) facts.push({ type: 'street_address', value: street, ...source });
    if (postal) facts.push({ type: 'postal_code', value: postal, ...source });
  }
  if (website) facts.push({ type: 'website_url', value: website, ...sourceFor(item, 'website') });
  if (!facts.length) throw new Error('at least one track contact fact is required');
  return facts;
}

async function recordObservation(env, { trackId, fact, at, status }) {
  const id = await digestId([trackId, fact.type, fact.value, fact.sourceUrl]);
  await env.DB.prepare(`
    INSERT INTO track_contact_fact_observations (
      id, track_id, fact_type, fact_value, source_url, source_type,
      first_verified_at, last_verified_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(track_id, fact_type, fact_value, source_url) DO UPDATE SET
      source_type = excluded.source_type,
      last_verified_at = excluded.last_verified_at,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `).bind(id, trackId, fact.type, fact.value, fact.sourceUrl, fact.sourceType, at, at, status).run();
}

export async function listTrackContactTargets(env) {
  if (!env.DB) throw new Error('DB is not configured');
  const { results } = await env.DB.prepare(`
    SELECT id, canonical_name AS name, city, country_code,
           street_address, postal_code, website_url
    FROM tracks
    ORDER BY canonical_name COLLATE NOCASE, id
  `).all();
  return { items: results || [], total: (results || []).length };
}

export async function applyTrackContactEnrichment(env, payload) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!payload || !Array.isArray(payload.tracks) || payload.tracks.length < 1 || payload.tracks.length > 100) {
    throw new Error('tracks must contain between 1 and 100 items');
  }

  const summary = { tracks: 0, verifiedFacts: 0, unchangedFacts: 0, conflicts: 0, results: [] };
  for (const raw of payload.tracks) {
    const trackId = text(raw?.track_id);
    if (!trackId) throw new Error('track_id is required');
    const track = await env.DB.prepare(`
      SELECT id, canonical_name, street_address, postal_code, website_url
      FROM tracks WHERE id = ? LIMIT 1
    `).bind(trackId).first();
    if (!track) throw new Error(`unknown track_id: ${trackId}`);
    const expectedName = text(raw.canonical_name);
    if (expectedName && expectedName !== track.canonical_name) throw new Error(`canonical_name mismatch for track_id: ${trackId}`);

    const at = verifiedAt(raw.verified_at);
    const facts = factsForItem(raw);
    const result = { trackId, name: track.canonical_name, verifiedFacts: 0, unchangedFacts: 0, conflicts: 0 };

    for (const fact of facts) {
      const column = FACT_COLUMNS[fact.type];
      const current = text(track[column]);
      if (current && current !== fact.value) {
        await recordObservation(env, { trackId, fact, at, status: 'conflict' });
        result.conflicts += 1;
        summary.conflicts += 1;
        continue;
      }

      await recordObservation(env, { trackId, fact, at, status: 'verified' });
      if (current === fact.value) {
        result.unchangedFacts += 1;
        summary.unchangedFacts += 1;
      } else {
        await env.DB.prepare(`UPDATE tracks SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(fact.value, trackId).run();
        track[column] = fact.value;
        result.verifiedFacts += 1;
        summary.verifiedFacts += 1;
      }
    }

    summary.tracks += 1;
    summary.results.push(result);
  }
  return summary;
}
