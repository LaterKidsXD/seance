# Implementation Plan: Séance

## Overview

Implement Séance as a Next.js 15 App Router application deployed on Vercel. The build order follows the natural dependency chain: shared types and Zod schemas first, then the in-memory cache and venue adapters, then the matching and fusion engines, then the API routes and MCP server, and finally the Ouija Dashboard. Property-based tests (fast-check + Vitest) are placed close to the pure functions they guard so regressions surface early.

---

## Tasks

- [x] 1. Scaffold project and shared schema layer
  - Initialise a Next.js 15 project with the App Router, TypeScript strict mode, Vitest, and fast-check; set up `eslint` and `prettier`; create the directory skeleton (`src/lib`, `src/adapters`, `src/app`, `src/components`, `src/hooks`, `data/`)
  - Write Zod schemas for `Market`, `Match`, `ConsensusEvent`, `Divergence`, and `DivergenceConfig` in `src/lib/schemas.ts`; export inferred TypeScript types alongside each schema
  - Add `DivergenceConfig` startup-validation logic that reads `DIVERGENCE_THRESHOLD` from `process.env` (default `0.05`) and throws if the parsed value is outside `[0.01, 1.00]`
  - Create `data/curated-matches.json` as an empty array placeholder
  - _Requirements: 1.2, 2.1, 2.2, 4.5_

- [ ] 2. Implement VenueCache and VenueAdapterRegistry
  - [ ] 2.1 Implement `VenueCache` in `src/lib/venueCache.ts`
    - `Map<VenueName, CacheEntry>` backing store with `get`, `set`, and `isStale` methods; TTL jitter: `Math.floor(Math.random() * 30_000) + 30_000` ms; separate `Map<string, { priceUsd: number; fetchedAt: number }>` for DexScreener spot-price cache (60 s TTL)
    - _Requirements: 1.3, 1.4_
  - [ ]* 2.2 Write unit tests for VenueCache
    - Test `isStale` boundaries (fresh, just-expired, 5-minute stale fallback), TTL jitter range, DexScreener cache expiry
    - _Requirements: 1.3, 1.4_
  - [ ] 2.3 Implement `VenueAdapterRegistry` in `src/lib/venueAdapterRegistry.ts`
    - `Promise.allSettled` over all registered adapters; on success write cache; on failure attempt stale fallback if snapshot < 5 min; if no snapshot omit venue; return `{ markets, errors }`
    - _Requirements: 1.1, 1.3, 1.4_
  - [ ]* 2.4 Write unit tests for VenueAdapterRegistry
    - Test all-success path, partial failure with fresh stale snapshot, partial failure with expired snapshot (venue omitted), all-venues-fail returns 503
    - _Requirements: 1.1, 1.3_

- [ ] 3. Implement venue adapters
  - [ ] 3.1 Implement `PolymarketAdapter` in `src/adapters/polymarketAdapter.ts`
    - Fetch `GET gamma-api.polymarket.com/markets?active=true&closed=false` with pagination; map `tokens[0].price` (where `outcome === "Yes"`) → `prob`; `liquidityNum` → `liquidity`; `endDate` normalised to UTC ISO 8601 → `close_time`; validate each market against `MarketSchema`; set `stale=false`
    - _Requirements: 1.1, 1.2, 1.7_
  - [ ]* 3.2 Write property test for PolymarketAdapter normalisation
    - **Property 1: Adapter output conforms to the Market schema**
    - **Validates: Requirements 1.2, 1.7**
    - Generate arbitrary Polymarket API response payloads with fast-check; assert every output passes `MarketSchema.parse()`, `prob ∈ [0,1]`, `venue === "polymarket"`, `stale === false`, `close_time` is valid UTC ISO 8601
    - _Requirements: 1.2, 1.7_
  - [ ] 3.3 Implement `KalshiAdapter` in `src/adapters/kalshiAdapter.ts`
    - Fetch `GET external-api.kalshi.com/trade-api/v2/markets?status=open` with pagination; midpoint of `yes_bid`/`yes_ask` → `prob`; `volume` → `liquidity`; `close_time` already ISO 8601; validate against `MarketSchema`; set `stale=false`
    - _Requirements: 1.1, 1.2, 1.7_
  - [ ]* 3.4 Write property test for KalshiAdapter normalisation
    - **Property 1: Adapter output conforms to the Market schema** (Kalshi variant)
    - **Validates: Requirements 1.2, 1.7**
    - Generate arbitrary Kalshi API response payloads; assert same schema invariants as 3.2
    - _Requirements: 1.2, 1.7_
  - [ ] 3.5 Implement `DexScreenerAdapter` in `src/adapters/dexScreenerAdapter.ts`
    - Extract ticker from market title via `/\$([A-Z0-9]+)/i` or `/\b([A-Z0-9]{2,10})\s+(?:above|below|over|under|crosses?)\s+\$/i`; call `GET api.dexscreener.com/latest/dex/search?q={symbol}`; return `priceUsd` from highest-liquidity pair; on failure return `{ spot_price_stale: true }` with no `spot_price`; use the 60 s symbol-level cache
    - _Requirements: 1.5, 1.6_
  - [ ]* 3.6 Write property test for DexScreener failure path
    - **Property 3: DexScreener failure sets spot_price_stale**
    - **Validates: Requirements 1.6**
    - Generate arbitrary crypto-threshold market titles and simulate fetch failure; assert no `spot_price` field and `spot_price_stale === true`
    - _Requirements: 1.6_
  - [ ]* 3.7 Write property test for stale fallback
    - **Property 2: Stale fallback preserves markets with stale=true**
    - **Validates: Requirements 1.3**
    - Generate arbitrary `Market[]` cache snapshots and simulate venue fetch failures (network error and HTTP 429); assert returned markets equal the snapshot with every `stale` field set to `true`
    - _Requirements: 1.3_

- [ ] 4. Checkpoint — Ensure all adapter and cache tests pass
  - Run `vitest --run`; resolve any failures before proceeding. Ask the user if any design question arises.

- [ ] 5. Implement MatchingEngine
  - [ ] 5.1 Implement confidence score helpers in `src/lib/matchingEngine.ts`
    - Jaro-Winkler title similarity (lowercase, strip punctuation, remove filler words: "will the a an in by on"); date similarity (`1.0` if `|close_time_A − close_time_B| ≤ 1 calendar day`, else `0.0`); strike extraction regex `/\$?([\d,]+(?:\.\d+)?)[kKmMbBtT]?/`; weighted sum formula with and without strike signal as specified in the design
    - _Requirements: 2.1, 2.2_
  - [ ]* 5.2 Write property test for confidence score symmetry
    - **Property 4: Confidence score symmetry**
    - **Validates: Requirements 2.4**
    - Generate arbitrary pairs of `Market` objects with fast-check; assert `computeConfidence(A, B) === computeConfidence(B, A)` for 100+ iterations
    - _Requirements: 2.4_
  - [ ]* 5.3 Write property test for confidence formula correctness
    - **Property 5: Confidence formula correctness with optional strike redistribution**
    - **Validates: Requirements 2.1, 2.2**
    - Generate market pairs with and without numeric strike values; assert the returned score equals the weighted formula exactly and lies in `[0, 1]`
    - _Requirements: 2.1, 2.2_
  - [ ] 5.4 Implement `MatchingEngine` class with `proposeMatches`, `reEvaluate`, `getMatchesForMarket`, `getCuratedMatchOverride`
    - Load `data/curated-matches.json` at construction; `proposeMatches` computes confidence for all incoming × existing pairs and creates/updates `Match` records; status transitions: `confidence ≥ 0.85` → linked, `< 0.85` → proposed, `< 0.50` → remove; curated matches always return `status: "curated"` and are never demoted; `getMatchesForMarket` returns matches ordered by `confidence` descending
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7_
  - [ ]* 5.5 Write property test for high-confidence promotion
    - **Property 6: High-confidence matches are promoted to linked**
    - **Validates: Requirements 2.3**
    - Generate market pairs whose signals produce `confidence ≥ 0.85`; assert `Match.status === "linked"` after `proposeMatches`
    - _Requirements: 2.3_
  - [ ]* 5.6 Write property test for curated match override
    - **Property 7: Curated match always overrides computed status**
    - **Validates: Requirements 2.5**
    - For any market pair in the curated list, assert `getMatchesForMarket` returns `status: "curated"` regardless of computed confidence
    - _Requirements: 2.5_
  - [ ]* 5.7 Write property test for match ordering
    - **Property 8: Matches returned in descending confidence order**
    - **Validates: Requirements 2.7**
    - Generate markets with ≥ 2 match records; assert `matches[i].confidence ≥ matches[i+1].confidence` for all i
    - _Requirements: 2.7_

- [ ] 6. Implement FusionEngine
  - [ ] 6.1 Implement `FusionEngine.computeConsensus` in `src/lib/fusionEngine.ts`
    - Liquidity-weighted average: `w[i] = market.liquidity ?? 1` (zero or null → weight 1); clamp result to `[min(prob), max(prob)]`; set `single_source=true` when input array has length 1; set `consensus_includes_stale=true` when any market has `stale=true`; throw when input array is empty (Requirement 3.6)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ]* 6.2 Write property test for consensus bounds invariant
    - **Property 9: Consensus probability bounds invariant**
    - **Validates: Requirements 3.2**
    - Generate arbitrary non-empty `Market[]` arrays with fast-check; assert `min(prob) ≤ consensus_prob ≤ max(prob)` for every output
    - _Requirements: 3.2_
  - [ ]* 6.3 Write property test for liquidity-weighted average correctness
    - **Property 10: Liquidity-weighted average correctness**
    - **Validates: Requirements 3.1, 3.3**
    - Generate market arrays including zero-liquidity and null-liquidity cases; assert `consensus_prob === Σ(prob[i] × w[i]) / Σ(w[i])`; assert single-element arrays set `single_source=true` and return the market's own `prob`
    - _Requirements: 3.1, 3.3_
  - [ ]* 6.4 Write property test for stale propagation
    - **Property 11: Stale market sets consensus_includes_stale**
    - **Validates: Requirements 3.4**
    - Generate market arrays with at least one `stale=true` market and assert `consensus_includes_stale=true`; generate all-fresh arrays and assert `consensus_includes_stale=false`
    - _Requirements: 3.4_

- [ ] 7. Implement DivergenceTracker
  - [ ] 7.1 Implement `DivergenceTracker` in `src/lib/divergenceTracker.ts`
    - `evaluate(event, threshold)`: for each market pair compute `gap = |prob_A − prob_B|`; emit new `Divergence` if `gap > threshold` and no active record exists; update `gapCurrent` and `rankScore = gapCurrent × min(liquidity_A ?? 0, liquidity_B ?? 0)` if active record exists; close divergence (set `gapAtClosure`, `closedAt`, `durationMs`) if `gap ≤ threshold`; never emit duplicates
    - `getTopDivergences(limit, minGap)`: filter by `gapCurrent ≥ minGap`, sort by `rankScore` descending, return top `limit`
    - `getHistory(eventKey)`: return history array capped at 1,000 entries (FIFO eviction)
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ]* 7.2 Write property test for divergence emission rule
    - **Property 12: Divergence emission rule**
    - **Validates: Requirements 4.1**
    - Generate market pairs and threshold values; assert new record emitted iff `|prob_A − prob_B| > threshold` with no existing active record; assert no duplicate record is created on subsequent calls when divergence is already active
    - _Requirements: 4.1_
  - [ ]* 7.3 Write property test for divergence ranking
    - **Property 13: Divergence ranking by gap × min(liquidity)**
    - **Validates: Requirements 4.2**
    - Generate lists of active divergence records; assert returned list is sorted by `rankScore` descending
    - _Requirements: 4.2_
  - [ ]* 7.4 Write property test for history cap
    - **Property 14: Divergence history cap at 1,000 records**
    - **Validates: Requirements 4.3**
    - Insert more than 1,000 divergence records for a single event key; assert `getHistory(key).length ≤ 1000` and oldest records are discarded first
    - _Requirements: 4.3_

- [ ] 8. Checkpoint — Ensure all engine and tracker tests pass
  - Run `vitest --run`; resolve all failures. Ask the user if design questions arise.

- [ ] 9. Implement HTTP API routes
  - [ ] 9.1 Implement `GET /api/events` Edge route in `src/app/api/events/route.ts`
    - Call `VenueAdapterRegistry.getMarkets()`, run `MatchingEngine`, `FusionEngine`, `DivergenceTracker`; serialise with `ConsensusEventSchema`; return `Cache-Control: s-maxage=30, stale-while-revalidate=60`; return 503 when all venues fail
    - _Requirements: 1.1, 3.1, 3.2, 3.4, 4.1_
  - [ ] 9.2 Implement `GET /api/events/[key]` Edge route in `src/app/api/events/[key]/route.ts`
    - Look up single `ConsensusEvent` by key; return 404 JSON error when key not found (Requirement 3.6); same cache headers as 9.1
    - _Requirements: 3.6_
  - [ ] 9.3 Implement `GET /api/divergences` Edge route in `src/app/api/divergences/route.ts`
    - Accept `limit` and `min_gap` query params; validate ranges; call `DivergenceTracker.getTopDivergences`; return empty array when no results
    - _Requirements: 4.1, 4.2_
  - [ ]* 9.4 Write integration tests for API routes
    - Test warm-cache path returns valid `ConsensusEvent[]`; test stale-cache path sets `stale=true` in response; test 404 for unknown event key; test 503 when all adapters fail; use Vitest + `fetch` against a locally started Next.js server
    - _Requirements: 1.3, 3.1, 3.6_

- [ ] 10. Implement MCP server
  - [ ] 10.1 Implement `/mcp` Node.js route in `src/app/mcp/route.ts`
    - Use `@modelcontextprotocol/sdk` with `StreamableHTTPServerTransport`; register `list_events`, `get_consensus`, and `top_divergences` tools with Zod input/output schemas as defined in the design; include "Research only — not financial advice" disclaimer in each tool's `description` field
    - _Requirements: 6.1, 6.2, 6.5_
  - [ ] 10.2 Implement MCP error handling for all tools
    - Unknown `event_key` → structured `isError: true` response; `limit` or `min_gap` out of range → structured validation error; internal system error → structured system error; no results → empty array (not an error)
    - _Requirements: 6.3, 6.4, 6.5, 6.6_
  - [ ]* 10.3 Write property test for MCP schema parity
    - **Property 16: MCP tool output passes the same Zod schema as the HTTP API**
    - **Validates: Requirements 6.2**
    - Generate arbitrary `ConsensusEvent` objects; serialise through the `get_consensus` tool handler; assert output passes `ConsensusEventSchema.parse()`
    - _Requirements: 6.2_
  - [ ]* 10.4 Write integration tests for MCP transport
    - POST a JSON-RPC `list_events` call and assert valid MCP response structure; test `get_consensus` with unknown key returns `isError: true`; test `top_divergences` with out-of-range `limit` returns structured error
    - _Requirements: 6.1, 6.3, 6.4_

- [ ] 11. Checkpoint — Ensure all API and MCP tests pass
  - Run `vitest --run`; resolve all failures. Ask the user if questions arise.

- [ ] 12. Implement Ouija Dashboard — core layout and event board
  - [ ] 12.1 Create global layout in `src/app/layout.tsx`
    - Dark parchment background (`#1a1209`), "IM Fell English" serif headline font, amber accent (`#d4a017`); sticky footer with "Research only — not financial advice" disclaimer; skip-to-content link at top of page
    - _Requirements: 5.3, 5.6_
  - [ ] 12.2 Implement `OuijaBoard` RSC in `src/components/OuijaBoard.tsx`
    - Fetch `ConsensusEvent[]` from `/api/events`; render a grid of `EventCard` components; ISR revalidation every 30 s
    - _Requirements: 5.1_
  - [ ] 12.3 Implement `EventCard` Client Component in `src/components/EventCard.tsx`
    - Expandable card wrapping a `<button>` element with explicit `tabIndex`; renders `Planchette`, optional `DivergenceAlert`, and optional `StaleIndicator`; keyboard-activatable expand/collapse
    - _Requirements: 5.1, 5.2, 5.4_
  - [ ] 12.4 Implement `Planchette` Client Component in `src/components/Planchette.tsx`
    - SVG indicator whose horizontal/radial position equals `consensus_prob` (normalised `[0, 1]`); default sliding/glowing CSS animation; respects `useReducedMotion` hook (150 ms opacity fade when reduced motion is requested)
    - _Requirements: 5.1, 5.5_
  - [ ]* 12.5 Write property test for Planchette position
    - **Property 15: Planchette position is proportional to consensus probability**
    - **Validates: Requirements 5.1**
    - Generate `consensus_prob` values in `[0, 1]` with fast-check; assert the computed position coordinate equals the input probability
    - _Requirements: 5.1_

- [ ] 13. Implement Ouija Dashboard — divergence, stale, and accessibility
  - [ ] 13.1 Implement `DivergenceAlert` Client Component in `src/components/DivergenceAlert.tsx`
    - "Possession" state: violet border (`#7c3aed`) plus flickering background fill animation (two independent visual properties); `role="status"` and `aria-live="polite"`; list disagreeing venues ordered by `prob` descending with links to market pages; respects `useReducedMotion` (suppress flicker animation)
    - _Requirements: 5.2, 5.3, 5.4, 5.5_
  - [ ] 13.2 Implement `StaleIndicator` RSC in `src/components/StaleIndicator.tsx`
    - Dashed amber border plus "⚠ STALE" text label; visible property change from non-stale state; meets 4.5:1 contrast ratio
    - _Requirements: 5.7, 5.3_
  - [ ] 13.3 Implement `useReducedMotion` hook in `src/hooks/useReducedMotion.ts`
    - Reads `window.matchMedia('(prefers-reduced-motion: reduce)')`; subscribes to changes; returns `boolean`
    - _Requirements: 5.5_
  - [ ] 13.4 Implement event detail page in `src/app/events/[key]/page.tsx`
    - Fetch single `ConsensusEvent` from `/api/events/[key]`; render full market list with individual `StaleIndicator` per stale market; use `useFocusTrap` hook for modal/detail panel focus management
    - _Requirements: 5.4, 5.7_
  - [ ]* 13.5 Write accessibility tests
    - Run `axe-core` automated checks against rendered `OuijaBoard` and `EventCard` pages in Vitest + jsdom; assert no WCAG 2.1 AA violations reported by axe
    - _Requirements: 5.3, 5.4, 5.7_

- [ ] 14. Final checkpoint — Ensure all tests pass and the application builds
  - Run `vitest --run`; run `next build`; resolve all failures and type errors. Ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property-based tests use `fast-check` integrated with Vitest; each test runs ≥ 100 iterations against pure in-memory functions — no upstream API calls
- Unit tests cover example-based cases and boundary values; property tests cover universal invariants
- Two formal invariants receive dedicated PBT tasks close to their implementation: **confidence symmetry** (5.2) and **consensus bounds** (6.2)
- All thirteen additional correctness properties from the design are also covered by property sub-tasks distributed across tasks 3, 5, 6, 7, 10, and 12
- The design's `DivergenceConfig` startup validation is wired in task 1 and exercised in the integration tests in task 9
- Checkpoint tasks are not leaf tasks and are excluded from the dependency graph

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3"] },
    { "id": 2, "tasks": ["2.4", "3.1", "3.3", "3.5"] },
    { "id": 3, "tasks": ["3.2", "3.4", "3.6", "3.7", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 5, "tasks": ["5.5", "5.6", "5.7", "6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "6.4", "7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "7.4", "9.1"] },
    { "id": 8, "tasks": ["9.2", "9.3", "10.1"] },
    { "id": 9, "tasks": ["9.4", "10.2", "12.1"] },
    { "id": 10, "tasks": ["10.3", "10.4", "12.2"] },
    { "id": 11, "tasks": ["12.3", "12.4"] },
    { "id": 12, "tasks": ["12.5", "13.1", "13.2", "13.3"] },
    { "id": 13, "tasks": ["13.4"] },
    { "id": 14, "tasks": ["13.5"] }
  ]
}
```
