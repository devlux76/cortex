import { describe, expect, it } from "vitest";
import { solveOpenTSP } from "../../cortex/OpenTSPSolver";
import type { SemanticNeighborSubgraph } from "../../core/types";

describe("solveOpenTSP", () => {
  it("returns [] for an empty graph", () => {
    const graph: SemanticNeighborSubgraph = { nodes: [], edges: [] };
    expect(solveOpenTSP(graph)).toEqual([]);
  });

  it("returns the single node for a one-node graph", () => {
    const graph: SemanticNeighborSubgraph = { nodes: ["a"], edges: [] };
    expect(solveOpenTSP(graph)).toEqual(["a"]);
  });

  it("returns both nodes for a two-node graph", () => {
    const graph: SemanticNeighborSubgraph = {
      nodes: ["a", "b"],
      edges: [{ from: "a", to: "b", distance: 1 }],
    };
    const path = solveOpenTSP(graph);
    expect(path).toHaveLength(2);
    expect(path).toContain("a");
    expect(path).toContain("b");
  });

  it("starts from the lexicographically smallest node", () => {
    const graph: SemanticNeighborSubgraph = {
      nodes: ["c", "a", "b"],
      edges: [
        { from: "a", to: "b", distance: 1 },
        { from: "b", to: "c", distance: 1 },
        { from: "a", to: "c", distance: 2 },
      ],
    };
    const path = solveOpenTSP(graph);
    expect(path[0]).toBe("a");
  });

  it("returns correct greedy path for a triangle", () => {
    // a→b: dist 1, b→c: dist 1, a→c: dist 10
    // Starting at "a", nearest is "b" (dist 1), then from "b" nearest unvisited is "c" (dist 1).
    const graph: SemanticNeighborSubgraph = {
      nodes: ["a", "b", "c"],
      edges: [
        { from: "a", to: "b", distance: 1 },
        { from: "b", to: "c", distance: 1 },
        { from: "a", to: "c", distance: 10 },
      ],
    };
    const path = solveOpenTSP(graph);
    expect(path).toEqual(["a", "b", "c"]);
  });

  it("visits all nodes exactly once", () => {
    const nodes = ["d", "a", "c", "b", "e"];
    const graph: SemanticNeighborSubgraph = {
      nodes,
      edges: [
        { from: "a", to: "b", distance: 1 },
        { from: "b", to: "c", distance: 2 },
        { from: "c", to: "d", distance: 3 },
        { from: "d", to: "e", distance: 4 },
      ],
    };
    const path = solveOpenTSP(graph);
    expect(path).toHaveLength(nodes.length);
    expect(new Set(path).size).toBe(nodes.length);
    for (const n of nodes) {
      expect(path).toContain(n);
    }
  });

  it("is deterministic: same input always produces same output", () => {
    const graph: SemanticNeighborSubgraph = {
      nodes: ["z", "m", "a", "q"],
      edges: [
        { from: "a", to: "m", distance: 2 },
        { from: "m", to: "q", distance: 1 },
        { from: "q", to: "z", distance: 3 },
      ],
    };
    const path1 = solveOpenTSP(graph);
    const path2 = solveOpenTSP(graph);
    expect(path1).toEqual(path2);
  });

  it("handles disconnected graph using Infinity for missing edges", () => {
    // "a" and "b" are connected; "c" is isolated.
    const graph: SemanticNeighborSubgraph = {
      nodes: ["a", "b", "c"],
      edges: [{ from: "a", to: "b", distance: 1 }],
    };
    const path = solveOpenTSP(graph);
    expect(path).toHaveLength(3);
    expect(new Set(path).size).toBe(3);
    // Path must start at "a" (lexicographically smallest).
    expect(path[0]).toBe("a");
  });

  it("uses lexicographic order as tiebreaker for equal distances", () => {
    // "a" → "b" dist 1, "a" → "c" dist 1. "b" should be picked first (lex order).
    const graph: SemanticNeighborSubgraph = {
      nodes: ["a", "b", "c"],
      edges: [
        { from: "a", to: "b", distance: 1 },
        { from: "a", to: "c", distance: 1 },
        { from: "b", to: "c", distance: 0.5 },
      ],
    };
    const path = solveOpenTSP(graph);
    expect(path[0]).toBe("a");
    expect(path[1]).toBe("b");
    expect(path[2]).toBe("c");
  });
});
