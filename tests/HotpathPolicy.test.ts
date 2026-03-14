import { describe, expect, it } from "vitest";

import {
  computeCapacity,
  computeFanoutLimit,
  computeNeighborMaxDegree,
  computeSalience,
  computeSubgraphBounds,
  deriveCommunityQuotas,
  deriveTierQuotas,
  DEFAULT_HOTPATH_POLICY,
} from "../core/HotpathPolicy";

// ---------------------------------------------------------------------------
// computeCapacity — H(t) = ceil(c * sqrt(t * log2(1+t)))
// ---------------------------------------------------------------------------

describe("computeCapacity", () => {
  it("grows sublinearly: H(10_000)/10_000 < H(1_000)/1_000", () => {
    const ratio10k = computeCapacity(10_000) / 10_000;
    const ratio1k = computeCapacity(1_000) / 1_000;
    expect(ratio10k).toBeLessThan(ratio1k);
  });

  it("is monotonically non-decreasing over representative range", () => {
    const points = [0, 1, 2, 10, 100, 1_000, 10_000, 100_000];
    for (let i = 1; i < points.length; i++) {
      expect(computeCapacity(points[i])).toBeGreaterThanOrEqual(
        computeCapacity(points[i - 1]),
      );
    }
  });

  it("returns a finite integer >= 1 for t = 0", () => {
    const result = computeCapacity(0);
    expect(Number.isFinite(result)).toBe(true);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it("returns a finite integer >= 1 for t = 1", () => {
    const result = computeCapacity(1);
    expect(Number.isFinite(result)).toBe(true);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it("returns a finite integer >= 1 for t = Number.MAX_SAFE_INTEGER", () => {
    const result = computeCapacity(Number.MAX_SAFE_INTEGER);
    expect(Number.isFinite(result)).toBe(true);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("never returns NaN for edge inputs", () => {
    for (const t of [0, 1, -1, NaN, Infinity, -Infinity]) {
      const r = computeCapacity(t);
      expect(Number.isNaN(r)).toBe(false);
      expect(r).not.toBe(Infinity);
      expect(r).not.toBe(-Infinity);
      expect(r).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// computeSalience — sigma = alpha*H_in + beta*R + gamma*Q
// ---------------------------------------------------------------------------

describe("computeSalience", () => {
  it("is deterministic for same inputs", () => {
    const a = computeSalience(5, 0.8, 3);
    const b = computeSalience(5, 0.8, 3);
    expect(a).toBe(b);
  });

  it("clamps to a finite number for extreme inputs", () => {
    for (const val of [Infinity, -Infinity, NaN, Number.MAX_VALUE]) {
      const r = computeSalience(val, val, val);
      expect(Number.isFinite(r)).toBe(true);
      expect(Number.isNaN(r)).toBe(false);
    }
  });

  it("accepts custom weights", () => {
    const result = computeSalience(10, 5, 2, { alpha: 1, beta: 0, gamma: 0 });
    expect(result).toBe(10);
  });

  it("uses default weights when none provided", () => {
    const { alpha, beta, gamma } = DEFAULT_HOTPATH_POLICY.salienceWeights;
    const expected = alpha * 3 + beta * 0.5 + gamma * 7;
    expect(computeSalience(3, 0.5, 7)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// deriveTierQuotas
// ---------------------------------------------------------------------------

describe("deriveTierQuotas", () => {
  it.each([1, 10, 100, 1_000])(
    "tier-quota counts sum exactly to capacity = %i",
    (cap) => {
      const q = deriveTierQuotas(cap);
      expect(q.shelf + q.volume + q.book + q.page).toBe(cap);
    },
  );

  it("all individual quotas are non-negative integers", () => {
    for (const cap of [1, 5, 17, 100]) {
      const q = deriveTierQuotas(cap);
      for (const v of [q.shelf, q.volume, q.book, q.page]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it("accepts custom quota ratios", () => {
    const q = deriveTierQuotas(100, {
      shelf: 0.25,
      volume: 0.25,
      book: 0.25,
      page: 0.25,
    });
    expect(q.shelf + q.volume + q.book + q.page).toBe(100);
    expect(q.shelf).toBe(25);
    expect(q.volume).toBe(25);
  });

  it("capacity = 0 returns all zeros", () => {
    const q = deriveTierQuotas(0);
    expect(q.shelf + q.volume + q.book + q.page).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveCommunityQuotas
// ---------------------------------------------------------------------------

describe("deriveCommunityQuotas", () => {
  it("sum of community quotas equals tier budget", () => {
    const sizes = [100, 200, 50];
    const budget = 50;
    const quotas = deriveCommunityQuotas(budget, sizes);
    expect(quotas.reduce((a, b) => a + b, 0)).toBe(budget);
  });

  it("returns empty array for empty sizes", () => {
    expect(deriveCommunityQuotas(10, [])).toEqual([]);
  });

  it("budget = 0 returns all zeros", () => {
    const quotas = deriveCommunityQuotas(0, [10, 20, 30]);
    expect(quotas).toEqual([0, 0, 0]);
  });

  it("budget < sizes.length allocates at most 1 each (no negative)", () => {
    const quotas = deriveCommunityQuotas(2, [10, 20, 30, 40, 50]);
    expect(quotas.reduce((a, b) => a + b, 0)).toBe(2);
    for (const q of quotas) {
      expect(q).toBeGreaterThanOrEqual(0);
    }
  });

  it("never produces NaN, Infinity, or negative values", () => {
    const testCases: [number, number[]][] = [
      [0, []],
      [0, [1]],
      [1, [1]],
      [5, [1, 1, 1, 1, 1]],
      [3, [0, 0, 0]],
      [10, [100]],
      [10, [50, 50]],
    ];
    for (const [budget, sizes] of testCases) {
      const quotas = deriveCommunityQuotas(budget, sizes);
      for (const q of quotas) {
        expect(Number.isFinite(q)).toBe(true);
        expect(Number.isNaN(q)).toBe(false);
        expect(q).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("single community receives entire budget", () => {
    const quotas = deriveCommunityQuotas(42, [100]);
    expect(quotas).toEqual([42]);
  });

  it("equal-size communities get equal quotas", () => {
    const quotas = deriveCommunityQuotas(9, [10, 10, 10]);
    // Each should get 3 (min 1 + proportional)
    expect(quotas).toEqual([3, 3, 3]);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_HOTPATH_POLICY
// ---------------------------------------------------------------------------

describe("DEFAULT_HOTPATH_POLICY", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(DEFAULT_HOTPATH_POLICY)).toBe(true);
  });

  it("contains expected constant values", () => {
    expect(DEFAULT_HOTPATH_POLICY.c).toBe(0.5);
    expect(DEFAULT_HOTPATH_POLICY.salienceWeights.alpha).toBe(0.5);
    expect(DEFAULT_HOTPATH_POLICY.salienceWeights.beta).toBe(0.3);
    expect(DEFAULT_HOTPATH_POLICY.salienceWeights.gamma).toBe(0.2);
    expect(DEFAULT_HOTPATH_POLICY.tierQuotaRatios.shelf).toBe(0.10);
    expect(DEFAULT_HOTPATH_POLICY.tierQuotaRatios.volume).toBe(0.20);
    expect(DEFAULT_HOTPATH_POLICY.tierQuotaRatios.book).toBe(0.20);
    expect(DEFAULT_HOTPATH_POLICY.tierQuotaRatios.page).toBe(0.50);
  });
});

// ---------------------------------------------------------------------------
// computeNeighborMaxDegree — P1-C: Williams-derived max degree for neighbor graph
// ---------------------------------------------------------------------------

describe("computeNeighborMaxDegree", () => {
  it("returns at least 1 for any corpus size", () => {
    for (const t of [0, 1, 2, 10, 100, 1_000]) {
      expect(computeNeighborMaxDegree(t)).toBeGreaterThanOrEqual(1);
    }
  });

  it("never exceeds hardCap (32 by default)", () => {
    for (const t of [10, 100, 1_000, 100_000]) {
      expect(computeNeighborMaxDegree(t)).toBeLessThanOrEqual(32);
    }
  });

  it("grows sublinearly (degree/t decreases as t increases)", () => {
    const ratio10k = computeNeighborMaxDegree(10_000) / 10_000;
    const ratio1k = computeNeighborMaxDegree(1_000) / 1_000;
    expect(ratio10k).toBeLessThanOrEqual(ratio1k);
  });

  it("respects custom hardCap", () => {
    expect(computeNeighborMaxDegree(10_000, 0.5, 5)).toBeLessThanOrEqual(5);
  });

  it("returns a finite positive integer for t = 0", () => {
    const r = computeNeighborMaxDegree(0);
    expect(Number.isFinite(r)).toBe(true);
    expect(Number.isInteger(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// computeSubgraphBounds — P1-E: Dynamic Williams-derived expansion bounds
// ---------------------------------------------------------------------------

describe("computeSubgraphBounds", () => {
  it("returns maxHops >= 1 for any corpus size", () => {
    for (const t of [0, 1, 2, 10, 100, 10_000]) {
      expect(computeSubgraphBounds(t).maxHops).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns maxSubgraphSize >= 1 for any corpus size", () => {
    for (const t of [0, 1, 2, 10, 100, 10_000]) {
      expect(computeSubgraphBounds(t).maxSubgraphSize).toBeGreaterThanOrEqual(1);
    }
  });

  it("maxSubgraphSize is bounded by 30", () => {
    for (const t of [100, 10_000, 1_000_000]) {
      expect(computeSubgraphBounds(t).maxSubgraphSize).toBeLessThanOrEqual(30);
    }
  });

  it("perHopBranching >= 1 and <= maxSubgraphSize", () => {
    const t = 1_000;
    const bounds = computeSubgraphBounds(t);
    expect(bounds.perHopBranching).toBeGreaterThanOrEqual(1);
    expect(bounds.perHopBranching).toBeLessThanOrEqual(bounds.maxSubgraphSize);
  });

  it("all fields are finite positive integers", () => {
    const bounds = computeSubgraphBounds(100);
    for (const key of ["maxSubgraphSize", "maxHops", "perHopBranching"] as const) {
      expect(Number.isFinite(bounds[key])).toBe(true);
      expect(Number.isInteger(bounds[key])).toBe(true);
      expect(bounds[key]).toBeGreaterThanOrEqual(1);
    }
  });

  it("maxHops grows logarithmically with corpus size", () => {
    const smallHops = computeSubgraphBounds(10).maxHops;
    const largeHops = computeSubgraphBounds(1_000_000).maxHops;
    expect(largeHops).toBeGreaterThanOrEqual(smallHops);
    // Logarithmic growth: even 1 billion pages should give maxHops ≤ 10
    expect(computeSubgraphBounds(1_000_000_000).maxHops).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// computeFanoutLimit — P1-A: Williams-derived hierarchy fanout limit
// ---------------------------------------------------------------------------

describe("computeFanoutLimit", () => {
  it("returns at least 1 for any node count", () => {
    for (const n of [0, 1, 2, 10, 100]) {
      expect(computeFanoutLimit(n)).toBeGreaterThanOrEqual(1);
    }
  });

  it("grows sublinearly: limit/n decreases as n increases", () => {
    const ratio100 = computeFanoutLimit(100) / 100;
    const ratio10 = computeFanoutLimit(10) / 10;
    expect(ratio100).toBeLessThan(ratio10);
  });

  it("returns a finite positive integer", () => {
    const r = computeFanoutLimit(50);
    expect(Number.isFinite(r)).toBe(true);
    expect(Number.isInteger(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(1);
  });
});
