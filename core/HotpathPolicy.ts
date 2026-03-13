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
import type { TierQuotas } from "./types";

// ---------------------------------------------------------------------------
// Weight / ratio parameter types
// ---------------------------------------------------------------------------

export interface SalienceWeights {
  alpha: number; // Hebbian in-degree weight
  beta: number;  // recency weight
  gamma: number; // query-hit weight
}

export interface TierQuotaRatios {
  shelf: number;
  volume: number;
  book: number;
  page: number;
}

// ---------------------------------------------------------------------------
// Frozen default policy constants
// ---------------------------------------------------------------------------

export const DEFAULT_HOTPATH_POLICY = Object.freeze({
  /** Capacity scaling constant. */
  c: 0.5,
  /** Hebbian in-degree weight (α). */
  alpha: 0.5,
  /** Recency weight (β). */
  beta: 0.3,
  /** Query-hit weight (γ). */
  gamma: 0.2,
  /** Tier quota ratios. */
  q_s: 0.10,
  q_v: 0.20,
  q_b: 0.20,
  q_p: 0.50,
});

// ---------------------------------------------------------------------------
// computeCapacity  —  H(t) = ⌈c · √(t · log₂(1+t))⌉
// ---------------------------------------------------------------------------

/**
 * Williams Bound capacity function.
 *
 * Returns an integer ≥ 1 for any non-negative finite `graphMass`.
 * For `graphMass === 0` the inner product is 0, so ⌈0⌉ = 0, but we clamp to 1
 * to guarantee at least one hotpath slot is always available.
 */
export function computeCapacity(graphMass: number): number {
  const c = DEFAULT_HOTPATH_POLICY.c;
  const t = Math.max(0, graphMass);

  if (!Number.isFinite(t)) {
    // Handle Infinity / NaN — return a safe large integer
    return Number.MAX_SAFE_INTEGER;
  }

  const log2 = Math.log2(1 + t);
  const inner = t * log2;
  const raw = c * Math.sqrt(inner);

  if (!Number.isFinite(raw)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.max(1, Math.ceil(raw));
}

// ---------------------------------------------------------------------------
// computeSalience  —  σ = α·H_in + β·R + γ·Q
// ---------------------------------------------------------------------------

/**
 * Computes salience score for a hotpath candidate.
 *
 * Always returns a finite number. Inputs that produce `NaN` or `Infinity` are
 * clamped to `0`.
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
  weights?: SalienceWeights,
): number {
  const α = weights?.alpha ?? DEFAULT_HOTPATH_POLICY.alpha;
  const β = weights?.beta ?? DEFAULT_HOTPATH_POLICY.beta;
  const γ = weights?.gamma ?? DEFAULT_HOTPATH_POLICY.gamma;

  const raw = α * hebbianIn + β * recency + γ * queryHits;

  if (!Number.isFinite(raw)) return 0;
  return raw;
}

// ---------------------------------------------------------------------------
// deriveTierQuotas  —  allocate H(t) across tiers
// ---------------------------------------------------------------------------

/**
 * Distributes `capacity` slots across four tiers according to `quotaRatios`.
 *
 * The distribution uses a largest-remainder method so the integer counts
 * always sum **exactly** to `capacity`.
 */
export function deriveTierQuotas(
  capacity: number,
  quotaRatios?: TierQuotaRatios,
): TierQuotas {
  const ratios = quotaRatios ?? {
    shelf: DEFAULT_HOTPATH_POLICY.q_s,
    volume: DEFAULT_HOTPATH_POLICY.q_v,
    book: DEFAULT_HOTPATH_POLICY.q_b,
    page: DEFAULT_HOTPATH_POLICY.q_p,
  };

  const cap = Math.max(0, Math.floor(capacity));
  const keys: (keyof TierQuotas)[] = ["shelf", "volume", "book", "page"];

  // Normalise ratios so they sum to 1
  const rawTotal = keys.reduce((sum, k) => sum + ratios[k], 0);
  const normalised = keys.map((k) => (rawTotal > 0 ? ratios[k] / rawTotal : 0.25));

  // Compute proportional (floating) values, then floor
  const proportional = normalised.map((r) => r * cap);
  const floors = proportional.map(Math.floor);
  let floorSum = floors.reduce((a, b) => a + b, 0);

  // Distribute remainders via largest-remainder method
  const remainders = proportional.map((p, i) => ({ idx: i, rem: p - floors[i] }));
  remainders.sort((a, b) => b.rem - a.rem);

  let i = 0;
  while (floorSum < cap) {
    floors[remainders[i].idx] += 1;
    floorSum += 1;
    i += 1;
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
// deriveCommunityQuotas  —  proportional with min(1) guarantee
// ---------------------------------------------------------------------------

/**
 * Distributes `tierBudget` slots proportionally among communities given their
 * sizes, with a minimum of 1 slot per community (when budget allows).
 *
 * Returns an empty array when `communitySizes` is empty.
 *
 * If `tierBudget` is 0, every community receives 0.
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
  const n = communitySizes.length;
  if (n === 0) return [];

  const budget = Math.max(0, Math.floor(tierBudget));
  if (budget === 0) return new Array(n).fill(0) as number[];

  const totalSize = communitySizes.reduce((a, b) => a + Math.max(0, b), 0);

  // Phase 1: assign minimum 1 to each community if budget allows
  const minPerCommunity = budget >= n ? 1 : 0;
  const quotas = new Array<number>(n).fill(minPerCommunity);
  const remaining = budget - minPerCommunity * n;

  if (remaining === 0 || totalSize === 0) return quotas;

  // Phase 2: distribute remaining proportionally (largest-remainder)
  const proportional = communitySizes.map(
    (s) => (Math.max(0, s) / totalSize) * remaining,
  );
  const floors = proportional.map(Math.floor);
  let floorSum = floors.reduce((a, b) => a + b, 0);

  const remainders = proportional.map((p, i) => ({ idx: i, rem: p - floors[i] }));
  remainders.sort((a, b) => b.rem - a.rem);

  let j = 0;
  while (floorSum < remaining) {
    floors[remainders[j].idx] += 1;
    floorSum += 1;
    j += 1;
  }

  for (let i = 0; i < n; i++) quotas[i] += floors[i];
  return quotas;
}
