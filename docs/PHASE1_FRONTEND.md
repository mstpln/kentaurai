# Phase 1 frontend

## Scope and running preview

Implemented on `feat/phase1-frontend` in the existing Worker-rendered PWA.
Run the existing `npm run dev:replit` workflow and open `/app/`. Authentication
still uses the development `APP_PASSWORD` session. No new service, package,
backend route, database schema, production configuration, or release workflow
was introduced.

The application shell, icons, and rich statistics/detail/filter views are
retained. The Travdata rebrand uses light surfaces, the Helvetica/Arial system
font stack, the supplied round TD logo, and dark navy navigation with bright
logo-blue selections and a blue top settings icon. Purple accents data; the bottom
navigation's original colors remain unchanged.
Time-period/filter rows stay light; navigation tabs have no outer dark frame.
The bottom navigation retains the original icons and styling with exactly
**Trend**, **Statistik**, and **Spel**. Trend opens the original Trend view;
Spel contains **Kommande omgångar** and **Mina system** as secondary views.
**Inställningar** is accessed only through the existing top gear, not the
bottom navigation. Obsolete AI/editorial entry points
are not part of the new navigation; their backend and stored data are untouched.

## Implemented interactions

- Factual upcoming V85/V86 rounds with eight legs and expandable horse rows;
  no system selection controls appear in start lists.
- Plain result form, four compact summary metrics, exactly eight contextual
  statistic cards, and compact five-start desktop/mobile history.
  Gallop and disqualification require explicit known flags; unknown codes
  are not interpreted. Missing measurements remain `–`.
- Shared horse notes keyed by horse identity, including a rightmost
  **Anteckningar** profile tab. Create, edit, optional start reference,
  confirmed delete, and persistence across reload are implemented locally.
- A separate manual builder with eight legs and all numbers 1–15, five across
  on mobile. Arbitrary spike counts, optional name, clear/save, historical
  registration, row product, V85 0.50 SEK / V86 0.25 SEK prices, and multiple
  registrations for one round are supported.
- Round-grouped saved systems with independently expandable systems/rounds,
  result comparison, three finance cards, and sample-size-labelled performance.
  Pending/unknown payouts are excluded from realized totals. Coverage of winning
  numbers never creates or implies a payout. There is no ROI card.
- Existing horse/driver/trainer/track search, statistics and Trend views, deep
  profiles, and operational settings remain available.
- Loading, empty, failed reads/retry, missing/partial facts, waiting results,
  expired authentication, and failed/corrupt local storage have explicit states.
  A failed initial storage read blocks writes instead of overwriting lost data.

## Existing APIs versus demonstration data

`src/phase1-data.js` performs authenticated same-origin **GETs only**:

- `/app/api/games/upcoming` and its round, leg, form, and entry-facts routes;
- `/app/api/entities/horses/:id` and `/:id/starts?limit=30&offset=0`;
- existing entity lists, `/search`, `/tracks`, `/games`, `/settings/status`.

The optimized horse-detail response deliberately omits embedded starts. The
adapter therefore reads the existing paginated history separately, displays up
to five completed, non-scratched, non-future starts, and preserves history errors.
The read is bounded; an unusually long list of scheduled starts may leave fewer
than five completed starts in that page. Track search is merged from the existing
track-list API rather than invented as a new `/search` backend capability.

**All API checks in this work used the local synthetic D1 database, not
production.** The existing preview badge identifies that environment. Database
fixture dates can be refreshed with the existing `npm run db:seed:replit`;
this resets only reserved `demo_` rows using explicit local Wrangler mode.

Additional isolated, opt-in examples live in `src/phase1-fixtures.js`. They
demonstrate V85/V86 data, form variations, missing X-Labs measurements,
completed/pending/historical systems, multiple systems per round, and positive,
negative, and zero outcomes. Each is labelled **Syntetiskt exempel**.
Dates are deterministic from an injected Stockholm calendar date and generated
per HTML request, not at Worker module initialization. Settled examples are in
the past, upcoming examples in the future; identifiers include their dates.
Demo notes are presentation fixtures, not automatically persisted user notes.

Notes and newly registered systems use versioned browser `localStorage` only
(`src/phase1-store.js` / UI adapter). They do **not** call the old system POST
API or its exactly-three-spikes rule. They do not sync between devices or users,
and clearing browser site data removes them. Local storage is not encrypted
private storage; scripts running on that origin and someone using the browser
profile can read it.

## Explicit Phase 2 backend work

1. Provide authenticated persistent note CRUD keyed by stable horse ID and
   optional stable race-entry ID. The existing history response does not expose
   its race/entry IDs. The frontend does not fabricate IDs from date/name:
   verified-history linking is disabled until those IDs exist in its contract.
   Race-linked notes are fully demonstrable with explicit synthetic entries.
   Store only the reference and note text/timestamps, never copied race facts.
2. Provide persistent manual-system CRUD and canonical historical/upcoming
   round lookup. Integrate it separately from legacy AI/generated systems.
   Add authoritative, auditable winners and payout/settlement reads; never infer
   an actual dividend from leg coverage. Browser-local registrations intentionally
   remain pending without an authoritative settlement.
3. Add a bounded completed-starts contract with stable IDs, consistent as-of
   semantics, and explicit coverage. Existing contextual metrics retain their
   current backend definitions; this phase does not invent new historical
   as-of computations or populate missing measurements.

No production database, Cloudflare credentials, R2 data, ingestion/backfill job,
or settings change was needed. Nothing was pushed, merged, deployed, or published.

## Travdata visual branding

`src/travdata-theme.js` provides the additive light theme and
`src/travdata-brand.js` applies display names, the transparent original logo,
PWA presentation metadata, and same-origin brand assets. The uploaded round
TD mark remains unchanged. TRAVDATA is smaller Arial Bold Italic text in the
original red/purple colors. Helvetica/Arial uses installed system fonts, with no
external font request. Existing API names, database names, authentication, browser-local notes
and system storage keys, PWA scope and application structure remain unchanged.
Only the existing static PWA cache version changes so previously cached
KentaurAI icons and metadata can refresh.

## Verification

```sh
npm run qa
node scripts/qa-phase1-browser.mjs
```

The dependency-free browser check uses installed Chromium and its debugging
protocol, signs into the development preview using the environment secret
without displaying it, blocks external/mutating browser requests, and cleans up
its temporary browser profile. Authentication is restricted to HTTPS
`.replit.dev` preview origins.

Coverage includes the core UI flows, shared notes and reload persistence,
synthetic race-linked notes, 1–15/manual arithmetic, multiple systems per round,
pending/negative finance states, empty/error responses, corrupt-storage
protection, search across all four entity types, and uncaught browser errors.
Responsive checks use **320, 375, 390, 430, 768, and 1280 px**.
The standard unauthenticated screenshot shows the login screen; signed-in UI
is checked separately by authenticated Chromium, without bypassing app auth.

Verified in the local preview on 2026-11-08: the full `npm run qa` suite passed
**1,338 tests**, and the authenticated browser suite passed **33 checks**.
There were no uncaught browser exceptions, no backend mutation requests, and
no page-level horizontal overflow at the tested widths. The existing workflow
remained running after login, navigation, reload, and the storage-failure test.
