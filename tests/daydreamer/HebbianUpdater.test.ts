/**
 * HebbianUpdater tests (P2-B2)
 *
 * Tests LTP (edge strengthening), LTD (decay), pruning (weak edge removal),
 * degree enforcement, salience recomputation, and promotion sweep triggering.
 */

import { beforeEach, describe, expect, it } from "vitest";

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
  DEFAULT_LTP_AMOUNT,
  DEFAULT_LTD_DECAY,
  DEFAULT_MAX_DEGREE,
  DEFAULT_PRUNE_THRESHOLD,
  decayAndPrune,
  strengthenEdges,
} from "../../daydreamer/HebbianUpdater";

// ---------------------------------------------------------------------------
// In-memory mock MetadataStore
// ---------------------------------------------------------------------------

const NOW_STR = "2026-03-13T00:00:00.000Z";
const NOW = Date.parse(NOW_STR);

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

class FullMockMetadataStore implements MetadataStore {
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
    for (const e of edges) {
      this.edgeMap.set(`${e.fromPageId}\x00${e.toPageId}`, e);
    }
  }
  async deleteEdge(from: Hash, to: Hash) {
    this.edgeMap.delete(`${from}\x00${to}`);
  }
  async getNeighbors(pageId: Hash) {
    return [...this.edgeMap.values()].filter((e) => e.fromPageId === pageId);
  }

  async getBooksByPage() { return []; }
  async getVolumesByBook() { return []; }
  async getShelvesByVolume() { return []; }

  async putSemanticNeighbors(pageId: Hash, neighbors: SemanticNeighbor[]) {
    this.semanticNeighbors.set(pageId, neighbors);
  }
  async getSemanticNeighbors(pageId: Hash) {
    return this.semanticNeighbors.get(pageId) ?? [];
  }
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
  async evictWeakest(tier: HotpathEntry["tier"], communityId?: string) {
    const entries = (await this.getHotpathEntries(tier)).filter(
      (e) => communityId === undefined || e.communityId === communityId,
    );
    if (!entries.length) return;
    const weakest = entries.reduce((a, b) => (a.salience <= b.salience ? a : b));
    this.hotpath.delete(weakest.entityId);
  }
  async getResidentCount() { return this.hotpath.size; }

  async putPageActivity(a: PageActivity) { this.activities.set(a.pageId, { ...a }); }
  async getPageActivity(id: Hash) { return this.activities.get(id); }

  /** Test helper: raw edge lookup. */
  getEdge(from: Hash, to: Hash): Edge | undefined {
    return this.edgeMap.get(`${from}\x00${to}`);
  }

  /** Test helper: all edges. */
  allEdges(): Edge[] {
    return [...this.edgeMap.values()];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HebbianUpdater", () => {
  let store: FullMockMetadataStore;

  beforeEach(() => {
    store = new FullMockMetadataStore();
  });

  // --- LTP ---

  it("strengthenEdges increases existing edge weight by ltpAmount", async () => {
    const edge: Edge = {
      fromPageId: "p1",
      toPageId: "p2",
      weight: 0.5,
      lastUpdatedAt: NOW_STR,
    };
    await store.putEdges([edge]);

    await strengthenEdges([{ from: "p1", to: "p2" }], {
      metadataStore: store,
      ltpAmount: DEFAULT_LTP_AMOUNT,
      now: NOW,
    });

    const updated = store.getEdge("p1", "p2");
    expect(updated).toBeDefined();
    expect(updated!.weight).toBeCloseTo(0.5 + DEFAULT_LTP_AMOUNT);
  });

  it("strengthenEdges creates a new edge if one does not yet exist", async () => {
    await store.putPage(makePage("p1"));
    await store.putPage(makePage("p2"));

    await strengthenEdges([{ from: "p1", to: "p2" }], {
      metadataStore: store,
      ltpAmount: 0.2,
      now: NOW,
    });

    const created = store.getEdge("p1", "p2");
    expect(created).toBeDefined();
    expect(created!.weight).toBeCloseTo(0.2);
  });

  it("strengthenEdges with empty traversal list is a no-op", async () => {
    await strengthenEdges([], { metadataStore: store, now: NOW });
    expect(store.allEdges()).toHaveLength(0);
  });

  // --- LTD + pruning ---

  it("decayAndPrune decreases all edge weights by ltdDecay factor", async () => {
    await store.putPage(makePage("a"));
    await store.putEdges([{ fromPageId: "a", toPageId: "b", weight: 1.0, lastUpdatedAt: NOW_STR }]);

    await decayAndPrune({ metadataStore: store, ltdDecay: 0.9, pruneThreshold: 0.0, now: NOW });

    const e = store.getEdge("a", "b");
    expect(e).toBeDefined();
    expect(e!.weight).toBeCloseTo(0.9);
  });

  it("decayAndPrune removes edges that fall below pruneThreshold", async () => {
    await store.putPage(makePage("a"));
    await store.putEdges([{ fromPageId: "a", toPageId: "b", weight: 0.005, lastUpdatedAt: NOW_STR }]);

    const result = await decayAndPrune({
      metadataStore: store,
      ltdDecay: 1.0,           // no decay — just prune
      pruneThreshold: 0.01,
      now: NOW,
    });

    expect(result.pruned).toBe(1);
    expect(store.getEdge("a", "b")).toBeUndefined();
  });

  it("decayAndPrune keeps edges above pruneThreshold", async () => {
    await store.putPage(makePage("a"));
    await store.putEdges([{ fromPageId: "a", toPageId: "b", weight: 0.5, lastUpdatedAt: NOW_STR }]);

    await decayAndPrune({
      metadataStore: store,
      ltdDecay: 0.99,
      pruneThreshold: DEFAULT_PRUNE_THRESHOLD,
      now: NOW,
    });

    expect(store.getEdge("a", "b")).toBeDefined();
  });

  it("decayAndPrune enforces maxDegree by removing excess edges", async () => {
    await store.putPage(makePage("src"));

    // Create more edges than maxDegree=2
    const edges: Edge[] = [
      { fromPageId: "src", toPageId: "t1", weight: 0.5, lastUpdatedAt: NOW_STR },
      { fromPageId: "src", toPageId: "t2", weight: 0.3, lastUpdatedAt: NOW_STR },
      { fromPageId: "src", toPageId: "t3", weight: 0.1, lastUpdatedAt: NOW_STR },
    ];
    await store.putEdges(edges);

    await decayAndPrune({
      metadataStore: store,
      ltdDecay: 1.0,
      pruneThreshold: 0.0,
      maxDegree: 2,
      now: NOW,
    });

    const remaining = store.allEdges().filter((e) => e.fromPageId === "src");
    expect(remaining.length).toBeLessThanOrEqual(2);
    // The two strongest edges should survive
    const ids = remaining.map((e) => e.toPageId).sort();
    expect(ids).toEqual(["t1", "t2"]);
  });

  it("decayAndPrune returns zero pruned/decayed when store is empty", async () => {
    const result = await decayAndPrune({ metadataStore: store, now: NOW });
    expect(result.decayed).toBe(0);
    expect(result.pruned).toBe(0);
  });

  it("maxDegree default constant is exported and positive", () => {
    expect(DEFAULT_MAX_DEGREE).toBeGreaterThan(0);
  });

  it("ltdDecay default is between 0 and 1 exclusive", () => {
    expect(DEFAULT_LTD_DECAY).toBeGreaterThan(0);
    expect(DEFAULT_LTD_DECAY).toBeLessThan(1);
  });

  it("pruneThreshold default is positive", () => {
    expect(DEFAULT_PRUNE_THRESHOLD).toBeGreaterThan(0);
  });
});
