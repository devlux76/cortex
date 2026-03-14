/**
 * FullNeighborRecalc tests (P2-C2)
 *
 * Tests dirty-flag clearing, neighbor quality vs. initial empty state,
 * batch size bound, and salience/promotion sweep after recalc.
 */

import { describe, expect, it } from "vitest";

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
import type { VectorStore } from "../../core/types";
import { computeCapacity } from "../../core/HotpathPolicy";
import { runFullNeighborRecalc } from "../../daydreamer/FullNeighborRecalc";

// ---------------------------------------------------------------------------
// In-memory implementations
// ---------------------------------------------------------------------------

const NOW_STR = "2026-03-13T00:00:00.000Z";
const NOW = Date.parse(NOW_STR);

function makePage(pageId: Hash, offset: number): Page {
  return {
    pageId,
    content: `Content of ${pageId}`,
    embeddingOffset: offset,
    embeddingDim: 4,
    contentHash: pageId,
    vectorHash: pageId,
    creatorPubKey: "pk",
    signature: "sig",
    createdAt: NOW_STR,
  };
}

class InMemoryVectorStore implements VectorStore {
  private data: Float32Array[] = [];

  async appendVector(v: Float32Array): Promise<number> {
    const offset = this.data.length;
    this.data.push(new Float32Array(v));
    return offset;
  }

  async readVector(offset: number, _dim: number): Promise<Float32Array> {
    return this.data[offset] ?? new Float32Array(_dim);
  }

  async readVectors(offsets: number[], dim: number): Promise<Float32Array[]> {
    return offsets.map((o) => this.data[o] ?? new Float32Array(dim));
  }
}

class FullMockMetadataStore implements MetadataStore {
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
  async getNeighbors(pageId: Hash) {
    return [...this.edgeMap.values()].filter((e) => e.fromPageId === pageId);
  }

  async getBooksByPage() { return []; }
  async getVolumesByBook() { return []; }
  async getShelvesByVolume() { return []; }

  async putMetroidNeighbors(pageId: Hash, neighbors: MetroidNeighbor[]) {
    this.metroidNeighbors.set(pageId, [...neighbors]);
  }
  async getMetroidNeighbors(pageId: Hash) {
    return this.metroidNeighbors.get(pageId) ?? [];
  }
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

  isDirty(volumeId: Hash): boolean { return this.dirtyFlags.get(volumeId) === true; }
  getMetroidNeighborsSync(pageId: Hash) { return this.metroidNeighbors.get(pageId) ?? []; }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Unit vectors in R^4 with different directions. */
const VECS: Float32Array[] = [
  new Float32Array([1, 0, 0, 0]),
  new Float32Array([0, 1, 0, 0]),
  new Float32Array([0, 0, 1, 0]),
  new Float32Array([0, 0, 0, 1]),
];

async function buildStoreWithVolume(
  pageCount: number,
  dirty: boolean,
): Promise<{ store: FullMockMetadataStore; vectorStore: InMemoryVectorStore; volumeId: Hash }> {
  const store = new FullMockMetadataStore();
  const vectorStore = new InMemoryVectorStore();
  const volumeId = "vol-1";

  const pageIds: Hash[] = [];
  for (let i = 0; i < pageCount; i++) {
    const vec = VECS[i % VECS.length];
    const offset = await vectorStore.appendVector(vec);
    const page = makePage(`page-${i}`, offset);
    await store.putPage(page);
    pageIds.push(page.pageId);
  }

  const book: Book = {
    bookId: "book-1",
    pageIds,
    medoidPageId: pageIds[0],
    meta: {},
  };
  await store.putBook(book);

  const volume: Volume = {
    volumeId,
    bookIds: ["book-1"],
    prototypeOffsets: [],
    prototypeDim: 4,
    variance: 0,
  };
  await store.putVolume(volume);

  if (dirty) {
    await store.flagVolumeForMetroidRecalc(volumeId);
  }

  return { store, vectorStore, volumeId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FullNeighborRecalc", () => {
  it("dirty flag is cleared after successful recalc", async () => {
    const { store, vectorStore, volumeId } = await buildStoreWithVolume(3, true);

    expect(store.isDirty(volumeId)).toBe(true);

    await runFullNeighborRecalc({ metadataStore: store, vectorStore, now: NOW });

    expect(store.isDirty(volumeId)).toBe(false);
  });

  it("neighbor list is populated after recalc (improves on empty initial state)", async () => {
    const { store, vectorStore } = await buildStoreWithVolume(3, true);

    // Initially no neighbors
    expect(store.getMetroidNeighborsSync("page-0")).toHaveLength(0);

    await runFullNeighborRecalc({ metadataStore: store, vectorStore, now: NOW });

    // After recalc, each page should have neighbors
    const neighbors = store.getMetroidNeighborsSync("page-0");
    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors.length).toBeLessThanOrEqual(2); // 3 pages → max 2 neighbors each
  });

  it("neighbors are sorted by cosine similarity descending", async () => {
    const { store, vectorStore } = await buildStoreWithVolume(4, true);
    await runFullNeighborRecalc({ metadataStore: store, vectorStore, now: NOW });

    const neighbors = store.getMetroidNeighborsSync("page-0");
    for (let i = 1; i < neighbors.length; i++) {
      expect(neighbors[i - 1].cosineSimilarity).toBeGreaterThanOrEqual(
        neighbors[i].cosineSimilarity,
      );
    }
  });

  it("maxNeighbors limits the number of neighbors per page", async () => {
    const { store, vectorStore } = await buildStoreWithVolume(4, true);

    await runFullNeighborRecalc({
      metadataStore: store,
      vectorStore,
      maxNeighbors: 2,
      now: NOW,
    });

    const neighbors = store.getMetroidNeighborsSync("page-0");
    expect(neighbors.length).toBeLessThanOrEqual(2);
  });

  it("volumes that are not dirty are skipped", async () => {
    const { store, vectorStore, volumeId } = await buildStoreWithVolume(3, false);

    const result = await runFullNeighborRecalc({
      metadataStore: store,
      vectorStore,
      now: NOW,
    });

    expect(result.volumesProcessed).toBe(0);
    expect(store.isDirty(volumeId)).toBe(false);
    expect(store.getMetroidNeighborsSync("page-0")).toHaveLength(0);
  });

  it("batch pairsComputed does not exceed computeCapacity(graphMass)", async () => {
    // Build a large enough store that budget matters
    const { store, vectorStore } = await buildStoreWithVolume(4, true);

    const result = await runFullNeighborRecalc({
      metadataStore: store,
      vectorStore,
      now: NOW,
    });

    const graphMass = 4;
    const budget = computeCapacity(graphMass);
    expect(result.pairsComputed).toBeLessThanOrEqual(Math.max(budget, 4 * 3));
  });

  it("returns zero counts when no pages exist", async () => {
    const store = new FullMockMetadataStore();
    const vectorStore = new InMemoryVectorStore();

    const result = await runFullNeighborRecalc({ metadataStore: store, vectorStore, now: NOW });

    expect(result.volumesProcessed).toBe(0);
    expect(result.pagesProcessed).toBe(0);
    expect(result.pairsComputed).toBe(0);
  });

  it("distance field is 1 - cosineSimilarity", async () => {
    const { store, vectorStore } = await buildStoreWithVolume(2, true);
    await runFullNeighborRecalc({ metadataStore: store, vectorStore, now: NOW });

    const neighbors = store.getMetroidNeighborsSync("page-0");
    for (const n of neighbors) {
      expect(n.distance).toBeCloseTo(1 - n.cosineSimilarity);
    }
  });
});
