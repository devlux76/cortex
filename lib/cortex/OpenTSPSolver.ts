import type { Hash, SemanticNeighborSubgraph } from "../core/types";

/**
 * Greedy nearest-neighbor open-path TSP heuristic.
 *
 * Visits every node in the subgraph exactly once, starting from the
 * lexicographically smallest node ID for determinism. At each step the
 * algorithm advances to the unvisited node nearest to the current one
 * (using edge distance). Ties are broken lexicographically. Missing edges
 * are treated as having distance Infinity.
 */
export function solveOpenTSP(subgraph: SemanticNeighborSubgraph): Hash[] {
  const { nodes, edges } = subgraph;
  if (nodes.length === 0) return [];

  // Build undirected adjacency map: node → (neighbor → distance).
  const adj = new Map<Hash, Map<Hash, number>>();
  for (const node of nodes) {
    adj.set(node, new Map());
  }
  for (const edge of edges) {
    const fromMap = adj.get(edge.from);
    const toMap = adj.get(edge.to);
    if (fromMap !== undefined) fromMap.set(edge.to, edge.distance);
    if (toMap !== undefined) toMap.set(edge.from, edge.distance);
  }

  // Pre-sort once so lexicographic tiebreaking is O(1) per step.
  const sorted = [...nodes].sort();

  const visited = new Set<Hash>();
  const path: Hash[] = [];
  let current = sorted[0];

  while (path.length < nodes.length) {
    visited.add(current);
    path.push(current);

    if (path.length === nodes.length) break;

    const neighbors = adj.get(current)!;
    let bestNode: Hash | undefined;
    let bestDist = Infinity;

    for (const node of sorted) {
      if (visited.has(node)) continue;
      const dist = neighbors.get(node) ?? Infinity;
      if (
        dist < bestDist ||
        (dist === bestDist && (bestNode === undefined || node < bestNode))
      ) {
        bestDist = dist;
        bestNode = node;
      }
    }

    // bestNode is always defined here because at least one unvisited node remains.
    current = bestNode!;
  }

  return path;
}
