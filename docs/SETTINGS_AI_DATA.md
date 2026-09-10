# Inställningar: AI och Data

KentaurAI har en privat inställningsyta som nås via kugghjulet uppe till höger på alla inloggade sidor. Huvudnavigationen Trend / Tränare / Hästar / Kuskar / Spel ändras inte.

## AI

### Exportera all data
- Exporten är en JSON-fil med kontrakt `kentaurai-full-export-v1`.
- Exporten innehåller all strukturerad D1-data som KentaurAI har lagrat, inklusive historik, beräknade features, tidigare analyser, system, resultat, lärande och driftdata.
- Råa R2-snapshots och hemligheter exporteras inte.
- Användaren väljer ChatGPT eller Claude eftersom marknadsblindheten hålls separat per AI-leverantör.
- För en kommande V85/V86-omgång döljs aktuell marknadsdata, marknadsberoende features och aktuella AI/systembedömningar för den valda leverantören tills en giltig `pre_market`-analys från samma leverantör har importerats.
- Historiska marknadsdata och historiska resultat finns kvar i full export.
- Efter importerad `pre_market`-analys exporteras filen igen. Då innehåller den även marknadskontext för den sparade förhandsanalysen.
- Exportfilens metadata innehåller analysinstruktioner, kontraktsversion, kontextfingeravtryck och mallar för AI:s returfil.

Rekommenderat exportfilnamn skapas automatiskt:

`kentaurai-full-export_<provider>_<timestamp>.json`

### Importera AI-analys
- Returfilen ska vara JSON och följa `kentaurai-analysis-v1`.
- Rekommenderade filnamn är `kentaurai-analysis_openai_YYYY-MM-DD.json` och `kentaurai-analysis_anthropic_YYYY-MM-DD.json`.
- Importen använder samma validering som den provider-neutrala analysväxeln.
- KentaurAI kontrollerar bland annat kontextfingeravtryck, full rankning av aktiva starter, sannolikhetssumma, ABCD, oförändrad styrkebedömning i finalpasset och exakt tre verkliga spikar per V85/V86-system.
- Analysen skrivs direkt till privat D1 och går aldrig via det publika GitHub-repot.

## Data

### Datamängd
Visar antal lagrade tränare, hästar, kuskar och spelomgångar med sparade system.

### Senaste körningar
Visar de senaste registrerade import-/arbetsflödeskörningarna med antal nya, uppdaterade, överhoppade och fel samt tydlig status.

### Datakällor
Visar en enkel hälsobild för officiell datakälla och X-Labs baserad på de senaste registrerade körningarna. Sidan gör inga extra externa kontrollanrop enbart för statusvisningen.

## Gemensam footer
Båda flikarna visar aktuell KentaurAI-version samt `Logga ut`.

## Säkerhet
Alla inställnings-, export- och importroutes kräver giltig privat app-session (`APP_PASSWORD`). `ADMIN_TOKEN` exponeras aldrig i webbläsaren. Exporten har `no-store` och råa privata R2-objekt eller hemligheter lämnar inte Cloudflare genom denna funktion.
