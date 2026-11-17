/**
 * Unit and property-based tests for src/lib/schemas.ts and
 * src/lib/divergenceConfig.ts
 *
 * Requirements: 1.2, 2.1, 2.2, 4.5
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fc from "fast-check";

import {
  MarketSchema,
  MatchSchema,
  DivergenceSchema,
  ConsensusEventSchema,
  DivergenceConfigSchema,
  type Market,
} from "./schemas.js";
import { loadDivergenceConfig } from "./divergenceConfig.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validMarket = (): Market => ({
  id: "mkt-001",
  title: "Will ETH exceed $5,000 by end of 2025?",
  prob: 0.42,
  venue: "polymarket",
  close_time: "2025-12-31T23:59:00Z",
  stale: false,
});

// ---------------------------------------------------------------------------
// MarketSchema
// ---------------------------------------------------------------------------

describe("MarketSchema", () => {
  it("accepts a minimal valid market", () => {
    const result = MarketSchema.safeParse(validMarket());
    expect(result.success).toBe(true);
  });

  it("accepts a market with all optional fields", () => {
    const result = MarketSchema.safeParse({
      ...validMarket(),
      liquidity: 50000,
      url: "https://polymarket.com/market/eth-5k",
      spot_price: 3200.5,
      spot_price_stale: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects prob below 0", () => {
    const result = MarketSchema.safeParse({ ...validMarket(), prob: -0.01 });
    expect(result.success).toBe(false);
  });

  it("rejects prob above 1", () => {
    const result = MarketSchema.safeParse({ ...validMarket(), prob: 1.001 });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown venue", () => {
    const result = MarketSchema.safeParse({ ...validMarket(), venue: "betfair" });
    expect(result.success).toBe(false);
  });

  it("accepts both valid venues", () => {
    expect(MarketSchema.safeParse({ ...validMarket(), venue: "polymarket" }).success).toBe(true);
    expect(MarketSchema.safeParse({ ...validMarket(), venue: "kalshi" }).success).toBe(true);
  });

  it("rejects negative liquidity", () => {
    const result = MarketSchema.safeParse({ ...validMarket(), liquidity: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid URL", () => {
    const result = MarketSchema.safeParse({ ...validMarket(), url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects negative spot_price", () => {
    const result = MarketSchema.safeParse({ ...validMarket(), spot_price: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero spot_price (must be positive)", () => {
    const result = MarketSchema.safeParse({ ...validMarket(), spot_price: 0 });
    expect(result.success).toBe(false);
  });

  it("property: prob is always in [0, 1] after parse", () => {
    fc.assert(
      fc.property(fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }), (prob) => {
        const result = MarketSchema.safeParse({ ...validMarket(), prob });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.prob).toBeGreaterThanOrEqual(0);
          expect(result.data.prob).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// MatchSchema
// ---------------------------------------------------------------------------

describe("MatchSchema", () => {
  const validMatch = () => ({
    id: "123e4567-e89b-12d3-a456-426614174000",
    marketA: "mkt-001",
    marketB: "mkt-002",
    confidence: 0.9,
    status: "linked" as const,
    signals: {
      titleSimilarity: 0.85,
      dateSimilarity: 1.0,
    },
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  });

  it("accepts a valid match", () => {
    expect(MatchSchema.safeParse(validMatch()).success).toBe(true);
  });

  it("accepts all valid status values", () => {
    for (const status of ["proposed", "linked", "curated"] as const) {
      expect(MatchSchema.safeParse({ ...validMatch(), status }).success).toBe(true);
    }
  });

  it("accepts optional strikeSimilarity", () => {
    const result = MatchSchema.safeParse({
      ...validMatch(),
      signals: { ...validMatch().signals, strikeSimilarity: 1.0 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(MatchSchema.safeParse({ ...validMatch(), confidence: -0.1 }).success).toBe(false);
    expect(MatchSchema.safeParse({ ...validMatch(), confidence: 1.1 }).success).toBe(false);
  });

  it("rejects an invalid UUID", () => {
    const result = MatchSchema.safeParse({ ...validMatch(), id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid status", () => {
    const result = MatchSchema.safeParse({ ...validMatch(), status: "unknown" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DivergenceSchema
// ---------------------------------------------------------------------------

describe("DivergenceSchema", () => {
  const validDivergence = () => ({
    id: "123e4567-e89b-12d3-a456-426614174001",
    eventKey: "eth-5k-2025",
    marketA: "mkt-001",
    marketB: "mkt-002",
    venueA: "polymarket" as const,
    venueB: "kalshi" as const,
    gapAtDetection: 0.12,
    gapCurrent: 0.09,
    detectedAt: "2025-01-01T12:00:00Z",
    rankScore: 450,
  });

  it("accepts a valid divergence", () => {
    expect(DivergenceSchema.safeParse(validDivergence()).success).toBe(true);
  });

  it("accepts optional closure fields", () => {
    const result = DivergenceSchema.safeParse({
      ...validDivergence(),
      gapAtClosure: 0.03,
      closedAt: "2025-01-02T08:00:00Z",
      durationMs: 72000000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects gapAtDetection outside [0, 1]", () => {
    expect(
      DivergenceSchema.safeParse({ ...validDivergence(), gapAtDetection: 1.5 }).success
    ).toBe(false);
  });

  it("rejects negative rankScore", () => {
    expect(
      DivergenceSchema.safeParse({ ...validDivergence(), rankScore: -1 }).success
    ).toBe(false);
  });

  it("rejects negative durationMs", () => {
    expect(
      DivergenceSchema.safeParse({ ...validDivergence(), durationMs: -100 }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConsensusEventSchema
// ---------------------------------------------------------------------------

describe("ConsensusEventSchema", () => {
  const validEvent = () => ({
    key: "eth-5k-2025",
    title: "Will ETH exceed $5,000 by end of 2025?",
    markets: [validMarket()],
    consensus_prob: 0.42,
    single_source: true,
    consensus_includes_stale: false,
  });

  it("accepts a valid consensus event", () => {
    expect(ConsensusEventSchema.safeParse(validEvent()).success).toBe(true);
  });

  it("accepts an event with optional divergence", () => {
    const result = ConsensusEventSchema.safeParse({
      ...validEvent(),
      divergence: {
        id: "123e4567-e89b-12d3-a456-426614174001",
        eventKey: "eth-5k-2025",
        marketA: "mkt-001",
        marketB: "mkt-002",
        venueA: "polymarket",
        venueB: "kalshi",
        gapAtDetection: 0.12,
        gapCurrent: 0.09,
        detectedAt: "2025-01-01T12:00:00Z",
        rankScore: 450,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects consensus_prob outside [0, 1]", () => {
    expect(
      ConsensusEventSchema.safeParse({ ...validEvent(), consensus_prob: -0.01 }).success
    ).toBe(false);
    expect(
      ConsensusEventSchema.safeParse({ ...validEvent(), consensus_prob: 1.01 }).success
    ).toBe(false);
  });

  it("rejects an event with an invalid market in the array", () => {
    const result = ConsensusEventSchema.safeParse({
      ...validEvent(),
      markets: [{ ...validMarket(), prob: 1.5 }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DivergenceConfigSchema
// ---------------------------------------------------------------------------

describe("DivergenceConfigSchema", () => {
  it("accepts the default threshold 0.05", () => {
    expect(DivergenceConfigSchema.safeParse({ threshold: 0.05 }).success).toBe(true);
  });

  it("accepts the boundary value 0.01", () => {
    expect(DivergenceConfigSchema.safeParse({ threshold: 0.01 }).success).toBe(true);
  });

  it("accepts the boundary value 1.00", () => {
    expect(DivergenceConfigSchema.safeParse({ threshold: 1.0 }).success).toBe(true);
  });

  it("rejects a threshold below 0.01", () => {
    expect(DivergenceConfigSchema.safeParse({ threshold: 0.009 }).success).toBe(false);
  });

  it("rejects a threshold above 1.00", () => {
    expect(DivergenceConfigSchema.safeParse({ threshold: 1.001 }).success).toBe(false);
  });

  it("rejects zero", () => {
    expect(DivergenceConfigSchema.safeParse({ threshold: 0 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadDivergenceConfig — startup validation
// ---------------------------------------------------------------------------

describe("loadDivergenceConfig", () => {
  afterEach(() => {
    delete process.env["DIVERGENCE_THRESHOLD"];
  });

  it("returns default 0.05 when DIVERGENCE_THRESHOLD is not set", () => {
    delete process.env["DIVERGENCE_THRESHOLD"];
    const config = loadDivergenceConfig();
    expect(config.threshold).toBe(0.05);
  });

  it("parses a valid env value", () => {
    process.env["DIVERGENCE_THRESHOLD"] = "0.1";
    const config = loadDivergenceConfig();
    expect(config.threshold).toBe(0.1);
  });

  it("throws when env value is below 0.01", () => {
    process.env["DIVERGENCE_THRESHOLD"] = "0.005";
    expect(() => loadDivergenceConfig()).toThrow();
  });

  it("throws when env value is above 1.00", () => {
    process.env["DIVERGENCE_THRESHOLD"] = "1.5";
    expect(() => loadDivergenceConfig()).toThrow();
  });

  it("throws when env value is not a number", () => {
    process.env["DIVERGENCE_THRESHOLD"] = "banana";
    expect(() => loadDivergenceConfig()).toThrow();
  });

  it("accepts the boundary values 0.01 and 1.00", () => {
    process.env["DIVERGENCE_THRESHOLD"] = "0.01";
    expect(loadDivergenceConfig().threshold).toBe(0.01);

    process.env["DIVERGENCE_THRESHOLD"] = "1.00";
    expect(loadDivergenceConfig().threshold).toBe(1.0);
  });

  it("property: any threshold in [0.01, 1.00] is accepted", () => {
    fc.assert(
      fc.property(
        // Use integer-scaled arbitraries to avoid 32-bit float edge cases.
        // Generate integers 10..100, then divide by 100 to get [0.10, 1.00].
        fc.integer({ min: 10, max: 100 }).map((n) => n / 100),
        (t) => {
          process.env["DIVERGENCE_THRESHOLD"] = String(t);
          const config = loadDivergenceConfig();
          expect(config.threshold).toBeGreaterThanOrEqual(0.01);
          expect(config.threshold).toBeLessThanOrEqual(1.0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("property: any threshold outside (0, 0.01) throws", () => {
    fc.assert(
      fc.property(
        // Generate integers 1..9, then divide by 1000 to get [0.001, 0.009].
        fc.integer({ min: 1, max: 9 }).map((n) => n / 1000),
        (t) => {
          process.env["DIVERGENCE_THRESHOLD"] = String(t);
          expect(() => loadDivergenceConfig()).toThrow();
        }
      ),
      { numRuns: 50 }
    );
  });
});
