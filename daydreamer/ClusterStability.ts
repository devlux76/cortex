// ---------------------------------------------------------------------------
// ClusterStability — Community detection via label propagation (P2-F)
// ---------------------------------------------------------------------------
//
// Assigns community labels to pages by running lightweight label propagation
// on the semantic (Metroid) neighbor graph. Labels are stored in
// PageActivity.communityId and propagate into SalienceEngine community quotas.
//
// Label propagation terminates when assignments stabilise (no label changes)
// or a maximum iteration limit is reached.
// ---------------------------------------------------------------------------

import type { Hash, MetadataStore, PageActivity } from "../core/types";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ClusterStabilityOptions {
  metadataStore: MetadataStore;
  /** Maximum number of label propagation iterations. Default: 20. */
  maxIterations?: number;
  /** Seed for deterministic tie-breaking. Default: undefined (uses min-label). */
  seed?: string;
}

export interface LabelPropagationResult {
  /** Number of iterations until convergence (or maxIterations). */
  iterations: number;
  /** True if the algorithm converged before hitting maxIterations. */
  converged: boolean;
  /** Map from pageId to assigned communityId. */
  communityMap: Map<Hash, string>;
}

// ---------------------------------------------------------------------------
// Label propagation
// ---------------------------------------------------------------------------

/**
 * Run one pass of label propagation over all pages.
 *
 * Each node adopts the most frequent label among its Metroid neighbors.
 * Ties are broken deterministically by choosing the lexicographically
 * smallest label (consistent across runs and nodes).
 *
 * Returns true if any label changed during this pass.
 */
async function propagationPass(
  pageIds: Hash[],
  labels: Map<Hash, string>,
  metadataStore: MetadataStore,
): Promise<boolean> {
  let changed = false;

  // Shuffle-equivalent deterministic ordering: sort by pageId for reproducibility
  const sorted = [...pageIds].sort();

  for (const pageId of sorted) {
    const neighbors = await metadataStore.getMetroidNeighbors(pageId);
    if (neighbors.length === 0) continue;

    // Count neighbor labels
    const counts = new Map<string, number>();
    for (const n of neighbors) {
      const label = labels.get(n.neighborPageId) ?? n.neighborPageId;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    // Find the most frequent label (tie-break: lexicographically smallest)
    let bestLabel: string | undefined;
    let bestCount = 0;
    for (const [label, count] of counts) {
      if (
        count > bestCount ||
        (count === bestCount && bestLabel !== undefined && label < bestLabel)
      ) {
        bestLabel = label;
        bestCount = count;
      }
    }

    if (bestLabel !== undefined && labels.get(pageId) !== bestLabel) {
      labels.set(pageId, bestLabel);
      changed = true;
    }
  }

  return changed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assign community labels to all pages via label propagation on the
 * Metroid (semantic) neighbor graph.
 *
 * Initial labels: each page is its own community (pageId as initial label).
 * Each iteration: every node adopts the most frequent label among neighbors.
 * Convergence: no label changed in the most recent pass.
 *
 * After convergence, persists all community labels via
 * `MetadataStore.putPageActivity`.
 */
export async function runLabelPropagation(
  options: ClusterStabilityOptions,
): Promise<LabelPropagationResult> {
  const {
    metadataStore,
    maxIterations = 20,
  } = options;

  const allPages = await metadataStore.getAllPages();
  if (allPages.length === 0) {
    return { iterations: 0, converged: true, communityMap: new Map() };
  }

  const pageIds = allPages.map((p) => p.pageId);

  // Initialise: each page is its own community
  const labels = new Map<Hash, string>();
  for (const id of pageIds) {
    labels.set(id, id);
  }

  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations++;
    const changed = await propagationPass(pageIds, labels, metadataStore);
    if (!changed) {
      converged = true;
      break;
    }
  }

  // Persist community labels to PageActivity
  for (const pageId of pageIds) {
    const communityId = labels.get(pageId) ?? pageId;
    const existing = await metadataStore.getPageActivity(pageId);
    const activity: PageActivity = {
      pageId,
      queryHitCount: existing?.queryHitCount ?? 0,
      lastQueryAt: existing?.lastQueryAt ?? new Date(0).toISOString(),
      communityId,
    };
    await metadataStore.putPageActivity(activity);
  }

  return { iterations, converged, communityMap: new Map(labels) };
}

/**
 * Detect whether a community should be split (too large relative to graph).
 *
 * A community is considered oversized when it holds more than
 * `maxCommunityFraction` of all pages.
 *
 * Returns the set of community IDs that exceed the threshold.
 */
export function detectOversizedCommunities(
  communityMap: Map<Hash, string>,
  maxCommunityFraction = 0.5,
): Set<string> {
  const total = communityMap.size;
  if (total === 0) return new Set();

  const counts = new Map<string, number>();
  for (const label of communityMap.values()) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const oversized = new Set<string>();
  for (const [label, count] of counts) {
    if (count / total > maxCommunityFraction) {
      oversized.add(label);
    }
  }
  return oversized;
}

/**
 * Detect communities that no longer have any members (empty communities).
 *
 * These communities should release their hotpath quota slots back to the
 * page-tier budget.
 *
 * @param knownCommunities  Full set of community IDs that have quota allocations.
 * @param activeCommunities Community IDs currently assigned to at least one page.
 */
export function detectEmptyCommunities(
  knownCommunities: Set<string>,
  activeCommunities: Set<string>,
): Set<string> {
  const empty = new Set<string>();
  for (const id of knownCommunities) {
    if (!activeCommunities.has(id)) {
      empty.add(id);
    }
  }
  return empty;
}
