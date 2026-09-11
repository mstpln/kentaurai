import { ANALYSIS_SUBMISSION_VERSION } from './analysis-exchange.js';

const PROVIDER_NAMES = Object.freeze({
  openai: 'ChatGPT',
  anthropic: 'Claude'
});

function providerName(value) {
  const key = String(value || '').trim().toLowerCase();
  return PROVIDER_NAMES[key] || 'AI';
}

export function recommendedAnalysisFilename(provider = 'ai') {
  const key = String(provider || 'ai').trim().toLowerCase();
  const safe = key === 'openai' || key === 'anthropic' ? key : 'ai';
  return `kentaurai-analysis_${safe}_ÅÅÅÅ-MM-DD.json`;
}

export function buildAnalysisImportPrompt(provider = 'ai') {
  const producer = providerName(provider);
  const filename = recommendedAnalysisFilename(provider);
  return `Du ska skapa en JSON-fil som kan importeras direkt i KentaurAI som en V85/V86-systemanalys.

VIKTIGT
- Returnera endast en ren JSON-fil. Ingen markdown, inga kodstaket och ingen förklarande text före eller efter JSON.
- Gissa aldrig KentaurAI-identiteter eller fingerprints. round_id, race_id, race_entry_id, context_fingerprint och parent_submission_id måste kopieras från KentaurAI-underlaget eller från en tidigare KentaurAI-submission i denna konversation.
- Om någon obligatorisk KentaurAI-identitet saknas: skapa inte en påhittad fil. Säg istället att användaren måste ladda upp rätt KentaurAI-underlag.
- Använd null för verkligt okända frivilliga värden. Utelämna inte obligatoriska fält.
- Ändra inte marknadsblind styrkebedömning i slutsteget.

FILNAMN
Namnge filen enligt: ${filename}

KONTRAKT
contract_version måste vara exakt: ${ANALYSIS_SUBMISSION_VERSION}
producer.provider ska beskriva ${producer} utan att hitta på någon annan producent.
producer.model ska vara den faktiska modell som gjort analysen om den är känd.
submission_id måste vara unikt för just denna fil och endast innehålla bokstäver, siffror, punkt, understreck, kolon och bindestreck.
data_snapshot_at måste vara en giltig ISO 8601-tidpunkt.
context_fingerprint måste vara exakt det sha256-värde som hör till KentaurAI-underlaget.

TVÅ ANALYSSTEG
1. Förhandsanalys: stage = "pre_market".
   - Marknadsblind styrkebedömning.
   - parent_submission_id får inte finnas.
   - systems måste vara en tom array.
   - Alla aktiva, ej strukna hästar i samtliga 8 avdelningar måste finnas exakt en gång under predictions.
2. Slutanalys/systemfil: stage = "final".
   - Kräver parent_submission_id från en redan sparad förhandsanalys för samma omgång och samma AI-producent.
   - win_probability, raw_rank och abcd_group måste vara exakt samma som i förhandsanalysen.
   - System, värdebedömning och rekommendationer får läggas till här.
   - Om parent_submission_id saknas i konversationen eller underlaget får du inte hitta på ett. Be då om rätt KentaurAI-underlag eller en importerad förhandsanalys först.

OBLIGATORISK TOPPNIVÅSTRUKTUR
{
  "contract_version": "${ANALYSIS_SUBMISSION_VERSION}",
  "submission_id": "<unik-id>",
  "round_id": "<exakt KentaurAI round_id>",
  "stage": "pre_market eller final",
  "parent_submission_id": "<krävs endast för final>",
  "producer": {
    "provider": "<faktisk producent>",
    "model": "<faktisk modell>"
  },
  "analysis_version": "<frivillig versionsetikett eller null>",
  "data_snapshot_at": "<ISO 8601>",
  "context_fingerprint": "sha256:<64 hextecken>",
  "round_summary": "<kort sammanfattning eller null>",
  "recommendations": null,
  "legs": [ ... exakt 8 avdelningar ... ],
  "systems": []
}

VARJE AVDELNING
Varje objekt i legs måste innehålla:
{
  "leg_number": 1,
  "race_id": "<exakt race_id från KentaurAI>",
  "scenarios": null,
  "race_shape_summary": "<kort loppbild eller null>",
  "conclusion": "<slutsats eller null>",
  "data_quality": "<kort kvalitetsbedömning eller unknown>",
  "predictions": [ ... ]
}
- legs måste innehålla exakt avdelning 1 till 8.
- race_id måste motsvara rätt lagrat lopp för avdelningen.
- predictions måste täcka varje ej struken start exakt en gång och får inte innehålla strukna hästar.

VARJE HÄSTBEDÖMNING
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
- Summan av win_probability i varje avdelning måste vara exakt 1.0 inom avrundningstolerans.
- raw_rank måste vara unik och obruten: 1, 2, 3 ... utan luckor eller dubbletter.
- abcd_group måste vara A, B, C eller D och avser relativ vinststyrka, inte spelvärde.
- uncertainty_low får inte överstiga win_probability.
- uncertainty_high får inte understiga win_probability.
- Skapa aldrig market_percent eller value_ratio. KentaurAI fyller/beräknar dessa själv.

SYSTEM – ENDAST VID stage = "final"
Varje system i systems ska ha:
{
  "system_id": "<unik etikett i filen, t.ex. main>",
  "system_type": "main eller alternative",
  "budget_sek": 0.0,
  "line_price_sek": 0.0,
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
- Alla 8 avdelningar måste ha minst en vald häst.
- Varje system måste ha EXAKT 3 spikavdelningar.
- En spikavdelning måste ha exakt en vald häst och den selectionen ska ha is_spike = true.
- Ingen flervalsavdelning får markeras som spik.
- Samma race_entry_id får inte förekomma två gånger i samma avdelning.
- Radantalet är produkten av antalet valda hästar i samtliga 8 avdelningar.
- Om line_price_sek anges måste budget_sek vara exakt radantal × line_price_sek.
- Skapa inte own_probability eller market_percent i systemets selections. KentaurAI fyller dessa från den sparade analysen och marknaden.

KONTROLLERA INNAN FILEN SKAPAS
1. contract_version är exakt ${ANALYSIS_SUBMISSION_VERSION}.
2. round_id, alla race_id, alla race_entry_id och context_fingerprint kommer från KentaurAI-underlaget och är inte gissade.
3. Det finns exakt 8 avdelningar.
4. Varje ej struken häst finns exakt en gång i predictions för sitt lopp.
5. Varje avdelnings win_probability summerar till 1.0.
6. raw_rank är obruten från 1 till antal aktiva hästar.
7. Vid final: parent_submission_id finns och styrkevärdena matchar förhandsanalysen exakt.
8. Varje system täcker alla 8 avdelningar och har exakt 3 spikar.
9. budget_sek, line_price_sek och systemets urval är matematiskt konsekventa.
10. JSON innehåller inga förbjudna AI-skapade market_percent, value_ratio eller own_probability.
11. Filen innehåller endast giltig JSON och inget annat.`;
}
