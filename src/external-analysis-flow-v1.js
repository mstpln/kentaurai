import { stableId } from './ids.js';
import { canonicalOptimizerPolicyForRound } from './analysis-optimizer-policy-config.js';
import { loadExternalRankingsV3, loadMarketDeadlineV3, loadVerifiedMarketRowsV3 } from './analysis-market-pack-v3.js';

export const EXTERNAL_ANALYSIS_FLOW_VERSION = 'external-analysis-v1';
export const MARKET_INPUT_CONTRACT = 'kentaurai-market-input-v1';
export const REGISTRATION_CONTEXT_CONTRACT = 'kentaurai-system-import-context-v1';
export const RECORDED_SYSTEM_CONTRACT = 'kentaurai-recorded-system-v1';
export const EXTERNAL_ANALYSIS_PROMPT_VERSION = 'external-analysis-prompt-v3';
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
    "# KentaurAI – Steg 1: Marknadsblind sportslig analys",
    "",
    'Du är ' + label + ' och ska analysera den uppladdade KentaurAI-filen för den valda V85/V86-omgången.',
    "",
    "Målet med Steg 1 är att göra en självständig, marknadsblind sportslig bedömning av varje aktiv hästs faktiska vinstchans i dagens lopp.",
    "",
    "Steg 1 ska svara på:",
    "",
    "\"Vilka hästar är mest sannolika vinnare utifrån verifierade sportsliga fakta, relevant historik, dagens förutsättningar och det sannolika löpningsscenariot – innan vi vet något om marknadens bedömning?\"",
    "",
    "Steg 1 är den sportsliga baslinjen för alla senare steg.",
    "",
    "---",
    "",
    "# ABSOLUTA REGLER",
    "",
    "- Använd endast information som finns i KentaurAI-filen.",
    "- Sök inte på webben.",
    "- Använd inte extern kunskap om dagens lopp.",
    "- Använd inte streckprocent, odds, spelarkollektiv, externa tips, externa rankingar, spelvärde eller annan marknadsinformation.",
    "- Om marknadsinformation av misstag skulle förekomma i filen ska den ignoreras helt.",
    "- Använd inte intervjuer, krönikor, redaktionella tips eller andra externa opinionssignaler i Steg 1, även om sådant av misstag skulle förekomma i underlaget. Dessa hör till senare steg.",
    "- Respektera filens as_of, cutoff och annan tidsmässig provenance. Använd aldrig information som uttryckligen ligger efter analysens tillåtna cutoff.",
    "- Okända faktauppgifter är okända. Hitta aldrig på statistik, tider, positioner, utrustning, citat eller andra fakta.",
    "- Saknad X-Labs-data eller annan frivillig data är aldrig negativt för hästen i sig. Det ökar endast osäkerheten.",
    "- Strukna hästar ska inte tilldelas vinstchans, ranking eller ABCD och ska inte ingå i sannolikhetsmassan.",
    "- Bygg inget spelsystem.",
    "- Välj inga spikar.",
    "- Gör ingen värdeanalys.",
    "- Jämför inte med marknadens bedömning.",
    "",
    "---",
    "",
    "# TRE NIVÅER SKA HÅLLAS ISÄR",
    "",
    "Skilj hela tiden mellan:",
    "",
    "1. Rå verifierad fakta",
    "2. KentaurAI:s deterministiskt beräknade features",
    "3. Din egen analytiska bedömning",
    "",
    "Rå fakta får aldrig förändras av analysen.",
    "",
    "Beräknade features är beslutsunderlag, inte automatiskt facit.",
    "",
    "Features som Form, performance-features, race_priors, person_context, equipment_response och track_analysis ska användas enligt sina levererade definitioner och evidensfält. Försök inte konstruera om KentaurAI:s deterministiska beräkningslogik.",
    "",
    "Använd underliggande data för att förstå och nyansera en feature, inte för att skapa en konkurrerande egen version av samma feature.",
    "",
    "---",
    "",
    "# KÄLLPRIORITET",
    "",
    "När uppgifter om samma faktum faktiskt står i konflikt ska följande tillförlitlighetsordning användas:",
    "",
    "1. Officiella verifierade fakta",
    "2. Direkta X-Labs-mätningar",
    "3. KentaurAI:s deterministiskt beräknade features",
    "4. Övrig strukturerad sportslig kontext",
    "",
    "Källprioritet och analytisk relevans är inte samma sak.",
    "",
    "En mycket relevant X-Labs-mätning för dagens situation kan vara mer analytiskt användbar än bred officiell statistik som mäter något annat.",
    "",
    "Vid verkliga konflikter:",
    "- dölj inte konflikten,",
    "- välj inte datapunkten som passar berättelsen,",
    "- utgå från mest tillförlitlig och relevant evidens,",
    "- och höj osäkerheten när konflikten påverkar bedömningen.",
    "",
    "---",
    "",
    "# KONTEXTSPECIFIK INFORMATION VÄGER TYNGST",
    "",
    "Relevant kontextspecifik statistik ska normalt väga tyngre än bred generell statistik när datakvalitet och sample är tillräckliga.",
    "",
    "Prioritera bland annat:",
    "- dagens startmetod,",
    "- liknande distans,",
    "- relevant startspår/startposition,",
    "- dagens bana eller jämförbar bankontext,",
    "- liknande klass och motstånd,",
    "- aktuell kusk,",
    "- aktuell tränare,",
    "- häst–kusk-kombination,",
    "- relevanta utrustningsförhållanden,",
    "- relevanta positioner och löpningsscenarier.",
    "",
    "Bred statistik ska fungera som stabiliserande bakgrund när mer specifik data är svag eller saknas.",
    "",
    "Anta aldrig att segmenterad statistik finns om den inte faktiskt finns i filen.",
    "",
    "---",
    "",
    "# SAMPLE, COVERAGE OCH EVIDENSSTYRKA",
    "",
    "Bedöm inte bara siffran utan också hur stark evidensen bakom siffran är.",
    "",
    "Ta hänsyn till:",
    "- sample size,",
    "- coverage,",
    "- hur nära statistiken ligger dagens kontext,",
    "- historikens ålder,",
    "- stabilitet,",
    "- eventuell backoff eller breddning av analysunderlaget,",
    "- history_selection och relevant-history-täckning när sådan information finns.",
    "",
    "Ett mycket specifikt sample på 1–2 starter ska inte automatiskt dominera ett större och fortfarande relevant sample.",
    "",
    "Ett stort men mycket generellt sample ska samtidigt inte automatiskt dominera tydligare aktuell information.",
    "",
    "När underlaget är svagt: sänk säkerheten i slutsatsen, inte automatiskt hästens vinstchans.",
    "",
    "---",
    "",
    "# UNDVIK DUBBELRÄKNING",
    "",
    "Flera KentaurAI-features kan beskriva samma bakomliggande prestation.",
    "",
    "Räkna inte samma information flera gånger bara för att den syns i flera delar av filen.",
    "",
    "Exempel:",
    "- Form och de starter som Form bygger på,",
    "- performance-features och samma relevant_history som ligger bakom dem,",
    "- officiella tider och X-Labs-fart när de beskriver samma prestation,",
    "- bästa fartvärden och de underliggande intervalltiderna,",
    "- trajectory_reconstruction och trip_scenario_500m_remaining,",
    "- positionsfeatures som bygger på samma positionsdata,",
    "- track_analysis och närliggande bana-/spårstatistik,",
    "- kusk/tränarstatistik och kombinationsfeatures baserade på samma starter.",
    "",
    "Överensstämmande signaler får stärka säkerheten i slutsatsen, men ska inte behandlas som flera oberoende bevis när de i praktiken kommer från samma information.",
    "",
    "---",
    "",
    "# ANALYSORDNING",
    "",
    "Följ denna ordning för varje avdelning:",
    "",
    "1. Datatäckning",
    "2. Grundkapacitet",
    "3. Form, klass och utveckling",
    "4. Fart och prestationsresurser",
    "5. Startförmåga",
    "6. Galopp och stabilitet",
    "7. Dagens individuella förutsättningar",
    "8. Kusk och tränare",
    "9. Utrustning",
    "10. Bana, race_priors och track_analysis",
    "11. Sannolik tidig position",
    "12. Tempo och löpningsscenario",
    "13. Alternativa realistiska scenarier",
    "14. Faktisk vinstchans",
    "15. Ranking",
    "16. ABCD",
    "17. Osäkerhet",
    "",
    "Ordningen är viktig: bedöm först hur bra hästen är. Bedöm sedan vilket lopp den sannolikt får. Sätt slutlig vinstchans först när båda delarna är analyserade.",
    "",
    "---",
    "",
    "# 1. DATATÄCKNING",
    "",
    "Bedöm först hur starkt underlaget är.",
    "",
    "Titta exempelvis på tillgång till:",
    "- relevant_history och history_aggregates,",
    "- officiella resultat och snapshots,",
    "- Form och övriga performance-features,",
    "- X-Labs och trajectory-data,",
    "- utrustning och equipment_response,",
    "- kusk/tränardata och person_context,",
    "- race_priors,",
    "- banprofil och track_analysis.",
    "",
    "Identifiera främst luckor som faktiskt kan påverka bedömningen. Lägg inte stor vikt vid irrelevanta saknade fält.",
    "",
    "Datatäckning ska framför allt påverka osäkerheten.",
    "",
    "---",
    "",
    "# 2. GRUNDKAPACITET",
    "",
    "Bedöm hästens inneboende sportsliga styrka innan dagens löpningsscenario vägs in.",
    "",
    "Fråga:",
    "",
    "\"Hur stark är denna häst jämfört med dagens motståndare om vi tillfälligt bortser från exakt vilket lopp den får?\"",
    "",
    "Väg bland annat in:",
    "- dokumenterad prestationsnivå,",
    "- bästa relevanta fartprestationer,",
    "- motståndets styrka,",
    "- klass,",
    "- prissumma/klasskontext där relevant,",
    "- prestationernas kvalitet,",
    "- hur hästen står sig relativt dagens motstånd.",
    "",
    "Använd official_start_points/Startpoäng när det finns som den officiella faktiska rating-/klasskontextsignal den är. Tolka den inte som ett direkt mått på startsnabbhet eller sannolikhet att nå ledningen.",
    "",
    "En stark prestation mot bättre motstånd ska normalt värderas högre än en liknande prestation mot klart sämre motstånd.",
    "",
    "En snabb tid får aldrig bedömas helt isolerat från prestationens sammanhang.",
    "",
    "---",
    "",
    "# 3. FORM, KLASS OCH UTVECKLING",
    "",
    "Bedöm:",
    "- aktuell form,",
    "- klassnivå,",
    "- förbättring eller försämring,",
    "- utvecklingsriktning,",
    "- stabilitet,",
    "- om senaste prestationerna är representativa.",
    "",
    "Använd KentaurAI:s Form-feature när den finns. Form är ett sammanvägt beslutsunderlag, inte facit.",
    "",
    "Förstå Form tillsammans med relevant_history, class_context och development utan att dubbelräkna samma starter.",
    "",
    "Övervärdera inte en ensam extrem prestation.",
    "",
    "Var särskilt uppmärksam på hästar som successivt förbättrats, nyligen mött betydligt hårdare motstånd eller har resultat som underskattar prestationernas faktiska kvalitet.",
    "",
    "---",
    "",
    "# 4. FART OCH PRESTATIONSRESURSER",
    "",
    "Använd de verifierade fartmätningar som faktiskt finns i filen.",
    "",
    "Det kan exempelvis omfatta:",
    "- första 100 m,",
    "- första 200 m,",
    "- första 500 m,",
    "- sista 400 m,",
    "- sista 1000 m,",
    "- officiell kilometertid,",
    "- andra relevanta X-Labs-intervall.",
    "",
    "När bästa/toppfart finns ska relevanta bästa prestationer väga tyngre än ett enkelt genomsnitt, men extrema enstaka mätningar med svagt sample ska behandlas försiktigt.",
    "",
    "Försök skilja mellan startsnabbhet, acceleration, marschfart, avslutningsförmåga och uthållig fart.",
    "",
    "Tider ska alltid sättas i relation till position, tempo, distans, lopp och klass/motstånd.",
    "",
    "---",
    "",
    "# 5. STARTFÖRMÅGA",
    "",
    "Bedöm startmomentet separat från generell kapacitet.",
    "",
    "Använd när tillgängligt:",
    "- första 100/200 m och annan verifierad öppningsdata,",
    "- startmetod,",
    "- spår/startposition,",
    "- historiska tidiga positioner,",
    "- X-Labs öppningsdata,",
    "- kusk/häst-kontext,",
    "- track_analysis för tidiga positioner,",
    "- avstånd till första sväng.",
    "",
    "VIKTIGT: official_start_points/Startpoäng är inte samma sak som startsnabbhet och får inte användas som ett direkt startsnabbhetsmått.",
    "",
    "Bedöm inte bara vem som är snabbast. Bedöm vem som faktiskt sannolikt når en viss position givet hela fältets beteende.",
    "",
    "Ta hänsyn till invändiga hästars möjlighet och sannolika vilja att svara, utvändiga hästars startsnabbhet, risk för körning, möjlig överflygling och möjlig släppning av ledningen.",
    "",
    "---",
    "",
    "# 6. GALOPP OCH STABILITET",
    "",
    "Använd gallop_risk och relevant galopphistorik när sådan finns.",
    "",
    "Bedöm risken kontextuellt, exempelvis efter startmetod, distans och andra relevanta sammanhang som faktiskt finns i filen.",
    "",
    "En generell galoppprocent ska inte automatiskt övertrumfa mer relevant kontext.",
    "",
    "Galopprisk ska påverka vinstchansen när den är sportsligt relevant, men dubbelräkna den inte om samma risk redan tydligt finns inbakad i annan feature.",
    "",
    "Okänd galoppstatus är okänd, inte automatiskt 'ingen galopp'.",
    "",
    "---",
    "",
    "# 7. DAGENS INDIVIDUELLA FÖRUTSÄTTNINGAR",
    "",
    "Bedöm:",
    "- distans,",
    "- startmetod,",
    "- spår/startposition,",
    "- faktisk startdistans och eventuell tilläggsposition,",
    "- relevant method_distance-kontext,",
    "- vila/readiness och jämförbara vilomönster när de finns,",
    "- kusk,",
    "- tränare,",
    "- häst–kusk-kombination,",
    "- verifierad utrustning och utrustningsförändringar,",
    "- andra verifierade aktuella faktorer i filen.",
    "",
    "Skilj tydligt mellan stora och små effekter. En faktor ska bara flytta bedömningen mycket när relevant evidens motiverar det.",
    "",
    "---",
    "",
    "# 8. KUSK OCH TRÄNARE",
    "",
    "Använd person_context som kontext till hästens prestation, inte som fristående prestige- eller namnranking.",
    "",
    "Titta främst på:",
    "- aktuell relevant form/statistik,",
    "- relevanta tidsfönster och sample,",
    "- dagens startmetod och distans när sådan segmentering finns,",
    "- aktuell häst–kusk-kombination,",
    "- relevant historik med samma häst,",
    "- tydliga dokumenterade skillnader mellan kombinationer.",
    "",
    "Om person_context använder provider_fallback ska det vägas som fallback och inte behandlas som lika specifikt som egen relevant historik.",
    "",
    "Övervärdera inte bred generell kusk-/tränarstatistik som saknar tydlig koppling till dagens situation.",
    "",
    "---",
    "",
    "# 9. UTRUSTNING",
    "",
    "Använd endast verifierad utrustningsinformation och equipment_response när sådan finns.",
    "",
    "Skilj mellan:",
    "- dagens utrustning,",
    "- faktisk förändring från tidigare starter,",
    "- hästens historiska prestation med motsvarande utrustning,",
    "- tränarens historiska förändringsmönster när det finns tillräcklig evidens.",
    "",
    "En utrustningsändring är inte automatiskt positiv eller negativ.",
    "",
    "Dra slutsats endast när sample, coverage och evidens motiverar det.",
    "",
    "Saknad utrustningsdata är okänd, inte negativ.",
    "",
    "---",
    "",
    "# 10. BANA, RACE_PRIORS OCH TRACK_ANALYSIS",
    "",
    "## Banprofil",
    "",
    "Använd banprofilen som relevant kontext. Den kan bland annat innehålla banlängd, bredd, upplopp, dosering, open stretch, kurvtyp, riktning, till första sväng och startplats för aktuell distans.",
    "",
    "Ge särskild betydelse åt till första sväng när det är relevant för startstriden.",
    "",
    "Omvandla inte automatiskt geometri till kausala påståenden.",
    "",
    "Exempel:",
    "- kort upplopp betyder inte automatiskt spetsfördel,",
    "- open stretch betyder inte automatiskt fördel för rygg ledaren,",
    "- bred bana betyder inte automatiskt fördel för ytterspår.",
    "",
    "Geometrin är kontext. Observerad statistik avgör om en faktisk effekt går att stödja.",
    "",
    "## race_priors",
    "",
    "race_priors är deterministiska historiska baslinjer för loppets kontext, utfall, startposition och shape. De är inte en färdig hästbedömning.",
    "",
    "Använd dem som populationell kontext och prior när den är relevant, men låt dem inte mekaniskt övertrumfa stark hästspecifik evidens.",
    "",
    "Respektera hierarchy/backoff, sample och evidensstyrka. Undvik dubbelräkning mot track_analysis eller andra features som bygger på närliggande historiska populationer.",
    "",
    "## track_analysis",
    "",
    "track_analysis är deterministisk historisk bankontext, inte en färdig hästbedömning.",
    "",
    "Använd särskilt sample, coverage, analysis_basis, dagens startmetod, distans/distance group, spår och relevanta positions-/scenarioresultat.",
    "",
    "Små samples ska ge lägre säkerhet. Om analysis_basis visar att underlaget har breddats ska slutsatsen bli försiktigare.",
    "",
    "Baseline jämför motsvarande kontext i samma land, exklusive dagens bana. Skillnaden mot baseline är ett empiriskt samband, inte automatiskt ett kausalt samband.",
    "",
    "VIKTIGT OM MÄTPUNKTER:",
    "- Entry-level relevant_history[].trip_scenario_500m_remaining beskriver klassificerat historiskt läge omkring 500 m kvar.",
    "- track_analysis.trip_scenario_500m_remaining ska alltid läsas enligt sitt measurement_policy.",
    "- I nuvarande track_analysis-kontrakt mäts leader/spets vid 500 m efter start, medan övriga namngivna positioner mäts omkring 500 m kvar.",
    "- Behandla aldrig 500m_after_start och 500m_remaining som samma mätpunkt.",
    "",
    "---",
    "",
    "# 11. TROLIGA TIDIGA POSITIONER",
    "",
    "Bedöm hur loppet sannolikt positionerar sig efter startstriden.",
    "",
    "För viktiga hästar, uppskatta när underlaget tillåter:",
    "- chans till ledningen,",
    "- risk att bli svarad,",
    "- sannolikhet för rygg ledaren,",
    "- risk för dödens,",
    "- sannolikhet för andra ytter,",
    "- risk att bli fast invändigt,",
    "- risk att hamna långt bak.",
    "",
    "Använd tillsammans spår/startposition, startmetod, verifierad öppningsfart, X-Labs, historiska tidiga positioner, trajectory, kusk/häst-kontext, track_analysis, till första sväng och hela fältets startsnabbhet.",
    "",
    "Var försiktig med falsk precision.",
    "",
    "---",
    "",
    "# 12. HISTORISKA LÖPNINGSSCENARIER",
    "",
    "Entry-level trip_scenario_500m_remaining beskriver historiskt klassificerad position omkring 500 m kvar. Det är inte samma sak som startposition eller vem som tar spets initialt.",
    "",
    "Använd historiken för att förstå vilka resor hästen fungerar väl eller sämre i, hur robust hästen är för olika resor och vilka av dagens realistiska scenarier som passar hästen.",
    "",
    "Dubbelräkna inte samma positionsevidens från trajectory_reconstruction och trip_scenario_500m_remaining.",
    "",
    "För track_analysis gäller den separata measurement_policy-regeln ovan.",
    "",
    "---",
    "",
    "# 13. TEMPO OCH LOPPDYNAMIK",
    "",
    "Bedöm det sannolika tempot.",
    "",
    "Fråga bland annat:",
    "- Hur många vill eller kan köra om ledningen?",
    "- Finns en tydlig spetsfavorit?",
    "- Finns risk för utdragen spetsstrid?",
    "- Kan någon ta över efter första biten?",
    "- Riskerar en stark häst dödens?",
    "- Kan en favorit behöva göra mycket eget arbete?",
    "- Finns risk för överpace?",
    "- Finns istället risk för lågt, positionsberoende tempo?",
    "- Vilka gynnas av respektive tempo?",
    "",
    "Tempo och position får påverka slutbedömningen kraftigt när loppet är scenario-känsligt.",
    "",
    "---",
    "",
    "# 14. SCENARIOANALYS",
    "",
    "Skapa alternativa scenarier när loppet faktiskt är scenario-känsligt.",
    "",
    "Normalt räcker 2–4 realistiska scenarier. I ett enkelt lopp kan ett tydligt huvudscenario räcka.",
    "",
    "För varje viktigt scenario:",
    "- vad händer?",
    "- vilka gynnas?",
    "- vilka missgynnas?",
    "- hur sannolikt är scenariot relativt alternativen?",
    "",
    "Använd inte exakta scenarioprocent om underlaget inte motiverar sådan precision.",
    "",
    "Men slutlig vinstchans ska i praktiken representera en sammanvägning över de realistiska scenarierna.",
    "",
    "Scenarioanalysen får inte bara vara text. Den ska kunna förändra vinstchans, ranking, ABCD och osäkerhet.",
    "",
    "---",
    "",
    "# GRUNDKAPACITET ÄR INTE SAMMA SAK SOM VINSTCHANS",
    "",
    "GRUNDKAPACITET = hur bra hästen är sportsligt.",
    "",
    "FAKTISK VINSTCHANS = hur ofta hästen förväntas vinna just dagens lopp givet hela den sannolika scenariofördelningen.",
    "",
    "En häst kan vara bäst kapacitetsmässigt men ändå inte ha högst vinstchans om den exempelvis sannolikt hamnar i dödens, har dåligt utgångsläge, riskerar att bli hängande, är mycket spetsberoende eller missgynnas av det mest sannolika tempot.",
    "",
    "En något svagare häst kan få högre faktisk vinstchans om den sannolikt når spets, får ett billigt lopp, får rätt rygg, har låg scenariorisk eller är robust i flera realistiska scenarier.",
    "",
    "Löpningsscenariot är därför inte en liten justering på slutet. I vissa lopp ska det vara en av de mest avgörande faktorerna i hela analysen.",
    "",
    "---",
    "",
    "# 15. SLUTLIG VINSTCHANS",
    "",
    "När den sportsliga analysen är klar:",
    "",
    "1. Bedöm grundkapaciteten.",
    "2. Väg in form, klass och utveckling.",
    "3. Väg in dagens individuella förutsättningar.",
    "4. Väg in startmoment och sannolik position.",
    "5. Väg in tempo.",
    "6. Väg in sannolika scenarier.",
    "7. Väg in scenario-robusthet och relevanta risker.",
    "8. Sätt relativa vinstchanser.",
    "9. Normalisera därefter till exakt 100 % bland aktiva hästar.",
    "",
    "Sätt inte procent häst för häst utan hänsyn till resten av fältet. Bedöm först den relativa styrkefördelningen i hela loppet och normalisera därefter.",
    "",
    "---",
    "",
    "# ANTI-FLATTENING-KONTROLL",
    "",
    "Undvik systematiskt för platta sannolikhetsfördelningar.",
    "",
    "Sannolikheterna ska spegla den faktiska sportsliga skillnaden mellan hästarna, inte modellens ovilja att göra tydliga bedömningar.",
    "",
    "Om en häst är klart bäst kapacitetsmässigt, har stark aktuell form, passar dagens förutsättningar och dessutom har ett gynnsamt eller robust sannolikt scenario ska detta kunna ge en tydligt koncentrerad vinstchans.",
    "",
    "När flera positiva signaler sammanfaller ska deras samlade betydelse synas tydligt i procenten, men korrelerade signaler får fortfarande inte dubbelräknas.",
    "",
    "Använd inga konstgjorda sannolikhetstak eller golv.",
    "",
    "En tydlig vinnarkandidat får ha 35 %, 45 %, 55 % eller ännu högre om den samlade analysen faktiskt motiverar det.",
    "",
    "Tvinga inte en stark favorit under 20–25 % bara därför att trav innehåller osäkerhet.",
    "",
    "För varje lopp ska du explicit kontrollera:",
    "",
    "1. Finns en tydlig förstahäst? Om ja, syns skillnaden tydligt i procenten?",
    "2. Finns två tydliga topphästar? Om ja, ligger de tydligt över resterande fält?",
    "3. Är loppet genuint jämnt? Endast då bör sannolikhetsfördelningen vara relativt platt.",
    "4. Har en häst både hög grundkapacitet och gynnsamt scenario? Då ska generell osäkerhet inte artificiellt hålla nere procenten.",
    "5. Har en kapacitetsstark häst ett tydligt negativt scenario? Då ska procenten kunna justeras ned kraftigt.",
    "6. Har lågklassade hästar fått för mycket sannolikhetsmassa endast därför att \"allt kan hända\"? Om ja, korrigera.",
    "",
    "OSÄKERHET SKA INTE AUTOMATISKT LÖSAS GENOM ATT PRESSA IHOP ALLA VINSTCHANSER MOT MITTEN.",
    "",
    "Uttryck istället osäkerhet i kolumnen Osäkerhet, scenariobeskrivningen och relevant motivering.",
    "",
    "Undvik falsk precision i decimaler och små differenser. Använd aldrig detta som skäl för att göra hela sannolikhetsfördelningen platt.",
    "",
    "---",
    "",
    "# SANNOLIKHETSKALIBRERING",
    "",
    "Kontrollera slutligen:",
    "- Är toppen för platt trots tydlig styrkeskillnad?",
    "- Är toppen för koncentrerad trots genuint jämnt lopp?",
    "- Har scenario-risken verkligen påverkat favoriten?",
    "- Har sannolik spets fått tillräcklig betydelse där spets är viktig?",
    "- Har en stark men scenario-utsatt häst justerats ned tillräckligt?",
    "- Har outsiders fått för stor sannolikhetsmassa utan sportsligt stöd?",
    "- Summerar de visade sannolikheterna exakt till 100 %?",
    "",
    "Vinstchansen ska representera bedömd vinstfrekvens. Den är inte bara en rankingpoäng.",
    "",
    "---",
    "",
    "# 16. RANKING",
    "",
    "Alla aktiva hästar ska ha unik ranking.",
    "",
    "Ranking ska följa vinstchansen fallande.",
    "",
    "Om två hästar får samma visade avrundade procent, använd den underliggande exakta bedömningen och därefter en medveten sportslig tie-break.",
    "",
    "Tie-break kan exempelvis baseras på scenario-robusthet, sannolik position, grundkapacitet, lägre risk eller starkare relevant evidens.",
    "",
    "Ändra inte procenten bara för att skapa unik ranking.",
    "",
    "Visa procent med tillräcklig precision för att tabellen ska vara begriplig och de visade chanserna ska kunna summera exakt till 100 %.",
    "",
    "---",
    "",
    "# 17. ABCD",
    "",
    "ABCD beskriver relativ vinststyrka i DAGENS LOPP.",
    "",
    "Det är inte en ren kapacitetsklassning och det är inte spelvärde.",
    "",
    "ABCD ska väga ihop hela den scenariojusterade sportsliga bedömningen:",
    "- grundkapacitet,",
    "- form,",
    "- klass,",
    "- utveckling,",
    "- dagens förutsättningar,",
    "- startposition,",
    "- sannolik tidig position,",
    "- tempo,",
    "- sannolikt löpningsscenario,",
    "- scenario-robusthet,",
    "- galopprisk,",
    "- sannolikheten för gynnsamma respektive ogynnsamma resor.",
    "",
    "Löpningsscenariot ska väga mycket när det har stor påverkan på faktisk vinstchans.",
    "",
    "En mycket stark häst kan därför klassas lägre om dagens sannolika resa är klart negativ. En något svagare häst kan klassas högre om den har en klart bättre scenariofördelning.",
    "",
    "ABCD ska följa naturliga styrkeskillnader i den slutliga vinstbedömningen.",
    "",
    "Använd inte ett förutbestämt antal hästar per grupp.",
    "",
    "A = loppets starkaste vinnarkandidater efter scenariojustering.",
    "B = tydliga utmanare med realistisk vinstchans, men lägre samlad styrka eller större frågetecken än A.",
    "C = hästar som kräver mer gynnsamt förlopp eller har tydligt lägre samlad vinststyrka.",
    "D = hästar med låg relativ vinstchans utifrån dagens samlade sportsliga analys.",
    "",
    "ABCD ska bilda sammanhängande styrkeband i rankingordningen. När rankingen har gått från A till B får en senare häst inte återgå till A; motsvarande gäller mellan B, C och D.",
    "",
    "Minst loppets starkaste nivå ska representeras av A, men tvinga inte ett visst antal A-, B-, C- eller D-hästar.",
    "",
    "ABCD måste vara förenligt med vinstchanser, ranking och dagens sannolika scenario.",
    "",
    "ABCD får aldrig påverkas av streck, odds eller spelvärde.",
    "",
    "---",
    "",
    "# 18. OSÄKERHET",
    "",
    "Sätt Osäkerhet per häst som Låg, Medel eller Hög.",
    "",
    "Bedöm utifrån:",
    "- datatäckning,",
    "- sample size,",
    "- kontextrelevans,",
    "- konflikter mellan signaler,",
    "- osäker startposition,",
    "- scenario-känslighet,",
    "- okända aktuella faktorer,",
    "- hur robust hästens bedömning är över alternativa loppförlopp.",
    "",
    "Osäkerhet är inte samma sak som vinstchans.",
    "",
    "En stark favorit kan ha hög osäkerhet. En svag outsider kan ha låg osäkerhet.",
    "",
    "---",
    "",
    "# ROBUSTHET ÖVER SCENARIER",
    "",
    "Skilj särskilt mellan:",
    "",
    "ROBUST VINNARKANDIDAT: har hög vinstchans i flera realistiska scenarier.",
    "",
    "SCENARIOBEROENDE VINNARKANDIDAT: är mycket stark i ett visst scenario men tappar kraftigt om loppet utvecklas annorlunda.",
    "",
    "Denna skillnad ska påverka vinstchans, ABCD och osäkerhet.",
    "",
    "---",
    "",
    "# INTERN SLUTKONTROLL PER AVDELNING",
    "",
    "Innan du presenterar resultatet, kontrollera:",
    "",
    "1. Alla strukna hästar är exkluderade.",
    "2. Alla aktiva hästar har vinstchans.",
    "3. Visade sannolikheter summerar exakt till 100 %.",
    "4. Ranking följer sannolikheterna.",
    "5. Ranking är unik.",
    "6. ABCD är konsekvent med faktisk scenariojusterad vinststyrka och bildar sammanhängande styrkeband.",
    "7. Löpningsscenariot har faktiskt påverkat bedömningen.",
    "8. Ingen viktig signal är dubbelräknad.",
    "9. Små samples har inte övervärderats.",
    "10. Saknad data har inte behandlats som negativ.",
    "11. Ingen marknads-, tips-, intervju- eller krönikedata har påverkat Steg 1.",
    "12. Favoriten är inte artificiellt nedtryckt.",
    "13. Outsiders har inte fått gratis sannolikhetsmassa.",
    "14. De viktigaste procentskillnaderna går att förklara sportsligt.",
    "15. Positionsprognosen är förenlig med startdata, spår och övriga konkurrenter.",
    "16. Startpoäng har inte misstolkats som startsnabbhet.",
    "17. 500m_after_start och 500m_remaining har inte blandats ihop.",
    "",
    "Korrigera analysen innan output om något inte håller.",
    "",
    "---",
    "",
    "# OUTPUT I CHATTEN",
    "",
    "Analysera samtliga 8 avdelningar.",
    "",
    "Håll outputen koncentrerad. Tabellen är huvudprodukten.",
    "",
    "För varje avdelning:",
    "",
    "## V85/V86-X",
    "",
    "### Bedömning",
    "",
    "| Nr | Häst | ABCD | Est. vinstchans | Rank | Osäkerhet | Kort motivering |",
    "|---|---|---|---:|---:|---|---|",
    "",
    "KRAV:",
    "- Alla aktiva hästar ska vara med.",
    "- Strukna hästar ska inte vara med.",
    "- Visade vinstchanser ska summera till exakt 100 %.",
    "- Ranking ska vara unik och följa vinstchansen fallande.",
    "- ABCD ska baseras på samlad scenariojusterad vinststyrka.",
    "- Osäkerhet ska anges som Låg, Medel eller Hög.",
    "- Motiveringen ska vara kort och fokusera på de 1–3 faktorer som faktiskt driver hästens bedömning.",
    "",
    "Prioritera exempelvis kapacitet, form/klass, relevant fart, startsnabbhet, sannolik position, löpningsscenario, galopprisk och tydlig aktuell fördel/nackdel.",
    "",
    "Återge inte hela datamängden i tabellen.",
    "",
    "## Spetsstrid",
    "",
    "Direkt under tabellen ska du kort och tydligt beskriva:",
    "- vilka hästar som främst gör upp om ledningen,",
    "- vem som är mest sannolik att ta spets,",
    "- vem/vilka som kan svara,",
    "- om någon sannolikt tar över efter första biten,",
    "- om någon sannolikt söker rygg,",
    "- om det finns risk för utdragen körning.",
    "",
    "Var tydlig med vilket scenario du bedömer som mest sannolikt. Om spetsstriden är mycket öppen, säg det.",
    "",
    "## Trolig positionering när loppet satt sig",
    "",
    "Ge den mest sannolika positionsbilden efter den första körningen, när fältet börjat hitta sina positioner.",
    "",
    "Detta är INTE samma sak som exakt position efter 100 m och inte samma sak som historiskt trip_scenario_500m_remaining.",
    "",
    "Använd när relevant:",
    "- **Spets:** nr + häst",
    "- **Rygg ledaren:** nr + häst",
    "- **3:e invändigt:** nr + häst",
    "- **Dödens:** nr + häst",
    "- **2:a ytter:** nr + häst",
    "- **3:e ytter:** nr + häst",
    "",
    "Ange bara en specifik häst när bedömningen har rimligt stöd.",
    "",
    "Om en position är osäker, skriv exempelvis:",
    "- **Dödens:** främst 7 Häst A, alternativt 5 Häst B",
    "- **2:a ytter:** osäkert mellan 6 Häst C och 9 Häst D",
    "",
    "Tvinga aldrig fram falsk precision.",
    "",
    "Om loppets struktur gör någon av dessa positioner irrelevant eller om underlaget inte räcker, skriv det istället för att hitta på.",
    "",
    "Positionsprognosen ska bygga på den samlade bilden av spår/startposition, startmetod, verifierad öppningsfart, X-Labs, historiska tidiga positioner, kusk/häst-kontext, till första sväng, track_analysis och konkurrenternas sannolika taktiska val.",
    "",
    "Målet är att konkret beskriva de 5–6 viktigaste positionerna i loppets sannolika huvudscenario.",
    "",
    "## Scenarioeffekt",
    "",
    "Skriv därefter 2–4 korta meningar om vad positioneringen betyder för loppet.",
    "",
    "Förklara tydligt:",
    "- vem som sannolikt kontrollerar loppet,",
    "- vem som riskerar ett tungt lopp,",
    "- vem som får en gynnsam resa,",
    "- om tempot sannolikt blir lågt, normalt eller högt,",
    "- vilka hästar som främst gynnas eller missgynnas,",
    "- vilken stark häst som eventuellt är mest scenario-sårbar.",
    "",
    "Om ett realistiskt alternativt scenario skulle ändra loppet kraftigt, nämn det kort.",
    "",
    "Denna text ska förklara varför tabellens sannolikheter och ABCD ser ut som de gör.",
    "",
    "---",
    "",
    "# OMGÅNGSSAMMANFATTNING",
    "",
    "När alla 8 avdelningar är färdiga, avsluta kort med:",
    "- tydligaste sportsliga förstahästarna,",
    "- mest robusta vinnarkandidaterna,",
    "- mest scenario-beroende topphästarna,",
    "- mest öppna loppen,",
    "- mest scenario-känsliga loppen,",
    "- var datatäckningen är starkast,",
    "- var osäkerheten är störst.",
    "",
    "Detta är fortfarande marknadsblind sportslig analys.",
    "",
    "Gör ingen värdeanalys. Bygg inget system. Välj inga spikar.",
    "",
    "---",
    "",
    "# STOPP EFTER STEG 1",
    "",
    "Behåll Steg 1:s vinstchanser, ranking, ABCD och scenarioanalys låsta i denna konversation.",
    "",
    "När Steg 1 är färdigt ska du stanna.",
    "",
    "Jag kommer därefter att ladda upp KentaurAI:s Steg 2-fil med marknadsdata i samma konversation.",
    "",
    "Steg 2 ska jämföra marknaden mot den redan genomförda marknadsblinda analysen.",
    "",
    "Steg 2 får inte skriva om Steg 1 i efterhand för att få den sportsliga bedömningen att passa streck, odds eller marknadens uppfattning.",
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
    '- Registrera det faktiskt färdiga/spelade systemet även om dess beräknade kostnad ligger utanför KentaurAI:s normala målbudget; bygg inte om systemet för att passa målbudgeten.',
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
