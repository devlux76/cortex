/**
 * Persistence round-trip tests for Phase 1 storage layer.
 *
 * Three suites:
 *   1. VectorStore contract  — via MemoryVectorStore (deterministic, no I/O)
 *   2. OPFSVectorStore       — same contract exercised through the OPFS code
 *                              path, with navigator.storage stubbed in-process
 *   3. IndexedDbMetadataStore— full CRUD + indexes via fake-indexeddb
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";

import { MemoryVectorStore } from "../storage/MemoryVectorStore";
import { OPFSVectorStore } from "../storage/OPFSVectorStore";
import { IndexedDbMetadataStore } from "../storage/IndexedDbMetadataStore";
import { FLOAT32_BYTES } from "../core/NumericConstants";
import type {
  Book,
  Edge,
  MetroidNeighbor,
  Page,
  Shelf,
  VectorStore,
  Volume,
} from "../core/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Float32Array from a plain number array (convenience). */
function f32(...values: number[]): Float32Array {
  return new Float32Array(values);
}

/** Assert that two Float32Arrays are element-wise equal within tolerance. */
function expectF32Equal(a: Float32Array, b: Float32Array, tol = 1e-6): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(a[i]).toBeCloseTo(b[i], 6);
    expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(tol);
  }
}

// ---------------------------------------------------------------------------
// OPFS mock factory
// ---------------------------------------------------------------------------

type MockWritable = {
  seek(pos: number): Promise<void>;
  write(data: ArrayBuffer | ArrayBufferView): Promise<void>;
  close(): Promise<void>;
};

type MockFileHandle = {
  getFile(): Promise<{ size: number; slice(s: number, e: number): { arrayBuffer(): Promise<ArrayBuffer> }; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(opts?: { keepExistingData?: boolean }): Promise<MockWritable>;
};

function makeMockOPFS(): { getDirectory(): Promise<{ getFileHandle(name: string, opts?: { create?: boolean }): Promise<MockFileHandle> }> } {
  const files = new Map<string, Uint8Array>();

  function makeHandle(name: string): MockFileHandle {
    return {
      getFile: async () => {
        const data = files.get(name) ?? new Uint8Array(0);
        return {
          size: data.byteLength,
          slice: (s: number, e: number) => ({
            arrayBuffer: async (): Promise<ArrayBuffer> => data.buffer.slice(s, e) as ArrayBuffer,
          }),
          arrayBuffer: async (): Promise<ArrayBuffer> => data.buffer.slice(0) as ArrayBuffer,
        };
      },
      createWritable: async (opts) => {
        const existing = files.get(name) ?? new Uint8Array(0);
        let buf: Uint8Array = opts?.keepExistingData
          ? new Uint8Array(existing)
          : new Uint8Array(0);
        let pos = 0;

        return {
          seek: async (p: number) => { pos = p; },
          write: async (data: ArrayBuffer | ArrayBufferView) => {
            const bytes: Uint8Array = ArrayBuffer.isView(data)
              ? new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength)
              : new Uint8Array(data as ArrayBuffer);
            const needed = pos + bytes.byteLength;
            if (needed > buf.byteLength) {
              const next = new Uint8Array(needed);
              next.set(buf);
              buf = next;
            }
            buf.set(bytes, pos);
            pos += bytes.byteLength;
            files.set(name, buf);
          },
          close: async () => { /* flush complete */ },
        };
      },
    };
  }

  return {
    getDirectory: async () => ({
      getFileHandle: async (name: string, opts?: { create?: boolean }) => {
        if (!opts?.create && !files.has(name)) {
          throw new DOMException("File not found", "NotFoundError");
        }
        if (!files.has(name)) files.set(name, new Uint8Array(0));
        return makeHandle(name);
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// 1. VectorStore contract — MemoryVectorStore
// ---------------------------------------------------------------------------

describe("VectorStore contract (MemoryVectorStore)", () => {
  let store: VectorStore;

  beforeEach(() => {
    store = new MemoryVectorStore();
  });

  it("appends a vector and returns byte offset 0 for the first write", async () => {
    const v = f32(1, 2, 3, 4);
    const offset = await store.appendVector(v);
    expect(offset).toBe(0);
  });

  it("second append returns offset equal to first vector byte length", async () => {
    const dim = 4;
    await store.appendVector(f32(1, 2, 3, 4));
    const offset2 = await store.appendVector(f32(5, 6, 7, 8));
    expect(offset2).toBe(dim * FLOAT32_BYTES);
  });

  it("readVector round-trips the appended data", async () => {
    const v = f32(0.1, 0.2, 0.3);
    const offset = await store.appendVector(v);
    const read = await store.readVector(offset, v.length);
    expectF32Equal(read, v);
  });

  it("readVectors returns correct data for multiple offsets", async () => {
    const v1 = f32(1, 0, 0);
    const v2 = f32(0, 1, 0);
    const v3 = f32(0, 0, 1);
    const o1 = await store.appendVector(v1);
    const o2 = await store.appendVector(v2);
    const o3 = await store.appendVector(v3);

    const [r1, r2, r3] = await store.readVectors([o1, o2, o3], 3);
    expectF32Equal(r1, v1);
    expectF32Equal(r2, v2);
    expectF32Equal(r3, v3);
  });

  it("sequential appends of different dimensions use independent byte offsets", async () => {
    const full = f32(1, 2, 3, 4, 5, 6, 7, 8); // dim=8
    const proto = f32(10, 20, 30, 40);          // dim=4

    const oFull = await store.appendVector(full);
    const oProto = await store.appendVector(proto);

    expectF32Equal(await store.readVector(oFull, 8), full);
    expectF32Equal(await store.readVector(oProto, 4), proto);
  });

  it("readVectors with empty offsets array returns empty array", async () => {
    const result = await store.readVectors([], 4);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. OPFSVectorStore — same contract, navigator.storage stubbed
// ---------------------------------------------------------------------------

describe("OPFSVectorStore (mocked OPFS)", () => {
  let store: OPFSVectorStore;

  beforeEach(() => {
    const mockStorage = makeMockOPFS();
    vi.stubGlobal("navigator", { storage: mockStorage });
    store = new OPFSVectorStore("test-vectors.bin");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends first vector at byte offset 0", async () => {
    const offset = await store.appendVector(f32(1, 2, 3));
    expect(offset).toBe(0);
  });

  it("second append offset equals first vector's byte size", async () => {
    await store.appendVector(f32(1, 2, 3, 4));
    const o2 = await store.appendVector(f32(5, 6, 7, 8));
    expect(o2).toBe(4 * FLOAT32_BYTES);
  });

  it("readVector round-trips appended data", async () => {
    const v = f32(-0.5, 0.25, 0.75, 1.0);
    const offset = await store.appendVector(v);
    const back = await store.readVector(offset, v.length);
    expectF32Equal(back, v);
  });

  it("readVectors returns all vectors at their offsets", async () => {
    const vecs = [f32(1, 0), f32(0, 1), f32(0.707, 0.707)];
    const offsets: number[] = [];
    for (const v of vecs) offsets.push(await store.appendVector(v));

    const results = await store.readVectors(offsets, 2);
    for (let i = 0; i < vecs.length; i++) {
      expectF32Equal(results[i], vecs[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. IndexedDbMetadataStore — full CRUD + indexes
// ---------------------------------------------------------------------------

/** Unique DB name per test to ensure full isolation. */
let dbCounter = 0;
function freshDbName(): string {
  return `cortex-test-${Date.now()}-${++dbCounter}`;
}

// Minimal valid entity fixtures ------------------------------------------------

const PAGE: Page = {
  pageId: "page-abc",
  content: "Hello world",
  embeddingOffset: 0,
  embeddingDim: 4,
  contentHash: "chash-abc",
  vectorHash: "vhash-abc",
  creatorPubKey: "pk-abc",
  signature: "sig-abc",
  createdAt: "2026-03-11T00:00:00.000Z",
};

const BOOK: Book = {
  bookId: "book-xyz",
  pageIds: ["page-abc"],
  medoidPageId: "page-abc",
  meta: { title: "Test Book" },
};

const VOLUME: Volume = {
  volumeId: "vol-001",
  bookIds: ["book-xyz"],
  prototypeOffsets: [16],
  prototypeDim: 4,
  variance: 0.1,
};

const SHELF: Shelf = {
  shelfId: "shelf-001",
  volumeIds: ["vol-001"],
  routingPrototypeOffsets: [64],
  routingDim: 2,
};

const EDGE_A: Edge = {
  fromPageId: "page-abc",
  toPageId: "page-def",
  weight: 0.8,
  lastUpdatedAt: "2026-03-11T00:00:00.000Z",
};

const EDGE_B: Edge = {
  fromPageId: "page-abc",
  toPageId: "page-ghi",
  weight: 0.6,
  lastUpdatedAt: "2026-03-11T00:00:00.000Z",
};

const NEIGHBORS: MetroidNeighbor[] = [
  { neighborPageId: "page-def", cosineSimilarity: 0.9, distance: 0.1 },
  { neighborPageId: "page-ghi", cosineSimilarity: 0.7, distance: 0.3 },
];

describe("IndexedDbMetadataStore", () => {
  // Polyfill IndexedDB globals with fresh in-memory factory each suite run.
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["indexedDB"] = new IDBFactory();
    (globalThis as Record<string, unknown>)["IDBKeyRange"] = FakeIDBKeyRange;
  });

  // --- Page CRUD ---

  it("putPage / getPage round-trips a Page", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putPage(PAGE);
    const result = await store.getPage(PAGE.pageId);
    expect(result).toEqual(PAGE);
  });

  it("getPage returns undefined for a missing pageId", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    const result = await store.getPage("missing");
    expect(result).toBeUndefined();
  });

  it("putPage is idempotent (second write overwrites)", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putPage(PAGE);
    await store.putPage({ ...PAGE, content: "Updated content" });
    const result = await store.getPage(PAGE.pageId);
    expect(result?.content).toBe("Updated content");
  });

  // --- Book CRUD + page→book reverse index ---

  it("putBook / getBook round-trips a Book", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putBook(BOOK);
    const result = await store.getBook(BOOK.bookId);
    expect(result).toEqual(BOOK);
  });

  it("putBook updates page→book reverse index", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putBook(BOOK);
    const books = await store.getBooksByPage("page-abc");
    expect(books).toHaveLength(1);
    expect(books[0].bookId).toBe("book-xyz");
  });

  it("two books sharing a page both appear in getBooksByPage", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    const book2: Book = { ...BOOK, bookId: "book-yyy", pageIds: ["page-abc"] };
    await store.putBook(BOOK);
    await store.putBook(book2);
    const books = await store.getBooksByPage("page-abc");
    expect(books.map((b) => b.bookId).sort()).toEqual(["book-xyz", "book-yyy"].sort());
  });

  // --- Volume CRUD + book→volume reverse index ---

  it("putVolume / getVolume round-trips a Volume", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putVolume(VOLUME);
    const result = await store.getVolume(VOLUME.volumeId);
    expect(result).toEqual(VOLUME);
  });

  it("putVolume updates book→volume reverse index", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putVolume(VOLUME);
    const volumes = await store.getVolumesByBook("book-xyz");
    expect(volumes).toHaveLength(1);
    expect(volumes[0].volumeId).toBe("vol-001");
  });

  // --- Shelf CRUD + volume→shelf reverse index ---

  it("putShelf / getShelf round-trips a Shelf", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putShelf(SHELF);
    const result = await store.getShelf(SHELF.shelfId);
    expect(result).toEqual(SHELF);
  });

  it("putShelf updates volume→shelf reverse index", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putShelf(SHELF);
    const shelves = await store.getShelvesByVolume("vol-001");
    expect(shelves).toHaveLength(1);
    expect(shelves[0].shelfId).toBe("shelf-001");
  });

  // --- Edges ---

  it("putEdges / getNeighbors round-trips Hebbian edges", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putEdges([EDGE_A, EDGE_B]);
    const neighbors = await store.getNeighbors("page-abc");
    expect(neighbors).toHaveLength(2);
    expect(neighbors.map((e) => e.toPageId).sort()).toEqual(
      ["page-def", "page-ghi"].sort(),
    );
  });

  it("getNeighbors returns edges sorted by weight descending", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putEdges([EDGE_B, EDGE_A]); // B first, lower weight
    const neighbors = await store.getNeighbors("page-abc");
    expect(neighbors[0].weight).toBeGreaterThan(neighbors[1].weight);
    expect(neighbors[0].toPageId).toBe("page-def"); // EDGE_A weight=0.8
  });

  it("getNeighbors respects limit parameter", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putEdges([EDGE_A, EDGE_B]);
    const neighbors = await store.getNeighbors("page-abc", 1);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].toPageId).toBe("page-def"); // highest weight first
  });

  it("getNeighbors returns empty array for unknown page", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    const neighbors = await store.getNeighbors("unknown-page");
    expect(neighbors).toEqual([]);
  });

  // --- MetroidNeighbors ---

  it("putMetroidNeighbors / getMetroidNeighbors round-trips neighbor list", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putMetroidNeighbors("page-abc", NEIGHBORS);
    const result = await store.getMetroidNeighbors("page-abc");
    expect(result).toEqual(NEIGHBORS);
  });

  it("getMetroidNeighbors respects maxDegree", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putMetroidNeighbors("page-abc", NEIGHBORS);
    const result = await store.getMetroidNeighbors("page-abc", 1);
    expect(result).toHaveLength(1);
    expect(result[0].neighborPageId).toBe("page-def");
  });

  it("getMetroidNeighbors returns empty array for unknown page", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    const result = await store.getMetroidNeighbors("no-such-page");
    expect(result).toEqual([]);
  });

  it("putMetroidNeighbors overwrites existing list", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putMetroidNeighbors("page-abc", NEIGHBORS);
    const updated: MetroidNeighbor[] = [
      { neighborPageId: "page-new", cosineSimilarity: 0.95, distance: 0.05 },
    ];
    await store.putMetroidNeighbors("page-abc", updated);
    const result = await store.getMetroidNeighbors("page-abc");
    expect(result).toHaveLength(1);
    expect(result[0].neighborPageId).toBe("page-new");
  });

  // --- Induced Metroid subgraph (BFS) ---

  it("getInducedMetroidSubgraph returns seed nodes with zero hops", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putMetroidNeighbors("page-abc", NEIGHBORS);
    const subgraph = await store.getInducedMetroidSubgraph(["page-abc"], 0);
    expect(subgraph.nodes).toEqual(["page-abc"]);
    expect(subgraph.edges).toHaveLength(0);
  });

  it("getInducedMetroidSubgraph expands one hop correctly", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.putMetroidNeighbors("page-abc", NEIGHBORS);
    // page-def and page-ghi have no further neighbors
    const subgraph = await store.getInducedMetroidSubgraph(["page-abc"], 1);
    expect(subgraph.nodes.sort()).toEqual(
      ["page-abc", "page-def", "page-ghi"].sort(),
    );
    expect(subgraph.edges).toHaveLength(2);
  });

  it("getInducedMetroidSubgraph does not revisit nodes", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    // Triangle: abc → def → abc (cycle)
    await store.putMetroidNeighbors("page-abc", [
      { neighborPageId: "page-def", cosineSimilarity: 0.9, distance: 0.1 },
    ]);
    await store.putMetroidNeighbors("page-def", [
      { neighborPageId: "page-abc", cosineSimilarity: 0.9, distance: 0.1 },
    ]);
    const subgraph = await store.getInducedMetroidSubgraph(["page-abc"], 5);
    const uniqueNodes = new Set(subgraph.nodes);
    expect(uniqueNodes.size).toBe(subgraph.nodes.length); // no duplicates
    expect(subgraph.nodes.sort()).toEqual(["page-abc", "page-def"].sort());
  });

  // --- Dirty-recalc flags ---

  it("needsMetroidRecalc returns false before any flag is set", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    expect(await store.needsMetroidRecalc("vol-001")).toBe(false);
  });

  it("flagVolumeForMetroidRecalc / needsMetroidRecalc round-trips", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.flagVolumeForMetroidRecalc("vol-001");
    expect(await store.needsMetroidRecalc("vol-001")).toBe(true);
  });

  it("clearMetroidRecalcFlag resets the flag", async () => {
    const store = await IndexedDbMetadataStore.open(freshDbName());
    await store.flagVolumeForMetroidRecalc("vol-001");
    await store.clearMetroidRecalcFlag("vol-001");
    expect(await store.needsMetroidRecalc("vol-001")).toBe(false);
  });
});
