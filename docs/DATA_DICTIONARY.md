# KentaurAI public data dictionary

Version: 1.0
Updated: 2026-09-12
Scope: verified public field inventory for current official, X-Labs, normalized and analysis-context families.

This is the field-level companion to `docs/DATA_INVENTORY.md`. It contains only generic source-family names, generic verified field identifiers/paths, semantics, mapping/use status and provenance rules. It contains no real racing payload values, private editorial provenance, credentials or private source identities.

## Status contract

Only these statuses are used:

- `used` - normalized and consumed by API, UI, deterministic feature logic or analysis context.
- `stored_unused` - normalized or preserved in D1 but not currently consumed analytically.
- `raw_only` - archived in raw source data but not normalized.
- `derived` - deterministically calculated from verified facts; not a raw source fact.
- `unclear` - source field exists but semantics/units are not verified enough to promote.
- `ignore` - deliberately not promoted because it has no current analytical/product value.
- `build_candidate` - concrete, source-backed candidate for a future separately scoped build.

## Field dictionary

| source_family | raw_path | semantic_name | data_type | nullable | normalized_target | status | consumer | provenance_rule | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| official_calendar | date | calendar date | date | no | capture identity | used | acquisition | source record + fetched time | Exact requested day. |
| official_calendar | tracks[].id | track identity | text/integer | no | track external identity | used | acquisition / identity | source record + exact external ID | Exact identity preferred over name. |
| official_calendar | tracks[].name | track name | text | yes | track observation | used | UI / identity | source record | Name conflicts are preserved. |
| official_calendar | tracks[].races[].id | race identity | text | no | race discovery identity | used | acquisition | source record | Used for exact calendar membership. |
| official_calendar | tracks[].races[].number | race number | integer | yes | race discovery metadata | used | acquisition / ordering | source record | Missing stays null. |
| official_calendar | tracks[].races[].status | race status | text | yes | race discovery metadata | used | acquisition | source record + fetched time | Operational fact. |
| official_calendar | tracks[].races[].startTime | race start time | timestamp | yes | race discovery metadata | used | scheduling | source record + fetched time | Capture-time fact. |
| official_calendar | games[].id | game identity | text | no | game_rounds.id | used | acquisition / analysis identity | source record | Canonical round identity. |
| official_calendar | games[].type | game type | enum | no | game_rounds.game_type | used | V85/V86 gate | source record | Only supported game types continue. |
| official_calendar | games[].status | game status | text | yes | game_rounds.status | used | scheduling / UI | source record | Operational fact. |
| official_calendar | games[].scheduledStart | game scheduled start | timestamp | yes | game_rounds.scheduled_start_at | used | scheduling | source record | No inferred time. |
| official_calendar | games[].returnToPlayer | return to player | number | yes | none | ignore | none | raw archive only | Game economics, not strength. |
| official_calendar | games[].productFlags | product/system flags | object/array | yes | none | ignore | none | raw archive only | Operational metadata. |
| official_calendar | tracks[].trackChanged | track changed flag | boolean | yes | none | unclear | none | raw archive only | Semantics must be verified before use. |
| official_game | id | round identity | text | no | game_rounds.id | used | analysis / UI / systems | source record | Canonical round ID. |
| official_game | status | round status | text | yes | game_rounds.status | used | UI / gating | source record + fetched time | Capture-time fact. |
| official_game | scheduledStart | round scheduled start | timestamp | yes | game_rounds.scheduled_start_at | used | pre-race gating | source record | No inferred value. |
| official_game | betStop | betting stop | timestamp | yes | game_rounds.bet_stop_at | used | final market cutoff | source record | Required by market-at-stop logic. |
| official_game | pool.timestamp | game-pool timestamp | timestamp | yes | market observation metadata | stored_unused | future market confidence | source record + source timestamp | Final/market layer only. |
| official_game | pool.turnover | game turnover | number | yes | market observation / round field where verified | stored_unused | final market context | source record + timestamp | Never pre-market strength input. |
| official_game | pool.systemCount | number of systems | integer | yes | none | build_candidate | future market confidence | source record + timestamp | Market maturity candidate only. |
| official_game | races[].id | race identity | text | no | races.id | used | all race joins | source record | Canonical race ID. |
| official_game | races[].name | race name | text | yes | races.race_name | used | UI / class context | source record | Free text remains separate from structured features. |
| official_game | races[].date | race date | date | no | races.race_date | used | history / filters | source record | Canonical date. |
| official_game | races[].number | race number | integer | yes | races.race_number | used | ordering / UI | source record | Null-safe. |
| official_game | races[].distance | nominal race distance | integer | yes | races.distance_m | used | filters / analysis | source record | Verified source value. |
| official_game | races[].startMethod | start method | enum/text | yes | races.start_method | used | filters / features | source record | Canonicalized deterministically. |
| official_game | races[].scheduledStartTime | scheduled race start | timestamp | yes | races.scheduled_start_at | used | UI / gating | source record | Source-backed. |
| official_game | races[].startTime | observed/actual start time | timestamp | yes | normalized_observations | stored_unused | none | source record + observed time | Preserved observation. |
| official_game | races[].status | race status | text | yes | races.status | used | processing / UI | source record | Capture-time fact. |
| official_game | races[].prize | advertised prize text | text | yes | normalized_observations | stored_unused | class verification | source record | First-prize mapping uses separately verified logic. |
| official_game | races[].terms[] | race terms | array/text | yes | normalized_observations | build_candidate | future structured race conditions | source record | Preserve raw wording; parse only verified rules. |
| official_game | races[].track.id | track identity | text/integer | no | track external identity | used | race identity / filters | source record + exact external ID | No name-only identity when ID exists. |
| official_game | races[].track.name | track name | text | yes | tracks.canonical_name / observation | used | UI | source record | Conflicts preserved. |
| official_game | races[].track.countryCode | track country | text | yes | tracks.country_code | used | UI / scope | source record | UI localizes code. |
| official_game | races[].track.sportSystemCode | track system code | text | yes | normalized_observations | stored_unused | none | source record | Operational metadata. |
| official_game | races[].starts[].id | start identity | text | no | race-entry source identity | used | start normalization | source record | Stable source start identity. |
| official_game | races[].starts[].number | start number | integer | no | race_entries.start_number | used | UI / stats | source record | Validated positive integer. |
| official_game | races[].starts[].postPosition | post/actual lane | integer | yes | race_entries.actual_lane | used | lane features / stats | source record | Used only when verified. |
| official_game | races[].starts[].distance | actual start distance | integer | yes | race_entries.actual_start_distance_m | used | handicap/tillägg | source record | Difference from base distance is deterministic. |
| official_game | races[].starts[].horse.id | horse identity | text | no | horses + horse external identity | used | all horse joins | source record + exact external ID | Canonical identity. |
| official_game | races[].starts[].horse.name | horse name | text | no | horses.canonical_name | used | UI | source record | Name conflicts preserved. |
| official_game | races[].starts[].horse.sex | horse sex | text | yes | horses.sex | used | filters / profile | source record | Missing stays null. |
| official_game | races[].starts[].horse.color | horse colour | text | yes | horses.color | stored_unused | profile | source record | Metadata, not a model factor. |
| official_game | races[].starts[].horse.nationality | horse nationality | text | yes | horses.country_code | stored_unused | profile | source record | Metadata at current version. |
| official_game | races[].starts[].horse.age | age at capture | integer | yes | normalized_observations.ageYears | build_candidate | future age-at-as-of context | source record + fetched time | Never converted into guessed birth year. |
| official_game | races[].starts[].horse.pedigree.father.name | sire name | text | yes | horses.sire_name | stored_unused | profile | source record | Stable pedigree-ID relation remains future work. |
| official_game | races[].starts[].horse.pedigree.mother.name | dam name | text | yes | horses.dam_name | stored_unused | profile | source record | No loose pedigree inference. |
| official_game | races[].starts[].horse.pedigree.grandfather.name | damsire name | text | yes | horses.damsire_name | stored_unused | profile | source record | Metadata. |
| official_game | races[].starts[].horse.breeder.name | breeder | text | yes | horses.breeder | stored_unused | profile | source record | Not a model factor now. |
| official_game | races[].starts[].horse.owner.name | owner | text | yes | horses.owner | stored_unused | profile | source record | Not a model factor now. |
| official_game | races[].starts[].horse.trainer | current trainer | object | yes | race_entries.trainer_id / trainers | used | trainer stats / analysis | source record + exact identity | Start relation is authoritative for that race. |
| official_game | races[].starts[].horse.homeTrack | horse home track | object | yes | horses.home_track_id + observation | stored_unused | profile | source record + exact track ID | No name-only mapping. |
| official_game | races[].starts[].horse.money | career earnings | number | yes | horses.career_earnings_sek | used | profile / analysis | source record | Verified source semantics. |
| official_game | races[].starts[].horse.record | current official record | object | yes | none | build_candidate | future capacity context | source record + fetched time | Current live importer does not populate record_text. |
| official_game | races[].starts[].horse.statistics.life.startPoints | Start Points | integer | yes | horse_start_points + horses.current_start_points | used | horse stats / AI pre-market | source record + observed_at | Immutable timeline; cache only advances chronologically. |
| official_game | races[].starts[].horse.statistics.year | current-year aggregate statistics | object | yes | none | build_candidate | future coverage/cross-check | source record + fetched time | Must be used as-of to avoid leakage. |
| official_game | races[].starts[].horse.statistics.life | lifetime aggregate statistics | object | yes | none except Start Points | build_candidate | future coverage/capacity | source record + fetched time | Keep separate from own calculated history. |
| official_game | races[].starts[].horse.statistics.records | method/distance records | array/object | yes | none | build_candidate | future capacity profile | source record + fetched time | Timestamped snapshot required. |
| official_game | races[].starts[].horse.lastFiveStarts.averageOdds | historical average odds | number | yes | none | raw_only | post-race/market research | raw archive + capture time | Must not enter blind strength. |
| official_game | races[].starts[].driver.id | driver identity | text | yes | drivers + external identity | used | driver stats / analysis | source record + exact identity | Canonical identity. |
| official_game | races[].starts[].driver.name | driver name | text | yes | drivers.canonical_name | used | UI | source record | Conflicts preserved. |
| official_game | races[].starts[].driver.location | driver location | text | yes | normalized_observations | stored_unused | profile | source record | Metadata. |
| official_game | races[].starts[].driver.birth | driver birth year | integer | yes | normalized_observations.birthYear | stored_unused | profile | source record | Not a direct quality signal. |
| official_game | races[].starts[].driver.homeTrack | driver home track | object | yes | drivers.home_track_id + observation | used | profile / exact home-track fact | source record + exact track ID | Name-only identity rejected. |
| official_game | races[].starts[].driver.license | driver license | text | yes | normalized_observations | stored_unused | profile | source record | Classification only if semantics are later needed. |
| official_game | races[].starts[].driver.silks | driver silks | object/text | yes | none | ignore | none | raw archive only | Presentation only. |
| official_game | races[].starts[].driver.statistics | driver annual statistics | object | yes | none | build_candidate | future coverage/form cross-check | source record + fetched time | Do not replace KentaurAI-derived stats. |
| official_game | races[].starts[].horse.trainer.id | trainer identity | text | yes | trainers + external identity | used | trainer stats / analysis | source record + exact identity | Canonical identity. |
| official_game | races[].starts[].horse.trainer.name | trainer name | text | yes | trainers.canonical_name | used | UI | source record | Conflicts preserved. |
| official_game | races[].starts[].horse.trainer.location | trainer location | text | yes | normalized_observations | stored_unused | profile | source record | Metadata. |
| official_game | races[].starts[].horse.trainer.birth | trainer birth year | integer | yes | normalized_observations.birthYear | stored_unused | profile | source record | Metadata. |
| official_game | races[].starts[].horse.trainer.homeTrack | trainer home track | object | yes | normalized_observations | used | trainer home/away stats | source record + exact external track ID | Latest verified observation drives home/away logic. |
| official_game | races[].starts[].horse.trainer.license | trainer license | text | yes | normalized_observations | stored_unused | profile | source record | Metadata. |
| official_game | races[].starts[].horse.trainer.statistics | trainer annual statistics | object | yes | none | build_candidate | future coverage/form cross-check | source record + fetched time | Keep independent from own stats. |
| official_game | races[].starts[].pools.<game>.betDistribution | betting percentage | number | yes | betting_snapshots.bet_percent | used | final market / post-race | source record + captured_at | Market-only; excluded from pre_market. |
| official_game | derived market rank | betting rank | integer | yes | betting_snapshots.market_rank | used | favorite-at-stop / final market | source record + captured_at | Deterministically ranked within the captured race. |
| official_game | races[].starts[].pools.<game>.trend | betting trend | number | yes | none | unclear | none | raw archive + capture time | Semantics must be proven from successive snapshots. |
| official_game | races[].starts[].pools.winPlace | win/place odds family | object | yes | odds_snapshots | used | final market / history | source record + captured_at | Source-backed and stop-capped when used in final analysis. |
| official_game | races[].starts[].horse.shoes | shoe state/change data | object | yes | equipment_snapshots | used | history / AI pre-market | source record + captured_at | Factual equipment only. |
| official_game | races[].starts[].horse.sulky | sulky state/change data | object | yes | equipment_snapshots | used | history / AI pre-market | source record + captured_at | Factual equipment only. |
| official_race | id | historical race identity | text | no | races.id | used | historical backfill | source record | Exact ordinary-race identity. |
| official_race | track.id | historical track identity | text/integer | no | track external identity / races.track_id | used | history / filters | source record + exact external ID | Identity checked against race ID. |
| official_race | date | historical race date | date | no | races.race_date | used | history / filters | source record | Canonical date. |
| official_race | number | historical race number | integer | no | races.race_number | used | ordering | source record | Identity checked against race ID. |
| official_race | distance | historical nominal distance | integer | yes | races.distance_m | used | stats / analysis | source record | Verified source value. |
| official_race | startMethod | historical start method | text | yes | races.start_method | used | stats / analysis | source record | Canonicalized deterministically. |
| official_race | starts[].scratched | verified scratch | boolean | yes | race_entries.scratched | used | all denominators | source record | Scratches are not starts. |
| official_race | starts[].postPosition | historical lane | integer | yes | race_entries.actual_lane | used | lane features / stats | source record | Verified only. |
| official_race | starts[].distance | historical actual start distance | integer | yes | race_entries.actual_start_distance_m | used | handicap/tillägg | source record | Deterministic distance difference. |
| official_race | starts[].result.place | official placing | integer | yes | race_results.placing | used | win/top3/form | source record | Non-positive/non-numeric stays null. |
| official_race | starts[].result.prizeMoney | official prize | number | yes | race_results.prize_sek | used | earnings stats | source record | Null remains distinct from zero. |
| official_race | starts[].result.kmTime | kilometre time | object | yes | race_results.km_time | stored_unused | future performance normalization | source record | Deterministically formatted when valid. |
| official_race | starts[].result.galloped | gallop indicator | boolean | yes | race_results.gallop | used | gallop rate | source record | Verified denominator only. |
| official_race | starts[].result.disqualified | disqualification | boolean | yes | race_results.disqualified | used | history / features | source record | Null-safe. |
| official_race | starts[].result.finalOdds | official final odds | number | yes | race_results.official_odds | stored_unused | retrospective market research | source record | Never current pre-market anchor. |
| official_race | starts[].result.finishOrder | finish-order value | number | yes | normalized_observations | stored_unused | none | source record | Preserved as observed result detail. |
| official_race | starts[].result.kmTime.code | kilometre-time code | text | yes | normalized_observations | stored_unused | none | source record | Not used in current stats. |
| xlabs_telemetry | frames[].trackId | telemetry track identity | text/integer | no | capture identity guard | used | X-Labs verification | source record + every-frame identity | Must match requested official track. |
| xlabs_telemetry | frames[].raceNumber | telemetry race number | integer | no | capture identity guard | used | X-Labs verification | source record + every-frame identity | Must match requested race. |
| xlabs_telemetry | frames[].timestamp | telemetry frame time | timestamp/number | no | raw telemetry / derived segments | used | telemetry calculations | source record | Ordered frame time retained in raw archive. |
| xlabs_telemetry | frames[].targets[].posX | trajectory X coordinate | number | yes | none | build_candidate | future trajectory analysis | source record | Tactical semantics not assumed. |
| xlabs_telemetry | frames[].targets[].posY | trajectory Y coordinate | number | yes | none | build_candidate | future trajectory analysis | source record | Tactical semantics not assumed. |
| xlabs_telemetry | frames[].targets[].distanceToFinish | distance to finish | number | yes | derived telemetry calculations | used | pace/distance calculations | source record | Relative-position use needs separate validation. |
| xlabs_telemetry | derived.first200 | first 200 m pace | time/number | yes | xlabs_data.first_200_time | used | horse stats / AI pre-market | source record + telemetry quality marker | Verified direct measurement. |
| xlabs_telemetry | derived.last200 | last 200 m pace | time/number | yes | xlabs_data.last_200_time | used | recent-start context | source record + telemetry quality marker | Verified measurement. |
| xlabs_telemetry | derived.last400 | last 400 m pace | time/number | yes | xlabs_data.last_400_time | used | horse stats / AI pre-market | source record + telemetry quality marker | Verified measurement. |
| xlabs_telemetry | derived.last500 | last 500 m pace | time/number | yes | xlabs_data.last_500_time | used | recent-start context | source record + telemetry quality marker | Verified measurement. |
| xlabs_telemetry | derived.last800 | last 800 m pace | time/number | yes | xlabs_data.last_800_time | used | recent-start context | source record + telemetry quality marker | Verified measurement. |
| xlabs_telemetry | derived.last1000 | last 1000 m pace | time/number | yes | xlabs_data.last_1000_time | used | recent-start context | source record + telemetry quality marker | Verified measurement. |
| xlabs_telemetry | derived.actualDistance | travelled distance | number | yes | xlabs_data.actual_distance_m | used | AI / history | source record + telemetry quality marker | Deterministic from verified frames. |
| xlabs_telemetry | derived.extraDistance | extra travelled distance | number | yes | xlabs_data.extra_distance_m | used | AI pre-market / horse patterns | source record + telemetry quality marker | Factual measurement. |
| xlabs_telemetry | derived.kmTime | full-race kilometre pace | time/number | yes | xlabs_data.km_time | used | recent-start context | source record + telemetry quality marker | Deterministic conversion. |
| xlabs_telemetry | derived.segments100m | 100 m interval pace sequence | array | yes | xlabs_data.segments_json | build_candidate | future scoped build | source record + telemetry quality marker | High-value safe expansion; no tactical labels required. |
| xlabs_telemetry | derived.frameCoverage | telemetry coverage | number | yes | xlabs_data.segments_json | stored_unused | QA / future confidence | source record + telemetry quality marker | Mapping requires verified coverage. |
| xlabs_telemetry | derived.slipstream | slipstream measure | number | yes | xlabs_data.slipstream_m | unclear | none | source record | Remains null until semantics are verified. |
| normalized_d1 | factual start sequence | first start after >=60 days | boolean/unknown | yes | deterministic query/feature | derived | horse/trainer stats | derived from stored actual starts | Scratches do not count or break rest. |
| normalized_d1 | factual start sequence | second start after rest | boolean/unknown | yes | deterministic query/feature | derived | horse/trainer stats | derived from stored actual starts | New >=60-day gap resets sequence. |
| normalized_d1 | actual_lane + start_method | volt lane quality | enum | yes | deterministic query/feature | derived | driver/trainer stats | derived from verified start facts | Good = 1, 6, 7 within current volt. |
| normalized_d1 | actual_start_distance - base_distance | handicap/tillägg | integer | yes | race_entries.handicap_m / filters | derived | driver/trainer stats | derived from verified distances | Separate from lane quality. |
| normalized_d1 | betting_snapshots at stop | favorite at betting stop | boolean | yes | deterministic market feature | derived | driver/trainer stats | latest source-backed valid pre-stop snapshot | Favorite = market rank 1. |
| normalized_d1 | betting_snapshots at stop | longshot at betting stop | boolean | yes | deterministic market feature | derived | driver/trainer stats | latest source-backed valid pre-stop snapshot | Contract = <=5%. |
| normalized_d1 | placements | horse form average, latest up to 10 | number | yes | deterministic statistics | derived | horse stats | filtered factual result starts | Placements only. |
| normalized_d1 | placements | driver/trainer form average, latest up to 30 | number | yes | deterministic statistics | derived | driver/trainer stats | filtered factual result starts | Placements only. |
| normalized_d1 | race_positions | verified race-position observations | rows | yes | race_positions | used | driver position rankings | source record required | Only source-backed verified position rows qualify. |
| normalized_d1 | race_conditions | race-condition observations | rows | yes | race_conditions | stored_unused | none | source-backed observation required | Acquisition/semantics remain incomplete. |
| normalized_d1 | analysis_features | deterministic feature values | rows | yes | analysis_features | used | AI context | feature version + as_of + source facts | Only market-blind versions may enter pre_market. |
| analysis_context | round.id | canonical round identity | text | no | immutable context envelope | used | external AI exchange | generated by KentaurAI | AI/user must not invent IDs. |
| analysis_context | legs[].raceId | canonical race identity | text | no | immutable context envelope | used | external AI exchange | generated by KentaurAI | Exact round membership. |
| analysis_context | legs[].entries[].raceEntryId | canonical race-entry identity | text | no | immutable context envelope | used | external AI exchange | generated by KentaurAI | Server validates submission IDs. |
| analysis_context | context_fingerprint | context fingerprint | text | no | immutable context envelope | used | import validation | generated from canonical context | Stale fingerprint fails closed. |
| analysis_context | pre_market factual context | market-blind facts/features | object | yes | exported context | used | external AI pre-market | generated from D1 with as-of rules | No current betting, odds, turnover or jackpot. |
| analysis_context | market context | verified market-at-stop object | object | yes | exported final context | used | external AI final | source-backed exact-round cutoff | Only after stored pre-market parent. |
| analysis_context | producer.provider | producer identity | enum | no | AI submission producer field | used | attribution | validated allowlist | Canonical providers currently openai/anthropic. |
| analysis_context | producer.model | actual model identity | text | no | AI submission producer field | used | attribution | validated string | Filename is descriptive, not authoritative. |

## Coverage and deliberate limits

The dictionary covers the source families required by the detailed build plan: official calendar/day, official V85/V86 game capture, official ordinary-race history/results, equipment, market/odds, X-Labs telemetry, key normalized deterministic feature families and the provider-neutral analysis context.

A `build_candidate` row is not permission to map it automatically. It still requires a separately scoped build with source-semantic verification, as-of/leakage rules, null behavior, provenance, tests and exact-head review. An `unclear` row must fail closed until semantics are proven.
