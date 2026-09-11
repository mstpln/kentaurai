# KentaurAI data inventory and analysis opportunity map

Updated: 2026-09-11
Status: Build F inventory

## Purpose

This document traces the data KentaurAI currently receives from its verified source families, what is normalized into D1, what is only retained in observations/raw storage, what reaches deterministic features and AI context, and which currently unused fields are plausible candidates for better racing analysis.

The inventory is deliberately conservative. A field being present in a source does **not** mean it should automatically become a model signal. Every promoted fact must have verified semantics, provenance, an as-of timestamp where relevant, and a leakage-safe historical interpretation.

The objective is the same as the earlier Start Points discovery: identify source-backed information KentaurAI already receives but is not yet exploiting, then promote only the useful parts through a controlled raw -> normalized -> calculated -> AI path.

## Classification legend

- **RAW** - present in an archived source payload in private R2.
- **CORE** - normalized into a first-class D1 column/table.
- **OBS** - preserved in `normalized_observations` or another provenance record but not a first-class analytical field.
- **CALC** - used by deterministic code to create a feature/statistic.
- **AI-PRE** - exposed to the market-blind analysis context.
- **AI-MKT** - exposed only in the market-aware final analysis stage.
- **UI/STATS** - used by a user-facing statistics/profile route.
- **UNUSED** - received or stored but not currently used as an analytical signal.
- **VERIFY** - source field exists, but exact semantics or units must be proven before promotion.

## Executive findings

Build F found several meaningful gaps between **data received** and **data used**. The most important are not cosmetic profile fields; they can materially improve race assessment if promoted correctly.

### Highest-value discoveries

1. **X-Labs already gives us a much richer race trajectory than the current analysis uses.** KentaurAI stores 100 m interval pace information in `xlabs_data.segments_json` and the raw frame stream contains timestamped `posX`, `posY` and `distanceToFinish` for each horse. Current analysis context exposes only summary fields such as first 200 m, last 200/400/500/800/1000 m, actual distance and extra distance. The interval sequence and most positional trajectory information are therefore currently underused.

2. **The official live game payload carries a substantial horse statistics block that is mostly ignored.** It includes year and lifetime starts, earnings, placings, records, win/place percentages, earnings per start and a record broken down by start method/distance. Start Points is already extracted separately, but the rest is not promoted into first-class analytical facts.

3. **The official payload contains a current horse record object that the analysis schema is already prepared to expose, but the current live importer does not populate it.** `horses.record_text` is selected into AI context, yet the live horse upsert does not write it. This is a concrete missing mapping rather than a future-model idea.

4. **Race terms are preserved but not structurally exploited enough.** Official race `terms[]` and prize text are retained in observations, while the current race classifier mainly works from race name/main class/class flags. Terms can provide deterministic facts such as age restriction, sex restriction, earnings band, spårtrappa/start-order rule, qualification/final conditions and other eligibility context. These are directly relevant to class and matchup interpretation.

5. **Explicit equipment-change flags are already captured and reach AI context, but the system does not yet have strong historical response features.** Front/rear shoe changes and sulky type/colour change flags are stored in `change_from_previous_json`; current state is available. The next useful step is not more scraping, but deterministic historical performance-by-equipment and change-response features with adequate sample-size safeguards.

6. **Current provider-side trainer/driver annual statistics are received but mostly ignored.** They can be valuable as an independent, fresh source-backed snapshot and a coverage check while our own backfill is incomplete. They should not replace our own statistics, and they must never be mixed into historical backtests using a later snapshot.

7. **The official marking pool exposes a `trend` value that is not stored.** It may describe market movement, but its exact semantics must be verified from multiple snapshots before use. Even once verified, it belongs only in the market-aware stage and must never affect the pre-market strength assessment.

8. **Pool timestamp, turnover and system count are available but currently underused.** These are not horse-strength inputs. They can instead qualify how mature/stable a market snapshot is and improve value-confidence logic in the final stage.

## 1. Official calendar/day capture

### Received

Current verified calendar/day payloads provide, at minimum:

- date
- track identity/name and basic scheduling information
- race IDs/numbers/status/start times
- game IDs/type/status/start/scheduled start
- track membership and race membership
- game-level metadata such as return-to-player and product flags
- track-level operational flags such as `trackChanged`

### Current use

Calendar/day data is primarily operational:

- discover exact V85/V86 game IDs
- schedule/capture upcoming rounds
- prove date/track/race membership
- support automatic live acquisition without guessing identities

### Currently low-value or unverified analytical fields

| Source field/family | Current state | Analytical assessment |
| --- | --- | --- |
| return-to-player | RAW/operational | Useful for game economics/validation, not horse strength. |
| product-system flags | RAW/operational | No current handicapping value. |
| biggest game type | RAW/operational | Discovery/UI only. |
| `trackChanged` | RAW, VERIFY | Potentially interesting operational/current-condition signal, but semantics must be verified before any interpretation. |

### Recommendation

Do not spend a build on calendar metadata for handicapping. Keep it as operational provenance unless `trackChanged` can be proven to represent a material change relevant to race conditions.

## 2. Official live V85/V86 game capture

This is the richest current official pre-race source.

### 2.1 Round and race facts

Received:

- round ID/type/status
- game pool timestamp/turnover/system count/payout metadata
- race ID/name/date/number
- official distance
- start method
- scheduled/actual start time
- prize text
- race terms array
- track identity/name/country/system code
- race status
- race-level win/place pools including timestamps and turnover

Current normalization:

- **CORE:** game round identity/type/date/start/status
- **CORE:** race identity, track, date, race number, scheduled time, distance, start method, race name/status
- **CORE:** game leg -> race mapping
- **OBS:** race start time, prize text, terms, observed field size
- **OBS:** track system code
- first-prize amount is handled through a separate verified normalization/repair path rather than trusting arbitrary free text in the live mapper

Current analytical use:

- distance/start method/track/race class feed statistics and AI context
- first prize feeds class-exposure and development calculations where verified
- race name/class flags feed race classification
- terms are retained but are not yet a first-class structured condition model

#### Opportunity: structured race conditions - HIGH

The terms block is one of the strongest unused official data families because it describes **what kind of race this actually is**. A deterministic parser can extract only patterns we can prove, for example:

- age minimum/maximum
- mares-only or other sex restriction
- earnings lower/upper band
- qualification/final/heat context
- spårtrappa / start-order rule
- amateur/apprentice/young-horse restrictions
- additional handicap/tillägg conditions
- number of starters and prize-placement structure when explicit

Why this matters:

- improves class comparison beyond a race label
- makes class rise/drop more accurate
- prevents unlike races from being treated as equivalent
- improves trainer/driver/horse segmented statistics
- creates better context for interpreting a fifth place in a hard restricted race versus a win in a weak open race

Guardrail: preserve the raw terms text in R2/observation and write only verified extracted facts. Unknown wording remains unknown.

### 2.2 Start position and handicap

Received:

- start ID
- start number
- post position
- actual start distance

Current normalization already handles this well:

- **CORE:** start number
- **CORE:** actual lane/post position
- **CORE:** actual start distance
- **CORE:** volt handicap meters
- **CORE:** volt tier, derived from verified 20 m distance increments

This is already used by horse/driver/trainer/track statistics and AI context. It is not an unused-source gap.

#### Remaining opportunity - MEDIUM

The schema also contains `springspar`, `inner_lane` and `back_row`. These are conceptually useful, but they should only be filled when deterministic semantics are verified. Some can be derived from start method/lane/tier, but we should define one canonical rule and test it rather than infer casually.

Useful future features:

- empirical start-position expectation per track/method/distance/class/field size
- horse-specific performance from front row/back row
- driver-specific volt-lane skill
- actual-vs-expected performance from the lane, not raw win percentage

## 3. Horse data received versus used

### 3.1 Core profile currently normalized

The live mapper already writes:

- horse identity/name
- sex
- colour
- nationality/country code
- sire name
- dam name
- damsire name
- breeder name
- owner name
- current trainer
- home track
- career earnings

These facts are useful for profile/context, but only some currently affect analysis.

### 3.2 Age versus birth year - important gap

The source supplies **age at the capture**. The live mapper stores that age in a timestamped normalized observation but does not write `horses.birth_year`.

The AI context currently reads `horses.birth_year`, so live-source horses may have a null birth year even though a source-backed current age exists.

Recommendation:

- do **not** invent birth year from age; that would turn a derived approximation into a raw fact
- add a snapshot-level `age_years` representation or expose the latest verified age observation as age-at-as-of
- populate actual birth year only if an official source explicitly supplies it

Analytical value: medium-high for young-horse/age-group races and development curves.

### 3.3 Breed - source gap, not just mapping gap

The schema and AI context support breed, but the observed current game payload does not provide a reliable explicit breed field for the horse. Do not infer breed from names/nationality/race context. Keep null until a verified source exists.

### 3.4 Current official record - HIGH

Received:

- record code
- start method
- distance group
- kilometre-time components

Current state:

- present in RAW
- not mapped into `horses.record_text` by the current live horse upsert
- AI context already has a `recordText` field, so the pipeline is prepared for it but often receives null from live data

Recommended promotion:

- normalize a structured current-record snapshot instead of only a free-text string if practical
- retain code/start method/distance/time separately
- expose a safe formatted representation to AI

Analytical role:

- capacity ceiling signal
- method/distance-specific speed capability
- useful cross-check against recent form, especially when a horse has sparse recent history

Important: a personal record is not the same as current form. It should support capacity assessment, not be treated as a current-performance score.

### 3.5 Official year/lifetime horse statistics - HIGH, with anti-leakage rules

Received:

- starts
- earnings
- first/second/third placings
- records by method/distance
- lifetime win percentage
- lifetime place percentage
- earnings per start
- Start Points

Current state:

- Start Points: **promoted, timestamped, first-class history**
- career earnings: core value is already stored from the current money field
- most remaining aggregate statistics: RAW only / not used as model features

Why useful:

1. **Coverage fallback / cross-check.** Own historical database can be incomplete while a current official aggregate may summarize a longer career.
2. **Capacity context.** Method/distance records can provide a verified ceiling signal.
3. **Freshness validation.** Provider yearly starts/earnings/wins can be compared with our own counts to detect backfill gaps.
4. **Sparse-history horses.** New imports with little local history can still have useful official aggregate context.

Why dangerous:

A current lifetime/year snapshot contains information accumulated up to its capture date. It must never be attached to a historical race earlier than the capture and treated as if it were known then. That would create look-ahead leakage.

Recommended design:

- store these as timestamped official aggregate observations
- never overwrite history
- use the latest observation at or before analysis `as_of`
- keep official aggregates separate from own calculated aggregates
- calculate a `coverage_gap`/`coverage_ratio` rather than silently blending the two

Potential deterministic features:

- official current-year starts/wins/place rate
- official lifetime starts/wins/place rate
- official earnings/start
- record by auto/volt and distance bucket
- own-history coverage versus official aggregate count

Do not duplicate signals: when our own complete history is available, own granular data remains primary for form/class/trip calculations.

### 3.6 Start Points - already promoted, but not fully exploited

Start Points is now correctly stored as timestamped source-backed observations and current cache.

The next logical use is not another raw field; it is **Start Points dynamics**:

- current level
- change since previous observation
- rolling delta across recent starts
- rate of rise/fall per start
- level relative to today’s field
- level relative to horse’s own recent baseline

This can be a useful compact form/class signal because the source itself updates it over time.

Guardrails:

- use only observations known before the target race
- do not make the points formula itself a hidden model truth; treat it as one external factual rating signal
- test incremental value before giving it strong influence

Priority: **HIGH**.

### 3.7 `lastFiveStarts.averageOdds` - received but intentionally not pre-market

This is historical market information. It can be useful for:

- post-analysis comparison
- market reputation / public-expectation research
- validating our own historical odds coverage

It must **not** enter the blind pre-market strength model because the project explicitly separates own assessment from market anchoring. If used, keep it in market/post-race layers.

Priority: low for immediate build.

### 3.8 Pedigree IDs and nationalities - MEDIUM/LONG TERM

We currently store sire/dam/damsire **names**, but the source also provides family entity IDs and sometimes nationality.

Potential long-term value:

- offspring performance by distance/method
- young horse priors when own history is sparse
- sire-line tendency for early speed, stamina, gait stability or surface/track adaptation

Risks:

- requires large samples
- easy to overfit
- parent identity must be stable, not name-matched loosely

Recommendation: preserve stable pedigree IDs in a future normalized relation, but do not prioritize pedigree weighting before stronger direct-performance features are built.

### 3.9 Foreign-owned flag - LOW

Received but not normalized. It may correlate with travel/import status but is not directly a performance fact. Do not create a bonus/malus. At most retain as metadata if needed later.

## 4. Driver data received versus used

Received in live payload:

- identity/name
- location
- birth year
- home track
- license
- silks
- annual starts/earnings/1st/2nd/3rd placings/win percentage

Current normalization:

- **CORE:** identity/name, home track
- **OBS:** location, birth year, license, home-track source identity
- annual statistics are not currently promoted as first-class driver facts
- silks are unused

Current own statistics are substantially better than a simple provider aggregate because KentaurAI can segment by period, horse age/sex, method, lane, favorite/longshot, etc.

### Opportunity: official annual driver snapshot - MEDIUM-HIGH

Use cases:

- fallback when own history is incomplete
- detect data completeness gaps
- fresh aggregate form baseline
- compare current season versus previous season

Do not replace own driver statistics. Store separately with timestamp/provenance.

### Opportunity: driver-horse combination - HIGH

The build plan wants combination quality, and we already have all required identities in `race_entries`/results. This does **not** require a new source field.

Deterministic features should include, with sample-size protection:

- starts together
- wins/top-three
- gallops/disqualifications
- market-relative performance where historical market exists
- X-Labs opening pace together where available
- performance compared with same horse under other drivers

This is likely more useful than driver age/license/profile metadata.

### Low-value fields

- silks: presentation only
- birth year: profile/experience segmentation at most, not a direct quality weight
- license text: useful for classifying amateur/apprentice/professional context if semantics are stable, otherwise metadata only

## 5. Trainer data received versus used

Received:

- identity/name
- location
- birth year
- home track
- license
- annual starts/earnings/placings/win percentage

Current normalization:

- trainer identity/name is core
- home track/location/birth/license are provenance observations
- Build D already derives powerful trainer statistics from own normalized history and uses exact official home-track identity when required

### Opportunity: official trainer yearly snapshot - MEDIUM-HIGH

Same principle as driver aggregates: useful as independent snapshot/fallback/coverage check, not as a replacement for own segmented statistics.

### Opportunity: stable form relative to own baseline - HIGH

The current trainer rankings provide rolling performance but the more analytically useful signal is deviation from the trainer’s own baseline and market expectation.

Examples:

- last 14/30 days win/top-three versus previous 90/365 days
- actual wins versus expected wins from historical market
- current earnings/class exposure versus normal
- horse performance first/second start after rest relative to trainer baseline
- equipment-change response by trainer

This mostly uses data already stored; the gap is feature logic, not acquisition.

## 6. Equipment and balance

Received and normalized today:

- shoes reported status
- front/rear shoe state
- barefoot front/rear
- sulky type text/code
- explicit front shoe change flag
- explicit rear shoe change flag
- explicit sulky type change flag
- sulky colour/change metadata
- source record and verification status

AI context already exposes current equipment plus `changeFromPrevious`.

### Important finding

For shoes and sulky, KentaurAI is **already receiving the explicit change flags**. The missing analytical value is historical response modeling, not a missing raw field.

### Recommended deterministic equipment features - HIGH

For each horse, with adequate samples and class/context controls:

- performance with/without front shoes
- performance with/without rear shoes
- performance barefoot all around
- standard versus American sulky
- first start after a verified equipment change
- recurring equipment setup versus normal setup
- X-Labs pace/extra-distance change under equipment state
- gallop frequency by equipment state

Trainer-level versions can be useful too, but should require larger samples.

Causal warning: a trainer may choose bike/barfota specifically when a horse is ready or race conditions are favorable. Therefore raw win-rate uplift must not be interpreted as pure equipment effect.

### Missing equipment categories

The schema supports headgear, earplugs and other equipment, but the observed current official game source does not currently provide verified equivalents through the mapper. Keep these null unless a source with clear semantics is verified.

## 7. Official results and historical ordinary-race data

Current historical importer already captures a strong base:

- exact race identity/date/track/race number
- distance/start method/field size/race name/status
- actual lane/start distance/volt tier/handicap
- driver/trainer/horse
- scratched status
- equipment
- official placing
- km time
- prize money
- gallop
- disqualification
- official final odds

Additional observation-only fields include finish order and kilometre-time code.

### Opportunity: richer performance normalization - HIGH

Current form logic is intentionally simple: last five results, placing/wins/top-three/gallop/disqualification/days since last start. Current development compares latest three versus preceding three on placing, class, earnings and errors.

That is a good safe foundation, but it leaves large amounts of stored information unused:

- km time
- actual start distance
- actual lane/tier
- track
- driver/trainer combination
- equipment state
- official odds for historical expectation
- X-Labs pace and extra distance

A stronger deterministic start-performance record should normalize every prior start for:

- class/money level
- distance/method
- lane/handicap
- pace
- extra distance/trip burden where verified
- gallop/disqualification
- market expectation, **only for retrospective normalization**, not current pre-market anchoring

Then the pre-market AI can receive a class-adjusted performance trend instead of relying heavily on finishing positions.

## 8. X-Labs: largest currently underused data family

### Raw telemetry actually available

The verified X-Labs mapper reads timestamped frames. For each start number in each frame it has:

- `posX`
- `posY`
- `distanceToFinish`
- frame timestamp

It requires at least 99% frame coverage for a horse before normalizing its telemetry.

### Currently normalized summary measurements

- first 200 m kilometre pace
- last 200 m
- last 400 m
- last 500 m
- last 800 m
- last 1000 m
- actual travelled distance
- extra distance versus official start distance
- converted full-race kilometre pace
- `segments_json` containing frame coverage plus **100 m interval pace sequence**

`slipstream_m` remains null because its semantics are not yet verified.

### What AI context currently uses

The recent-start context exposes the summary X-Labs measurements above. It does **not** expose or calculate from the 100 m interval sequence, and it does not currently use the full `posX`/`posY` trajectory.

This is the clearest “we already have it but are not using it” finding in Build F.

### Candidate X-Labs feature family - VERY HIGH priority

All should be deterministic and versioned.

#### A. Opening-speed profile

- first 100 m pace
- first 200 m pace
- acceleration from 0-100 to 100-200
- median opening pace across relevant starts
- best relevant opening pace
- consistency/variance of opening pace
- opening pace by auto/volt, lane and driver

Use: expected race shape and lead probability.

#### B. Mid-race pace profile

- pace over middle race thirds/quarters
- slowest and fastest 100 m interval
- pace variance
- sustained high-speed duration
- whether a horse needs a breather after a hard opening

Use: style and tempo tolerance.

#### C. Closing profile

- last 100/200/400 relative to prior race segment
- acceleration/deceleration into the finish
- closing speed relative to race field
- ability to maintain pace after extra distance

Use: speed versus stamina, pace-collapse scenarios and long-spurt suitability.

#### D. Trip/path efficiency

Already safe:

- actual distance
- extra distance
- extra distance as percentage of nominal race distance

Potential after coordinate validation:

- path curvature / lateral displacement
- sustained outside travel
- movement episodes

Do **not** label these as lane/wide-trip/death-seat until track-coordinate semantics are proven.

#### E. Relative race position from `distanceToFinish`

Potential deterministic derivations, after validation against known races:

- relative rank through time
- position/rank at 200/500/1000/to-finish checkpoints
- places gained/lost by segment
- lead changes/overtakes
- closing rank gain
- early-position versus finish-position relationship

This may allow us to populate parts of the existing `race_positions` model without scraping commentary, but it requires careful validation because telemetry order/coordinate timing must be proven.

#### F. Race-level pace pressure

From all horses in the same telemetry frames:

- opening field pace
- number of horses contesting the front early
- duration of high opening pressure
- pace collapse pattern
- winner’s/each horse’s performance relative to race pace

Use: distinguish strong performance in a hard-run race from an easy-trip result.

### Why this outranks many new source fields

This is direct measurement of what happened in the race. It can explain *how* a horse performed, not merely where it finished. It is therefore closer to the project’s desired “performance, not result row” philosophy than profile metadata such as owner, colour or driver age.

## 9. Market data received versus used

### Already used safely

- V85/V86 betting percentage snapshots
- market rank
- winner odds snapshots
- place min/max odds snapshots
- source provenance
- betting-stop cap for final analysis

Build E now ensures current market information is isolated from pre-market strength assessment.

### Unused `trend` field - VERIFY, market stage only

The marking pool contains a numerical trend value for each start. We should not assume whether it represents absolute movement, relative movement, velocity or something else.

Verification plan:

1. capture at least several successive snapshots for the same starts
2. compare `trend` with change in betting percentage
3. test behavior around new money/late market changes
4. confirm sign and scale
5. only then define a versioned semantic

If verified, possible final-stage uses:

- market direction
- late steam/drift
- disagreement between our fixed pre-market probability and changing market

Never expose it to `pre_market`.

### Pool maturity/confidence - MEDIUM-HIGH

Received:

- timestamp
- turnover
- system count at game level
- race pool turnover for win/place

Potential deterministic value features:

- snapshot age
- turnover relative to final/typical turnover for similar rounds if known
- number of systems represented
- stability of betting percentage over successive snapshots

Purpose: tell the final value logic whether a 5% market estimate is still immature/noisy or based on a mature pool.

This is a **confidence qualifier**, not a horse ability signal.

## 10. Track and race-condition data

### Static track schema is richer than current automatic official input

D1 already has room for:

- lap length
- home-stretch length
- curve radius
- banking
- width
- surface
- open stretch
- angled mobile wing
- start notes
- track notes

These can materially affect tactical fit, but most are not supplied by the current official game payload and therefore require separately verified track metadata. They should remain stable track facts, not be inferred.

### Day conditions schema exists but acquisition is not complete

`race_conditions` supports:

- track status
- temperature
- wind speed/direction
- precipitation
- weather text
- day profile

These are not yet a mature automatic feature family.

### Opportunity: day profile - MEDIUM after enough races

When race-day data is available, deterministic logic could compare earlier races on the card with long-term track expectations:

- inside/outside lane deviation
- front-runner versus closer deviation
- actual kilometre times versus class expectation
- unusual weather/wind effects

Small samples must remain low-confidence. This should come after direct X-Labs/race-condition improvements.

## 11. Database columns that exist but are not reliably populated from current live input

This distinction is important: schema support is not data support.

Notable examples:

- `horses.birth_year` - current live source gives age, not a verified birth year mapping
- `horses.breed` - no reliable current live source field observed
- `horses.record_text` - source record exists but live mapper does not populate it
- `drivers.country_code` - current live mapper does not promote location/nationality into this fact
- `trainers.country_code` - same issue
- `race_entries.springspar` / `inner_lane` / `back_row` - schema exists; not universally promoted in current live importer
- `race_results.finish_time` and `distance_behind_winner_m` - schema exists but current ordinary-race importer does not populate them from the verified payload it handles
- `race_positions` - model exists but automatic X-Labs-derived position semantics are not yet implemented
- `race_conditions` - schema exists, acquisition/derivation incomplete
- `xlabs_data.slipstream_m` - deliberately null pending semantic verification

A future UI or AI context must not confuse “column exists” with “fact is available.”

## 12. Data already available but insufficiently exposed to AI

The pre-market analysis context currently does a good job exposing:

- race/track basics
- horse identity/basic profile
- driver/trainer
- position/handicap
- current equipment/change flags
- persisted deterministic features
- five recent starts
- summary X-Labs data on those starts
- editorial signals after factual context

But several high-value layers are still absent or too shallow:

1. Start Points history/delta, not just general horse profile.
2. X-Labs 100 m pace profile and trajectory-derived features.
3. structured race eligibility/terms.
4. class-adjusted start performance richer than placing/prize.
5. driver-horse combination features.
6. horse distance/method performance profile.
7. horse track profile.
8. trainer form relative to own baseline.
9. equipment response history.
10. race-pace/style fit.

These should be calculated by code and exposed as compact structured features; AI should not be asked to recalculate hundreds of historical rows.

## 13. Prioritized opportunity backlog

### Priority 1 - X-Labs interval and trajectory features

**Why:** already captured, direct performance measurement, high explanatory value, minimal new source dependence.

First safe slice:

- first 100 pace
- 100-200 pace
- last 100 pace
- fastest/slowest 100 interval
- pace variance
- closing-versus-midrace delta
- extra-distance percentage
- frame coverage/sample count

Do not yet infer named tactical positions from geometry.

### Priority 2 - Official horse record + aggregate snapshot family

**Why:** already present in current official payload; Start Points proved this source area is useful.

First slice:

- structured horse current record
- official current-year and lifetime starts/wins/top-three/earnings
- official method/distance records
- timestamped observations
- own-history coverage comparison

Keep source aggregate and own derived stats separate.

### Priority 3 - Start Points dynamics

**Why:** source/history infrastructure already exists.

Features:

- current level
- previous level
- absolute/relative delta
- rolling change across recent observations
- field percentile/rank using same-as-of data

### Priority 4 - Structured race terms/class conditions

**Why:** official and already archived/observed; improves class comparison and segmentation.

Build only a deterministic allowlist parser; unknown language remains raw text.

### Priority 5 - Richer class-adjusted performance per historical start

**Why:** combines facts already in D1 into the performance signal the original plan actually calls for.

Inputs can include class/prize, placing, km time, distance/method, lane/handicap, X-Labs, equipment and trip burden. Market-relative historical performance can be a separate retrospective normalization channel.

### Priority 6 - Driver-horse combination and trainer relative-form features

**Why:** identities/history already exist; no acquisition dependency.

### Priority 7 - Equipment response history

**Why:** current equipment/change flags already exist and can be linked to results/X-Labs.

### Priority 8 - Verified market trend and maturity

**Why:** improves value timing/confidence, but only after field semantics are proven and only in final stage.

### Priority 9 - X-Labs-derived tactical positions

**Why:** potentially very valuable, but needs coordinate/relative-position validation first.

### Priority 10 - pedigree entity relationships

**Why:** useful for sparse-history/young horses but lower expected gain than direct performance data and easy to overfit.

## 14. Data that should probably not become model factors now

Avoid adding weak signals merely because they exist:

- horse colour
- owner identity by itself
- breeder identity by itself
- driver/trainer age by itself
- silks
- foreign-owned flag by itself
- product flags from calendar/game metadata
- return-to-player as horse-strength input
- sulky colour

They may remain useful metadata/provenance. Promote only if later evidence supports a clearly defined use case.

## 15. Required validation before promoting a new source field

Every new field family must pass these gates:

1. **Exact source semantics** - prove what the field means, including scale/unit.
2. **Identity** - prove round/race/start/horse/person linkage.
3. **Time semantics** - know when the value was observed/effective.
4. **Historical safety** - never apply a later snapshot to an earlier race.
5. **Null safety** - missing remains null; no default zero unless zero is explicitly factual.
6. **Conflict behavior** - preserve conflicting observations and fail closed where required.
7. **Idempotency** - same source snapshot cannot create duplicates.
8. **Separation** - factual source value remains separate from deterministic features and AI judgment.
9. **Market isolation** - any odds/streck/trend/public expectation remains outside pre-market strength.
10. **Incremental value** - do not add a feature if it only duplicates an existing signal without measurable benefit.

## 16. Recommended next scoped builds

Build F itself is an inventory and prioritization build. It should not quietly introduce many new model signals at once.

Recommended implementation sequence after Build F:

### Build G - X-Labs interval performance features

Create a deterministic feature family from existing `segments_json`, beginning with only semantics already supported by the stored 100 m interval timing. Add sample/coverage fields and expose compact features to pre-market AI.

### Build H - Official horse snapshot expansion

Normalize the current record and selected official aggregate statistics as timestamped observations. Add own-history coverage comparison. Extend the existing Start Points pattern rather than creating mutable profile guesses.

### Build I - Start Points dynamics

Calculate leakage-safe trends/field-relative measures from `horse_start_points` history.

### Build J - Structured race terms

Parse a narrow allowlist of verified race-condition patterns into structured facts/class flags.

### Build K - Performance normalization and combinations

Add richer per-start performance, driver-horse combination, trainer-relative form and equipment-response features in separately testable slices.

### Later validation builds

- market trend semantics/maturity
- X-Labs positional/tactical derivation
- day-profile/weather
- pedigree relationships

## 17. Definition of done for Build F

Build F is complete when:

- all currently implemented source families have been traced from raw capture through normalization and analytical exposure
- received-but-unused high-value data is explicitly identified
- schema-present-but-not-source-populated fields are distinguished from real available data
- market-derived information is clearly separated from strength data
- leakage risks are documented
- candidate improvements are prioritized by expected analytical value and confidence in semantics
- future builds are small enough to validate independently
- no private raw payload, real reference export, private editorial provenance or secret is committed to the public repository

## Conclusion

KentaurAI does **not** currently suffer mainly from a lack of raw data. The larger opportunity is that several strong source-backed facts and measurements are already being captured but are not yet transformed into compact deterministic analytical features.

The strongest next gains are likely to come from:

1. using the X-Labs interval/trajectory data we already retain,
2. promoting the rest of the official horse statistics family with the same timestamped discipline used for Start Points,
3. exploiting Start Points as a time series rather than only a current value,
4. turning official race terms into structured class/eligibility facts, and
5. combining existing result, equipment, class and identity data into richer performance/combination features.

That path adds information without weakening KentaurAI's core discipline: **raw facts remain facts, code calculates reusable features, and AI interprets the structured race context.**
