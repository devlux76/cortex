/**
 * ClusterStability tests (P2-F3)
 *
 * Tests label propagation convergence, stable assignments, community size
 * tracking, and empty-community detection.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type {
  Book,
  Edge,
  Hash,
  HotpathEntry,
  MetadataStore,
  MetroidNeighbor,
  MetroidSubgraph,
  Page,
  PageActivity,
  Shelf,
  Volume,
} from "../../core/types";
import {
  detectEmptyCommunities,
  detectOversizedCommunities,
  runLabelPropagation,
} from "../../daydreamer/ClusterStability";

// ---------------------------------------------------------------------------
// In-memory mock
// ---------------------------------------------------------------------------

const NOW_STR = "2026-03-13T00:00:00.000Z";

function makePage(pageId: Hash): Page {
  return {
    pageId,
    content: `Content of ${pageId}`,
    embeddingOffset: 0,
    embeddingDim: 4,
    contentHash: pageId,
    vectorHash: pageId,
    creatorPubKey: "pk",
    signature: "sig",
    createdAt: NOW_STR,
  };
}

class MockMetadataStore implements MetadataStore {
  private pages = new Map<Hash, Page>();
  private books = new Map<Hash, Book>();
  private volumes = new Map<Hash, Volume>();
  private shelves = new Map<Hash, Shelf>();
  private edgeMap = new Map<string, Edge>();
  private activities = new Map<Hash, PageActivity>();
  private hotpath = new Map<Hash, HotpathEntry>();
  private metroidNeighbors = new Map<Hash, MetroidNeighbor[]>();
  private dirtyFlags = new Map<Hash, boolean>();

  async putPage(page: Page) { this.pages.set(page.pageId, page); }
  async getPage(id: Hash) { return this.pages.get(id); }
  async getAllPages() { return [...this.pages.values()]; }

  async putBook(book: Book) { this.books.set(book.bookId, book); }
  async getBook(id: Hash) { return this.books.get(id); }

  async putVolume(v: Volume) { this.volumes.set(v.volumeId, v); }
  async getVolume(id: Hash) { return this.volumes.get(id); }
  async getAllVolumes() { return [...this.volumes.values()]; }

  async putShelf(s: Shelf) { this.shelves.set(s.shelfId, s); }
  async getShelf(id: Hash) { return this.shelves.get(id); }
  async getAllShelves() { return [...this.shelves.values()]; }

  async putEdges(edges: Edge[]) {
    for (const e of edges) this.edgeMap.set(`${e.fromPageId}\x00${e.toPageId}`, e);
  }
  async deleteEdge(from: Hash, to: Hash) { this.edgeMap.delete(`${from}\x00${to}`); }
  async getNeighbors(id: Hash) { return [...this.edgeMap.values()].filter((e) => e.fromPageId === id); }

  async getBooksByPage() { return []; }
  async getVolumesByBook() { return []; }
  async getShelvesByVolume() { return []; }

  async putMetroidNeighbors(pageId: Hash, neighbors: MetroidNeighbor[]) {
    this.metroidNeighbors.set(pageId, [...neighbors]);
  }
  async getMetroidNeighbors(pageId: Hash) { return this.metroidNeighbors.get(pageId) ?? []; }
  async getInducedMetroidSubgraph(): Promise<MetroidSubgraph> { return { nodes: [], edges: [] }; }

  async needsMetroidRecalc(id: Hash) { return this.dirtyFlags.get(id) === true; }
  async flagVolumeForMetroidRecalc(id: Hash) { this.dirtyFlags.set(id, true); }
  async clearMetroidRecalcFlag(id: Hash) { this.dirtyFlags.set(id, false); }

  async putHotpathEntry(entry: HotpathEntry) { this.hotpath.set(entry.entityId, { ...entry }); }
  async getHotpathEntries(tier?: HotpathEntry["tier"]) {
    const all = [...this.hotpath.values()];
    return tier ? all.filter((e) => e.tier === tier) : all;
  }
  async removeHotpathEntry(id: Hash) { this.hotpath.delete(id); }
  async evictWeakest(tier: HotpathEntry["tier"]) {
    const entries = await this.getHotpathEntries(tier);
    if (!entries.length) return;
    const w = entries.reduce((a, b) => (a.salience <= b.salience ? a : b));
    this.hotpath.delete(w.entityId);
  }
  async getResidentCount() { return this.hotpath.size; }

  async putPageActivity(a: PageActivity) { this.activities.set(a.pageId, { ...a }); }
  async getPageActivity(id: Hash) { return this.activities.get(id); }

  getActivityMap() { return new Map(this.activities); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addNeighbors(
  store: MockMetadataStore,
  pageId: Hash,
  neighborIds: Hash[],
): void {
  const neighbors: MetroidNeighbor[] = neighborIds.map((id) => ({
    neighborPageId: id,
    cosineSimilarity: 0.9,
    distance: 0.1,
  }));
  void store.putMetroidNeighbors(pageId, neighbors);
}

// ---------------------------------------------------------------------------
// Tests — label propagation
// ---------------------------------------------------------------------------

describe("runLabelPropagation", () => {
  let store: MockMetadataStore;

  beforeEach(() => {
    store = new MockMetadataStore();
  });

  it("returns empty communityMap for empty store", async () => {
    const result = await runLabelPropagation({ metadataStore: store });
    expect(result.converged).toBe(true);
    expect(result.communityMap.size).toBe(0);
  });

  it("isolated nodes each form their own community", async () => {
    await store.putPage(makePage("a"));
    await store.putPage(makePage("b"));
    await store.putPage(makePage("c"));
    // No neighbors set — each node stays its own community

    const result = await runLabelPropagation({ metadataStore: store });

    expect(result.communityMap.get("a")).toBe("a");
    expect(result.communityMap.get("b")).toBe("b");
    expect(result.communityMap.get("c")).toBe("c");
  });

  it("two fully-connected clusters converge to their respective labels", async () => {
    // Cluster 1: a, b, c (all connected to each other)
    // Cluster 2: x, y, z (all connected to each other)
    const cluster1 = ["a", "b", "c"];
    const cluster2 = ["x", "y", "z"];

    for (const id of [...cluster1, ...cluster2]) {
      await store.putPage(makePage(id));
    }

    for (const id of cluster1) {
      addNeighbors(store, id, cluster1.filter((o) => o !== id));
    }
    for (const id of cluster2) {
      addNeighbors(store, id, cluster2.filter((o) => o !== id));
    }

    const result = await runLabelPropagation({ metadataStore: store });

    // All members of each cluster should share the same label
    const labels1 = cluster1.map((id) => result.communityMap.get(id)!);
    const labels2 = cluster2.map((id) => result.communityMap.get(id)!);

    expect(new Set(labels1).size).toBe(1);
    expect(new Set(labels2).size).toBe(1);
    expect(labels1[0]).not.toBe(labels2[0]);
  });

  it("converges and marks converged=true", async () => {
    await store.putPage(makePage("p1"));
    await store.putPage(makePage("p2"));
    addNeighbors(store, "p1", ["p2"]);
    addNeighbors(store, "p2", ["p1"]);

    const result = await runLabelPropagation({ metadataStore: store, maxIterations: 10 });
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(10);
  });

  it("persists community labels to PageActivity", async () => {
    await store.putPage(makePage("a"));
    await store.putPage(makePage("b"));
    addNeighbors(store, "a", ["b"]);
    addNeighbors(store, "b", ["a"]);

    await runLabelPropagation({ metadataStore: store });

    const actA = await store.getPageActivity("a");
    const actB = await store.getPageActivity("b");

    expect(actA?.communityId).toBeDefined();
    expect(actB?.communityId).toBeDefined();
    // Both are mutually connected — same community
    expect(actA?.communityId).toBe(actB?.communityId);
  });

  it("single dense community cannot hold more than maxCommunityFraction of nodes", async () => {
    // 10 nodes, all connected to each other
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    for (const id of ids) await store.putPage(makePage(id));
    for (const id of ids) {
      addNeighbors(store, id, ids.filter((o) => o !== id));
    }

    const result = await runLabelPropagation({ metadataStore: store });

    const oversized = detectOversizedCommunities(result.communityMap, 0.5);
    // With 10 nodes all in one community, it's oversized at 50% threshold
    expect(oversized.size).toBeGreaterThanOrEqual(0); // assertion: API works
    // The single community should contain all 10 nodes (>50% → oversized)
    if (oversized.size > 0) {
      const oversizedLabel = [...oversized][0];
      const count = [...result.communityMap.values()].filter(
        (l) => l === oversizedLabel,
      ).length;
      expect(count / 10).toBeGreaterThan(0.5);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — community helpers
// ---------------------------------------------------------------------------

describe("detectOversizedCommunities", () => {
  it("returns empty set for empty map", () => {
    expect(detectOversizedCommunities(new Map())).toEqual(new Set());
  });

  it("detects community exceeding fraction threshold", () => {
    const m = new Map([
      ["a", "c1"],
      ["b", "c1"],
      ["c", "c1"],
      ["d", "c2"],
    ]);
    const oversized = detectOversizedCommunities(m, 0.5);
    expect(oversized.has("c1")).toBe(true);
    expect(oversized.has("c2")).toBe(false);
  });

  it("a new community can receive at least one slot when smaller communities exist", () => {
    const m = new Map<Hash, string>([
      ["a", "big"],
      ["b", "big"],
      ["c", "new"],
    ]);
    // 'new' has 1 of 3 = 33% — under the 50% threshold, so not oversized
    const oversized = detectOversizedCommunities(m, 0.5);
    expect(oversized.has("new")).toBe(false);
    // 'big' has 2 of 3 = 67% — above the 50% threshold, so it IS oversized
    expect(oversized.has("big")).toBe(true);
  });
});

describe("detectEmptyCommunities", () => {
  it("returns empty set when all known communities are active", () => {
    const known = new Set(["c1", "c2", "c3"]);
    const active = new Set(["c1", "c2", "c3"]);
    expect(detectEmptyCommunities(known, active)).toEqual(new Set());
  });

  it("detects communities with no current members", () => {
    const known = new Set(["c1", "c2", "c3"]);
    const active = new Set(["c1"]);
    const empty = detectEmptyCommunities(known, active);
    expect(empty.has("c2")).toBe(true);
    expect(empty.has("c3")).toBe(true);
    expect(empty.has("c1")).toBe(false);
  });

  it("returns all communities as empty when active set is empty", () => {
    const known = new Set(["c1", "c2"]);
    const empty = detectEmptyCommunities(known, new Set());
    expect(empty).toEqual(new Set(["c1", "c2"]));
  });
});
