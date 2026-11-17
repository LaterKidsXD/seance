/**
 * Shared Zod schemas and inferred TypeScript types for Séance.
 *
 * These schemas are the single source of truth for all data shapes used by
 * venue adapters, the HTTP API, and the MCP server.
 *
 * Requirements: 1.2, 2.1, 2.2, 4.5
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

/**
 * A single binary-outcome market on a venue, normalised to a common shape.
 * Requirements: 1.2, 1.7
 */
export const MarketSchema = z.object({
  id: z.string(),
  title: z.string(),
  prob: z.number().min(0).max(1),
  venue: z.enum(["polymarket", "kalshi"]),
  close_time: z.string().datetime({ offset: false }), // UTC ISO 8601, no offset suffix
  stale: z.boolean(),
  liquidity: z.number().nonnegative().optional(),
  url: z.string().url().optional(),
  spot_price: z.number().positive().optional(),
  spot_price_stale: z.boolean().optional(),
});

export type Market = z.infer<typeof MarketSchema>;

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

/**
 * A proposed or confirmed link between two Markets that resolve on the same
 * real-world Event.
 * Requirements: 2.1, 2.2
 */
export const MatchSchema = z.object({
  id: z.string().uuid(),
  marketA: z.string(), // Market.id
  marketB: z.string(), // Market.id
  confidence: z.number().min(0).max(1),
  status: z.enum(["proposed", "linked", "curated"]),
  signals: z.object({
    titleSimilarity: z.number().min(0).max(1),
    dateSimilarity: z.number().min(0).max(1),
    strikeSimilarity: z.number().min(0).max(1).optional(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Match = z.infer<typeof MatchSchema>;

// ---------------------------------------------------------------------------
// Divergence
// ---------------------------------------------------------------------------

/**
 * A condition where the absolute probability gap between two linked Markets
 * exceeds the configured divergence threshold.
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export const DivergenceSchema = z.object({
  id: z.string().uuid(),
  eventKey: z.string(),
  marketA: z.string(),
  marketB: z.string(),
  venueA: z.enum(["polymarket", "kalshi"]),
  venueB: z.enum(["polymarket", "kalshi"]),
  gapAtDetection: z.number().min(0).max(1),
  gapCurrent: z.number().min(0).max(1),
  gapAtClosure: z.number().min(0).max(1).optional(),
  detectedAt: z.string().datetime(),
  closedAt: z.string().datetime().optional(),
  durationMs: z.number().nonnegative().optional(),
  rankScore: z.number().nonnegative(), // gap × min(liquidity)
});

export type Divergence = z.infer<typeof DivergenceSchema>;

// ---------------------------------------------------------------------------
// ConsensusEvent
// ---------------------------------------------------------------------------

/**
 * A real-world event with one or more linked Markets and a fused consensus
 * probability.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export const ConsensusEventSchema = z.object({
  key: z.string(), // derived from canonical market title slug
  title: z.string(),
  markets: z.array(MarketSchema),
  consensus_prob: z.number().min(0).max(1),
  single_source: z.boolean(),
  consensus_includes_stale: z.boolean(),
  divergence: DivergenceSchema.optional(),
});

export type ConsensusEvent = z.infer<typeof ConsensusEventSchema>;

// ---------------------------------------------------------------------------
// DivergenceConfig
// ---------------------------------------------------------------------------

/**
 * Runtime configuration for the divergence threshold.
 *
 * Loaded from the DIVERGENCE_THRESHOLD environment variable.
 * Valid range: [0.01, 1.00]. Values outside this range cause a startup failure.
 * Requirements: 4.5
 */
export const DivergenceConfigSchema = z.object({
  threshold: z.number().min(0.01).max(1.0),
});

export type DivergenceConfig = z.infer<typeof DivergenceConfigSchema>;

// ---------------------------------------------------------------------------
// Venue name type (utility)
// ---------------------------------------------------------------------------

export type VenueName = Market["venue"];
