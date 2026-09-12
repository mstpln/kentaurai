# KentaurAI public data dictionary

Version: 1.0
Updated: 2026-09-12
Scope: verified public field inventory for currently implemented official, X-Labs, normalized and analysis-context families.

This dictionary is the canonical field-by-field companion to `docs/DATA_INVENTORY.md`. It intentionally contains only generic source-family names, generic source paths, semantics, mapping/use status and provenance rules. It contains no real racing payload values, private editorial provenance, credentials or private source identities.

## Status contract

Only these statuses are allowed:

- `used` - normalized and consumed by API, UI, deterministic feature logic or analysis context.
- `stored_unused` - normalized or preserved in D1 but not currently consumed analytically.
- `raw_only` - archived in raw source data but not normalized.
- `derived` - deterministically calculated from verified facts; not a raw source fact.
- `unclear` - observed source field exists but semantics/units are not yet verified enough to map.
- `ignore` - deliberately not promoted because it has no current analytical/product value.
- `build_candidate` - concrete, source-backed candidate for a future scoped build.

## Field dictionary

| source_family | raw_path | semantic_name | data_type | nullable | normalized_target | status | consumer | provenance_rule | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| official_calendar | date | calendar date | date | no | operational capture identity | used | live acquisition | source record + fetched time | Used to discover exact requested day. |
| official_calendar | tracks[].id | track identity | text/integer | no | tracks.external identity mapping | used | live acquisition / identity | source record + exact external id | Never name-match when exact identity exists. |
| official_calendar | tracks[].name | track name | text | yes | tracks.canonical_name observation | used | UI / identity display | source record | Conflicts preserved rather than silently replacing canonical name. |
| official_calendar | tracks[].races[].id | race identity | text | no | races.id / discovery membership | used | live acquisition | source record | Exact race membership for game discovery. |
| official_calendar | tracks[].races[].number | race number | integer | yes | races.race_number | used | UI / ordering | source record | Missing stays null. |
| official_calendar | tracks[].races[].status | race status | text | yes | races.status / observation | used | acquisition / UI | source record + fetched time | Operational status only. |
| official_calendar | tracks[].races[].startTime | race start time | timestamp | yes | races.scheduled_start_at / observation | used | scheduling | source record + fetched time | Time semantics must remain capture-time scoped. |
| official_calendar | games[].id | game identity | text | no | game_rounds.id | used | live acquisition / analysis identity | source record | Canonical round identity. |
| official_calendar | games[].type | game type | enum | no | game_rounds.game_type | used | V85/V86 gate | source record | Only exact supported V85/V86 identities enter normal flow. |
| official_calendar | games[].status | game status | text | yes | game_rounds.status | used | scheduling / UI | source record | Operational fact. |
| official_calendar | games[].scheduledStart | game scheduled start | timestamp | yes | game_rounds.scheduled_start_at | used | scheduling | source record | No guessed time. |
| official_calendar | games[].returnToPlayer | return to player | number | yes | none | ignore | none | raw archive only | Game economics, not horse strength. |
| official_calendar | games[].productFlags | product/system flags | object/array | yes | none | ignore | none | raw archive only | Operational/product metadata only. |
| official_calendar | tracks[].trackChanged | track changed flag | boolean | yes | none | unclear | none | raw archive only until semantics verified | Do not interpret as track-condition signal yet. |
| official_game | id | round identity | text | no | game_rounds.id | used | analysis / UI / system | source record | Canonical round id. |
| official_game | type | game type | enum | no | game_rounds.game_type | used | analysis / system rules | source record | V85/V86 only in game analysis flow. |
| official_game | status | round status | text | yes | game_rounds.status | used | UI / pre-race gating | source record + fetched time | Capture-time fact. |
| official_game | scheduledStart | round scheduled start | timestamp | yes | game_rounds.scheduled_start_at | used | pre-race gating | source record | No inferred values. |
| official_game | betStop | betting stop | timestamp | yes | game_rounds.bet_stop_at | used | final market cutoff | source record | Required for verified market-at-stop logic. |
| official_game | pool.timestamp | game-pool observation time | timestamp | yes | source/market observation time | stored_unused | future market confidence | source record + source timestamp | Candidate for market maturity only. |
| official_game | pool.turnover | game turnover | number | yes | game_rounds/market snapshot field where mapped | stored_unused | final-stage market context | source record + timestamp | Never pre-market strength input. |
| official_game | pool.systemCount | number of systems | integer | yes | none | build_candidate | future market confidence | source record + timestamp | Market maturity candidate, final stage only. |
| official_game | races[].id | race identity | text | no | races.id | used | all race joins | source record | Canonical race id. |
| official_game | races[].name | race name | text | yes | races.race_name | used | UI / class logic | source record | Free text remains distinct from structured class features. |
| official_game | races[].date | race date | date | no | races.race_date | used | history / filters | source record | Canonical race date. |
| official_game | races[].number | race number | integer | yes | races.race_number | used | ordering / UI | source record | Null-safe. |
| official_game | races[].distance | nominal race distance | integer | yes | races.distance_m | used | filters / analysis | source record | Verified nominal distance only. |
| official_game | races[].startMethod | start method | enum/text | yes | races.start_method | used | filters / features | source record | Canonicalized by deterministic code. |
| official_game | races[].scheduledStart | scheduled race start | timestamp | yes | races.scheduled_start_at | used | UI / gating | source record | No guessed time. |
| official_game | races[].actualStart | actual start time | timestamp | yes | normalized_observations | stored_unused | none | source record + observed time | Preserved when present. |
| official_game | races[].status | race status | text | yes | races.status | used | UI / processing | source record | Capture-time fact. |
| official_game | races[].prizeText | advertised prize text | text | yes | normalized_observations | stored_unused | verification / future terms work | source record | First-prize parsing uses separately verified logic. |
| official_game | races[].terms[] | race terms | array/text | yes | normalized_observations | build_candidate | future class/condition parser | source record | Raw wording preserved; only allowlisted semantics may be derived. |
| official_game | races[].track.id | track identity | text/integer | no | tracks external mapping | used | race identity / filters | source record | Exact id preferred over name. |
| official_game | races[].track.name | track name | text | yes | tracks.canonical_name observation | used | UI | source record | Conflicts preserved. |
| official_game | races[].track.country | track country | text | yes | tracks.country_code | used | UI / Swedish racing scope | source record | Storage remains code; UI localizes. |
| official_game | races[].track.systemCode | track system code | text | yes | normalized_observations | stored_unused | none | source record | Operational metadata. |
| official_game | races[].starts[].id | start identity | text | no | race_entries.id/external relation | used | all start facts | source record | Stable start identity. |
| official_game | races[].starts[].number | start number | integer | yes | race_entries.start_number | used | UI / navigation | source record | Missing stays null. |
| official_game | races[].starts[].postPosition | actual/post lane | integer | yes | race_entries.actual_lane | used | lane features / stats | source record | Used only when verified. |
| official_game | races[].starts[].distance | actual start distance | integer | yes | race_entries.actual_start_distance_m | used | handicap/tillägg feature | source record | Handicap derived only from verified distance difference. |
| official_game | races[].starts[].horse.id | horse identity | text | no | horses.id / race_entries.horse_id | used | all horse joins | source record | Canonical identity. |
| official_game | races[].starts[].horse.name | horse name | text | no | horses.canonical_name | used | UI | source record | Canonical-name conflicts preserved. |
| official_game | races[].starts[].horse.sex | horse sex | text | yes | horses.sex | used | filters / profile | source record | No inference when missing. |
| official_game | races[].starts[].horse.color | horse colour | text | yes | horses.color | stored_unused | profile | source record | Metadata, not model factor. |
| official_game | races[].starts[].horse.nationality | horse nationality | text | yes | horses.country_code | stored_unused | profile | source record | Metadata only at current version. |
| official_game | races[].starts[].horse.age | age at capture | integer | yes | normalized_observations | build_candidate | future age-at-as-of context | source record + fetched time | Never converted into guessed birth year. |
| official_game | races[].starts[].horse.sire | sire identity/name family | object/text | yes | horse pedigree name fields | stored_unused | profile | source record | Stable pedigree IDs are a later candidate. |
| official_game | races[].starts[].horse.dam | dam identity/name family | object/text | yes | horse pedigree name fields | stored_unused | profile | source record | No loose name-based pedigree relation. |
| official_game | races[].starts[].horse.damsire | damsire identity/name family | object/text | yes | horse pedigree name fields | stored_unused | profile | source record | Metadata at current version. |
| official_game | races[].starts[].horse.breeder | breeder | text/object | yes | horses.breeder_name | stored_unused | profile | source record | Not a model factor now. |
| official_game | races[].starts[].horse.owner | owner | text/object | yes | horses.owner_name | stored_unused | profile | source record | Not a model factor now. |
| official_game | races[].starts[].horse.trainer | current trainer | object | yes | race_entries.trainer_id / trainers | used | stats / analysis | source record + exact identity | Race-entry relation is authoritative for that start. |
| official_game | races[].starts[].horse.homeTrack | horse home track | object/text | yes | horse profile/observation | stored_unused | profile | source record | Do not infer track identity from name when exact ID is unavailable. |
| official_game | races[].starts[].horse.money | career earnings | number | yes | horses.earnings_sek | used | profile / analysis | source record | Stored directly using verified source semantics. |
| official_game | races[].starts[].horse.record | current official record object | object | yes | none | build_candidate | future capacity context | source record + fetched time | Needs structured timestamped mapping; not current form. |
| official_game | races[].starts[].horse.statistics.startPoints | Start Points | integer | yes | horse_start_points + horses.current_start_points | used | horse stats / AI pre-market | source record + observed_at | Immutable time series; current cache only advances chronologically. |
| official_game | races[].starts[].horse.statistics.year | current-year aggregate statistics | object | yes | none | build_candidate | future coverage/cross-check | source record + fetched time | Must never leak a later snapshot into earlier analysis. |
| official_game | races[].starts[].horse.statistics.life | lifetime aggregate statistics | object | yes | none | build_candidate | future coverage/capacity context | source record + fetched time | Keep separate from KentaurAI-derived history. |
| official_game | races[].starts[].horse.statistics.records | method/distance records | array/object | yes | none | build_candidate | future capacity profile | source record + fetched time | Timestamped snapshot required. |
| official_game | races[].starts[].horse.lastFiveStarts.averageOdds | historical average odds | number | yes | none | raw_only | post-race/market research only | raw archive + capture time | Must not enter market-blind strength. |
| official_game | races[].starts[].driver.id | driver identity | text | yes | drivers.id / race_entries.driver_id | used | driver stats / analysis | source record | Canonical identity. |
| official_game | races[].starts[].driver.name | driver name | text | yes | drivers.canonical_name | used | UI | source record | Conflicts preserved. |
| official_game | races[].starts[].driver.location | driver location | text | yes | normalized_observations | stored_unused | profile | source record | No direct quality interpretation. |
| official_game | races[].starts[].driver.birthYear | driver birth year | integer | yes | normalized_observations | stored_unused | profile | source record | Profile/segmentation only if later needed. |
| official_game | races[].starts[].driver.homeTrack | driver home track | object/text | yes | source-backed home-track observation | used | driver/trainer track logic where applicable | source record + exact external identity | No name-only identity. |
| official_game | races[].starts[].driver.license | driver license | text | yes | normalized_observations | stored_unused | profile | source record | Classification only after semantics are stable. |
| official_game | races[].starts[].driver.silks | driver silks | object/text | yes | none | ignore | none | raw archive only | Presentation-only data. |
| official_game | races[].starts[].driver.statistics | driver annual statistics | object | yes | none | build_candidate | future coverage/fresh-form cross-check | source record + fetched time | Keep independent from KentaurAI-derived stats. |
| official_game | races[].starts[].trainer.id | trainer identity | text | yes | trainers.id / race_entries.trainer_id | used | trainer stats / analysis | source record | Canonical identity. |
| official_game | races[].starts[].trainer.name | trainer name | text | yes | trainers.canonical_name | used | UI | source record | Conflicts preserved. |
| official_game | races[].starts[].trainer.location | trainer location | text | yes | normalized_observations | stored_unused | profile | source record | Metadata. |
| official_game | races[].starts[].trainer.birthYear | trainer birth year | integer | yes | normalized_observations | stored_unused | profile | source record | Metadata. |
| official_game | races[].starts[].trainer.homeTrack | trainer home track | object/text | yes | source-backed home-track observation | used | home/away trainer stats | source record + exact external identity | Name-only matching is rejected. |
| official_game | races[].starts[].trainer.license | trainer license | text | yes | normalized_observations | stored_unused | profile | source record | Metadata until explicit use. |
| official_game | races[].starts[].trainer.statistics | trainer annual statistics | object | yes | none | build_candidate | future coverage/form cross-check | source record + fetched time | Keep separate from derived trainer stats. |
| official_game | races[].starts[].betDistribution | betting percentage | number | yes | betting_snapshots.bet_percent | used | final market / post-race | source record + captured_at | Market-only; excluded from pre_market. |
| official_game | races[].starts[].marketRank | betting rank | integer | yes | betting_snapshots.market_rank | used | favorite-at-stop feature / final market | source record + captured_at | Last valid source-backed pre-stop snapshot only. |
| official_game | races[].starts[].trend | betting trend | number | yes | none | unclear | none | raw archive + capture time | Semantics must be proven from successive snapshots; market stage only. |
| official_game | races[].starts[].odds | win/place odds family | object | yes | odds_snapshots | used | final market / history | source record + captured_at | Source-backed and betting-stop capped where used for final analysis. |
| official_game | races[].starts[].equipment | current shoe/sulky state | object | yes | equipment_snapshots | used | history / AI pre-market | source record + captured_at | Factual state only. |
| official_game | races[].starts[].equipmentChanges | change-from-previous flags | object | yes | equipment_snapshots.change_from_previous_json | used | AI pre-market | source record + captured_at | Historical response feature remains a future candidate. |
| official_race | id | historical race identity | text | no | races.id | used | historical backfill | source record | Exact ordinary-race identity. |
| official_race | track | historical track identity | object | no | tracks / races.track_id | used | history / filters | source record | Swedish trotting scope verified separately. |
| official_race | date | historical race date | date | no | races.race_date | used | history / filters | source record | Canonical date. |
| official_race | number | historical race number | integer | yes | races.race_number | used | ordering | source record | Null-safe. |
| official_race | distance | historical nominal distance | integer | yes | races.distance_m | used | stats / analysis | source record | Verified source field. |
| official_race | startMethod | historical start method | text | yes | races.start_method | used | stats / analysis | source record | Canonicalized deterministically. |
| official_race | scratched | declared scratch flag | boolean | yes | race_entries.scratched | used | all denominator rules | source record | Scratched declarations are never counted as starts. |
| official_race | starts[].postPosition | historical actual lane | integer | yes | race_entries.actual_lane | used | lane features / stats | source record | Verified only. |
| official_race | starts[].startDistance | historical actual start distance | integer | yes | race_entries.actual_start_distance_m | used | handicap/tillägg | source record | Handicap derived deterministically. |
| official_race | results[].placing | official placing | integer/text | yes | race_results.placing | used | form / win/top3 | source record | Non-numeric/unknown placement remains null. |
| official_race | results[].prize | official prize | number | yes | race_results.prize_sek | used | earnings stats | source record | Null distinct from zero. |
| official_race | results[].kmTime | kilometre time | text/number | yes | race_results.km_time | stored_unused | future performance normalization | source record | Candidate for class-adjusted performance. |
| official_race | results[].gallop | gallop indicator | boolean | yes | race_results.gallop | used | gallop rate | source record | Denominator uses only verified gallop status. |
| official_race | results[].disqualified | disqualification indicator | boolean | yes | race_results.disqualified | used | history / features | source record | Null-safe. |
| official_race | results[].odds | official final odds | number | yes | race_results.final_odds / odds history | stored_unused | retrospective expectation research | source record | Never current pre-market anchor. |
| official_race | results[].finishOrder | finish-order text/code | text | yes | normalized_observations | stored_unused | none | source record | Preserve, do not reinterpret without need. |
| official_race | results[].kmTimeCode | kilometre-time code | text | yes | normalized_observations | stored_unused | none | source record | Semantics not needed for current stats. |
| xlabs_telemetry | frames[].trackId | telemetry track identity | integer/text | no | capture identity guard | used | X-Labs verification | source record + every-frame identity | Must match requested official track identity. |
| xlabs_telemetry | frames[].raceNumber | telemetry race number | integer | no | capture identity guard | used | X-Labs verification | source record + every-frame identity | Must match requested race number. |
| xlabs_telemetry | frames[].timestamp | telemetry frame time | timestamp/number | no | raw telemetry / derived segments | used | telemetry calculations | source record | Ordered frame timing retained in raw archive. |
| xlabs_telemetry | frames[].targets[].posX | lateral/track coordinate X | number | yes | none | build_candidate | future trajectory analysis | source record | Coordinate semantics must be validated before tactical labels. |
| xlabs_telemetry | frames[].targets[].posY | lateral/track coordinate Y | number | yes | none | build_candidate | future trajectory analysis | source record | Same guardrail as posX. |
| xlabs_telemetry | frames[].targets[].distanceToFinish | distance to finish | number | yes | calculations / segments_json | used | pace / future relative-position features | source record | Relative-position derivation requires separate validation. |
| xlabs_telemetry | derived.first200 | first 200 m pace | time/number | yes | xlabs_data.first_200_time | used | horse stats / AI pre-market | source record + telemetry quality marker | Verified direct measurement. |
| xlabs_telemetry | derived.last200 | last 200 m pace | time/number | yes | xlabs_data.last_200_time | used | recent-start AI context | source record + telemetry quality marker | Verified direct measurement. |
| xlabs_telemetry | derived.last400 | last 400 m pace | time/number | yes | xlabs_data.last_400_time | used | horse stats / AI pre-market | source record + telemetry quality marker | Verified direct measurement. |
| xlabs_telemetry | derived.last500 | last 500 m pace | time/number | yes | xlabs_data.last_500_time | used | recent-start AI context | source record + telemetry quality marker | Verified direct measurement. |
| xlabs_telemetry | derived.last800 | last 800 m pace | time/number | yes | xlabs_data.last_800_time | used | recent-start AI context | source record + telemetry quality marker | Verified direct measurement. |
| xlabs_telemetry | derived.last1000 | last 1000 m pace | time/number | yes | xlabs_data.last_1000_time | used | recent-start AI context | source record + telemetry quality marker | Verified direct measurement. |
| xlabs_telemetry | derived.actualDistance | travelled distance | number | yes | xlabs_data.actual_distance_m | used | AI / history | source record + telemetry quality marker | Directly derived from verified frames. |
| xlabs_telemetry | derived.extraDistance | extra travelled distance | number | yes | xlabs_data.extra_distance_m | used | AI pre-market / Build F horse patterns | source record + telemetry quality marker | Factual measurement, not tactical interpretation. |
| xlabs_telemetry | derived.kmTime | full-race kilometre pace | time/number | yes | xlabs_data.km_time | used | recent-start context | source record + telemetry quality marker | Verified deterministic conversion. |
| xlabs_telemetry | derived.segments100m | 100 m interval pace sequence | array | yes | xlabs_data.segments_json | build_candidate | future Build G | source record + telemetry quality marker | Highest-priority safe X-Labs expansion; no tactical labels required. |
| xlabs_telemetry | derived.frameCoverage | telemetry frame coverage | number | yes | xlabs_data.segments_json | stored_unused | QA / future confidence | source record + telemetry quality marker | Current mapper requires at least 99% coverage. |
| xlabs_telemetry | derived.slipstream | slipstream distance | number | yes | xlabs_data.slipstream_m | unclear | none | source record | Deliberately null until semantics are verified. |
| normalized_d1 | race_entries + races history | first start after >=60 days | boolean/unknown | yes | deterministic query/feature | derived | horse/trainer stats | derived from factual start sequence | Scratches do not count or break rest. |
| normalized_d1 | race_entries + races history | second start after rest | boolean/unknown | yes | deterministic query/feature | derived | horse/trainer stats | derived from factual start sequence | New >=60-day gap resets sequence. |
| normalized_d1 | actual_lane + start_method | volt lane quality | enum | yes | deterministic feature/query | derived | driver/trainer stats | derived from verified start facts | Good = lanes 1, 6, 7 within current volt. |
| normalized_d1 | actual_start_distance - base_distance | handicap/tillägg bucket | integer | yes | race_entries.handicap_m / derived filters | derived | driver/trainer stats | derived from verified distances | Separate from volt-lane quality. |
| normalized_d1 | betting_snapshots at stop | favorite at betting stop | boolean | yes | deterministic market feature | derived | driver/trainer stats | latest source-backed valid pre-stop snapshot | Favorite = verified market rank 1. |
| normalized_d1 | betting_snapshots at stop | longshot at betting stop | boolean | yes | deterministic market feature | derived | driver/trainer stats | latest source-backed valid pre-stop snapshot | Contract = market share <=5%. |
| normalized_d1 | placements | horse form average, latest up to 10 | number | yes | deterministic statistics | derived | horse stats | only factual filtered result starts | Placements only. |
| normalized_d1 | placements | driver/trainer form average, latest up to 30 | number | yes | deterministic statistics | derived | driver/trainer stats | only factual filtered result starts | Placements only. |
| normalized_d1 | race_positions | verified race position observations | object/rows | yes | race_positions | stored_unused | source-backed position rankings where populated | source record required | No X-Labs tactical derivation until separately validated. |
| normalized_d1 | race_conditions | race-day condition facts | object/rows | yes | race_conditions | stored_unused | none | source-backed observation required | Automatic acquisition/derivation remains incomplete. |
| normalized_d1 | analysis_features | deterministic feature values | object/rows | yes | analysis_features | used | AI context | feature version + as_of + source facts | Only market-blind versions may enter pre_market. |
| analysis_context | analysis_contexts[].round.id | canonical round identity | text | no | immutable export envelope | used | external AI exchange | generated by KentaurAI | AI/user must not invent or transform. |
| analysis_context | analysis_contexts[].legs[].raceId | canonical race identities | text | no | immutable export envelope | used | external AI exchange | generated by KentaurAI | Exact eight-leg context. |
| analysis_context | analysis_contexts[].legs[].entries[].raceEntryId | canonical race-entry identities | text | no | immutable export envelope | used | external AI exchange | generated by KentaurAI | Submission validation is server-side. |
| analysis_context | context_fingerprint | context fingerprint | text | no | immutable export envelope | used | import validation | generated from canonical context | Stale fingerprint fails closed. |
| analysis_context | pre_market factual context | market-blind facts/features | object | yes | exported context | used | external AI pre-market | generated from D1 with as-of rules | Excludes current betting, odds, turnover and jackpot. |
| analysis_context | market context | verified market-at-stop object | object | yes | exported final context | used | external AI final | exact source-backed round/race-entry market with cutoff | Exposed only after stored pre-market parent. |
| analysis_context | producer.provider | producer identity | enum | no | ai_submissions/provider field | used | attribution | validated allowlist | Current canonical providers: openai, anthropic. |
| analysis_context | producer.model | actual model identity | text | no | ai_submissions/model field | used | attribution | validated string | Filename is descriptive, never authoritative. |

## Coverage and deliberate limits

This dictionary covers the currently implemented source families and normalized/analysis families required by the build plan: official calendar/day, official V85/V86 game capture, official ordinary-race history/results, equipment, market/odds, X-Labs telemetry, key normalized D1 feature families and provider-neutral analysis context.

A row marked `build_candidate` is not permission to map it automatically. Each candidate still needs a separately scoped build with source-semantic verification, anti-leakage rules, null behavior, provenance, tests and exact-head review. A row marked `unclear` must fail closed until semantics are proven.
