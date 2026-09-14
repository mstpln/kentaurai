import { stableId } from './ids.js';

export const RACE_PROPOSITION_PARSER_VERSION = 'kentaurai-race-proposition-v1';

const EMPTY_FACTS = Object.freeze({
  age_min_years: null,
  age_max_years: null,
  sex_restriction: null,
  earnings_min_amount: null,
  earnings_max_amount: null,
  earnings_currency: null,
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

const NEGATION = /\b(?:inte|ej|icke|utan|ikke|unntatt|förutom|exklusive)\b/i;
const SUPPORTED_KEYWORD = /(?:år|final|försök|forsøk|kval|heat|spårtrappa|sportrapp|amatör|amatør|lärling|lærling|unghäst|unghest|tillägg|tillegg|ston|stolopp|hopper|hingstar|hingster|valacker|vallaker|kr|sek|nok)/i;
const UNSUPPORTED_AGE_CONJUNCTION = /\b\d{1,2}\s*-?\s*(?:och|og)\s*\d{1,2}\s*[- ]?år(?:iga|ige)?\b/i;
const CONNECTOR_WORDS = /\b(?:för|for|till|til|och|og|samt|av|med)\b/gi;

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rawFragment(value) {
  if (typeof value === 'string') return normalizeText(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

function amount(text) {
  const digits = String(text).replace(/[.\s]/g, '');
  const value = Number(digits);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function currency(value) {
  const code = String(value ?? '').toLowerCase();
  if (code === 'sek') return 'SEK';
  if (code === 'nok') return 'NOK';
  return null;
}

function emptyFacts() { return { ...EMPTY_FACTS }; }

function sameGroup(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function descendingRange(group, values) {
  if (group === 'age') {
    const min = values.age_min_years;
    const max = values.age_max_years;
    return min != null && max != null && min > max;
  }
  if (group === 'earnings') {
    const min = values.earnings_min_amount;
    const max = values.earnings_max_amount;
    return min != null && max != null && min > max;
  }
  return false;
}

function assignGroup({ facts, assigned, conflicted, group, keys, candidate, fragment, ambiguousFragments }) {
  if (conflicted.has(group)) return;
  const normalized = Object.fromEntries(keys.map((key) => [key, candidate[key] ?? null]));
  if (descendingRange(group, normalized)) {
    for (const key of keys) facts[key] = null;
    assigned.delete(group);
    conflicted.add(group);
    ambiguousFragments.push(`invalid ${group} range: ${fragment}`);
    return;
  }
  const prior = assigned.get(group);
  if (prior && !sameGroup(prior, normalized)) {
    for (const key of keys) facts[key] = null;
    assigned.delete(group);
    conflicted.add(group);
    ambiguousFragments.push(`conflicting ${group} conditions: ${fragment}`);
    return;
  }
  if (!prior) {
    assigned.set(group, normalized);
    for (const key of keys) facts[key] = normalized[key];
  }
}

function consumeRule(state, rule) {
  const match = state.remaining.match(rule.regex);
  if (!match) return false;
  const candidate = rule.build(match);
  assignGroup({
    facts: state.facts,
    assigned: state.assigned,
    conflicted: state.conflicted,
    group: rule.group,
    keys: rule.keys,
    candidate,
    fragment: state.original,
    ambiguousFragments: state.ambiguousFragments
  });
  state.matchedPatterns.push({ fragment: state.original, pattern: rule.pattern });
  state.remaining = `${state.remaining.slice(0, match.index)} ${state.remaining.slice(match.index + match[0].length)}`;
  return true;
}

const RULES = Object.freeze([
  {
    pattern: 'age_range', group: 'age', keys: ['age_min_years', 'age_max_years'],
    regex: /\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*[- ]?år(?:iga|ige)?\b/i,
    build: (m) => ({ age_min_years: Number(m[1]), age_max_years: Number(m[2]) })
  },
  {
    pattern: 'age_min', group: 'age', keys: ['age_min_years', 'age_max_years'],
    regex: /\b(\d{1,2})\s*[- ]?år(?:iga|ige)?\s+(?:och\s+äldre|og\s+eldre)\b/i,
    build: (m) => ({ age_min_years: Number(m[1]), age_max_years: null })
  },
  {
    pattern: 'age_max', group: 'age', keys: ['age_min_years', 'age_max_years'],
    regex: /\b(?:högst|høyest|maks|max)\s+(\d{1,2})\s*[- ]?år(?:iga|ige)?\b/i,
    build: (m) => ({ age_min_years: null, age_max_years: Number(m[1]) })
  },
  {
    pattern: 'age_exact', group: 'age', keys: ['age_min_years', 'age_max_years'],
    regex: /\b(\d{1,2})\s*[- ]?år(?:iga|ige)?\b/i,
    build: (m) => ({ age_min_years: Number(m[1]), age_max_years: Number(m[1]) })
  },
  {
    pattern: 'sex_stallions_geldings', group: 'sex', keys: ['sex_restriction'],
    regex: /\b(?:hingstar\s+och\s+valacker|hingster\s+og\s+vallaker)\b/i,
    build: () => ({ sex_restriction: 'stallions_and_geldings' })
  },
  {
    pattern: 'sex_mares', group: 'sex', keys: ['sex_restriction'],
    regex: /\b(?:ston|stolopp|hopper|hoppeløp)\b/i,
    build: () => ({ sex_restriction: 'mares_only' })
  },
  {
    pattern: 'earnings_range', group: 'earnings', keys: ['earnings_min_amount', 'earnings_max_amount', 'earnings_currency'],
    regex: /\b([0-9][0-9. ]*)\s*[-–]\s*([0-9][0-9. ]*)\s*(kr|sek|nok)\b/i,
    build: (m) => ({ earnings_min_amount: amount(m[1]), earnings_max_amount: amount(m[2]), earnings_currency: currency(m[3]) })
  },
  {
    pattern: 'earnings_max', group: 'earnings', keys: ['earnings_min_amount', 'earnings_max_amount', 'earnings_currency'],
    regex: /\b(?:högst|høyest|maks|max)\s+([0-9][0-9. ]*)\s*(kr|sek|nok)\b/i,
    build: (m) => ({ earnings_min_amount: null, earnings_max_amount: amount(m[1]), earnings_currency: currency(m[2]) })
  },
  {
    pattern: 'earnings_min', group: 'earnings', keys: ['earnings_min_amount', 'earnings_max_amount', 'earnings_currency'],
    regex: /\b(?:lägst|minst|minimum)\s+([0-9][0-9. ]*)\s*(kr|sek|nok)\b/i,
    build: (m) => ({ earnings_min_amount: amount(m[1]), earnings_max_amount: null, earnings_currency: currency(m[2]) })
  },
  {
    pattern: 'final', group: 'final', keys: ['is_final'], regex: /\bfinal(?:en)?\b/i,
    build: () => ({ is_final: true })
  },
  {
    pattern: 'qualifier', group: 'qualifier', keys: ['is_qualifier'], regex: /\b(?:försök|forsøk|kval(?:ificering|ifisering)?)\b/i,
    build: () => ({ is_qualifier: true })
  },
  {
    pattern: 'heat', group: 'heat', keys: ['is_heat', 'heat_number'], regex: /\bheat(?:\s+(\d{1,2}))?\b/i,
    build: (m) => ({ is_heat: true, heat_number: m[1] ? Number(m[1]) : null })
  },
  {
    pattern: 'lane_ladder', group: 'lane_ladder', keys: ['is_lane_ladder'], regex: /\b(?:spårtrappa|sportrapp)\b/i,
    build: () => ({ is_lane_ladder: true })
  },
  {
    pattern: 'amateur', group: 'amateur', keys: ['is_amateur'], regex: /\b(?:amatör(?:lopp)?|amatør(?:løp)?)\b/i,
    build: () => ({ is_amateur: true })
  },
  {
    pattern: 'apprentice', group: 'apprentice', keys: ['is_apprentice'], regex: /\b(?:lärling(?:slopp)?|lærling(?:løp)?)\b/i,
    build: () => ({ is_apprentice: true })
  },
  {
    pattern: 'young_horse', group: 'young_horse', keys: ['is_young_horse'], regex: /\b(?:unghäst(?:lopp)?|unghest(?:løp)?)\b/i,
    build: () => ({ is_young_horse: true })
  },
  {
    pattern: 'handicap', group: 'handicap', keys: ['has_handicap_condition', 'handicap_step_m'],
    regex: /(?:\b(?:tillägg|tillegg)\s+(\d{1,3})\s*m\b|\b(\d{1,3})\s*m\s+(?:tillägg|tillegg)\b|\b(?:tillägg|tillegg)\b)/i,
    build: (m) => ({ has_handicap_condition: true, handicap_step_m: m[1] ? Number(m[1]) : m[2] ? Number(m[2]) : null })
  }
]);

function meaningfulResidual(text) {
  return text
    .replace(CONNECTOR_WORDS, ' ')
    .replace(/[,:;()./]+/g, ' ')
    .replace(/[-–]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRacePropositionTerms(terms) {
  const rawTerms = terms == null ? [] : Array.isArray(terms) ? terms : [terms];
  const facts = emptyFacts();
  const matchedPatterns = [];
  const unparsedFragments = [];
  const ambiguousFragments = [];
  const assigned = new Map();
  const conflicted = new Set();

  for (const raw of rawTerms) {
    const text = rawFragment(raw);
    if (!text) continue;
    if (typeof raw !== 'string') {
      unparsedFragments.push(text);
      continue;
    }
    if (NEGATION.test(text) && SUPPORTED_KEYWORD.test(text)) {
      ambiguousFragments.push(text);
      continue;
    }
    if (UNSUPPORTED_AGE_CONJUNCTION.test(text)) {
      conflicted.add('age');
      ambiguousFragments.push(text);
    }

    const state = { original: text, remaining: text, facts, matchedPatterns, ambiguousFragments, assigned, conflicted };
    for (const rule of RULES) while (consumeRule(state, rule)) {}
    if (meaningfulResidual(state.remaining)) unparsedFragments.push(text);
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

function requireBatchLimit(value) {
  const limit = value == null ? 25 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer between 1 and 100');
  return limit;
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
  return {
    id: factId,
    raceId: row.entity_id,
    parserVersion: RACE_PROPOSITION_PARSER_VERSION,
    parseStatus: parsed.parseStatus,
    inserted: Number(result.meta?.changes ?? 0) === 1
  };
}

export async function storePendingRacePropositions(env, { limit = 25 } = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const batchLimit = requireBatchLimit(limit);
  const { results } = await env.DB.prepare(`
    SELECT o.id
    FROM normalized_observations o
    JOIN source_records s ON s.id = o.source_record_id
    LEFT JOIN race_proposition_facts rpf
      ON rpf.source_observation_id = o.id AND rpf.parser_version = ?
    WHERE o.entity_type = 'race'
      AND o.quality_status = 'normalized_verified_subset'
      AND s.source_type = 'official_provider'
      AND rpf.id IS NULL
    ORDER BY julianday(o.observed_at) ASC, o.id ASC
    LIMIT ?
  `).bind(RACE_PROPOSITION_PARSER_VERSION, batchLimit).all();

  let inserted = 0;
  const processed = [];
  for (const row of results) {
    const result = await storeRacePropositionFromObservation(env, row.id);
    if (result.inserted) inserted += 1;
    processed.push({ observationId: row.id, parseStatus: result.parseStatus });
  }
  const next = await env.DB.prepare(`
    SELECT 1 AS pending
    FROM normalized_observations o
    JOIN source_records s ON s.id = o.source_record_id
    LEFT JOIN race_proposition_facts rpf
      ON rpf.source_observation_id = o.id AND rpf.parser_version = ?
    WHERE o.entity_type = 'race'
      AND o.quality_status = 'normalized_verified_subset'
      AND s.source_type = 'official_provider'
      AND rpf.id IS NULL
    LIMIT 1
  `).bind(RACE_PROPOSITION_PARSER_VERSION).first();
  return { parserVersion: RACE_PROPOSITION_PARSER_VERSION, processed, inserted, hasMore: Boolean(next?.pending) };
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
