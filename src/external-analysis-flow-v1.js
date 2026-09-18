import { stableId } from './ids.js';
import { getVerifiedAnalysisMarket } from './analysis-market.js';
import { canonicalOptimizerPolicyForRound } from './analysis-optimizer-policy-config.js';
import { loadExternalRankingsV3, loadVerifiedMarketRowsV3 } from './analysis-market-pack-v3.js';

export const EXTERNAL_ANALYSIS_FLOW_VERSION = 'external-analysis-v1';
export const MARKET_INPUT_CONTRACT = 'kentaurai-market-input-v1';
export const REGISTRATION_CONTEXT_CONTRACT = 'kentaurai-system-import-context-v1';
export const RECORDED_SYSTEM_CONTRACT = 'kentaurai-recorded-system-v1';
export const EXTERNAL_ANALYSIS_PROMPT_VERSION = 'external-analysis-prompt-v1';

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
    " (SELECT COUNT(*) FROM systems s WHERE s.game_round_id=gr.id) AS system_count" +
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
  const market = await getVerifiedAnalysisMarket(env, roundId, requestedAt);
  const history = await loadVerifiedMarketRowsV3(env, roundId, market.cutoff);
  const externalRankings = await loadExternalRankingsV3(env, roundId, market.cutoff);
  const policy = normalizePolicy(await canonicalOptimizerPolicyForRound(env, roundId));
  return {
    contract_version: MARKET_INPUT_CONTRACT,
    generated_at: new Date().toISOString(),
    round: identity.round,
    system_policy: policy,
    market,
    market_history: history,
    external_rankings: externalRankings,
    entry_map: identity.legs
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
    '# KentaurAI - Steg 1: marknadsblind analys',
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
    '# KentaurAI - Steg 2: marknad, värde och system',
    '',
    'Fortsätt i samma konversation där Steg 1 redan är färdigt. Läs nu den uppladdade KentaurAI-filen med marknadsdata.',
    '',
    'GRUNDREGEL:',
    '- Steg 1 är din oberoende styrkebedömning. Ändra inte sannolikheter, ranking eller ABCD bara för att marknaden tycker annorlunda.',
    '- Jämför egen vinstchans mot streck/odds och förklara tydligt var marknaden och din analys skiljer sig.',
    '- Externa rankingsignaler får bara användas sist som kontroll om de finns i underlaget; de får inte styra grundrankingen.',
    '',
    'GÖR NU:',
    '1. Beräkna värde mot marknaden för relevanta hästar.',
    '2. Identifiera överstreckade favoriter, understreckade värdehästar och avdelningar där marknaden verkar mest fel.',
    '3. Återkoppla till loppbild/scenarier och de viktigaste statistiska detaljerna från Steg 1.',
    '4. Bygg det slutliga systemet enligt system_policy i den uppladdade filen.',
    '',
    'SYSTEMREGLER:',
    '- Systemet ska ha exakt 3 spikar i tre olika avdelningar.',
    '- En spikavdelning har exakt en vald häst.',
    '- Alla 8 avdelningar måste ha minst en vald häst.',
    '- Huvudsystemet ska normalt ligga inom budgetintervallet i system_policy.',
    '- Radantalet är produkten av antalet valda hästar i de 8 avdelningarna.',
    '- Prioritera träffchans och spelvärde tillsammans; marknadsprocent får aldrig ersätta egen vinstchans.',
    '',
    'OUTPUT I CHATten:',
    '- Kort marknads-/värdebedömning per avdelning.',
    '- Slutligt system, avdelning 1-8.',
    '- Exakt vilka 3 spikar som valts och varför.',
    '- Radantal och kostnad.',
    '- Viktigaste fällningarna och accepterad risk.',
    '- Kort systemtes: vilket loppförlopp och vilka statistiska observationer systemet främst bygger på.',
    '',
    'Skapa ingen KentaurAI-importfil ännu. Den görs först senare när jag väljer Registrera system i appen.'
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
    '  "producer": {"provider": "' + key + '", "model": "<verklig modell eller unknown>"},',
    '  "analysis_as_of": "<manifest.as_of från Steg 1-filen>",',
    '  "round_summary": "<Steg 1-sammanfattning>",',
    '  "recommendations": "<kort Steg 2/systemsammanfattning>",',
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
    '- legs ska innehålla exakt 8 avdelningar och Steg 1-bedömningen ska återges utan marknadsfärgning.',
    '- win_probability ska vara JSON-tal 0-1 och summera till 1 per avdelning.',
    '- raw_rank ska vara unik 1..N och ABCD ska vara A/B/C/D.',
    '- Matcha hästar med startnummer + namn mot importunderlaget och kopiera race_entry_id exakt. Ingen fuzzy gissning.',
    '- systems måste innehålla minst ett main-system. Varje system ska täcka alla 8 avdelningar och ge exakt 3 singleton-avdelningar; KentaurAI räknar dessa som spikar.',
    '- Lägg INTE in row_count, budget_sek, cost_sek, line_price_sek, own_probability eller market_percent i systems/selections. KentaurAI räknar/hämtar dessa deterministiskt.',
    '- Om något inte kan mappas entydigt: skapa ingen partiell fil. Säg i chatten vad som blockerar.'
  ].join('\\n');
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
      if (!allowedByLeg.get(leg)?.has(entryId)) throw new Error('system selection ' + entryId + ' is not active in leg ' + leg);
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
    const percent = Number(betting.get(selection.raceEntryId)?.betPercent);
    if (!Number.isFinite(percent)) return null;
    byLeg.set(selection.legNumber, (byLeg.get(selection.legNumber) || 0) + percent / 100);
  }
  return [...byLeg.values()].reduce((product, value) => product * value, 1);
}

export async function importRecordedSystem(env, payload) {
  if (!env?.DB || typeof env.DB.batch !== 'function') throw new Error('D1 batch support is required');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('import must be a JSON object');
  if (payload.contract_version !== RECORDED_SYSTEM_CONTRACT) throw new Error('unsupported contract_version');

  const submissionId = requiredText(payload.submission_id, 'submission_id', 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(submissionId)) throw new Error('submission_id must use lowercase letters, numbers and single hyphens');
  const roundId = requiredText(payload.round_id, 'round_id', 200);
  const producer = {
    provider: providerKey(payload.producer?.provider),
    model: requiredText(payload.producer?.model || 'unknown', 'producer.model', 200)
  };
  const analysisAsOf = exactIso(payload.analysis_as_of, 'analysis_as_of');
  const roundSummary = optionalText(payload.round_summary, 'round_summary', MAX_TEXT);
  const recommendations = boundedJson(payload.recommendations, 'recommendations', MAX_JSON_TEXT);

  const identity = await loadRoundIdentity(env, roundId);
  if (!Array.isArray(payload.legs) || payload.legs.length !== 8) throw new Error('legs must contain exactly eight legs');
  const legs = payload.legs.map((leg, index) => normalizePredictions(leg, identity.legs[index], index));
  const predictionMap = new Map(legs.flatMap((leg) => leg.predictions.map((prediction) => [prediction.raceEntryId, prediction])));
  const policy = normalizePolicy(await canonicalOptimizerPolicyForRound(env, roundId));
  const systems = normalizeSystems(payload.systems, identity.legs, predictionMap, policy);

  let market = null;
  try {
    market = await getVerifiedAnalysisMarket(env, roundId, new Date().toISOString());
  } catch {
    market = null;
  }
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

  const createdAt = new Date().toISOString();
  const config = {
    recordedSystem: {
      contract_version: RECORDED_SYSTEM_CONTRACT,
      flow_version: EXTERNAL_ANALYSIS_FLOW_VERSION,
      prompt_version: EXTERNAL_ANALYSIS_PROMPT_VERSION,
      submission_id: submissionId,
      round_id: roundId,
      analysis_as_of: analysisAsOf,
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
    producer.provider, producer.model, JSON.stringify(config), 'Manual external AI analysis and recorded system'
  ));
  kinds.push('model');

  for (const leg of legs) {
    const analysisId = stableId('race-analysis', modelVersionId, leg.raceId);
    statements.push(env.DB.prepare(
      "INSERT INTO ai_race_analyses " +
      "(id,race_id,model_version_id,data_snapshot_at,market_blind,scenarios_json,race_shape_summary,conclusion,data_quality,created_at,analysis_origin,method_note) " +
      "VALUES (?,?,?,?,1,?,?,?,?,?,'analysis_exchange','manual_record_v1')"
    ).bind(
      analysisId, leg.raceId, modelVersionId, analysisAsOf,
      leg.scenarios == null ? null : JSON.stringify(leg.scenarios),
      leg.raceShapeSummary, leg.conclusion, leg.dataQuality, createdAt
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
        market_cutoff: market?.cutoff || null
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
        Number.isFinite(Number(marketPercent)) ? Number(marketPercent) : null,
        selection.selectionReason
      ));
      kinds.push('selection');
    }
  }

  const results = await env.DB.batch(statements);
  const changes = (kind) => results.reduce((sum, result, index) => sum + (kinds[index] === kind ? Number(result.meta?.changes ?? 0) : 0), 0);
  return {
    contractVersion: RECORDED_SYSTEM_CONTRACT,
    submissionId,
    roundId,
    modelVersionId,
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
