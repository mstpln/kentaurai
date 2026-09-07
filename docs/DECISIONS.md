# Product and architecture decisions

## Architecture
- GitHub: public code, migrations, tests and version history.
- Cloudflare Worker: private API, import orchestration, interface delivery and scheduled jobs.
- Cloudflare D1: normalized/queryable data.
- Cloudflare R2: raw snapshots and larger source objects.
- A private read-only KentaurAI interface sits on top of the Worker/D1 data layer.
- AI provider is replaceable; OpenAI and Claude are both valid analysis layers.

## Entity-centric interface direction
1. The interface is entity-centric rather than V85/V86-round-centric.
2. Primary detail entities are horse, trainer and driver.
3. V85/V86 round pages are not a core interface requirement.
4. Bottom navigation order is fixed as Start -> Tränare -> Hästar -> Kuskar.
5. A global search bar remains fixed at the top and searches all three primary entity types.
6. Start and detail pages should use tabs instead of long continuous vertical pages wherever practical.
7. Detail pages expose factual history, deterministic statistics and trends first; later X-Labs/features can be added to the same entity pages.
8. The start page should eventually surface the most relevant rolling trend data, such as trainer and driver win rates over 2 weeks, 4 weeks, 3 months, 6 months and 1 year.
9. Trend leaderboards must use deterministic code and sensible minimum-sample rules so very small samples do not dominate.
10. The interface remains separate from the AI analysis layer: factual data and calculated metrics are displayed directly; AI interpretation is a later layer.
11. The first interface is read-only and private.
12. Visual direction is minimal and strongly structured, using black/grey/brown/beige as the base with restrained blue/yellow/gold accents and clear card/divider/tab separation.
13. Missing historical/statistical data is shown as unavailable; the interface must never invent trend values or substitute unrelated data.
14. Browser access uses a separate `APP_PASSWORD` secret and a secure HttpOnly session cookie. `ADMIN_TOKEN` remains reserved for operational APIs and is never exposed to the interface.

## Official live normalization
1. Raw official responses are archived before normalization and remain the factual source of truth.
2. The live mapper only maps field semantics verified against an observed current game payload.
3. Missing optional facts remain null; age is not converted into an inferred birth year.
4. Horse `money` is treated as SEK. Nested statistics earnings are not assumed to use the same scale.
5. V85/V86 marking distribution and winner/place odds are converted from observed hundredths by deterministic code.
6. Voltstart handicap is calculated only from observed start distance minus race base distance; unsupported distance differences fail instead of being guessed.
7. Market percentages, odds and equipment are timestamped snapshots tied to the exact `source_record_id`; later captures do not overwrite historical snapshots.
8. Multi-track rounds do not invent a primary track.
9. Conflicting canonical names for the same official external ID preserve the existing canonical value and flag the new observation as `source_conflict`.
10. Live scratch semantics remain unimplemented until a real scratched/withdrawn response is observed. Declared starts are marked with that limitation rather than guessed.
11. Automatic live acquisition remains disabled until a later explicit build enables it.
12. The official-provider vertical slice is accepted only after raw-vs-normalized production verification passes without mismatches for the verified subset.

## Manual editorial flow
1. Editorial content is reviewed outside KentaurAI using an authorized user workflow.
2. That workflow exports only the structured signals needed by KentaurAI.
3. The export is supplied temporarily to the private import flow and is never committed to the public repository.
4. The import endpoint validates it and writes structured signals to private D1 while preserving private provenance.
5. Manual editorial data uses a separate import path from automated provider ingestion.
6. KentaurAI does not browse or collect editorial content itself.
7. Public code, tests and examples never identify a private editorial source.

## Learning registry
A single race must not directly change model weights. Candidate learnings are recorded as hypotheses and accumulate supporting/contradicting observations. Actual model/rule changes are stored in `model_change_log` and tied to `model_versions`.
