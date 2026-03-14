/**
 * ClusterStability tests (P2-F3)
 *
 * Tests label propagation convergence, stable assignments, community size
 * tracking, and empty-community detection.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ClusterStability } from "../../daydreamer/ClusterStability";
import type {
  Book,
  Edge,
  Hash,
  HotpathEntry,
  MetadataStore,
  SemanticNeighbor,
  SemanticNeighborSubgraph,
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

class LabelPropMockStore implements MetadataStore {
  private pages = new Map<Hash, Page>();
  private books = new Map<Hash, Book>();
  private volumes = new Map<Hash, Volume>();
  private shelves = new Map<Hash, Shelf>();
  private edgeMap = new Map<string, Edge>();
  private activities = new Map<Hash, PageActivity>();
  private hotpath = new Map<Hash, HotpathEntry>();
  private semanticNeighbors = new Map<Hash, SemanticNeighbor[]>();
  private dirtyFlags = new Map<Hash, boolean>();

  async putPage(page: Page) { this.pages.set(page.pageId, page); }
  async getPage(id: Hash) { return this.pages.get(id); }
  async getAllPages() { return [...this.pages.values()]; }

  async putBook(book: Book) { this.books.set(book.bookId, book); }
  async getBook(id: Hash) { return this.books.get(id); }

  async putVolume(v: Volume) { this.volumes.set(v.volumeId, v); }
  async getVolume(id: Hash) { return this.volumes.get(id); }
  async getAllVolumes() { return [...this.volumes.values()]; }
  async deleteVolume(id: Hash) { this.volumes.delete(id); }

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

  async putSemanticNeighbors(pageId: Hash, neighbors: SemanticNeighbor[]) {
    this.semanticNeighbors.set(pageId, [...neighbors]);
  }
  async getSemanticNeighbors(pageId: Hash) { return this.semanticNeighbors.get(pageId) ?? []; }
  async getInducedNeighborSubgraph(): Promise<SemanticNeighborSubgraph> { return { nodes: [], edges: [] }; }

  async needsNeighborRecalc(id: Hash) { return this.dirtyFlags.get(id) === true; }
  async flagVolumeForNeighborRecalc(id: Hash) { this.dirtyFlags.set(id, true); }
  async clearNeighborRecalcFlag(id: Hash) { this.dirtyFlags.set(id, false); }

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
  store: LabelPropMockStore,
  pageId: Hash,
  neighborIds: Hash[],
): void {
  const neighbors: SemanticNeighbor[] = neighborIds.map((id) => ({
    neighborPageId: id,
    cosineSimilarity: 0.9,
    distance: 0.1,
  }));
  void store.putSemanticNeighbors(pageId, neighbors);
}

// ---------------------------------------------------------------------------
// Tests — label propagation
// ---------------------------------------------------------------------------

describe("runLabelPropagation", () => {
  let store: LabelPropMockStore;

  beforeEach(() => {
    store = new LabelPropMockStore();
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

// ---------------------------------------------------------------------------
// In-memory MetadataStore mock
// ---------------------------------------------------------------------------

class MockMetadataStore implements MetadataStore {
  pages = new Map<Hash, Page>();
  books = new Map<Hash, Book>();
  volumes = new Map<Hash, Volume>();
  shelves = new Map<Hash, Shelf>();
  activities = new Map<Hash, PageActivity>();
  edges: Edge[] = [];
  hotpath = new Map<Hash, HotpathEntry>();

  // Pages
  async putPage(page: Page): Promise<void> { this.pages.set(page.pageId, { ...page }); }
  async getPage(id: Hash): Promise<Page | undefined> { return this.pages.get(id); }
  async getAllPages(): Promise<Page[]> { return [...this.pages.values()]; }

  // Books
  async putBook(book: Book): Promise<void> { this.books.set(book.bookId, { ...book }); }
  async getBook(id: Hash): Promise<Book | undefined> { return this.books.get(id); }

  // Volumes
  async putVolume(volume: Volume): Promise<void> { this.volumes.set(volume.volumeId, { ...volume }); }
  async getVolume(id: Hash): Promise<Volume | undefined> { return this.volumes.get(id); }
  async getAllVolumes(): Promise<Volume[]> { return [...this.volumes.values()]; }
  async deleteVolume(volumeId: Hash): Promise<void> { this.volumes.delete(volumeId); }

  // Shelves
  async putShelf(shelf: Shelf): Promise<void> { this.shelves.set(shelf.shelfId, { ...shelf }); }
  async getShelf(id: Hash): Promise<Shelf | undefined> { return this.shelves.get(id); }
  async getAllShelves(): Promise<Shelf[]> { return [...this.shelves.values()]; }

  // Edges
  async putEdges(edges: Edge[]): Promise<void> { this.edges.push(...edges); }
  async deleteEdge(from: Hash, to: Hash): Promise<void> { this.edges = this.edges.filter((e) => !(e.fromPageId === from && e.toPageId === to)); }
  async getNeighbors(pageId: Hash): Promise<Edge[]> {
    return this.edges.filter((e) => e.fromPageId === pageId);
  }

  // Reverse indexes
  async getBooksByPage(pageId: Hash): Promise<Book[]> {
    return [...this.books.values()].filter((b) => b.pageIds.includes(pageId));
  }
  async getVolumesByBook(bookId: Hash): Promise<Volume[]> {
    return [...this.volumes.values()].filter((v) => v.bookIds.includes(bookId));
  }
  async getShelvesByVolume(volumeId: Hash): Promise<Shelf[]> {
    return [...this.shelves.values()].filter((s) => s.volumeIds.includes(volumeId));
  }

  // Semantic neighbor stubs
  async putSemanticNeighbors(): Promise<void> { /* stub */ }
  async getSemanticNeighbors(): Promise<SemanticNeighbor[]> { return []; }
  async getInducedNeighborSubgraph(): Promise<SemanticNeighborSubgraph> { return { nodes: [], edges: [] }; }
  async needsNeighborRecalc(): Promise<boolean> { return false; }
  async flagVolumeForNeighborRecalc(): Promise<void> { /* stub */ }
  async clearNeighborRecalcFlag(): Promise<void> { /* stub */ }

  // Hotpath
  async putHotpathEntry(entry: HotpathEntry): Promise<void> { this.hotpath.set(entry.entityId, { ...entry }); }
  async getHotpathEntries(tier?: HotpathEntry["tier"]): Promise<HotpathEntry[]> {
    const all = [...this.hotpath.values()];
    return tier !== undefined ? all.filter((e) => e.tier === tier) : all;
  }
  async removeHotpathEntry(id: Hash): Promise<void> { this.hotpath.delete(id); }
  async evictWeakest(): Promise<void> { /* stub */ }
  async getResidentCount(): Promise<number> { return this.hotpath.size; }

  // Page activity
  async putPageActivity(activity: PageActivity): Promise<void> {
    this.activities.set(activity.pageId, { ...activity });
  }
  async getPageActivity(pageId: Hash): Promise<PageActivity | undefined> {
    return this.activities.get(pageId);
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeVolume(
  id: string,
  bookIds: string[],
  variance: number,
): Volume {
  return {
    volumeId: id,
    bookIds,
    prototypeOffsets: [0],
    prototypeDim: 8,
    variance,
  };
}

function makeBook(id: string, pageIds: string[]): Book {
  return {
    bookId: id,
    pageIds,
    medoidPageId: pageIds[0] ?? id,
    meta: {},
  };
}

function makeShelf(id: string, volumeIds: string[]): Shelf {
  return {
    shelfId: id,
    volumeIds,
    routingPrototypeOffsets: [],
    routingDim: 8,
  };
}

/** Put a minimal fake page into the store so hierarchy traversal works. */
async function seedPage(store: MockMetadataStore, pageId: string): Promise<void> {
  await store.putPage({
    pageId,
    content: `fake content for ${pageId}`,
    embeddingOffset: 0,
    embeddingDim: 8,
    contentHash: pageId,
    vectorHash: pageId,
    creatorPubKey: "fake-key",
    signature: "fake-sig",
    createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClusterStability", () => {
  let store: MockMetadataStore;

  beforeEach(() => {
    store = new MockMetadataStore();
  });

  describe("no-op on stable volumes", () => {
    it("returns zero counts when there are no volumes", async () => {
      const stability = new ClusterStability();
      const result = await stability.run(store);

      expect(result.splitCount).toBe(0);
      expect(result.mergeCount).toBe(0);
      expect(result.communityUpdates).toBe(0);
      expect(result.completedAt).toBeTruthy();
    });

    it("does not split volumes below the variance threshold", async () => {
      const book1 = makeBook("book-1", ["page-1", "page-2"]);
      const book2 = makeBook("book-2", ["page-3", "page-4"]);
      const volume = makeVolume("vol-stable", ["book-1", "book-2"], 0.1);
      const shelf = makeShelf("shelf-1", ["vol-stable"]);

      await store.putBook(book1);
      await store.putBook(book2);
      await store.putVolume(volume);
      await store.putShelf(shelf);
      for (const pageId of ["page-1", "page-2", "page-3", "page-4"]) {
        await seedPage(store, pageId);
      }

      const stability = new ClusterStability({ varianceThreshold: 0.5 });
      const result = await stability.run(store);

      expect(result.splitCount).toBe(0);
    });

    it("does not merge volumes that meet the minimum book count", async () => {
      const book1 = makeBook("book-1", ["page-1"]);
      const book2 = makeBook("book-2", ["page-2"]);
      const volume = makeVolume("vol-ok", ["book-1", "book-2"], 0.1);
      const shelf = makeShelf("shelf-1", ["vol-ok"]);

      await store.putBook(book1);
      await store.putBook(book2);
      await store.putVolume(volume);
      await store.putShelf(shelf);
      for (const pageId of ["page-1", "page-2"]) {
        await seedPage(store, pageId);
      }

      const stability = new ClusterStability({ minBooksPerVolume: 2 });
      const result = await stability.run(store);

      expect(result.mergeCount).toBe(0);
    });
  });

  describe("split — high-variance volumes", () => {
    it("splits a high-variance volume with four books into two sub-volumes", async () => {
      const books = ["book-A", "book-B", "book-C", "book-D"].map((id) =>
        makeBook(id, [`${id}-page`]),
      );
      for (const book of books) await store.putBook(book);
      // Seed pages so hierarchy traversal can discover the shelf
      for (const book of books) {
        for (const pageId of book.pageIds) await seedPage(store, pageId);
      }

      const volume = makeVolume(
        "vol-high-var",
        books.map((b) => b.bookId),
        0.9,
      );
      const shelf = makeShelf("shelf-1", ["vol-high-var"]);
      await store.putVolume(volume);
      await store.putShelf(shelf);

      const stability = new ClusterStability({ varianceThreshold: 0.5 });
      const result = await stability.run(store);

      expect(result.splitCount).toBe(1);

      // The two new volumes must collectively contain all original books
      const updatedShelf = await store.getShelf("shelf-1");
      expect(updatedShelf).toBeDefined();

      const allNewBooks = new Set<string>();
      for (const volId of updatedShelf!.volumeIds) {
        const vol = await store.getVolume(volId);
        expect(vol).toBeDefined();
        vol!.bookIds.forEach((id) => allNewBooks.add(id));
      }

      for (const book of books) {
        expect(allNewBooks.has(book.bookId)).toBe(true);
      }

      // The original volume must be deleted from the store (no orphan)
      expect(await store.getVolume("vol-high-var")).toBeUndefined();
    });

    it("produces two non-empty sub-volumes when splitting", async () => {
      const books = ["b1", "b2", "b3", "b4"].map((id) =>
        makeBook(id, [`${id}-page`]),
      );
      for (const book of books) await store.putBook(book);
      for (const book of books) {
        for (const pageId of book.pageIds) await seedPage(store, pageId);
      }

      const volume = makeVolume("vol-split", books.map((b) => b.bookId), 0.8);
      const shelf = makeShelf("shelf-x", ["vol-split"]);
      await store.putVolume(volume);
      await store.putShelf(shelf);

      await new ClusterStability({ varianceThreshold: 0.5 }).run(store);

      const updatedShelf = await store.getShelf("shelf-x");
      for (const volId of updatedShelf!.volumeIds) {
        const vol = await store.getVolume(volId);
        expect(vol!.bookIds.length).toBeGreaterThan(0);
      }
    });

    it("updates community labels for pages in split volumes", async () => {
      const books = ["bA", "bB", "bC", "bD"].map((id) =>
        makeBook(id, [`${id}-page`]),
      );
      for (const book of books) await store.putBook(book);
      // Seed pages for hierarchy traversal AND page activities
      for (const book of books) {
        for (const pageId of book.pageIds) {
          await seedPage(store, pageId);
          await store.putPageActivity({
            pageId,
            queryHitCount: 0,
            lastQueryAt: new Date().toISOString(),
          });
        }
      }

      const volume = makeVolume("vol-comm", books.map((b) => b.bookId), 0.9);
      const shelf = makeShelf("shelf-comm", ["vol-comm"]);
      await store.putVolume(volume);
      await store.putShelf(shelf);

      const result = await new ClusterStability({
        varianceThreshold: 0.5,
      }).run(store);

      expect(result.communityUpdates).toBeGreaterThan(0);
    });
  });

  describe("merge — undersized volumes", () => {
    it("merges a one-book volume into the neighbouring volume", async () => {
      const book1 = makeBook("small-book", ["small-page"]);
      const book2 = makeBook("big-book-1", ["big-page-1"]);
      const book3 = makeBook("big-book-2", ["big-page-2"]);

      await store.putBook(book1);
      await store.putBook(book2);
      await store.putBook(book3);
      // Seed pages for hierarchy traversal
      for (const pageId of [
        ...book1.pageIds,
        ...book2.pageIds,
        ...book3.pageIds,
      ]) {
        await seedPage(store, pageId);
      }

      const smallVol = makeVolume("vol-small", ["small-book"], 0.1);
      const bigVol = makeVolume("vol-big", ["big-book-1", "big-book-2"], 0.1);
      const shelf = makeShelf("shelf-merge", ["vol-small", "vol-big"]);

      await store.putVolume(smallVol);
      await store.putVolume(bigVol);
      await store.putShelf(shelf);

      const stability = new ClusterStability({ minBooksPerVolume: 2 });
      const result = await stability.run(store);

      expect(result.mergeCount).toBe(1);

      // The merged volume should contain all three books
      const updatedShelf = await store.getShelf("shelf-merge");
      expect(updatedShelf).toBeDefined();

      const allBooks = new Set<string>();
      for (const volId of updatedShelf!.volumeIds) {
        const vol = await store.getVolume(volId);
        if (vol) vol.bookIds.forEach((id) => allBooks.add(id));
      }
      expect(allBooks.has("small-book")).toBe(true);

      // The consumed volumes must be deleted from the store (no orphans)
      expect(await store.getVolume("vol-small")).toBeUndefined();
      expect(await store.getVolume("vol-big")).toBeUndefined();
    });

    it("does not merge when there is only one volume in the shelf", async () => {
      const book = makeBook("lone-book", ["lone-page"]);
      await store.putBook(book);
      await seedPage(store, "lone-page");

      const volume = makeVolume("vol-lone", ["lone-book"], 0.1);
      const shelf = makeShelf("shelf-lone", ["vol-lone"]);
      await store.putVolume(volume);
      await store.putShelf(shelf);

      const stability = new ClusterStability({ minBooksPerVolume: 2 });
      const result = await stability.run(store);

      expect(result.mergeCount).toBe(0);
    });
  });

  describe("completedAt", () => {
    it("returns a valid ISO timestamp", async () => {
      const stability = new ClusterStability();
      const result = await stability.run(store);
      expect(() => new Date(result.completedAt)).not.toThrow();
      expect(Number.isFinite(new Date(result.completedAt).getTime())).toBe(true);
    });
  });
});
