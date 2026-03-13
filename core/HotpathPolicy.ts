// ---------------------------------------------------------------------------
// HotpathPolicy — Williams Bound policy foundation
// ---------------------------------------------------------------------------
//
// Central source of truth for the Williams Bound architecture.
// All hotpath constants live here as a frozen default policy object.
// Policy-derived != model-derived — kept strictly separate from ModelDefaults.
// ---------------------------------------------------------------------------

import type { SalienceWeights, TierQuotaRatios, TierQuotas } from "./types";

// ---------------------------------------------------------------------------
// HotpathPolicy interface
// ---------------------------------------------------------------------------

export interface HotpathPolicy {
  /** Scaling factor in H(t) = ceil(c * sqrt(t * log2(1+t))) */
  readonly c: number;

  /** Salience weights: sigma = alpha*H_in + beta*R + gamma*Q */
  readonly salienceWeights: SalienceWeights;

  /** Fractional tier quota ratios (must sum to 1.0) */
  readonly tierQuotaRatios: TierQuotaRatios;
}

// ---------------------------------------------------------------------------
// Frozen default policy object
// ---------------------------------------------------------------------------

export const DEFAULT_HOTPATH_POLICY: HotpathPolicy = Object.freeze({
  c: 0.5,
  salienceWeights: Object.freeze({
    alpha: 0.5, // Hebbian connectivity
    beta: 0.3,  // recency
    gamma: 0.2, // query-hit frequency
  }),
  tierQuotaRatios: Object.freeze({
    shelf: 0.10,
    volume: 0.20,
    book: 0.20,
    page: 0.50,
  }),
});

// ---------------------------------------------------------------------------
// H(t) — Resident hotpath capacity
// ---------------------------------------------------------------------------

/**
 * Compute the resident hotpath capacity H(t) = ceil(c * sqrt(t * log2(1+t))).
 *
 * Properties guaranteed by tests:
 * - Monotonically non-decreasing
 * - Sublinear growth (H(t)/t shrinks as t grows)
 * - Returns a finite integer >= 1 for any non-negative finite t
 */
export function computeCapacity(
  graphMass: number,
  c: number = DEFAULT_HOTPATH_POLICY.c,
): number {
  if (!Number.isFinite(graphMass) || graphMass < 0) {
    return 1;
  }
  if (graphMass === 0) return 1;

  const log2 = Math.log2(1 + graphMass);
  const raw = c * Math.sqrt(graphMass * log2);

  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.ceil(raw);
}

// ---------------------------------------------------------------------------
// Node salience — sigma = alpha*H_in + beta*R + gamma*Q
// ---------------------------------------------------------------------------

/**
 * Compute node salience: sigma = alpha*H_in + beta*R + gamma*Q.
 *
 * @param hebbianIn  Sum of incident Hebbian edge weights
 * @param recency    Recency score (0-1, exponential decay)
 * @param queryHits  Query-hit count for the node
 * @param weights    Tunable weights (default from policy)
 */
export function computeSalience(
  hebbianIn: number,
  recency: number,
  queryHits: number,
  weights: SalienceWeights = DEFAULT_HOTPATH_POLICY.salienceWeights,
): number {
  const raw = weights.alpha * hebbianIn
            + weights.beta * recency
            + weights.gamma * queryHits;

  if (!Number.isFinite(raw)) return 0;
  return raw;
}

// ---------------------------------------------------------------------------
// Tier quota derivation
// ---------------------------------------------------------------------------

/**
 * Allocate H(t) across shelf/volume/book/page tiers.
 *
 * Uses largest-remainder method so quotas sum exactly to `capacity`.
 */
export function deriveTierQuotas(
  capacity: number,
  ratios: TierQuotaRatios = DEFAULT_HOTPATH_POLICY.tierQuotaRatios,
): TierQuotas {
  const tiers: (keyof TierQuotas)[] = ["shelf", "volume", "book", "page"];

  // Normalize ratios so they sum to 1
  const rawTotal = tiers.reduce((sum, t) => sum + ratios[t], 0);
  const normalized = tiers.map((t) => (rawTotal > 0 ? ratios[t] / rawTotal : 0.25));

  const cap = Math.max(0, Math.floor(capacity));
  const idealShares = normalized.map((r) => r * cap);
  const floors = idealShares.map((s) => Math.floor(s));
  let remaining = cap - floors.reduce((a, b) => a + b, 0);

  // Distribute remainders by largest fractional part
  const remainders = idealShares.map((s, i) => ({
    index: i,
    remainder: s - floors[i],
  }));
  remainders.sort((a, b) => b.remainder - a.remainder);

  for (const r of remainders) {
    if (remaining <= 0) break;
    floors[r.index]++;
    remaining--;
  }

  return {
    shelf: floors[0],
    volume: floors[1],
    book: floors[2],
    page: floors[3],
  };
}

// ---------------------------------------------------------------------------
// Community quota derivation
// ---------------------------------------------------------------------------

/**
 * Distribute a tier budget proportionally across communities.
 *
 * Uses largest-remainder method so quotas sum exactly to `tierBudget`.
 * Each community receives a minimum of 1 slot when budget allows.
 *
 * Returns an empty array when `communitySizes` is empty.
 * If `tierBudget` is 0, every community receives 0.
 */
export function deriveCommunityQuotas(
  tierBudget: number,
  communitySizes: number[],
): number[] {
  const n = communitySizes.length;
  if (n === 0) return [];

  const budget = Math.max(0, Math.floor(tierBudget));
  if (budget === 0) return new Array(n).fill(0) as number[];

  const totalSize = communitySizes.reduce((a, b) => a + Math.max(0, b), 0);

  // Phase 1: assign minimum 1 to each community if budget allows
  const minPerCommunity = budget >= n ? 1 : 0;
  const quotas = new Array<number>(n).fill(minPerCommunity);
  const remainingBudget = budget - minPerCommunity * n;

  if (remainingBudget === 0 || totalSize === 0) return quotas;

  // Phase 2: distribute remaining proportionally (largest-remainder)
  const proportional = communitySizes.map(
    (s) => (Math.max(0, s) / totalSize) * remainingBudget,
  );
  const floors = proportional.map(Math.floor);
  let floorSum = floors.reduce((a, b) => a + b, 0);

  const remainders = proportional.map((p, i) => ({ idx: i, rem: p - floors[i] }));
  remainders.sort((a, b) => b.rem - a.rem);

  let j = 0;
  while (floorSum < remainingBudget) {
    floors[remainders[j].idx] += 1;
    floorSum += 1;
    j += 1;
  }

  for (let i = 0; i < n; i++) quotas[i] += floors[i];
  return quotas;
}
