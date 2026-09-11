import { ANALYSIS_SUBMISSION_VERSION } from './analysis-exchange.js';

export const ANALYSIS_IMPORT_INSTRUCTIONS_VERSION = 'kentaurai-analysis-import-instructions-v1';
export const ANALYSIS_IMPORT_CONTRACT_VERSION = ANALYSIS_SUBMISSION_VERSION;

export function buildAnalysisImportInstructions() {
  return `Du ska skapa en JSON-fil som kan importeras direkt i KentaurAI.

VIKTIGT
- Svara med en ren JSON-fil och ingenting annat. Ingen markdown, inga kodstaket, inga kommentarer och ingen förklarande text runt JSON-objektet.
- Uppfinn aldrig KentaurAI-identiteter eller fakta. Om ett obligatoriskt round_id, race_id, race_entry_id, context_fingerprint eller parent_submission_id saknas i materialet du har, skapa inte en gissad fil. Be i stället användaren att ladda upp rätt KentaurAI-underlag.
- Saknade valfria fakta ska vara null, inte gissningar.
- Använd exakt contract_version "${ANALYSIS_SUBMISSION_VERSION}".
- Rekommenderat filnamn är kentaurai-analysis_<provider>_ÅÅÅÅ-MM-DD.json, där <provider> är openai eller anthropic.
- producer.provider ska vara "openai" för ChatGPT eller "anthropic" för Claude.
- producer.model ska vara den exakta modellbeteckningen som gjorde analysen om den är känd. Om den inte är känd: använd en kort sanningsenlig beteckning för den aktuella modellen, inte en påhittad versionssträng.

KentaurAI arbetar i två steg. Avgör vilket steg som kan skapas utifrån materialet i konversationen.

STEG 1: FÖRHANDSANALYS / pre_market
Skapa stage "pre_market" när den marknadsblinda grundanalysen ska importeras.
- systems måste vara en tom array eller utelämnas.
- parent_submission_id får inte finnas.
- predictions ska omfatta exakt varje icke-struken start i varje avdelning exakt en gång.
- Aktuella marknadsprocent, odds, value_ratio eller andra marknadsfakta får inte läggas in i prediction-objekten.

STEG 2: SLUTANALYS / final
Skapa stage "final" när marknadsvärdering och V85/V86-system ska importeras.
- parent_submission_id är obligatoriskt och måste vara exakt ID för en redan lagrad pre_market-submission för samma omgång och samma provider.
- context_fingerprint ska kopieras från det aktuella market-contextet, inte från det äldre pre_market-contextet.
- De marknadsblinda win_probability, raw_rank och abcd_group-värdena måste vara identiska med den lagrade pre_market-filen. De får inte skrivas om efter att marknaden har blivit synlig.
- recommendations och systems får läggas till.

TOPPNIVÅ – obligatorisk struktur
{
  "contract_version": "${ANALYSIS_SUBMISSION_VERSION}",
  "submission_id": "UNIKT_ID",
  "round_id": "EXAKT_ROUND_ID_FRÅN_KENTAURAI",
  "stage": "pre_market eller final",
  "parent_submission_id": "ENDAST_FINAL_ELLER_UTELÄMNA",
  "context_fingerprint": "sha256:... EXAKT_FRÅN_AKTUELLT_CONTEXT",
  "producer": {
    "provider": "openai eller anthropic",
    "model": "EXAKT_MODELL"
  },
  "analysis_version": "valfri kort versionsetikett eller null",
  "data_snapshot_at": "ISO-8601 datum/tid",
  "round_summary": "kort svensk sammanfattning eller null",
  "recommendations": "valfritt objekt eller null",
  "legs": [EXAKT_8_AVDELNINGAR],
  "systems": [SYSTEM_ENDAST_FINAL]
}

submission_id
- Måste vara unikt för denna fil.
- Tillåtna tecken: bokstäver, siffror, punkt, understreck, kolon och bindestreck.
- Återanvänd aldrig ett gammalt submission_id för ändrat innehåll.

legs
- Exakt åtta objekt, ett för varje avdelning 1–8.
- Sortera dem i avdelningsordning.
- Varje leg ska ha:
{
  "leg_number": 1,
  "race_id": "EXAKT_RACE_ID_FRÅN_KENTAURAI",
  "scenarios": null,
  "race_shape_summary": "svensk loppbild eller null",
  "conclusion": "kort svensk slutsats eller null",
  "data_quality": "sufficient, limited eller unknown",
  "predictions": [ALLA_AKTIVA_HÄSTAR]
}

predictions
Varje icke-struken start i avdelningen måste förekomma exakt en gång. Inga strukna hästar får finnas med.
Varje prediction ska ha:
{
  "race_entry_id": "EXAKT_RACE_ENTRY_ID_FRÅN_KENTAURAI",
  "win_probability": 0.125,
  "uncertainty_low": null,
  "uncertainty_high": null,
  "raw_rank": 1,
  "abcd_group": "A",
  "scenario_robustness": null,
  "reasoning": {
    "summary": "kort svensk motivering"
  }
}

Regler för predictions
- win_probability anges som sannolikhet 0–1, inte procent 0–100.
- Summan av win_probability inom varje avdelning måste vara exakt 1.0 inom normal avrundningstolerans.
- raw_rank måste vara unika heltal 1, 2, 3 ... utan luckor eller dubletter för samtliga aktiva hästar i avdelningen.
- abcd_group får endast vara A, B, C eller D och beskriver relativ vinststyrka, inte spelvärde.
- uncertainty_low och uncertainty_high är valfria 0–1. Om de anges får low inte vara högre än win_probability och high inte lägre.
- scenario_robustness är valfri 0–1.
- value_ratio och market_percent får INTE skickas. KentaurAI beräknar/lagrar dessa själv.

systems – endast stage final
Varje system ska ha:
{
  "system_id": "main",
  "system_type": "main",
  "budget_sek": 200,
  "line_price_sek": null,
  "risk_profile": "balanced",
  "notes": "kort svensk systemkommentar eller null",
  "selections": [ALLA_VALDA_HÄSTAR_I_8_AVDELNINGAR]
}

Regler för system
- system_type får endast vara "main" eller "alternative".
- system_id måste vara unikt inom filen.
- Varje system måste ha minst en vald häst i samtliga åtta avdelningar.
- Varje selection ska vara:
  {
    "leg_number": 1,
    "race_entry_id": "EXAKT_RACE_ENTRY_ID_FRÅN_KENTAURAI",
    "is_spike": true,
    "selection_reason": "kort svensk motivering eller null"
  }
- Ett V85/V86-system måste innehålla EXAKT TRE spikavdelningar.
- En spikavdelning måste innehålla exakt en vald häst och den selectionen ska ha is_spike true.
- Övriga selections ska ha is_spike false.
- Samma häst/start får inte förekomma två gånger i samma avdelning.
- race_entry_id måste tillhöra en aktiv, icke-struken start i rätt avdelning.
- Antal systemrader beräknas som produkten av antalet valda hästar i alla åtta avdelningar. KentaurAI räknar detta själv; skicka inget row_count-fält som källa.
- Om line_price_sek anges måste budget_sek vara exakt antal rader × line_price_sek. Om radpris inte är säkert känt, sätt line_price_sek till null och använd den avsedda budgeten i budget_sek.
- Systemets own_probability, market_percent, estimated totals, value_ratio eller row_count ska inte skickas som AI-fakta. KentaurAI härleder dessa där det är relevant.

SLUTKONTROLL INNAN FILEN SKAPAS
1. contract_version är exakt "${ANALYSIS_SUBMISSION_VERSION}".
2. round_id och context_fingerprint är kopierade exakt från aktuellt KentaurAI-context.
3. Filen innehåller exakt 8 legs med rätt race_id.
4. Varje leg innehåller exakt alla icke-strukna race_entry_id en gång.
5. Sannolikheterna summerar till 1.0 i varje avdelning.
6. Rankningarna är 1..N utan luckor eller dubletter.
7. Inga value_ratio eller market_percent har lagts in i predictions.
8. Vid final finns giltigt parent_submission_id och pre_market-styrkan är oförändrad.
9. Varje final-system täcker alla 8 avdelningar och har exakt 3 spikar.
10. JSON är syntaktiskt giltig och innehåller ingen text utanför JSON-objektet.

Om något av dessa krav inte kan uppfyllas utifrån KentaurAI-underlaget: skapa inte gissade värden. Tala i stället om exakt vilket KentaurAI-underlag som saknas.`;
}
