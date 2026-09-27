# Inställningar: AI och Data

KentaurAI har en privat inställningsyta som nås via kugghjulet på inloggade sidor. Den normala analysvägen efter F4 är v3 och kräver ingen utvecklarkonsol eller manuell JSON-redigering.

## AI

### V3 · Analysflöde
1. Välj en komplett V85/V86-omgång.
2. Hämta den marknadsblinda analysfilen och kör Steg 1 hos vald AI.
3. Ladda upp AI:ns strikta Step 1-JSON. KentaurAI validerar och förseglar den server-side.
4. Om nya marknadsblinda fakta har kommit efter förseglingen visar gränssnittet revisionssteget. En ny version måste förseglas innan marknadssteget öppnas.
5. Hämta **Steg 2-underlag**. F4-filen är självständig och innehåller exakt lagrat förseglat Steg 1 plus den verifierade marknadsfilen. Den kan därför användas i en ny AI-konversation; KentaurAI förlitar sig inte på konversationsminne.
6. Kör Steg 2 och ladda upp resultatet. AI:n tolkar marknadsskillnad, mognad, tillförlitlighet och värde men väljer inte systemet.
7. KentaurAI lagrar canonical decision och kodoptimeraren bygger det auktoritativa systemet med exakt tre spikar.

Aktuell standardpolicy för huvudsystemet är 150-250 SEK. Om fler rader inte ökar beräknad P(8) kan optimeraren stanna under målbandet. Exakt tre spikar gäller ändå.

### Legacy
Historiska v1/v2-analyser och system får fortfarande läsas. Nya gamla combined/declared-unsealed analyser kan inte skapas när ANALYSIS_WORKFLOW_MODE=v3. legacy_v2 är endast ett kontrollerat rollback-läge och aktiveras aldrig automatiskt.

## Inställningar

Inställningar är uppdelat i två flikar:

### Drift
Drift är den operativa kontrollpanelen. Den visar:
- om schemalagda KentaurAI-jobb är aktiva eller pausade,
- verifierad Cloudflare D1-användning mot de inkluderade nivåerna för aktuell billingperiod,
- datakällornas jobbstatus,
- de senaste registrerade aktiviteterna.

Switchen **Automatiska jobb** är en verklig runtime-kontroll. När den är avstängd avslutas nya schemalagda körningar före datainsamling/bearbetning. Den kontrolleras även mellan morgonkörningens delar, så en paus som görs medan en körning redan pågår stoppar efterföljande delar. En SQL/API-operation som redan har startat avbryts inte mitt i operationen. Om kontrollen inte kan läsas failar schemalagd automation stängt. Vanlig appanvändning och uttryckligen manuella funktioner påverkas inte.

Cloudflare är source of truth för progress bars. KentaurAI ska inte räkna upp billingvärden från noll eller ersätta saknad Cloudflare-data med uppskattningar. D1 rows read/written hämtas från Cloudflares GraphQL Analytics API och D1 storage från D1 analytics; billingperioden härleds från Cloudflares billing metadata. Värdena visas rött först när den inkluderade nivån är passerad, annars grönt.

Runtime behöver `CLOUDFLARE_ACCOUNT_ID` och en dedikerad read-only hemlighet `CLOUDFLARE_USAGE_API_TOKEN` med minsta nödvändiga Cloudflare-behörighet för Account Analytics Read och Billing Read. Token får aldrig visas i UI, loggas eller läggas i GitHub. Om integrationen inte är konfigurerad eller Cloudflare inte kan läsas visas statusen som otillgänglig i stället för fabricerade siffror.

### Data
Data-fliken visar den lagrade datamängden och länken till den aggregerade datatäckningsrapporten. Rapporten kan hämtas via den privata app-sessionen. Råpayloads, privata R2-objektnycklar, hemligheter och privat redaktionell proveniens visas inte.

Historiska backfills/cleanup och andra administratörsoperationer förblir separata manuella adminflöden och aktiveras inte av Drift-switchen.

## Säkerhet
Alla app-routes kräver giltig privat session via APP_PASSWORD. Operativa /v1/*-routes använder separat ADMIN_TOKEN. Den privata appen exponerar aldrig administratörstoken och svar använder no-store där relevant.
