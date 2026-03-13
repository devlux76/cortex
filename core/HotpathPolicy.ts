// ---------------------------------------------------------------------------
// HotpathPolicy — Williams Bound policy foundation
// ---------------------------------------------------------------------------
//
// Central source of truth for the Williams Bound architecture.
// All hotpath constants live here as a frozen default policy object.
// Policy-derived ≠ model-derived — kept strictly separate from ModelDefaults.
// ---------------------------------------------------------------------------

import type { SalienceWeights, TierQuotaRatios, TierQuotas } from "./types";

// ---------------------------------------------------------------------------
// HotpathPolicy interface
// ---------------------------------------------------------------------------

export interface HotpathPolicy {
  /** Scaling factor in H(t) = ⌈c · √(t · log₂(1+t))⌉ */
  readonly c: number;

  /** Salience weights σ = α·H_in + β·R + γ·Q */
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
 * Compute the resident hotpath capacity H(t) = ⌈c · √(t · log₂(1+t))⌉.
 *
 * Properties guaranteed by tests:
 * - Monotonically non-decreasing
 * - Sublinear growth (H(t)/t shrinks as t grows)
 * - Returns a finite integer ≥ 1 for any non-negative finite t
 */
export function computeCapacity(
  graphMass: number,
  c: number = DEFAULT_HOTPATH_POLICY.c,
): number {
  if (!Number.isFinite(graphMass) || graphMass < 0) {
    return 1;
  }
  // Zero mass is a valid edge case (empty graph) — return minimum capacity
  if (graphMass === 0) return 1;

  const log2 = Math.log2(1 + graphMass);
  const raw = c * Math.sqrt(graphMass * log2);

  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.ceil(raw);
}

// ---------------------------------------------------------------------------
// σ(v) — Node salience
// ---------------------------------------------------------------------------

/**
 * Compute node salience σ = α·H_in + β·R + γ·Q.
 *
 * @param hebbianIn  Sum of incident Hebbian edge weights
 * @param recency    Recency score (0–1, exponential decay)
 * @param queryHits  Query-hit count for the node
 * @param weights    Tunable weights (default from policy)
 */
export function computeSalience(
  hebbianIn: number,
  recency: number,
  queryHits: number,
  weights: SalienceWeights = DEFAULT_HOTPATH_POLICY.salienceWeights,
): number {
  return weights.alpha * hebbianIn + weights.beta * recency + weights.gamma * queryHits;
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
  const idealShares = tiers.map((t) => capacity * ratios[t]);
  const floors = idealShares.map((s) => Math.floor(s));
  let remaining = capacity - floors.reduce((a, b) => a + b, 0);

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
 * Communities that receive 0 are excluded (intentional: sparse communities
 * are not promoted until they grow).
 */
export function deriveCommunityQuotas(
  tierBudget: number,
  communitySizes: number[],
): number[] {
  if (communitySizes.length === 0 || tierBudget <= 0) {
    return communitySizes.map(() => 0);
  }

  const total = communitySizes.reduce((a, b) => a + b, 0);
  if (total === 0) return communitySizes.map(() => 0);

  const idealShares = communitySizes.map((n) => (tierBudget * n) / total);
  const floors = idealShares.map((s) => Math.floor(s));
  let remaining = tierBudget - floors.reduce((a, b) => a + b, 0);

  // Largest-remainder distribution; break ties by community size (larger wins)
  const remainders = idealShares.map((s, i) => ({
    index: i,
    remainder: s - floors[i],
    size: communitySizes[i],
  }));
  remainders.sort((a, b) =>
    b.remainder - a.remainder || b.size - a.size,
  );

  for (const r of remainders) {
    if (remaining <= 0) break;
    floors[r.index]++;
    remaining--;
  }

  return floors;
}
