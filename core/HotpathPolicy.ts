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

// ---------------------------------------------------------------------------
// Semantic neighbor degree limit — Williams-bound derived
// ---------------------------------------------------------------------------

// Bootstrap floor for Williams-bound log formulas: ensures t_eff ≥ 2 so that
// log₂(t_eff) > 0 and log₂(log₂(1+t_eff)) is defined and positive.
const MIN_GRAPH_MASS_FOR_LOGS = 2;

/**
 * Compute the Williams-bound-derived maximum degree for the semantic neighbor
 * graph given a corpus of `graphMass` total pages.
 *
 * The degree limit uses the same H(t) formula as the hotpath capacity but is
 * bounded by a hard cap to keep the graph sparse.  At small corpora the
 * Williams formula naturally returns small values (e.g. 1–5 for t < 10);
 * at large corpora the `hardCap` clamps growth to prevent the graph becoming
 * too dense.
 *
 * @param graphMass  Total number of pages in the corpus.
 * @param c          Williams Bound scaling constant (default from policy).
 * @param hardCap    Maximum degree regardless of formula result.  Default: 32.
 */
export function computeNeighborMaxDegree(
  graphMass: number,
  c: number = DEFAULT_HOTPATH_POLICY.c,
  hardCap = 32,
): number {
  const derived = computeCapacity(graphMass, c);
  return Math.min(hardCap, Math.max(1, derived));
}

// ---------------------------------------------------------------------------
// Dynamic subgraph expansion bounds — Williams-bound derived
// ---------------------------------------------------------------------------

export interface SubgraphBounds {
  /** Maximum number of nodes to include in the induced subgraph. */
  maxSubgraphSize: number;
  /** Maximum BFS hops from seed nodes. */
  maxHops: number;
  /** Maximum fanout per hop (branching factor). */
  perHopBranching: number;
}

/**
 * Compute dynamic Williams-derived bounds for subgraph expansion (step 9 of
 * the Cortex query path).
 *
 * Formulas from DESIGN.md "Dynamic Subgraph Expansion Bounds":
 *
 *   t_eff            = max(t, 2)
 *   maxSubgraphSize  = min(30, ⌊√(t_eff · log₂(1+t_eff)) / log₂(t_eff)⌋)
 *   maxHops          = max(1, ⌈log₂(log₂(1 + t_eff))⌉)
 *   perHopBranching  = max(1, ⌊maxSubgraphSize ^ (1/maxHops)⌋)
 *
 * The bootstrap floor `t_eff = max(t, 2)` eliminates division-by-zero for
 * t ≤ 1 and ensures a safe minimum of `maxSubgraphSize=1, maxHops=1`.
 *
 * @param graphMass  Total number of pages in the corpus.
 */
export function computeSubgraphBounds(graphMass: number): SubgraphBounds {
  const tEff = Math.max(graphMass, MIN_GRAPH_MASS_FOR_LOGS);
  const log2tEff = Math.log2(tEff);

  const maxSubgraphSize = Math.min(
    30,
    Math.floor(Math.sqrt(tEff * Math.log2(1 + tEff)) / log2tEff),
  );

  const maxHops = Math.max(1, Math.ceil(Math.log2(Math.log2(1 + tEff))));

  const perHopBranching = Math.max(
    1,
    Math.floor(Math.pow(maxSubgraphSize, 1 / maxHops)),
  );

  return {
    maxSubgraphSize: Math.max(1, maxSubgraphSize),
    maxHops,
    perHopBranching,
  };
}

// ---------------------------------------------------------------------------
// Williams-derived hierarchy fanout limit
// ---------------------------------------------------------------------------

/**
 * Compute the Williams-derived fanout limit for a hierarchy node that
 * currently has `childCount` children.
 *
 * Per DESIGN.md "Sublinear Fanout Bounds":
 *   Max children = O(√(childCount · log childCount))
 *
 * The formula is evaluated with a bootstrap floor of t_eff = max(t, 2) to
 * avoid log(0) and returns at least 1 child.
 *
 * @param childCount  Current number of children for the parent node.
 * @param c           Williams Bound scaling constant.
 */
export function computeFanoutLimit(
  childCount: number,
  c: number = DEFAULT_HOTPATH_POLICY.c,
): number {
  const tEff = Math.max(childCount, MIN_GRAPH_MASS_FOR_LOGS);
  const raw = c * Math.sqrt(tEff * Math.log2(1 + tEff));
  return Math.max(1, Math.ceil(raw));
}
