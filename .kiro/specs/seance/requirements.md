# Requirements Document

## Introduction

Séance aggregates binary-outcome prediction markets for the same real-world event across Polymarket, Kalshi, and crypto spot/DEX prices. It fuses per-venue probabilities into a single liquidity-weighted consensus probability and surfaces cross-venue divergences ("hauntings") through two interfaces: a themed web UI (the Ouija Dashboard) and a Model Context Protocol (MCP) server for AI agent integration.

The system is read-only with respect to external venues — it never places orders. All data is sourced from public APIs. The runtime cost target is $0 (serverless/edge-compatible) and the p95 API latency target is under 800 ms when warm.

---

## Glossary

- **System**: The Séance application, encompassing the backend API, fusion engine, and Ouija Dashboard.
- **Venue**: A prediction market platform or price oracle. Supported venues are Polymarket, Kalshi, and DexScreener (crypto spot/DEX prices).
- **Market**: A single binary-outcome market on a Venue, normalized into a common schema containing at minimum: `id`, `title`, `prob` (∈ [0, 1]), `venue`, `close_time` (UTC ISO 8601), and `stale` (boolean). Optional fields include `liquidity`, `spot_price`, and `spot_price_stale`.
- **Event**: A real-world outcome that may be priced by one or more Markets across different Venues.
- **Match**: A proposed or confirmed link between two or more Markets that resolve on the same Event.
- **Confidence Score**: A value ∈ [0, 1] expressing the system's certainty that two Markets represent the same Event.
- **Curated Match**: A Match manually confirmed by an operator and stored in a persistent match list.
- **Consensus Probability**: A single probability value ∈ [0, 1] derived from fusing the probabilities of all Markets linked to an Event.
- **Divergence**: A condition where the absolute probability gap between any two linked Markets exceeds a configured threshold.
- **Planchette**: The visual indicator on the Ouija Dashboard whose position encodes the Consensus Probability for an Event.
- **MCP Server**: A Model Context Protocol server exposing Séance data as callable tools for AI agents.
- **Stale**: A flag indicating that a cached Market snapshot could not be refreshed within the cache TTL window.
- **DexScreener**: A public DEX and crypto spot price aggregator used as the price oracle for crypto threshold markets.

---

## Requirements

### Requirement 1: Venue Adapters

**User Story:** As a researcher, I want live prices from each Venue normalized to a common schema, so that I can compare Markets across platforms without manual data wrangling.

#### Acceptance Criteria

1. WHEN the API receives a request for Markets, THE System SHALL fetch market data from the Polymarket public API and the Kalshi public API.

2. WHEN market data is fetched from a Venue, THE System SHALL return normalized `Market` objects each containing at minimum the fields `id`, `title`, `prob` (a decimal value in the range [0, 1]), `venue`, `close_time` (UTC ISO 8601), and `stale` (boolean).

3. IF a Venue request fails or returns an HTTP 429 rate-limit response, THEN THE System SHALL serve the most recent cached snapshot for that Venue, provided that snapshot is no older than 5 minutes, with `stale=true`, and SHALL complete the response using data from other Venues that responded successfully.

4. THE System SHALL cache each Venue's response for a minimum of 30 seconds and a maximum of 60 seconds before issuing a new network request to that Venue.

5. IF a Market's title or metadata indicates it resolves based on whether an on-chain asset's price crosses a numeric threshold, THEN THE System SHALL fetch the current spot price for the underlying asset from DexScreener and include it in the normalized `Market` object.

6. IF the DexScreener request for a crypto price-threshold Market fails, THEN THE System SHALL return the `Market` object without the spot price field and SHALL set `spot_price_stale=true`.

7. THE System SHALL normalize all Venue timestamps to UTC ISO 8601 format before storing or returning `Market` objects.

---

### Requirement 2: Cross-Venue Matching

**User Story:** As a trader, I want equivalent Markets linked across Venues automatically, so that I can view all pricing for one Event in a single place.

#### Acceptance Criteria

1. WHEN a Market is created or its metadata is ingested from a Venue feed, THE System SHALL propose Matches against existing Markets using a combined Confidence Score derived from: title text similarity (weight 0.5), resolution date proximity within ±1 calendar day (weight 0.3), and strike or threshold value equality (weight 0.2) when both Markets carry a numeric strike or threshold value, or omitting that signal and redistributing its weight proportionally when either Market lacks a numeric strike or threshold value.

2. THE System SHALL assign each proposed Match a Confidence Score in the range [0, 1], computed as the weighted sum of available signals as defined in Criterion 1.

3. IF a proposed Match has a Confidence Score ≥ 0.85, THEN THE System SHALL promote that Match to a linked state, creating an observable Match record with a status of "linked" associating the two Markets.

4. THE System SHALL compute Confidence Scores symmetrically: the Confidence Score for Match(A, B) SHALL equal the Confidence Score for Match(B, A). *(property test: symmetry)*

5. WHERE a Curated Match list exists, THE System SHALL prefer Curated Matches over automatically proposed or linked Matches for the same pair of Markets.

6. WHEN a Market is updated with a new title or resolution date, THE System SHALL re-evaluate all proposed and linked Matches involving that Market; IF a Match's recomputed Confidence Score falls below 0.85, THEN THE System SHALL demote its status from "linked" to "proposed", and IF a Match's recomputed Confidence Score falls below 0.5, THEN THE System SHALL remove that Match proposal entirely.

7. WHEN a request is made for all Matches associated with a given Market, THE System SHALL return all proposed and linked Match records for that Market ordered by Confidence Score descending, or an empty list when no Matches exist.

---

### Requirement 3: Consensus Fusion

**User Story:** As a researcher, I want a single fused probability for each linked Event, so that I can read the market's overall consensus without manually averaging across platforms.

#### Acceptance Criteria

1. THE System SHALL compute a Consensus Probability for each Event by calculating a liquidity-weighted average of the `prob` values of all Markets linked to that Event, treating any Market whose `liquidity` value is null, zero, or absent as having a weight of 1 in the weighted average.

2. WHEN the Consensus Probability for an Event is computed, THE System SHALL verify that the result lies within the closed interval [min(prob), max(prob)] of the input Market probabilities for that Event, and IF the result falls outside that interval, THEN THE System SHALL clamp the Consensus Probability to the nearest bound of that interval. *(property test: bounds invariant)*

3. WHEN only one Market is linked to an Event, THE System SHALL return that Market's `prob` as the Consensus Probability and SHALL set `single_source=true` on the Event response.

4. WHEN a Market linked to an Event has `stale=true`, THE System SHALL include that Market in the Consensus Probability calculation and SHALL set `consensus_includes_stale=true` on the Event response.

5. WHEN any linked Market's `prob` or `liquidity` value is updated, THE System SHALL recompute the Consensus Probability for the corresponding Event.

6. IF no Markets are linked to an Event, THEN THE System SHALL return an error response indicating that a Consensus Probability cannot be computed for that Event.

---

### Requirement 4: Divergence Detection

**User Story:** As a trader, I want alerts when Venues disagree significantly on the probability of the same Event, so that I can investigate potential mispricings before they close.

#### Acceptance Criteria

1. WHEN the absolute difference between the `prob` values of any two Markets linked to the same Event exceeds the configured divergence threshold (default: 0.05, i.e. 5 percentage points), THE System SHALL emit a Divergence event containing the identifiers of the two Markets, their respective Venues, the gap value, and the UTC timestamp of detection.

2. WHEN a Divergence event is emitted or an active Divergence is updated, THE System SHALL rank all Divergences whose closure timestamp is not yet set by the product of the gap value and the minimum `liquidity` among the two Markets in descending order; IF the `liquidity` value of either Market is zero or unavailable, THEN THE System SHALL treat that Market's `liquidity` as zero when computing the ranking score.

3. WHEN a Divergence event is emitted or a Divergence is closed, THE System SHALL record the gap at detection time, the gap at closure time (if closed), and the elapsed duration between detection and closure (if closed) for that Event, retaining at most the 1,000 most recent Divergence records per Event and discarding the oldest when the limit is exceeded.

4. WHEN the absolute difference between two previously diverging Markets falls below the configured divergence threshold, THE System SHALL mark the Divergence as closed and record the closure timestamp and final gap.

5. THE System SHALL allow the divergence threshold to be configured per deployment without requiring a code change, and SHALL reject any configured value outside the range 0.01 to 1.00 inclusive with an error indicating the value is out of range.

---

### Requirement 5: Ouija Dashboard

**User Story:** As a visitor, I want a visually distinctive but accessible interface, so that the data is memorable and easy to interpret at a glance.

#### Acceptance Criteria

1. THE System SHALL render each linked Event as a board element where the Planchette's horizontal or radial position encodes the Consensus Probability on a 0-to-1 scale.

2. WHEN a Divergence is active for an Event, THE System SHALL apply a "possession" visual state to that Event's board element — distinguishable from the default state by at least two independent visual properties (such as border style and background fill) — and SHALL list the disagreeing Venues in descending order of their individual `prob` values with links to the respective Market pages.

3. THE System SHALL meet WCAG 2.1 Level AA contrast requirements for all text and meaningful graphical elements.

4. THE System SHALL support full keyboard navigation such that all interactive elements satisfy WCAG 2.1 Success Criteria 2.1.1 (all functionality operable via keyboard) and 2.4.3 (focus order is logical and sequential) without requiring a pointer device.

5. WHERE the user's device or browser signals `prefers-reduced-motion`, THE System SHALL suppress all animated transitions on the Dashboard or replace them with a fade transition of no more than 200 ms duration.

6. THE System SHALL display a persistent "Research only — not financial advice" disclaimer visible on every page of the Dashboard.

7. WHEN a Market's data is `stale=true`, THE System SHALL display a visually distinct stale indicator — differing from the non-stale state by at least one visible property (such as a label or icon) — on that Market's data within the Event board, meeting the WCAG 2.1 Level AA contrast requirements defined in criterion 3.

---

### Requirement 6: MCP Server

**User Story:** As an AI agent, I want structured tool access to Séance data, so that I can programmatically query divergences and consensus probabilities within my reasoning workflow.

#### Acceptance Criteria

1. THE System SHALL expose an MCP-compliant server providing the following tools:
   - `list_events` — returns a list of all known Events with their Consensus Probabilities and `single_source` flags.
   - `get_consensus(event_key)` — returns the full normalized Event object for the specified `event_key`, including all linked Markets and the Consensus Probability.
   - `top_divergences(limit, min_gap)` — returns the top `limit` active Divergences with a gap ≥ `min_gap`, ordered by gap × min(liquidity) descending, where `limit` is an integer in the range [1, 100] and `min_gap` is a decimal in the range [0.00, 1.00].

2. THE System SHALL return all MCP tool outputs using the same normalized `Market` and `Event` schemas used by the HTTP API.

3. WHEN an MCP tool is called with an invalid or unknown `event_key`, THE System SHALL return a structured error response indicating the key was not found, without throwing an unhandled exception.

4. WHEN an MCP tool is called with out-of-range parameters (`limit` < 1 or `limit` > 100, or `min_gap` outside [0.00, 1.00]), THE System SHALL return a structured validation error response identifying which parameter failed and its valid range, without throwing an unhandled exception.

5. WHEN an MCP tool call fails due to an internal system error unrelated to input validity (such as a data store being unavailable), THE System SHALL return a structured error response indicating a system-level failure, without throwing an unhandled exception.

6. WHEN `list_events` or `top_divergences` is called and no matching records exist, THE System SHALL return an empty list in the tool output rather than an error response.

---

## Non-Functional Requirements

### Performance

1. THE System SHALL respond to API requests with a p95 latency of less than 800 milliseconds when the cache is warm.

### Cost

2. THE System SHALL be deployable at zero ongoing infrastructure cost using serverless or edge-compatible runtimes.

### Security

3. THE System SHALL not store or reference any API secrets, private keys, or credentials in the source code repository.

### Licensing

4. THE System SHALL be released under the MIT License.

### Compliance

5. THE System SHALL include a "Research only — not financial advice" disclaimer in both the Dashboard and in the description field of each MCP tool.
