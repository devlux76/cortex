// ---------------------------------------------------------------------------
// HebbianUpdater — Edge plasticity via LTP / LTD / pruning (P2-B)
// ---------------------------------------------------------------------------
//
// Strengthens edges traversed during successful queries (Long-Term
// Potentiation), decays all edges each pass (Long-Term Depression), and
// prunes edges that fall below a threshold to keep the graph sparse.
//
// After LTP/LTD, salience is recomputed for every node whose incident edges
// changed, and a promotion/eviction sweep is run so the hotpath stays current.
// ---------------------------------------------------------------------------

import type { Edge, Hash, MetadataStore } from "../core/types";
import { DEFAULT_HOTPATH_POLICY, type HotpathPolicy } from "../core/HotpathPolicy";
import { batchComputeSalience, runPromotionSweep } from "../core/SalienceEngine";

// ---------------------------------------------------------------------------
// Constants (policy-derived defaults; never hardcoded in callers)
// ---------------------------------------------------------------------------

/** Default LTP step: edge weight increases by this amount on traversal. */
export const DEFAULT_LTP_AMOUNT = 0.1;

/** Default LTD multiplicative decay factor applied every pass (0 < decay < 1). */
export const DEFAULT_LTD_DECAY = 0.99;

/** Edges with weight below this threshold are removed by pruning. */
export const DEFAULT_PRUNE_THRESHOLD = 0.01;

/** Maximum outgoing Hebbian edges per node (degree cap). */
export const DEFAULT_MAX_DEGREE = 16;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HebbianUpdaterOptions {
  metadataStore: MetadataStore;
  policy?: HotpathPolicy;
  /** LTP step amount. Default: DEFAULT_LTP_AMOUNT. */
  ltpAmount?: number;
  /** LTD multiplicative decay applied to every edge. Default: DEFAULT_LTD_DECAY. */
  ltdDecay?: number;
  /** Prune edges whose weight drops below this value. Default: DEFAULT_PRUNE_THRESHOLD. */
  pruneThreshold?: number;
  /** Maximum outgoing degree per node. Default: DEFAULT_MAX_DEGREE. */
  maxDegree?: number;
  /** Current timestamp (ms since epoch). Defaults to Date.now(). */
  now?: number;
}

/**
 * LTP — strengthen edges that were traversed during a successful query.
 *
 * Clamps weights to [0, Infinity) and re-saves affected edges.
 * Recomputes salience for changed nodes and triggers a promotion sweep.
 */
export async function strengthenEdges(
  traversedPairs: Array<{ from: Hash; to: Hash }>,
  options: HebbianUpdaterOptions,
): Promise<void> {
  if (traversedPairs.length === 0) return;

  const {
    metadataStore,
    policy = DEFAULT_HOTPATH_POLICY,
    ltpAmount = DEFAULT_LTP_AMOUNT,
    now = Date.now(),
  } = options;

  // Group by source node for efficient per-node updates
  const bySource = new Map<Hash, Set<Hash>>();
  for (const { from, to } of traversedPairs) {
    let targets = bySource.get(from);
    if (!targets) {
      targets = new Set();
      bySource.set(from, targets);
    }
    targets.add(to);
  }

  const changedNodeIds = new Set<Hash>();

  for (const [fromId, toIds] of bySource) {
    const existing = await metadataStore.getNeighbors(fromId);
    const edgeMap = new Map<Hash, Edge>(existing.map((e) => [e.toPageId, e]));

    const timestamp = new Date(now).toISOString();
    const updatedEdges: Edge[] = [];

    for (const toId of toIds) {
      const edge = edgeMap.get(toId);
      if (edge) {
        updatedEdges.push({
          ...edge,
          weight: edge.weight + ltpAmount,
          lastUpdatedAt: timestamp,
        });
      } else {
        // Create new edge if not yet present
        updatedEdges.push({
          fromPageId: fromId,
          toPageId: toId,
          weight: ltpAmount,
          lastUpdatedAt: timestamp,
        });
      }
      changedNodeIds.add(fromId);
      changedNodeIds.add(toId);
    }

    if (updatedEdges.length > 0) {
      await metadataStore.putEdges(updatedEdges);
    }
  }

  if (changedNodeIds.size > 0) {
    await batchComputeSalience([...changedNodeIds], metadataStore, policy, now);
    await runPromotionSweep([...changedNodeIds], metadataStore, policy, now);
  }
}

/**
 * LTD + pruning — decay all edges by a multiplicative factor, then remove
 * edges whose weight falls below the prune threshold or that exceed the max
 * degree per source node.
 *
 * Recomputes salience for every node whose incident edges changed.
 */
export async function decayAndPrune(
  options: HebbianUpdaterOptions,
): Promise<{ decayed: number; pruned: number }> {
  const {
    metadataStore,
    policy = DEFAULT_HOTPATH_POLICY,
    ltdDecay = DEFAULT_LTD_DECAY,
    pruneThreshold = DEFAULT_PRUNE_THRESHOLD,
    maxDegree = DEFAULT_MAX_DEGREE,
    now = Date.now(),
  } = options;

  const allPages = await metadataStore.getAllPages();
  if (allPages.length === 0) return { decayed: 0, pruned: 0 };

  const changedNodeIds = new Set<Hash>();
  let totalDecayed = 0;
  let totalPruned = 0;

  const timestamp = new Date(now).toISOString();

  for (const page of allPages) {
    const edges = await metadataStore.getNeighbors(page.pageId);
    if (edges.length === 0) continue;

    // Apply LTD decay
    const decayed: Edge[] = edges.map((e) => ({
      ...e,
      weight: e.weight * ltdDecay,
      lastUpdatedAt: timestamp,
    }));
    totalDecayed += decayed.length;

    // Separate edges to keep vs. prune
    const surviving = decayed.filter((e) => e.weight >= pruneThreshold);
    const pruned = decayed.filter((e) => e.weight < pruneThreshold);

    // Enforce max degree: keep the strongest surviving edges
    surviving.sort((a, b) => b.weight - a.weight);
    const kept = surviving.slice(0, maxDegree);
    const degreeEvicted = surviving.slice(maxDegree);

    // Delete pruned edges
    for (const e of [...pruned, ...degreeEvicted]) {
      await metadataStore.deleteEdge(e.fromPageId, e.toPageId);
      totalPruned++;
      changedNodeIds.add(e.fromPageId);
      changedNodeIds.add(e.toPageId);
    }

    // Save decayed-but-surviving edges
    if (kept.length > 0) {
      await metadataStore.putEdges(kept);
      changedNodeIds.add(page.pageId);
    }
  }

  if (changedNodeIds.size > 0) {
    await batchComputeSalience([...changedNodeIds], metadataStore, policy, now);
    await runPromotionSweep([...changedNodeIds], metadataStore, policy, now);
  }

  return { decayed: totalDecayed, pruned: totalPruned };
}
