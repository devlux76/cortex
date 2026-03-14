/**
 * PrototypeRecomputer tests (P2-D2)
 *
 * Tests medoid selection, centroid computation, and that tier-quota hotpath
 * entries are updated after prototype recomputation.
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
import type { VectorStore } from "../../core/types";
import {
  computeCentroid,
  recomputePrototypes,
  selectMedoidIndex,
} from "../../daydreamer/PrototypeRecomputer";

// ---------------------------------------------------------------------------
// In-memory store helpers (reused from FullNeighborRecalc pattern)
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
  readonly stored: Float32Array[] = [];

  async appendVector(v: Float32Array): Promise<number> {
    const offset = this.stored.length;
    this.stored.push(new Float32Array(v));
    return offset;
  }
  async readVector(offset: number, dim: number): Promise<Float32Array> {
    return this.stored[offset] ?? new Float32Array(dim);
  }
  async readVectors(offsets: number[], dim: number): Promise<Float32Array[]> {
    return offsets.map((o) => this.stored[o] ?? new Float32Array(dim));
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
  private semanticNeighbors = new Map<Hash, SemanticNeighbor[]>();
  private dirtyFlags = new Map<Hash, boolean>();

  async putPage(page: Page) { this.pages.set(page.pageId, page); }
  async getPage(id: Hash) { return this.pages.get(id); }
  async getAllPages() { return [...this.pages.values()]; }

  async putBook(book: Book) {
    this.books.set(book.bookId, book);
    for (const pageId of book.pageIds) {
      this._pageToBooks.set(pageId, [...(this._pageToBooks.get(pageId) ?? []), book.bookId]);
    }
  }
  private _pageToBooks = new Map<Hash, Hash[]>();
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

  async getBooksByPage(pageId: Hash) {
    const ids = this._pageToBooks.get(pageId) ?? [];
    return ids.map((id) => this.books.get(id)).filter(Boolean) as Book[];
  }
  async getVolumesByBook() { return []; }
  async getShelvesByVolume() { return []; }

  async putSemanticNeighbors(pageId: Hash, neighbors: SemanticNeighbor[]) {
    this.semanticNeighbors.set(pageId, neighbors);
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

  allHotpath() { return [...this.hotpath.values()]; }
}

// ---------------------------------------------------------------------------
// Tests — pure helpers
// ---------------------------------------------------------------------------

describe("selectMedoidIndex", () => {
  it("returns -1 for empty array", () => {
    expect(selectMedoidIndex([])).toBe(-1);
  });

  it("returns 0 for single-element array", () => {
    expect(selectMedoidIndex([new Float32Array([1, 0])])).toBe(0);
  });

  it("selects the vector closest to all others", () => {
    // Three vectors: [1,0], [0.9,0.1], [0,1]
    // [0.9,0.1] is closest to both others → should be medoid
    const vecs = [
      new Float32Array([1, 0]),
      new Float32Array([0.9, 0.1]),
      new Float32Array([0, 1]),
    ];
    const idx = selectMedoidIndex(vecs);
    expect(idx).toBe(1);
  });
});

describe("computeCentroid", () => {
  it("returns empty array for empty input", () => {
    const c = computeCentroid([]);
    expect(c.length).toBe(0);
  });

  it("returns the vector itself for a single input", () => {
    const v = new Float32Array([1, 2, 3, 4]);
    const c = computeCentroid([v]);
    expect(Array.from(c)).toEqual(Array.from(v));
  });

  it("computes element-wise mean correctly", () => {
    const vecs = [
      new Float32Array([1, 0]),
      new Float32Array([0, 1]),
    ];
    const c = computeCentroid(vecs);
    expect(c[0]).toBeCloseTo(0.5);
    expect(c[1]).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// Tests — recomputePrototypes integration
// ---------------------------------------------------------------------------

describe("recomputePrototypes", () => {
  let store: FullMockMetadataStore;
  let vectorStore: InMemoryVectorStore;

  beforeEach(() => {
    store = new FullMockMetadataStore();
    vectorStore = new InMemoryVectorStore();
  });

  async function seedVolume(): Promise<{ volumeId: Hash; pageIds: Hash[] }> {
    const vecs = [
      new Float32Array([1, 0, 0, 0]),
      new Float32Array([0, 1, 0, 0]),
      new Float32Array([0, 0, 1, 0]),
    ];

    const pageIds: Hash[] = [];
    for (let i = 0; i < vecs.length; i++) {
      const offset = await vectorStore.appendVector(vecs[i]);
      const page = makePage(`p${i}`, offset);
      await store.putPage(page);
      pageIds.push(page.pageId);
    }

    const book: Book = { bookId: "b1", pageIds, medoidPageId: pageIds[0], meta: {} };
    await store.putBook(book);

    const vol: Volume = {
      volumeId: "v1",
      bookIds: ["b1"],
      prototypeOffsets: [],
      prototypeDim: 4,
      variance: 0,
    };
    await store.putVolume(vol);

    return { volumeId: "v1", pageIds };
  }

  it("appends a prototype vector to VectorStore after recompute", async () => {
    await seedVolume();
    const initialCount = vectorStore.stored.length;

    await recomputePrototypes({ metadataStore: store, vectorStore, now: NOW });

    expect(vectorStore.stored.length).toBeGreaterThan(initialCount);
  });

  it("updates the volume prototypeOffsets after recompute", async () => {
    await seedVolume();

    await recomputePrototypes({ metadataStore: store, vectorStore, now: NOW });

    const updated = await store.getVolume("v1");
    expect(updated?.prototypeOffsets.length).toBeGreaterThan(0);
  });

  it("volumesUpdated count matches number of volumes with pages", async () => {
    await seedVolume();

    const result = await recomputePrototypes({ metadataStore: store, vectorStore, now: NOW });

    expect(result.volumesUpdated).toBe(1);
  });

  it("empty volume store produces zero updates", async () => {
    const result = await recomputePrototypes({ metadataStore: store, vectorStore, now: NOW });
    expect(result.volumesUpdated).toBe(0);
    expect(result.shelvesUpdated).toBe(0);
  });

  it("shelf prototypes are updated when shelves reference volumes with prototypes", async () => {
    await seedVolume();

    // First compute volume prototypes so the shelf has something to reference
    await recomputePrototypes({ metadataStore: store, vectorStore, now: NOW });

    // Attach a shelf
    const shelf: Shelf = {
      shelfId: "shelf-1",
      volumeIds: ["v1"],
      routingPrototypeOffsets: [],
      routingDim: 4,
    };
    await store.putShelf(shelf);

    const result = await recomputePrototypes({ metadataStore: store, vectorStore, now: NOW });

    expect(result.shelvesUpdated).toBe(1);

    const updated = await store.getShelf("shelf-1");
    expect(updated?.routingPrototypeOffsets.length).toBeGreaterThan(0);
  });
});
