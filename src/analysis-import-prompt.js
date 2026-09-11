import { ANALYSIS_SUBMISSION_VERSION } from './analysis-exchange.js';

const PROVIDERS = Object.freeze({
  openai: { key: 'openai', label: 'ChatGPT' },
  chatgpt: { key: 'openai', label: 'ChatGPT' },
  anthropic: { key: 'anthropic', label: 'Claude' },
  claude: { key: 'anthropic', label: 'Claude' }
});

function providerInfo(value) {
  return PROVIDERS[String(value || '').trim().toLowerCase()] || null;
}

export function recommendedAnalysisFilename(provider = 'ai') {
  const info = providerInfo(provider);
  const safe = info?.key || 'ai';
  return `kentaurai-analysis_${safe}_ÅÅÅÅ-MM-DD.json`;
}

export function buildAnalysisImportPrompt(provider = 'ai') {
  const info = providerInfo(provider);
  const providerKey = info?.key || '<openai eller anthropic enligt KentaurAI-underlaget>';
  const providerLabel = info?.label || 'den AI som gjort analysen';
  const filename = recommendedAnalysisFilename(provider);

  return `Du ska skapa en ren JSON-fil som kan importeras direkt i KentaurAI som en V85/V86-analys.

VIKTIGT
- Returnera endast giltig JSON. Ingen markdown, inga kodstaket och ingen förklarande text före eller efter JSON.
- Gissa aldrig KentaurAI-identiteter eller fingerprints. round_id, race_id, race_entry_id, context_fingerprint och parent_submission_id måste kopieras exakt från rätt KentaurAI-underlag eller från en tidigare sparad KentaurAI-submission i denna konversation.
- Om en obligatorisk KentaurAI-identitet saknas: skapa inte en påhittad fil. Be användaren om rätt KentaurAI-underlag.
- Använd null för verkligt okända frivilliga värden. Hitta aldrig på råfakta.
- data_snapshot_at får INTE finnas i klientfilen. KentaurAI sätter den tiden vid import.
- För en slutanalys får legs INTE finnas i klientfilen. KentaurAI kopierar den lagrade marknadsblinda styrkeanalysen från förhandsanalysen.

FILNAMN
Namnge filen enligt: ${filename}

KONTRAKT OCH PRODUCENT
- contract_version måste vara exakt "${ANALYSIS_SUBMISSION_VERSION}".
- producer.provider måste vara exakt "${providerKey}" för ${providerLabel}.
- producer.model är obligatoriskt och ska vara den faktiska modell som gjort analysen. Om den inte kan fastställas utan att gissa ska du inte skapa importfilen.
- submission_id är en idempotensnyckel och måste vara unik för filens innehåll. Den får endast bestå av gemena a-z, siffror och enkla bindestreck, till exempel "anthropic-20260912-v85-final-1". Ingen punkt, inget understreck, inga versaler och inga dubbla/ledande/avslutande bindestreck.
- context_fingerprint måste vara exakt sha256-värdet från det KentaurAI-underlag som hör till aktuellt steg.

DET FINNS TVÅ OLIKA KLIENTFORMAT

1. FÖRHANDSANALYS — stage = "pre_market"
Använd endast KentaurAI:s pre_market-context. Bedöm styrka marknadsblint innan streck/värde. Filen ska innehålla legs med alla aktiva, ej strukna hästar. parent_submission_id ska utelämnas eller vara null. systems ska vara en tom array.

PRE_MARKET-STRUKTUR
{
  "contract_version": "${ANALYSIS_SUBMISSION_VERSION}",
  "submission_id": "<unik-gemen-id-med-bindestreck>",
  "round_id": "<exakt KentaurAI round_id>",
  "stage": "pre_market",
  "producer": {
    "provider": "${providerKey}",
    "model": "<faktisk modell>"
  },
  "analysis_version": "<frivillig versionsetikett eller null>",
  "context_fingerprint": "sha256:<64 hextecken från pre_market-context>",
  "round_summary": "<kort sammanfattning eller null>",
  "recommendations": null,
  "legs": [ ... exakt 8 avdelningar ... ],
  "systems": []
}

VARJE AVDELNING I PRE_MARKET
{
  "leg_number": 1,
  "race_id": "<exakt race_id från KentaurAI>",
  "scenarios": null,
  "race_shape_summary": "<kort loppbild eller null>",
  "conclusion": "<slutsats eller null>",
  "data_quality": "<kort kvalitetsbedömning eller unknown>",
  "predictions": [ ... ]
}
Regler:
- legs måste innehålla exakt avdelning 1 till 8.
- race_id måste motsvara rätt lagrat lopp för avdelningen.
- predictions måste täcka varje ej struken start exakt en gång och får inte innehålla strukna hästar.

VARJE HÄSTBEDÖMNING I PRE_MARKET
{
  "race_entry_id": "<exakt KentaurAI race_entry_id>",
  "win_probability": 0.0,
  "uncertainty_low": null,
  "uncertainty_high": null,
  "raw_rank": 1,
  "abcd_group": "A",
  "scenario_robustness": null,
  "reasoning": "<kort motivering eller null>"
}
Regler:
- win_probability anges som decimal 0–1, inte procent 0–100.
- Summan av win_probability i varje avdelning måste vara 1.0 inom KentaurAI:s avrundningstolerans.
- raw_rank måste vara unik och obruten: 1, 2, 3 ... utan luckor eller dubbletter.
- abcd_group måste vara A, B, C eller D och avser relativ vinststyrka, inte spelvärde.
- uncertainty_low får inte överstiga win_probability.
- uncertainty_high får inte understiga win_probability.
- Skapa aldrig market_percent eller value_ratio. KentaurAI hämtar/beräknar dessa själv.

2. SLUTANALYS OCH SYSTEM — stage = "final"
Använd endast KentaurAI:s market-context som skapats för en redan sparad pre_market-submission. Slutfilen får INTE innehålla legs, predictions, win_probability, raw_rank eller abcd_group. KentaurAI kopierar den tidigare marknadsblinda styrkeanalysen oförändrad.

FINAL-STRUKTUR
{
  "contract_version": "${ANALYSIS_SUBMISSION_VERSION}",
  "submission_id": "<ny-unik-gemen-id-med-bindestreck>",
  "round_id": "<exakt KentaurAI round_id>",
  "stage": "final",
  "parent_submission_id": "<exakt lagrad pre_market submission_id>",
  "producer": {
    "provider": "${providerKey}",
    "model": "<faktisk modell>"
  },
  "analysis_version": "<frivillig versionsetikett eller null>",
  "context_fingerprint": "sha256:<64 hextecken från market-context för parent_submission_id>",
  "round_summary": "<kort slutlig sammanfattning eller null>",
  "recommendations": {
    "summary": "<spelidé, värdebedömning och reservationer>"
  },
  "systems": [ ... ]
}
Regler:
- parent_submission_id är obligatorisk och måste identifiera en redan sparad pre_market-submission för samma omgång.
- producer.provider måste vara samma canonical provider som i förhandsanalysen.
- context_fingerprint ska komma från market-context som hör till just denna parent_submission_id.
- legs får inte finnas i final-filen.

VARJE SYSTEM — ENDAST I FINAL
{
  "system_id": "<unik etikett i filen, till exempel main>",
  "system_type": "main",
  "budget_sek": 200,
  "line_price_sek": null,
  "risk_profile": null,
  "notes": null,
  "selections": [ ... ]
}
Varje selection ska ha:
{
  "leg_number": 1,
  "race_entry_id": "<exakt KentaurAI race_entry_id>",
  "is_spike": true,
  "selection_reason": "<kort motivering eller null>"
}
Systemregler:
- system_type måste vara "main" eller "alternative".
- Alla 8 avdelningar måste ha minst en vald häst.
- Varje V85/V86-system måste ha EXAKT 3 spikavdelningar i tre olika avdelningar.
- Varje spikavdelning måste ha exakt en vald häst och den selectionen ska ha is_spike = true.
- Varje avdelning med exakt en vald häst är en spik och måste markeras is_spike = true.
- Ingen flervalsavdelning får markeras som spik.
- Samma race_entry_id får inte förekomma två gånger i samma avdelning.
- Radantalet är produkten av antalet valda hästar i samtliga 8 avdelningar.
- budget_sek är obligatorisk och måste vara större än 0. För huvudsystemet är normal målbudget 150–250 SEK om inget annat uttryckligen beslutats.
- line_price_sek är frivillig/null. Om den anges måste budget_sek vara exakt radantal × line_price_sek inom KentaurAI:s tolerans.
- Skapa inte own_probability eller market_percent i selections. KentaurAI fyller dessa från den sparade analysen och marknaden.

KONTROLLERA INNAN FILEN SKAPAS
1. contract_version är exakt "${ANALYSIS_SUBMISSION_VERSION}".
2. submission_id följer strikt formatet gemena a-z/siffror med enkla bindestreck.
3. round_id, race_id, race_entry_id, context_fingerprint och eventuell parent_submission_id är kopierade från rätt KentaurAI-context och inte gissade.
4. data_snapshot_at finns inte i filen.
5. PRE_MARKET: exakt 8 legs; varje aktiv häst exakt en gång; sannolikheter summerar till 1.0; raw_rank är obruten; systems är tom.
6. FINAL: parent_submission_id finns; provider matchar parent; context_fingerprint kommer från rätt market-context; legs finns inte.
7. Varje system täcker alla 8 avdelningar och har exakt 3 en-hästs-spikar.
8. budget_sek, eventuell line_price_sek och systemets urval är matematiskt konsekventa.
9. JSON innehåller inga AI-skapade market_percent, value_ratio eller own_probability.
10. Filen innehåller endast giltig JSON och inget annat.`;
}
