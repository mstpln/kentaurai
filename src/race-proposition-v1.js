import { stableId } from './ids.js';

export const RACE_PROPOSITION_PARSER_VERSION = 'kentaurai-race-proposition-v1';

const EMPTY_FACTS = Object.freeze({
  age_min_years: null,
  age_max_years: null,
  sex_restriction: null,
  earnings_min_sek: null,
  earnings_max_sek: null,
  is_final: null,
  is_qualifier: null,
  is_heat: null,
  heat_number: null,
  is_lane_ladder: null,
  is_amateur: null,
  is_apprentice: null,
  is_young_horse: null,
  has_handicap_condition: null,
  handicap_step_m: null
});

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function amount(text) {
  const digits = text.replace(/[.\s]/g, '');
  const value = Number(digits);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function emptyFacts() { return { ...EMPTY_FACTS }; }

function matchAge(text) {
  let m = text.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*[- ]?år(?:iga|ige)?\b/i);
  if (m) return { age_min_years: Number(m[1]), age_max_years: Number(m[2]), pattern: 'age_range' };
  m = text.match(/\b(\d{1,2})\s*[- ]?år(?:iga|ige)?\s+och\s+äldre\b/i) || text.match(/\b(\d{1,2})\s*[- ]?år(?:ige)?\s+og\s+eldre\b/i);
  if (m) return { age_min_years: Number(m[1]), age_max_years: null, pattern: 'age_min' };
  m = text.match(/\b(?:högst|max)\s+(\d{1,2})\s*[- ]?år(?:iga|ige)?\b/i) || text.match(/\b(?:høyest|maks)\s+(\d{1,2})\s*[- ]?år(?:ige)?\b/i);
  if (m) return { age_min_years: null, age_max_years: Number(m[1]), pattern: 'age_max' };
  m = text.match(/\b(\d{1,2})\s*[- ]?år(?:iga|ige)?\b/i);
  if (m) return { age_min_years: Number(m[1]), age_max_years: Number(m[1]), pattern: 'age_exact' };
  return null;
}

function matchSex(text) {
  if (/\b(?:ston|stolopp|hopper|hoppeløp)\b/i.test(text)) return { sex_restriction: 'mares_only', pattern: 'sex_mares' };
  if (/\b(?:hingstar\s+och\s+valacker|hingster\s+og\s+vallaker)\b/i.test(text)) return { sex_restriction: 'stallions_and_geldings', pattern: 'sex_stallions_geldings' };
  return null;
}

function matchEarnings(text) {
  let m = text.match(/\b(?:högst|højst|max)\s+([0-9][0-9. ]*)\s*(?:kr|sek|nok)\b/i) || text.match(/\b(?:høyest|maks)\s+([0-9][0-9. ]*)\s*(?:kr|nok)\b/i);
  if (m) return { earnings_min_sek: null, earnings_max_sek: amount(m[1]), pattern: 'earnings_max' };
  m = text.match(/\b(?:lägst|minst)\s+([0-9][0-9. ]*)\s*(?:kr|sek|nok)\b/i) || text.match(/\b(?:minimum|minst)\s+([0-9][0-9. ]*)\s*(?:kr|nok)\b/i);
  if (m) return { earnings_min_sek: amount(m[1]), earnings_max_sek: null, pattern: 'earnings_min' };
  m = text.match(/\b([0-9][0-9. ]*)\s*[-–]\s*([0-9][0-9. ]*)\s*(?:kr|sek|nok)\b/i);
  if (m) return { earnings_min_sek: amount(m[1]), earnings_max_sek: amount(m[2]), pattern: 'earnings_range' };
  return null;
}

function matchFlags(text) {
  const out = [];
  if (/\bfinal(?:en)?\b/i.test(text)) out.push({ is_final: true, pattern: 'final' });
  if (/\b(?:försök|forsøk|kval(?:ificering|ifisering)?)\b/i.test(text)) out.push({ is_qualifier: true, pattern: 'qualifier' });
  const heat = text.match(/\bheat(?:\s+(\d{1,2}))?\b/i);
  if (heat) out.push({ is_heat: true, heat_number: heat[1] ? Number(heat[1]) : null, pattern: 'heat' });
  if (/\b(?:spårtrappa|sportrapp)\b/i.test(text)) out.push({ is_lane_ladder: true, pattern: 'lane_ladder' });
  if (/\b(?:amatör(?:lopp)?|amatør(?:løp)?)\b/i.test(text)) out.push({ is_amateur: true, pattern: 'amateur' });
  if (/\b(?:lärling(?:slopp)?|lærling(?:løp)?)\b/i.test(text)) out.push({ is_apprentice: true, pattern: 'apprentice' });
  if (/\b(?:unghäst(?:lopp)?|unghest(?:løp)?)\b/i.test(text)) out.push({ is_young_horse: true, pattern: 'young_horse' });
  const handicap = text.match(/\b(?:tillägg|tillegg)(?:\s+(\d{1,3})\s*m)?\b/i);
  if (handicap) out.push({ has_handicap_condition: true, handicap_step_m: handicap[1] ? Number(handicap[1]) : null, pattern: 'handicap' });
  return out;
}

function hasSupportedKeyword(text) {
  return /(?:år|final|försök|forsøk|kval|heat|spårtrappa|sportrapp|amatör|amatør|lärling|lærling|unghäst|unghest|tillägg|tillegg|ston|stolopp|hopper|hingstar|hingster|valacker|vallaker|kr|sek|nok)/i.test(text);
}

function hasUnsafeNegation(text) {
  return /\b(?:inte|ej|icke|utan|ikke|unntatt|förutom|förutom|exklusive)\b/i.test(text) && hasSupportedKeyword(text);
}

function assignFacts(facts, candidate, conflicts) {
  for (const [key, value] of Object.entries(candidate)) {
    if (key === 'pattern' || value == null) continue;
    if (facts[key] != null && facts[key] !== value) {
      facts[key] = null;
      conflicts.add(key);
    } else if (!conflicts.has(key)) {
      facts[key] = value;
    }
  }
}

function rawFragment(value) {
  if (typeof value === 'string') return normalizeText(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function parseRacePropositionTerms(terms) {
  const rawTerms = terms == null ? [] : Array.isArray(terms) ? terms : [terms];
  const facts = emptyFacts();
  const matchedPatterns = [];
  const unparsedFragments = [];
  const ambiguousFragments = [];
  const conflicts = new Set();

  for (const raw of rawTerms) {
    const text = rawFragment(raw);
    if (!text) continue;
    if (typeof raw !== 'string') {
      unparsedFragments.push(text);
      continue;
    }
    if (hasUnsafeNegation(text)) {
      ambiguousFragments.push(text);
      continue;
    }

    const candidates = [matchAge(text), matchSex(text), matchEarnings(text), ...matchFlags(text)].filter(Boolean);
    if (!candidates.length) {
      unparsedFragments.push(text);
      continue;
    }
    for (const candidate of candidates) {
      assignFacts(facts, candidate, conflicts);
      matchedPatterns.push({ fragment: text, pattern: candidate.pattern });
    }
  }

  if (conflicts.size) {
    ambiguousFragments.push(`conflicting structured fields: ${[...conflicts].sort().join(', ')}`);
  }

  let parseStatus = 'no_terms';
  if (ambiguousFragments.length) parseStatus = 'ambiguous';
  else if (matchedPatterns.length && unparsedFragments.length) parseStatus = 'partial';
  else if (matchedPatterns.length) parseStatus = 'parsed';
  else if (unparsedFragments.length) parseStatus = 'unparsed';

  return Object.freeze({
    parserVersion: RACE_PROPOSITION_PARSER_VERSION,
    parseStatus,
    rawTerms,
    facts: Object.freeze(facts),
    matchedPatterns: Object.freeze(matchedPatterns),
    unparsedFragments: Object.freeze(unparsedFragments),
    ambiguousFragments: Object.freeze(ambiguousFragments)
  });
}

function requireInstant(value, label) {
  const text = String(value ?? '').trim();
  const ms = Date.parse(text);
  if (!text || !Number.isFinite(ms)) throw new Error(`${label} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

export async function storeRacePropositionFromObservation(env, observationId) {
  if (!env.DB) throw new Error('DB is not configured');
  const id = String(observationId ?? '').trim();
  if (!id) throw new Error('observationId is required');
  const row = await env.DB.prepare(`
    SELECT o.id, o.entity_id, o.source_record_id, o.observed_at, o.fields_json, o.quality_status, s.source_type
    FROM normalized_observations o
    JOIN source_records s ON s.id = o.source_record_id
    WHERE o.id = ? AND o.entity_type = 'race'
    LIMIT 1
  `).bind(id).first();
  if (!row || row.source_type !== 'official_provider' || row.quality_status !== 'normalized_verified_subset') {
    throw new Error('observation is not a verified official race observation');
  }
  let fields;
  try { fields = JSON.parse(row.fields_json); } catch { throw new Error('race observation fields_json is invalid'); }
  const parsed = parseRacePropositionTerms(fields?.terms ?? null);
  const factId = stableId('race-proposition', row.id, RACE_PROPOSITION_PARSER_VERSION);
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO race_proposition_facts
      (id, race_id, source_observation_id, source_record_id, observed_at, parser_version, parse_status,
       raw_terms_json, facts_json, matched_patterns_json, unparsed_fragments_json, ambiguous_fragments_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    factId, row.entity_id, row.id, row.source_record_id, row.observed_at, RACE_PROPOSITION_PARSER_VERSION,
    parsed.parseStatus, JSON.stringify(parsed.rawTerms), JSON.stringify(parsed.facts), JSON.stringify(parsed.matchedPatterns),
    JSON.stringify(parsed.unparsedFragments), JSON.stringify(parsed.ambiguousFragments)
  ).run();
  return { id: factId, raceId: row.entity_id, parserVersion: RACE_PROPOSITION_PARSER_VERSION, parseStatus: parsed.parseStatus, inserted: Number(result.meta?.changes ?? 0) === 1 };
}

export async function getRacePropositionsAsOf(env, raceIds, asOf, parserVersion = RACE_PROPOSITION_PARSER_VERSION) {
  if (!env.DB) throw new Error('DB is not configured');
  const ids = [...new Set((raceIds ?? []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const cutoff = requireInstant(asOf, 'asOf');
  const ph = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT rpf.*, ROW_NUMBER() OVER (
        PARTITION BY rpf.race_id
        ORDER BY julianday(rpf.observed_at) DESC, rpf.id DESC
      ) AS rn
      FROM race_proposition_facts rpf
      WHERE rpf.race_id IN (${ph})
        AND rpf.parser_version = ?
        AND julianday(rpf.observed_at) <= julianday(?)
    )
    SELECT * FROM ranked WHERE rn = 1
  `).bind(...ids, parserVersion, cutoff).all();
  const out = new Map(ids.map((id) => [id, null]));
  for (const row of results) {
    out.set(row.race_id, {
      parserVersion: row.parser_version,
      parseStatus: row.parse_status,
      observedAt: row.observed_at,
      sourceRecordId: row.source_record_id,
      sourceObservationId: row.source_observation_id,
      rawTerms: JSON.parse(row.raw_terms_json),
      facts: JSON.parse(row.facts_json),
      matchedPatterns: JSON.parse(row.matched_patterns_json),
      unparsedFragments: JSON.parse(row.unparsed_fragments_json),
      ambiguousFragments: JSON.parse(row.ambiguous_fragments_json)
    });
  }
  return out;
}
