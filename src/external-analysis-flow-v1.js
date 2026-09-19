import { stableId } from './ids.js';
import { canonicalOptimizerPolicyForRound } from './analysis-optimizer-policy-config.js';
import { loadExternalRankingsV3, loadMarketDeadlineV3, loadVerifiedMarketRowsV3 } from './analysis-market-pack-v3.js';

export const EXTERNAL_ANALYSIS_FLOW_VERSION = 'external-analysis-v1';
export const MARKET_INPUT_CONTRACT = 'kentaurai-market-input-v1';
export const REGISTRATION_CONTEXT_CONTRACT = 'kentaurai-system-import-context-v1';
export const RECORDED_SYSTEM_CONTRACT = 'kentaurai-recorded-system-v1';
export const EXTERNAL_ANALYSIS_PROMPT_VERSION = 'external-analysis-prompt-v1';
export const EXTERNAL_ANALYSIS_RUN_CONTRACT = 'kentaurai-external-analysis-run-v1';

const MAX_TEXT = 12000;
const MAX_JSON_TEXT = 30000;
const PROBABILITY_TOLERANCE = 0.0001;
const ABCD_ORDER = new Map([['A', 0], ['B', 1], ['C', 2], ['D', 3]]);

function requiredText(value, field, max = 200) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(field + ' is required and must be at most ' + max + ' characters');
  return text;
}

function optionalText(value, field, max = MAX_TEXT) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (text.length > max) throw new Error(field + ' must be at most ' + max + ' characters');
  return text;
}

function providerKey(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'chatgpt') return 'openai';
  if (provider === 'anthropic' || provider === 'claude') return 'anthropic';
  throw new Error('provider must be openai or anthropic');
}

function providerModel(value) {
  const model = requiredText(value, 'producer.model', 200);
  if (/[\u0000-\u001f\u007f]/.test(model)) throw new Error('producer.model contains control characters');
  return model;
}

function jsonNumber(value, field, { min = -Infinity, max = Infinity, nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(field + ' must be a JSON number between ' + min + ' and ' + max);
  }
  return value;
}

function jsonInteger(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(field + ' must be a JSON integer between ' + min + ' and ' + max);
  }
  return value;
}

function validIso(value) {
  return typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value));
}

function exactIso(value, field) {
  const text = requiredText(value, field, 80);
  if (!validIso(text)) throw new Error(field + ' must be a valid ISO timestamp');
  return new Date(Date.parse(text)).toISOString();
}

function boundedJson(value, field, max = MAX_JSON_TEXT) {
  if (value == null) return null;
  const text = JSON.stringify(value);
  if (text.length > max) throw new Error(field + ' is too large');
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizePolicy(policy) {
  return {
    game_type: policy.game_type,
    line_price_sek: Number(policy.line_price_sek),
    target_budget_min_sek: Number(policy.target_budget_min_sek),
    max_budget_sek: Number(policy.max_budget_sek),
    exact_spike_count: Number(policy.exact_spike_count),
    system_type: policy.system_type
  };
}

export async function recordExternalAnalysisExport(env, {
  stage,
  roundId,
  artifactId,
  artifactFingerprint,
  asOf,
  cutoffAt = null,
  generatedAt,
  artifact = {}
} = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const normalizedStage = requiredText(stage, 'stage', 20).toLowerCase();
  if (!['step1', 'step2'].includes(normalizedStage)) throw new Error('stage must be step1 or step2');
  const round = requiredText(roundId, 'round_id', 200);
  const idValue = requiredText(artifactId, 'artifact_id', 200);
  const fingerprint = requiredText(artifactFingerprint, 'artifact_fingerprint', 200);
  const asOfIso = exactIso(asOf, 'as_of');
  const cutoffIso = cutoffAt == null ? null : exactIso(cutoffAt, 'cutoff_at');
  const generatedIso = exactIso(generatedAt, 'generated_at');
  const artifactJson = JSON.stringify(boundedJson(artifact, 'artifact', 30000) || {});
  const id = stableId('external-analysis-export', normalizedStage, round, idValue, fingerprint, generatedIso);
  await env.DB.prepare(
    'INSERT OR IGNORE INTO analysis_external_exports ' +
    '(id,game_round_id,stage,artifact_id,artifact_fingerprint,as_of,cutoff_at,artifact_json,generated_at,created_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    id, round, normalizedStage, idValue, fingerprint, asOfIso, cutoffIso,
    artifactJson, generatedIso, new Date().toISOString()
  ).run();
  return { id, stage: normalizedStage, roundId: round };
}

export async function listExternalAnalysisRounds(env, scope = 'analysis') {
  if (!env?.DB) throw new Error('DB is not configured');
  const mode = String(scope || 'analysis').trim().toLowerCase();
  if (!['analysis', 'registration'].includes(mode)) throw new Error('scope must be analysis or registration');
  const upcomingClause = mode === 'analysis'
    ? "AND datetime(COALESCE(gr.bet_stop_at,gr.scheduled_start_at,(SELECT MIN(r2.scheduled_start_at) FROM game_legs gl2 JOIN races r2 ON r2.id=gl2.race_id WHERE gl2.game_round_id=gr.id))) >= CURRENT_TIMESTAMP"
    : '';
  const order = mode === 'analysis'
    ? "datetime(COALESCE(gr.bet_stop_at,gr.scheduled_start_at,gr.round_date)) ASC, gr.id ASC"
    : "gr.round_date DESC, CASE WHEN gr.scheduled_start_at IS NULL THEN 1 ELSE 0 END, gr.scheduled_start_at DESC, gr.id DESC";
  const { results } = await env.DB.prepare(
    "SELECT gr.id,gr.game_type,gr.round_date,gr.scheduled_start_at,gr.bet_stop_at,gr.status," +
    " (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id) AS leg_count," +
    " (SELECT COUNT(*) FROM analysis_external_runs aer WHERE aer.game_round_id=gr.id) AS system_count" +
    " FROM game_rounds gr" +
    " WHERE gr.game_type IN ('V85','V86')" +
    " AND (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id)=8 " +
    upcomingClause +
    " ORDER BY " + order +
    " LIMIT 100"
  ).all();
  return (results || []).map((row) => ({
    id: row.id,
    gameType: row.game_type,
    roundDate: row.round_date,
    scheduledStartAt: row.scheduled_start_at || null,
    betStopAt: row.bet_stop_at || null,
    status: row.status || null,
    legCount: Number(row.leg_count || 0),
    hasRecordedSystem: Number(row.system_count || 0) > 0
  }));
}

export async function loadRoundIdentity(env, roundId) {
  if (!env?.DB) throw new Error('DB is not configured');
  const id = requiredText(roundId, 'round_id', 200);
  const round = await env.DB.prepare(
    "SELECT id,game_type,round_date,scheduled_start_at,bet_stop_at,status FROM game_rounds WHERE id=? AND game_type IN ('V85','V86') LIMIT 1"
  ).bind(id).first();
  if (!round) throw new Error('V85/V86 round was not found');

  const { results } = await env.DB.prepare(
    "SELECT gl.leg_number,r.id AS race_id,r.distance_m,r.start_method," +
    " re.id AS race_entry_id,re.start_number,re.scratched,h.id AS horse_id,h.canonical_name AS horse_name" +
    " FROM game_legs gl" +
    " JOIN races r ON r.id=gl.race_id" +
    " JOIN race_entries re ON re.race_id=r.id" +
    " JOIN horses h ON h.id=re.horse_id" +
    " WHERE gl.game_round_id=?" +
    " ORDER BY gl.leg_number,CASE WHEN re.start_number IS NULL THEN 999 ELSE re.start_number END,re.id"
  ).bind(id).all();

  const legs = Array.from({ length: 8 }, (_, index) => ({
    leg_number: index + 1,
    race_id: null,
    distance_m: null,
    start_method: null,
    entries: []
  }));
  for (const row of results || []) {
    const leg = Number(row.leg_number);
    if (!Number.isInteger(leg) || leg < 1 || leg > 8) continue;
    const target = legs[leg - 1];
    target.race_id = target.race_id || row.race_id;
    target.distance_m = row.distance_m == null ? null : Number(row.distance_m);
    target.start_method = row.start_method || null;
    target.entries.push({
      race_entry_id: row.race_entry_id,
      start_number: row.start_number == null ? null : Number(row.start_number),
      horse_id: row.horse_id,
      horse_name: row.horse_name,
      scratched: Number(row.scratched || 0) === 1
    });
  }
  if (legs.some((leg) => !leg.race_id)) throw new Error('round must contain exactly eight populated legs');
  return {
    round: {
      id: round.id,
      game_type: round.game_type,
      round_date: round.round_date,
      scheduled_start_at: round.scheduled_start_at || null,
      bet_stop_at: round.bet_stop_at || null,
      status: round.status || null
    },
    legs
  };
}

export async function buildMarketInput(env, roundId, asOf = null) {
  const identity = await loadRoundIdentity(env, roundId);
  const requestedAt = validIso(asOf) ? new Date(Date.parse(asOf)).toISOString() : new Date().toISOString();
  const deadline = await loadMarketDeadlineV3(env, roundId, requestedAt);
  const history = await loadVerifiedMarketRowsV3(env, roundId, deadline.cutoff);
  const latestBetting = new Map();
  for (const row of history.betting || []) latestBetting.set(row.race_entry_id, row);
  const latestOdds = new Map();
  for (const row of history.odds || []) latestOdds.set(row.race_entry_id + '|' + row.market_type, row);

  const market = {
    definitionVersion: deadline.deadline_source === 'bet_stop_at'
      ? 'verified-market-at-stop-v1'
      : 'verified-market-at-round-start-v1',
    roundId,
    betStopAt: identity.round.bet_stop_at,
    marketDeadlineAt: deadline.deadline_at,
    deadlineSource: deadline.deadline_source,
    asOf: deadline.requested_as_of,
    cutoff: deadline.cutoff,
    betting: [...latestBetting.values()].map((row) => ({
      raceEntryId: row.race_entry_id,
      legNumber: Number(row.leg_number),
      betPercent: row.market_ownership_percent == null ? null : Number(row.market_ownership_percent),
      marketRank: row.market_rank == null ? null : Number(row.market_rank),
      capturedAt: row.captured_at
    })),
    odds: [...latestOdds.values()].map((row) => ({
      raceEntryId: row.race_entry_id,
      marketType: row.market_type,
      odds: row.odds == null ? null : Number(row.odds),
      capturedAt: row.captured_at
    }))
  };

  const policy = normalizePolicy(await canonicalOptimizerPolicyForRound(env, roundId));
  const fingerprintInput = {
    contract_version: MARKET_INPUT_CONTRACT,
    round_id: identity.round.id,
    game_type: identity.round.game_type,
    system_policy: policy,
    market,
    market_history: history,
    entry_identity: identity.legs.map((leg) => ({
      leg_number: leg.leg_number,
      race_id: leg.race_id,
      entries: leg.entries.map((entry) => ({
        race_entry_id: entry.race_entry_id,
        start_number: entry.start_number,
        horse_id: entry.horse_id
      }))
    }))
  };
  const marketFingerprint = await sha256(fingerprintInput);
  return {
    contract_version: MARKET_INPUT_CONTRACT,
    round: identity.round,
    system_policy: policy,
    market,
    market_history: history,
    entry_map: identity.legs,
    generated_at: new Date().toISOString(),
    market_fingerprint: marketFingerprint,
    market_as_of: deadline.requested_as_of,
    market_cutoff: deadline.cutoff
  };
}

export async function buildRegistrationContext(env, roundId) {
  const identity = await loadRoundIdentity(env, roundId);
  const policy = normalizePolicy(await canonicalOptimizerPolicyForRound(env, roundId));
  return {
    contract_version: REGISTRATION_CONTEXT_CONTRACT,
    output_contract: RECORDED_SYSTEM_CONTRACT,
    generated_at: new Date().toISOString(),
    round: identity.round,
    system_policy: policy,
    code_calculates: [
      'spike_count_from_singleton_legs',
      'row_count_from_selection_counts',
      'cost_sek_from_row_count_and_line_price',
      'estimated_hit_probability_from_stored_step1_probabilities',
      'stored_market_percent_from_verified_market_snapshot'
    ],
    legs: identity.legs
  };
}

export function getExternalAnalysisStep1Prompt(provider = 'openai') {
  const key = providerKey(provider);
  const label = key === 'openai' ? 'ChatGPT' : 'Claude';
  return [
    '# KentaurAI - Steg 1: Marknadsblind analys',
    '',
    'Du är ' + label + ' och ska analysera den uppladdade KentaurAI-filen för den valda V85/V86-omgången.',
    '',
    'VIKTIGT:',
    '- Använd bara data i KentaurAI-filen. Sök inte på webben och använd inte aktuell streck-, odds- eller tippsinformation.',
    '- Okända faktauppgifter är okända. Hitta aldrig på statistik, tider, utrustning eller citat.',
    '- Saknad X-Labs eller annan frivillig data är inte negativt för hästen; det ökar bara osäkerheten.',
    '- ABCD beskriver relativ vinststyrka, inte spelvärde.',
    '- Bygg inget system i Steg 1.',
    '',
    'Analysera i denna ordning för varje avdelning:',
    '1. Datatäckning och viktiga luckor.',
    '2. Kapacitet.',
    '3. Form, klass och utveckling.',
    '4. Distans, startmetod, spår, kusk/tränare, utrustning och övrig relevant kontext.',
    '5. Trolig loppbild och 2-4 tydliga scenarier när de faktiskt behövs.',
    '6. Marknadsblinda vinstchanser, osäkerhet, ranking och ABCD.',
    '',
    'KRAV:',
    '- Alla 8 avdelningar ska analyseras.',
    '- Varje aktiv häst ska ha vinstchans, unik ranking och ABCD.',
    '- Vinstchanserna ska summera till 100 % per avdelning.',
    '- Ranking ska följa vinstchansen fallande; lös eventuella lika chanser med en medveten tie-break.',
    '- Håll isär rå fakta, beräknade features och dina egna bedömningar.',
    '',
    'OUTPUT I CHATten:',
    '- Per avdelning: kort loppbild, viktigaste scenarierna och en kompakt tabell med Nr, Häst, Chans, Rank, ABCD, Osäkerhet och kort motivering.',
    '- Lyft bara statistik och detaljer som faktiskt påverkar bedömningen.',
    '- Avsluta med en kort omgångssammanfattning och var underlaget är starkast/svagast.',
    '',
    'Behåll hela Steg 1 i denna konversation. När Steg 1 är klart stannar du. Jag kommer därefter ladda upp KentaurAI:s Steg 2-fil med marknadsdata i samma konversation.'
  ].join('\\n');
}

export function getExternalAnalysisStep2Prompt(provider = 'openai') {
  providerKey(provider);
  return [
    '# KentaurAI - Steg 2: Marknadsanalys',
    '',
    'Fortsätt i samma konversation där Steg 1 redan är färdigt. Läs nu den uppladdade KentaurAI-filen med marknadsdata.',
    '',
    'GRUNDREGEL:',
    '- Steg 1 är din oberoende marknadsblinda styrkebedömning. Ändra inte sannolikheter, ranking eller ABCD för att marknaden tycker annorlunda.',
    '- Jämför egen vinstchans mot streck/odds och förklara tydligt var marknaden och den blinda analysen skiljer sig.',
    '- Intervjuer, krönikor och extern statistik kommer först i Steg 3 och ska inte användas här.',
    '',
    'GÖR NU:',
    '1. Bedöm marknadsläget per avdelning mot Steg 1.',
    '2. Identifiera tydligt överstreckade och understreckade hästar samt stora marknadskonflikter.',
    '3. Notera relevanta marknadsrörelser och eventuella avvikelser som kan motivera en informationskontroll i Steg 3.',
    '4. Sammanfatta var marknaden skiljer sig mest från den blinda analysen.',
    '',
    'VIKTIGT:',
    '- Bygg inget system i Steg 2.',
    '- Välj inga spikar eller garderingar ännu.',
    '- Marknadsdata får inte skriva om Steg 1.',
    '',
    'När marknadsanalysen är klar stannar du. Jag kommer därefter ladda upp Steg 3-underlaget med intervjuer och extern statistik i samma konversation.'
  ].join('\\n');
}

export function getRegistrationPrompt(provider = 'openai') {
  const key = providerKey(provider);
  return [
    '# KentaurAI - skapa registreringsfil',
    '',
    'Det färdiga V85/V86-systemet och analysen finns redan i denna konversation. Gör inte om analysen och bygg inte om systemet.',
    'Läs den uppladdade filen med contract_version "' + REGISTRATION_CONTEXT_CONTRACT + '". Den är enda auktoritativa källan för round_id, race_id, race_entry_id, startnummer och hästnamn.',
    '',
    'Skapa en enda giltig JSON-fil med contract_version "' + RECORDED_SYSTEM_CONTRACT + '". Ingen markdown och ingen text utanför JSON.',
    '',
    'Filen ska ha formen:',
    '{',
    '  "contract_version": "' + RECORDED_SYSTEM_CONTRACT + '",',
    '  "submission_id": "nytt-stabilt-id",',
    '  "round_id": "<exakt från importunderlaget>",',
    '  "producer": {"provider": "' + key + '", "model": "<verklig modellbeteckning>"},',
    '  "step1": {"pack_id":"<manifest.pack_id>","facts_fingerprint":"<manifest.facts_fingerprint>","as_of":"<manifest.as_of>","generated_at":"<manifest.generated_at>"},',
    '  "step2": {"market_fingerprint":"<market_fingerprint från Steg 2-filen>","as_of":"<market_as_of>","cutoff":"<market_cutoff>","generated_at":"<generated_at från Steg 2-filen>"},',
    '  "round_summary": "<senaste sportsliga sammanfattning efter Steg 3>",',
    '  "recommendations": "<kort slutlig systemsammanfattning>",',
    '  "legs": [',
    '    {"leg_number":1,"race_id":"...","scenarios":null,"race_shape_summary":"...","conclusion":"...","data_quality":"...","predictions":[',
    '      {"race_entry_id":"...","win_probability":0.0,"uncertainty_low":null,"uncertainty_high":null,"raw_rank":1,"abcd_group":"A","scenario_robustness":null,"reasoning":"..."}',
    '    ]}',
    '  ],',
    '  "systems": [',
    '    {"system_id":"main","system_type":"main","notes":"...","risk_profile":null,"selections":[',
    '      {"leg_number":1,"race_entry_id":"...","selection_reason":"..."}',
    '    ]}',
    '  ]',
    '}',
    '',
    'REGLER:',
    '- Kopiera step1.pack_id, step1.facts_fingerprint, step1.as_of och step1.generated_at exakt från Steg 1-filens manifest.',
    '- Kopiera step2.market_fingerprint, step2.as_of, step2.cutoff och step2.generated_at exakt från Steg 2-filen. Hitta inte på dessa värden.',
    '- legs ska innehålla exakt 8 avdelningar och återge den senaste sportsliga bedömningen efter Steg 3. Om Steg 3 inte ändrade något är detta samma sannolikheter som Steg 1.',
    '- Marknaden i Steg 2 får aldrig i sig ändra win_probability. Endast ny sportslig fakta/statistik i Steg 3 får motivera en dagsjustering.',
    '- win_probability ska vara JSON-tal 0-1 och summera till 1 per avdelning.',
    '- raw_rank ska vara unik 1..N och ABCD ska vara A/B/C/D.',
    '- Matcha hästar med startnummer + namn mot importunderlaget och kopiera race_entry_id exakt. Ingen fuzzy gissning.',
    '- systems måste innehålla minst ett main-system. Varje system ska täcka alla 8 avdelningar och ge exakt 3 singleton-avdelningar; KentaurAI räknar dessa som spikar.',
    '- Lägg INTE in row_count, budget_sek, cost_sek, line_price_sek, own_probability eller market_percent i systems/selections. KentaurAI räknar/hämtar dessa deterministiskt.',
    '- Om något inte kan mappas entydigt: skapa ingen partiell fil. Säg i chatten vad som blockerar.'
  ].join('\\n');
}

function activeLegsFromExportArtifact(artifact, identity) {
  const activeLegs = Array.isArray(artifact?.active_legs) ? artifact.active_legs : [];
  const byLeg = new Map(activeLegs.map((leg) => [Number(leg?.leg_number), leg]));
  return identity.legs.map((leg) => {
    const step1 = byLeg.get(leg.leg_number);
    if (!step1 || requiredText(step1.race_id, 'audited export race_id', 200) !== leg.race_id) {
      throw new Error('audited export does not match selected round race identity');
    }
    const canonical = new Set(leg.entries.map((entry) => entry.race_entry_id));
    const unique = [...new Set((step1.entry_ids || []).map((id) => requiredText(id, 'audited export race_entry_id', 200)))];
    if (!unique.length || unique.some((id) => !canonical.has(id))) {
      throw new Error('audited export contains invalid active entry identity');
    }
    return {
      leg_number: leg.leg_number,
      race_id: leg.race_id,
      entries: unique.map((race_entry_id) => ({ race_entry_id, scratched: false }))
    };
  });
}

function normalizePredictions(payloadLeg, expectedLeg, legIndex) {
  const legNumber = jsonInteger(payloadLeg?.leg_number, 'legs[' + legIndex + '].leg_number', { min: 1, max: 8 });
  if (legNumber !== expectedLeg.leg_number) throw new Error('legs must be ordered 1-8');
  const raceId = requiredText(payloadLeg.race_id, 'legs[' + legIndex + '].race_id', 200);
  if (raceId !== expectedLeg.race_id) throw new Error('race_id does not match the selected round in leg ' + legNumber);
  if (!Array.isArray(payloadLeg.predictions)) throw new Error('leg ' + legNumber + ' predictions must be an array');

  const active = expectedLeg.entries.filter((entry) => !entry.scratched);
  const allowed = new Set(active.map((entry) => entry.race_entry_id));
  if (payloadLeg.predictions.length !== active.length) throw new Error('leg ' + legNumber + ' must contain every active race entry exactly once');

  const seen = new Set();
  const predictions = payloadLeg.predictions.map((prediction, index) => {
    const entryId = requiredText(prediction?.race_entry_id, 'legs[' + legIndex + '].predictions[' + index + '].race_entry_id', 200);
    if (!allowed.has(entryId)) throw new Error('prediction ' + entryId + ' is not an active entry in leg ' + legNumber);
    if (seen.has(entryId)) throw new Error('duplicate prediction for ' + entryId);
    seen.add(entryId);
    const probability = jsonNumber(prediction.win_probability, 'win_probability', { min: 0, max: 1 });
    const low = jsonNumber(prediction.uncertainty_low, 'uncertainty_low', { min: 0, max: 1, nullable: true });
    const high = jsonNumber(prediction.uncertainty_high, 'uncertainty_high', { min: 0, max: 1, nullable: true });
    if (low != null && low > probability) throw new Error('uncertainty_low cannot exceed win_probability');
    if (high != null && high < probability) throw new Error('uncertainty_high cannot be below win_probability');
    const rank = jsonInteger(prediction.raw_rank, 'raw_rank', { min: 1, max: active.length });
    const abcd = requiredText(prediction.abcd_group, 'abcd_group', 1).toUpperCase();
    if (!ABCD_ORDER.has(abcd)) throw new Error('abcd_group must be A, B, C or D');
    const robustness = jsonNumber(prediction.scenario_robustness, 'scenario_robustness', { min: 0, max: 1, nullable: true });
    return {
      raceEntryId: entryId,
      winProbability: probability,
      uncertaintyLow: low,
      uncertaintyHigh: high,
      rawRank: rank,
      abcdGroup: abcd,
      scenarioRobustness: robustness,
      reasoning: boundedJson(prediction.reasoning, 'reasoning', 8000)
    };
  });

  const sum = predictions.reduce((total, prediction) => total + prediction.winProbability, 0);
  if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) throw new Error('leg ' + legNumber + ' win_probability must sum to 1');
  const ranks = predictions.map((prediction) => prediction.rawRank).sort((a, b) => a - b);
  if (ranks.some((rank, index) => rank !== index + 1)) throw new Error('leg ' + legNumber + ' raw_rank must be unique and contiguous 1..N');
  const ranked = [...predictions].sort((a, b) => a.rawRank - b.rawRank);
  for (let index = 1; index < ranked.length; index += 1) {
    if (ranked[index].winProbability > ranked[index - 1].winProbability + 1e-12) {
      throw new Error('leg ' + legNumber + ' ranking must follow win_probability');
    }
    if (ABCD_ORDER.get(ranked[index].abcdGroup) < ABCD_ORDER.get(ranked[index - 1].abcdGroup)) {
      throw new Error('leg ' + legNumber + ' ABCD groups must form contiguous strength bands');
    }
  }

  return {
    legNumber,
    raceId,
    scenarios: boundedJson(payloadLeg.scenarios, 'scenarios'),
    raceShapeSummary: optionalText(payloadLeg.race_shape_summary, 'race_shape_summary', 6000),
    conclusion: optionalText(payloadLeg.conclusion, 'conclusion', 6000),
    dataQuality: optionalText(payloadLeg.data_quality, 'data_quality', 1000),
    predictions
  };
}

function normalizeSystems(payloadSystems, expectedLegs, predictionMap, policy) {
  if (!Array.isArray(payloadSystems) || payloadSystems.length < 1 || payloadSystems.length > 2) {
    throw new Error('systems must contain one main system and optionally one alternative system');
  }
  const allowedByLeg = new Map(expectedLegs.map((leg) => [
    leg.leg_number,
    new Set(leg.entries.filter((entry) => !entry.scratched).map((entry) => entry.race_entry_id))
  ]));
  const normalized = payloadSystems.map((system, systemIndex) => {
    if (!system || typeof system !== 'object' || Array.isArray(system)) throw new Error('systems[' + systemIndex + '] must be an object');
    for (const forbidden of ['row_count','rowCount','budget_sek','budgetSek','cost_sek','costSek','line_price_sek','linePriceSek']) {
      if (forbidden in system) throw new Error(forbidden + ' is calculated by KentaurAI and must not be supplied');
    }
    const clientId = requiredText(system.system_id, 'systems[' + systemIndex + '].system_id', 120);
    const systemType = requiredText(system.system_type || 'main', 'system_type', 30).toLowerCase();
    if (!['main', 'alternative'].includes(systemType)) throw new Error('system_type must be main or alternative');
    if (!Array.isArray(system.selections)) throw new Error('system selections must be an array');

    const byLeg = new Map();
    const seen = new Set();
    const selections = system.selections.map((selection, selectionIndex) => {
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error('selection must be an object');
      for (const forbidden of ['is_spike','isSpike','own_probability','ownProbability','market_percent','marketPercent']) {
        if (forbidden in selection) throw new Error(forbidden + ' is derived by KentaurAI and must not be supplied');
      }
      const leg = jsonInteger(selection.leg_number, 'selection.leg_number', { min: 1, max: 8 });
      const entryId = requiredText(selection.race_entry_id, 'selection.race_entry_id', 200);
      if (!allowedByLeg.get(leg)?.has(entryId)) throw new Error('system selection ' + entryId + ' was not active in the audited Step 2 export for leg ' + leg);
      if (!predictionMap.has(entryId)) throw new Error('system selection ' + entryId + ' has no current sports prediction');
      const key = leg + '|' + entryId;
      if (seen.has(key)) throw new Error('system contains a duplicate selection in leg ' + leg);
      seen.add(key);
      const item = {
        legNumber: leg,
        raceEntryId: entryId,
        selectionReason: optionalText(selection.selection_reason, 'selection_reason', 2000)
      };
      if (!byLeg.has(leg)) byLeg.set(leg, []);
      byLeg.get(leg).push(item);
      return item;
    });

    if (byLeg.size !== 8) throw new Error('every system must select at least one horse in all eight legs');
    const singletonLegs = [...byLeg.values()].filter((items) => items.length === 1).length;
    if (singletonLegs !== 3) throw new Error('every V85/V86 system must contain exactly three one-horse spike legs');
    const rowCount = [...byLeg.values()].reduce((rows, items) => rows * items.length, 1);
    if (!Number.isSafeInteger(rowCount) || rowCount < 1) throw new Error('system row count is not a safe positive integer');
    const costSek = Math.round(rowCount * policy.line_price_sek * 100) / 100;
    const coverageByLeg = [...byLeg.entries()].map(([leg, items]) => ({
      leg,
      probability: items.reduce((sum, item) => sum + Number(predictionMap.get(item.raceEntryId)?.winProbability || 0), 0)
    }));
    const estimatedHitProbability = coverageByLeg.reduce((product, row) => product * row.probability, 1);
    return {
      clientId,
      systemType,
      notes: optionalText(system.notes, 'system.notes', 8000),
      riskProfile: optionalText(system.risk_profile, 'system.risk_profile', 1000),
      selections,
      byLeg,
      rowCount,
      costSek,
      spikeCount: singletonLegs,
      estimatedHitProbability
    };
  });

  if (!normalized.some((system) => system.systemType === 'main')) throw new Error('at least one main system is required');
  if (new Set(normalized.map((system) => system.systemType)).size !== normalized.length) throw new Error('only one system per system_type is allowed');
  if (new Set(normalized.map((system) => system.clientId)).size !== normalized.length) throw new Error('system_id values must be unique');
  return normalized;
}

function marketMaps(market) {
  const betting = new Map((market?.betting || []).map((row) => [row.raceEntryId, row]));
  return betting;
}

function marketOwnership(system, betting) {
  const byLeg = new Map();
  for (const selection of system.selections) {
    const raw = betting.get(selection.raceEntryId)?.betPercent;
    if (raw == null) return null;
    const percent = Number(raw);
    if (!Number.isFinite(percent)) return null;
    byLeg.set(selection.legNumber, (byLeg.get(selection.legNumber) || 0) + percent / 100);
  }
  return [...byLeg.values()].reduce((product, value) => product * value, 1);
}

function normalizedStep1Provenance(payload) {
  const step1 = payload?.step1;
  if (!step1 || typeof step1 !== 'object' || Array.isArray(step1)) throw new Error('step1 provenance is required');
  return {
    packId: requiredText(step1.pack_id, 'step1.pack_id', 160),
    factsFingerprint: requiredText(step1.facts_fingerprint, 'step1.facts_fingerprint', 160),
    asOf: exactIso(step1.as_of, 'step1.as_of'),
    generatedAt: exactIso(step1.generated_at, 'step1.generated_at')
  };
}

function normalizedStep2Provenance(payload) {
  const step2 = payload?.step2;
  if (!step2 || typeof step2 !== 'object' || Array.isArray(step2)) throw new Error('step2 provenance is required');
  return {
    marketFingerprint: requiredText(step2.market_fingerprint, 'step2.market_fingerprint', 160),
    asOf: exactIso(step2.as_of, 'step2.as_of'),
    cutoff: exactIso(step2.cutoff, 'step2.cutoff'),
    generatedAt: exactIso(step2.generated_at, 'step2.generated_at')
  };
}

async function requireAuditedExport(env, {
  roundId,
  stage,
  artifactId,
  artifactFingerprint,
  asOf,
  cutoffAt = null,
  generatedAt
}) {
  const row = await env.DB.prepare(
    'SELECT artifact_json,cutoff_at FROM analysis_external_exports ' +
    'WHERE game_round_id=? AND stage=? AND artifact_id=? AND artifact_fingerprint=? AND as_of=? AND generated_at=? LIMIT 1'
  ).bind(roundId, stage, artifactId, artifactFingerprint, asOf, generatedAt).first();
  if (!row) throw new Error(stage + ' provenance does not match an audited KentaurAI export');
  if ((cutoffAt || null) !== (row.cutoff_at || null)) throw new Error(stage + ' cutoff does not match audited KentaurAI export');
  let artifact = {};
  try { artifact = JSON.parse(row.artifact_json || '{}'); } catch { throw new Error(stage + ' audited export metadata is invalid'); }
  return artifact;
}

async function legacyStep2MarketFingerprint(env, roundId, marketInput) {
  const externalRankings = await loadExternalRankingsV3(env, roundId, marketInput.market_cutoff);
  return sha256({
    contract_version: MARKET_INPUT_CONTRACT,
    round_id: marketInput.round.id,
    game_type: marketInput.round.game_type,
    system_policy: marketInput.system_policy,
    market: marketInput.market,
    market_history: marketInput.market_history,
    external_rankings: externalRankings,
    entry_identity: marketInput.entry_map.map((leg) => ({
      leg_number: leg.leg_number,
      race_id: leg.race_id,
      entries: leg.entries.map((entry) => ({
        race_entry_id: entry.race_entry_id,
        start_number: entry.start_number,
        horse_id: entry.horse_id
      }))
    }))
  });
}

async function verifyExternalProvenance(env, roundId, step1, step2) {
  const step1Artifact = await requireAuditedExport(env, {
    roundId,
    stage: 'step1',
    artifactId: step1.packId,
    artifactFingerprint: step1.factsFingerprint,
    asOf: step1.asOf,
    generatedAt: step1.generatedAt
  });
  const step2Artifact = await requireAuditedExport(env, {
    roundId,
    stage: 'step2',
    artifactId: step2.marketFingerprint,
    artifactFingerprint: step2.marketFingerprint,
    asOf: step2.asOf,
    cutoffAt: step2.cutoff,
    generatedAt: step2.generatedAt
  });
  const marketInput = await buildMarketInput(env, roundId, step2.asOf);
  const replayedCutoff = exactIso(marketInput.market_cutoff, 'replayed Step 2 cutoff');
  let replayedFingerprint = marketInput.market_fingerprint;
  if (replayedCutoff === step2.cutoff && replayedFingerprint !== step2.marketFingerprint) {
    replayedFingerprint = await legacyStep2MarketFingerprint(env, roundId, marketInput);
  }
  if (replayedFingerprint !== step2.marketFingerprint || replayedCutoff !== step2.cutoff) {
    throw new Error('Step 2 provenance can no longer be reproduced from immutable market history');
  }
  if (Date.parse(step2.generatedAt) < Date.parse(step1.generatedAt)) {
    throw new Error('step2.generated_at cannot precede step1.generated_at');
  }
  return { step1Artifact, step2Artifact, marketInput };
}

export async function importRecordedSystem(env, payload, options = {}) {
  if (!env?.DB || typeof env.DB.batch !== 'function') throw new Error('D1 batch support is required');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('import must be a JSON object');
  if (payload.contract_version !== RECORDED_SYSTEM_CONTRACT) throw new Error('unsupported contract_version');

  const submissionId = requiredText(payload.submission_id, 'submission_id', 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(submissionId)) throw new Error('submission_id must use lowercase letters, numbers and single hyphens');
  const roundId = requiredText(payload.round_id, 'round_id', 200);
  const producer = {
    provider: providerKey(payload.producer?.provider),
    model: providerModel(payload.producer?.model)
  };
  const step1 = normalizedStep1Provenance(payload);
  const step2 = normalizedStep2Provenance(payload);
  if (payload.analysis_as_of != null && exactIso(payload.analysis_as_of, 'analysis_as_of') !== step1.asOf) {
    throw new Error('analysis_as_of must match step1.as_of');
  }
  const analysisAsOf = step1.asOf;
  const roundSummary = optionalText(payload.round_summary, 'round_summary', MAX_TEXT);
  const recommendations = boundedJson(payload.recommendations, 'recommendations', MAX_JSON_TEXT);

  const createdAt = exactIso(options.now ?? new Date().toISOString(), 'imported_at');
  const identity = await loadRoundIdentity(env, roundId);
  const deadline = await loadMarketDeadlineV3(env, roundId, createdAt);
  if (Date.parse(analysisAsOf) > Date.parse(deadline.deadline_at)) {
    throw new Error('step1.as_of must not be after the authoritative round deadline');
  }
  const provenance = await verifyExternalProvenance(env, roundId, step1, step2);
  if (!Array.isArray(payload.legs) || payload.legs.length !== 8) throw new Error('legs must contain exactly eight legs');
  const predictionLegs = activeLegsFromExportArtifact(provenance.step1Artifact, identity);
  const systemLegs = activeLegsFromExportArtifact(provenance.step2Artifact, identity);
  const legs = payload.legs.map((leg, index) => normalizePredictions(leg, predictionLegs[index], index));
  const predictionMap = new Map(legs.flatMap((leg) => leg.predictions.map((prediction) => [prediction.raceEntryId, prediction])));
  const policy = normalizePolicy(await canonicalOptimizerPolicyForRound(env, roundId));
  const systems = normalizeSystems(payload.systems, systemLegs, predictionMap, policy);

  const marketInput = provenance.marketInput;
  const market = marketInput.market;
  const betting = marketMaps(market);
  const digest = await sha256(payload);
  const modelVersionId = stableId('analysis', roundId, submissionId);
  const existing = await env.DB.prepare('SELECT config_json FROM model_versions WHERE id=? LIMIT 1').bind(modelVersionId).first();
  if (existing) {
    let stored = null;
    try { stored = JSON.parse(existing.config_json || 'null'); } catch {}
    if (stored?.recordedSystem?.payload_digest !== digest) {
      throw new Error('submission_id already exists with different content; use a new submission_id');
    }
    return {
      contractVersion: RECORDED_SYSTEM_CONTRACT,
      submissionId,
      roundId,
      modelVersionId,
      externalRunId: stableId('external-analysis-run', modelVersionId),
      reused: true,
      writes: { analyses: 0, predictions: 0, systems: 0, selections: 0 },
      systems: systems.map((system) => ({
        system_id: system.clientId,
        system_type: system.systemType,
        spike_count: system.spikeCount,
        row_count: system.rowCount,
        cost_sek: system.costSek
      }))
    };
  }

  const importTiming = Date.parse(createdAt) < Date.parse(deadline.deadline_at) ? 'pre_race' : 'post_race_recovery';
  const sourceTimingEligible = Date.parse(step1.generatedAt) < Date.parse(deadline.deadline_at)
    && Date.parse(step2.generatedAt) < Date.parse(deadline.deadline_at);
  const learningEligibility = importTiming === 'pre_race' && sourceTimingEligible ? 'eligible_by_timing' : 'manual_review_required';
  const analysisBlindness = importTiming === 'pre_race' ? 'declared_unsealed' : 'declared_unsealed_post_race_import';
  const config = {
    recordedSystem: {
      contract_version: RECORDED_SYSTEM_CONTRACT,
      flow_version: EXTERNAL_ANALYSIS_FLOW_VERSION,
      prompt_version: EXTERNAL_ANALYSIS_PROMPT_VERSION,
      submission_id: submissionId,
      round_id: roundId,
      analysis_as_of: analysisAsOf,
      step1_pack_id: step1.packId,
      step1_facts_fingerprint: step1.factsFingerprint,
      step1_generated_at: step1.generatedAt,
      step2_market_fingerprint: step2.marketFingerprint,
      step2_market_cutoff: step2.cutoff,
      step2_generated_at: step2.generatedAt,
      analysis_blindness: analysisBlindness,
      import_timing: importTiming,
      learning_eligibility: learningEligibility,
      payload_digest: digest,
      round_summary: roundSummary,
      recommendations,
      system_policy: policy
    }
  };

  const statements = [];
  const kinds = [];
  statements.push(env.DB.prepare(
    'INSERT INTO model_versions (id,created_at,feature_version,prompt_version,ai_provider,ai_model,config_json,notes) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(
    modelVersionId, createdAt, EXTERNAL_ANALYSIS_FLOW_VERSION, EXTERNAL_ANALYSIS_PROMPT_VERSION,
    producer.provider, producer.model, JSON.stringify(config),
    importTiming === 'pre_race'
      ? 'Manual external AI analysis; Step 1 blindness declared but unsealed'
      : 'Manual external AI analysis imported after market deadline; declared unsealed and excluded from automatic learning'
  ));
  kinds.push('model');

  for (const leg of legs) {
    const analysisId = stableId('race-analysis', modelVersionId, leg.raceId);
    statements.push(env.DB.prepare(
      "INSERT INTO ai_race_analyses " +
      "(id,race_id,model_version_id,data_snapshot_at,market_blind,scenarios_json,race_shape_summary,conclusion,data_quality,created_at,analysis_origin,method_note) " +
      "VALUES (?,?,?,?,0,?,?,?,?,?,'analysis_exchange',?)"
    ).bind(
      analysisId, leg.raceId, modelVersionId, analysisAsOf,
      leg.scenarios == null ? null : JSON.stringify(leg.scenarios),
      leg.raceShapeSummary, leg.conclusion, leg.dataQuality, createdAt,
      analysisBlindness
    ));
    kinds.push('analysis');

    for (const prediction of leg.predictions) {
      statements.push(env.DB.prepare(
        'INSERT INTO ai_horse_predictions ' +
        '(id,ai_race_analysis_id,race_entry_id,win_probability,uncertainty_low,uncertainty_high,raw_rank,abcd_group,value_ratio,scenario_robustness,reasoning_json) ' +
        'VALUES (?,?,?,?,?,?,?,?,NULL,?,?)'
      ).bind(
        stableId('prediction', analysisId, prediction.raceEntryId),
        analysisId, prediction.raceEntryId, prediction.winProbability,
        prediction.uncertaintyLow, prediction.uncertaintyHigh, prediction.rawRank,
        prediction.abcdGroup, prediction.scenarioRobustness,
        prediction.reasoning == null ? null : JSON.stringify(prediction.reasoning)
      ));
      kinds.push('prediction');
    }
  }

  for (const system of systems) {
    const systemId = stableId('system', modelVersionId, system.clientId);
    const estimatedMarketOwnership = marketOwnership(system, betting);
    const valueMetric = estimatedMarketOwnership && estimatedMarketOwnership > 0
      ? system.estimatedHitProbability / estimatedMarketOwnership
      : null;
    statements.push(env.DB.prepare(
      'INSERT INTO systems ' +
      '(id,game_round_id,model_version_id,system_type,budget_sek,row_count,line_price_sek,spike_count,estimated_hit_probability,estimated_market_ownership,value_metric,risk_profile,created_at,metrics_json,notes) ' +
      'VALUES (?,?,?,?,?,?,?,3,?,?,?,?,?,?,?)'
    ).bind(
      systemId, roundId, modelVersionId, system.systemType, system.costSek, system.rowCount, policy.line_price_sek,
      system.estimatedHitProbability, estimatedMarketOwnership, valueMetric, system.riskProfile, createdAt,
      JSON.stringify({
        calculation: EXTERNAL_ANALYSIS_FLOW_VERSION,
        row_count_derived: true,
        cost_derived: true,
        spike_count_derived: true,
        within_target_budget: system.costSek >= policy.target_budget_min_sek && system.costSek <= policy.max_budget_sek,
        target_budget_min_sek: policy.target_budget_min_sek,
        max_budget_sek: policy.max_budget_sek,
        market_definition_version: market?.definitionVersion || null,
        market_cutoff: step2.cutoff,
        market_fingerprint: step2.marketFingerprint,
        step1_pack_id: step1.packId,
        step1_facts_fingerprint: step1.factsFingerprint,
        analysis_blindness: analysisBlindness,
        import_timing: importTiming,
        learning_eligibility: learningEligibility
      }),
      system.notes
    ));
    kinds.push('system');

    for (const selection of system.selections) {
      const isSpike = system.byLeg.get(selection.legNumber).length === 1;
      const marketPercent = betting.get(selection.raceEntryId)?.betPercent;
      const prediction = predictionMap.get(selection.raceEntryId);
      statements.push(env.DB.prepare(
        'INSERT INTO system_selections (system_id,leg_number,race_entry_id,is_spike,own_probability,market_percent,selection_reason) VALUES (?,?,?,?,?,?,?)'
      ).bind(
        systemId, selection.legNumber, selection.raceEntryId, isSpike ? 1 : 0,
        prediction?.winProbability ?? null,
        marketPercent == null ? null : (Number.isFinite(Number(marketPercent)) ? Number(marketPercent) : null),
        selection.selectionReason
      ));
      kinds.push('selection');
    }
  }

  const mainSystem = systems.find((system) => system.systemType === 'main');
  const mainSystemId = stableId('system', modelVersionId, mainSystem.clientId);
  const externalRunId = stableId('external-analysis-run', modelVersionId);
  const previousRun = await env.DB.prepare(
    "SELECT id FROM analysis_external_runs WHERE game_round_id=? ORDER BY datetime(created_at) DESC,id DESC LIMIT 1"
  ).bind(roundId).first();
  statements.push(env.DB.prepare(
    'INSERT INTO analysis_external_runs ' +
    '(id,game_round_id,model_version_id,main_system_id,contract_version,flow_version,prompt_version,provider,model,' +
    'step1_pack_id,step1_pack_as_of,step1_generated_at,step1_facts_fingerprint,step2_market_fingerprint,step2_market_cutoff,step2_generated_at,' +
    'analysis_blindness,import_timing,learning_eligibility,payload_digest,supersedes_run_id,created_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    externalRunId, roundId, modelVersionId, mainSystemId, EXTERNAL_ANALYSIS_RUN_CONTRACT,
    EXTERNAL_ANALYSIS_FLOW_VERSION, EXTERNAL_ANALYSIS_PROMPT_VERSION, producer.provider, producer.model,
    step1.packId, step1.asOf, step1.generatedAt, step1.factsFingerprint, step2.marketFingerprint, step2.cutoff,
    step2.generatedAt, analysisBlindness, importTiming, learningEligibility, digest,
    previousRun?.id || null, createdAt
  ));
  kinds.push('external_run');

  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (error) {
    const raced = await env.DB.prepare('SELECT config_json FROM model_versions WHERE id=? LIMIT 1').bind(modelVersionId).first();
    if (raced) {
      let stored = null;
      try { stored = JSON.parse(raced.config_json || 'null'); } catch {}
      if (stored?.recordedSystem?.payload_digest === digest) {
        return {
          contractVersion: RECORDED_SYSTEM_CONTRACT,
          submissionId,
          roundId,
          modelVersionId,
          externalRunId,
          reused: true,
          writes: { analyses: 0, predictions: 0, systems: 0, selections: 0 },
          systems: systems.map((system) => ({
            system_id: system.clientId,
            system_type: system.systemType,
            spike_count: system.spikeCount,
            row_count: system.rowCount,
            cost_sek: system.costSek
          }))
        };
      }
    }
    throw error;
  }
  const changes = (kind) => results.reduce((sum, result, index) => sum + (kinds[index] === kind ? Number(result.meta?.changes ?? 0) : 0), 0);
  return {
    contractVersion: RECORDED_SYSTEM_CONTRACT,
    submissionId,
    roundId,
    modelVersionId,
    externalRunId,
    analysisBlindness,
    importTiming,
    learningEligibility,
    reused: false,
    writes: {
      analyses: changes('analysis'),
      predictions: changes('prediction'),
      systems: changes('system'),
      selections: changes('selection')
    },
    systems: systems.map((system) => ({
      system_id: system.clientId,
      system_type: system.systemType,
      spike_count: system.spikeCount,
      row_count: system.rowCount,
      cost_sek: system.costSek,
      within_target_budget: system.costSek >= policy.target_budget_min_sek && system.costSek <= policy.max_budget_sek
    }))
  };
}
