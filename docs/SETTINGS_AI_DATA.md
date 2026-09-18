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

## Data

### Datatäckning och drift
Data-fliken visar Coverage v2 i läsbar form, inklusive täckning för nästa omgång och sanerad status för officiell historik/X-Labs-jobb. Full datatäckningsrapport kan hämtas via den privata app-sessionen.

Driftinformationen är skrivskyddad i appen. Råpayloads, privata R2-objektnycklar, råa feltexter, hemligheter och ADMIN_TOKEN visas inte. Att återuppta eller ändra historiska jobb görs endast via det separata administratörsflödet.

## Säkerhet
Alla app-routes kräver giltig privat session via APP_PASSWORD. Operativa /v1/*-routes använder separat ADMIN_TOKEN. Den privata appen exponerar aldrig administratörstoken och svar använder no-store där relevant.
