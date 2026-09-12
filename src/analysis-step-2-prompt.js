export const ANALYSIS_STEP_2_PROMPT = `# KentaurAI — Steg 2: Marknad, spelvärde och system (V85/V86)

Den marknadsblinda styrkeanalysen från steg 1 finns redan i denna konversation. Nu släpps marknaden in.

## ABSOLUT REGEL: STEG 1 ÄR LÅST

Återanvänd steg 1 oförändrat. Ändra inte sannolikheter, ranking, ABCD, loppbilder, scenarier, slutsatser, osäkerhet, datakvalitet eller hästmotiveringar efter att marknaden blivit synlig. Om du nu upptäcker ett möjligt fel i steg 1 ska du kommentera det separat, aldrig skriva om steg 1.

## 1. Marknad och värde

Streckprocenten är primär marknadsvariabel. Vinnarodds är en andrahandskontroll. Tidsstämpla marknadsdatan.

För varje häst redovisas:
- egen vinstchans från steg 1,
- aktuell streckprocent,
- värdekvot = egen vinstchans / streckandel,
- break-even-odds = 100 / egen vinstchans.

Identifiera överstreckade favoriter, understreckade värdehästar och felprissatta lopp. ABCD beskriver fortsatt ren vinststyrka och får inte ändras utifrån spelvärde.

Vid strykningar ska marknadsandelar vid behov normaliseras till kvarvarande hästar. Hitta aldrig på saknade marknadsdata.

## 2. Externa källor sist

Tips, experttexter och externa rankingar får användas först efter den egna värdebedömningen. De får ge aktuell information eller utmana resonemang, men får aldrig ersätta den egna analysen, kopieras som system eller ändra steg-1-rankingen.

## 3. Systemregler

Varje V85/V86-system ska innehålla EXAKT TRE SPIKAR i tre olika avdelningar. En spikavdelning har exakt en vald häst. Alla andra avdelningar har minst två valda hästar.

### V85

Bygg två system:

**Huvudsystem**
- radpris 0,50 kr,
- följ den beslutade budgeten/metoden,
- exakt tre spikar,
- optimera balansen mellan träffchans och spelvärde.

**Personligt alternativsystem**
- max 144 kr,
- radpris 0,50 kr,
- exakt tre spikar,
- ska vara en materiellt annorlunda positionering, inte en billig kopia av huvudsystemet.

### V86

Bygg ett personligt system:
- max 144 kr,
- radpris 0,25 kr,
- exakt tre spikar,
- optimera balansen mellan träffchans och spelvärde.

Radantalet är produkten av antal val i alla åtta avdelningar. Kostnaden är radantal × radpris.

## 4. Systemoptimering

Gardera bredast där marknaden är mest fel, inte automatiskt där favoriten är starkast. Spika bara där hästen både är tillräckligt stark enligt steg 1 och systempositionen är försvarbar mot marknaden. Var beredd att fälla överstreckade favoriter. Ta inte med hästar utan realistisk vinstchans enbart som försäkring.

För V85:s personliga alternativsystem ska systemet avvika materiellt från huvudsystemet. Redovisa gemensamma hästar, avdelningar med identiskt urval och gemensamma spikar. Som riktmärke ska minst två av tre spikar skilja sig mellan systemen.

## 5. Nyckeltal

Per system redovisas:
- valda hästar per avdelning,
- radantal och kostnad,
- egen samlad vinstchans per avdelning,
- samlad streckandel per avdelning,
- värdekvot för avdelningsurvalet,
- förenklad träffchans för full rad som produkt av avdelningstäckningarna,
- ungefärligt kollektivt ägande av samma kombination,
- viktigaste värdeidé,
- största risk,
- hårt streckade hästar som systemet aktivt står utan.

Säg tydligt att multiplikationen av avdelningschanser bygger på ett förenklat oberoendeantagande.

## 6. Output

Håll svaret kompakt. Per avdelning:

| Nr | Häst | Chans | Streck | Kvot | Break-even | Kommentar |
|---|---|---|---|---|---|---|

Därefter varje system som tydlig rad/avdelningslista, följt av radantal, kostnad, nyckeltal och fällningar. Avsluta med en citerbar kontrollrad per system, till exempel:

\`1: 3,5,6,7 · 2: 1 · 3: 1,5,6,7 · 4: 9 · 5: 2 · 6: 3,5,6,8 · 7: 2,4,6 · 8: 1,3,4\`

## 7. Slutkontroll

Innan systemet levereras:
1. steg-1-sannolikheter/ranking/ABCD och övrig steg-1-text är oförändrade,
2. alla åtta avdelningar har minst en vald häst,
3. inget system innehåller struken häst,
4. varje system har exakt tre singleton-spikar,
5. radantalet är produkten av valen i de åtta avdelningarna,
6. kostnaden = radantal × rätt radpris,
7. marknadsdatan är tidsstämplad,
8. V85-systemens likhetskontroll är gjord.

När analysen och systemen är färdiga skapas importfilen i nästa separata exportsteg. Ändra inte systemet där.`;
