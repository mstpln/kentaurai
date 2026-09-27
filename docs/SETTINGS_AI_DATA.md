# Inställningar: Drift och Data

KentaurAI har en privat inställningsyta som nås via kugghjulet på inloggade sidor. Analysflödet ligger i den separata primära ytan **Analys**. Inställningar har två flikar: **Drift** och **Data**.

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

## Drift

Drift är standardfliken. Den visar:
- en master-switch för automatiska KentaurAI-jobb,
- Cloudflare-användning mot inkluderade gränser och faktisk billingperiod,
- status för officiell data/X-Labs,
- senaste registrerade aktivitet.

Master-switchen är den enda avsiktliga operativa mutationen i Drift. När den är pausad stoppar den det schemalagda Worker-flödet innan automatisk datainsamling/bearbetning delegeras. Vanlig appanvändning och manuellt initierade funktioner fortsätter att fungera. Om kontrollstatus inte kan läsas stoppar schemalagd automatik fail-closed.

Cloudflare-progressen hämtas server-side från Cloudflare och startar därför från det verkliga konto-/billingperiodläget, inte från noll. En separat least-privilege `CLOUDFLARE_USAGE_API_TOKEN` och `CLOUDFLARE_ACCOUNT_ID` krävs i Worker-miljön. Om de saknas visas användningen som ej ansluten; inga nollvärden eller uppskattade kostnadsstaplar fabriceras.

## Data

Data-fliken visar Datamängd och den befintliga sanerade datatäckningsrapporten. Full rapport kan hämtas via den privata app-sessionen.

Råpayloads, privata R2-objektnycklar, råa feltexter, hemligheter och ADMIN_TOKEN visas inte. Att återuppta eller ändra historiska jobb görs endast via det separata administratörsflödet.

## Säkerhet
Alla app-routes kräver giltig privat session via APP_PASSWORD. Operativa /v1/*-routes använder separat ADMIN_TOKEN. Den privata appen exponerar aldrig administratörstoken och svar använder no-store där relevant.
