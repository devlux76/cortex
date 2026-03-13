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
  const n = communitySizes.length;
  if (n === 0) return [];

  const budget = Math.max(0, Math.floor(tierBudget));
  if (budget === 0) return new Array(n).fill(0) as number[];

  const totalSize = communitySizes.reduce((a, b) => a + Math.max(0, b), 0);

  // Phase 1: assign minimum 1 to each community if budget allows
  const minPerCommunity = budget >= n ? 1 : 0;
  const quotas = new Array<number>(n).fill(minPerCommunity);
  const remaining = budget - minPerCommunity * n;

  if (remaining < 0) {
    // Budget < n communities — give 1 to the first `budget` communities
    const result = new Array<number>(n).fill(0);
    for (let i = 0; i < budget; i++) result[i] = 1;
    return result;
  }

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
