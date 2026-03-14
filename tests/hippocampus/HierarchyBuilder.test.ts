import { describe, expect, it, beforeEach } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";

import { IndexedDbMetadataStore } from "../../storage/IndexedDbMetadataStore";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import { generateKeyPair } from "../../core/crypto/sign";
import { buildPage } from "../../hippocampus/PageBuilder";
import { ingestText } from "../../hippocampus/Ingest";
import { buildHierarchy } from "../../hippocampus/HierarchyBuilder";
import type { ModelProfile } from "../../core/ModelProfile";
import type { Hash } from "../../core/types";

let dbCounter = 0;
function freshDbName(): string {
  return `cortex-hierarchy-test-${Date.now()}-${++dbCounter}`;
}

const PROFILE: ModelProfile = {
  modelId: "test-model",
  embeddingDimension: 8,
  contextWindowTokens: 64,
  truncationTokens: 48,
  maxChunkTokens: 4,
  source: "metadata",
};

async function makeFixture(pageCount: number) {
  const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
  const vectorStore = new MemoryVectorStore();
  const keyPair = await generateKeyPair();

  const backend = new DeterministicDummyEmbeddingBackend({ dimension: PROFILE.embeddingDimension });
  const runner = new EmbeddingRunner(async () => ({
    backend,
    selectedKind: "dummy" as const,
    reason: "forced" as const,
    supportedKinds: ["dummy" as const],
    measurements: [],
  }));

  // Ingest enough words to generate ~pageCount pages (4 tokens each chunk).
  const words = Array.from({ length: pageCount * 4 }, (_, i) => `word${i}`);
  const text = words.join(" ");

  const result = await ingestText(text, {
    modelProfile: PROFILE,
    embeddingRunner: runner,
    vectorStore,
    metadataStore,
    keyPair,
  });

  return { metadataStore, vectorStore, pageIds: result.pages.map((p) => p.pageId) };
}

describe("HierarchyBuilder", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["indexedDB"] = new IDBFactory();
    (globalThis as Record<string, unknown>)["IDBKeyRange"] = FakeIDBKeyRange;
  });

  it("produces at least one book for 5 pages", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(5);

    const { books } = await buildHierarchy(pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    expect(books.length).toBeGreaterThanOrEqual(1);
  });

  it("every book's medoidPageId exists in its pageIds list", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(10);

    const { books } = await buildHierarchy(pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    for (const book of books) {
      expect(book.pageIds).toContain(book.medoidPageId);
    }
  });

  it("every book's pageIds are a subset of the input pageIds", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(10);

    const { books } = await buildHierarchy(pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    const inputSet = new Set(pageIds);
    for (const book of books) {
      for (const id of book.pageIds) {
        expect(inputSet.has(id)).toBe(true);
      }
    }
  });

  it("produces volumes with populated prototypeOffsets", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(10);

    const { volumes } = await buildHierarchy(pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    expect(volumes.length).toBeGreaterThanOrEqual(1);
    for (const vol of volumes) {
      expect(vol.prototypeOffsets.length).toBeGreaterThan(0);
      expect(vol.prototypeDim).toBe(PROFILE.embeddingDimension);
      expect(vol.bookIds.length).toBeGreaterThan(0);
    }
  });

  it("produces shelves with populated routingPrototypeOffsets", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(10);

    const { shelves } = await buildHierarchy(pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    expect(shelves.length).toBeGreaterThanOrEqual(1);
    for (const shelf of shelves) {
      expect(shelf.routingPrototypeOffsets.length).toBeGreaterThan(0);
      expect(shelf.routingDim).toBe(PROFILE.embeddingDimension);
      expect(shelf.volumeIds.length).toBeGreaterThan(0);
    }
  });

  it("books are persisted to the metadata store", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(5);

    const { books } = await buildHierarchy(pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    for (const book of books) {
      const stored = await metadataStore.getBook(book.bookId);
      expect(stored).toEqual(book);
    }
  });

  it("volumes are persisted to the metadata store", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(5);

    const { volumes } = await buildHierarchy(pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    for (const vol of volumes) {
      const stored = await metadataStore.getVolume(vol.volumeId);
      expect(stored).toEqual(vol);
    }
  });

  it("shelves are persisted to the metadata store", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(5);

    const { shelves } = await buildHierarchy(pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    for (const shelf of shelves) {
      const stored = await metadataStore.getShelf(shelf.shelfId);
      expect(stored).toEqual(shelf);
    }
  });

  it("admits hierarchy entity IDs to the hotpath index", async () => {
    // Build and store pages manually so the hotpath starts empty, then
    // call buildHierarchy exactly once and verify admission.
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const backend = new DeterministicDummyEmbeddingBackend({ dimension: PROFILE.embeddingDimension });

    const contents = [
      "alpha beta gamma delta",
      "epsilon zeta eta theta",
      "iota kappa lambda mu",
      "nu xi omicron pi",
      "rho sigma tau upsilon",
    ];

    const embeddings = await backend.embed(contents);
    const pageIds: Hash[] = [];

    for (let i = 0; i < contents.length; i++) {
      const offset = await vectorStore.appendVector(embeddings[i]);
      const page = await buildPage({
        content: contents[i],
        embedding: embeddings[i],
        embeddingOffset: offset,
        embeddingDim: PROFILE.embeddingDimension,
        creatorPubKey: keyPair.publicKey,
        signingKey: keyPair.signingKey,
      });
      await metadataStore.putPage(page);
      await metadataStore.putPageActivity({
        pageId: page.pageId,
        queryHitCount: 0,
        lastQueryAt: new Date().toISOString(),
      });
      pageIds.push(page.pageId);
    }

    // Hotpath is clean at this point — buildHierarchy gets the first shot at admission.
    const { books, volumes, shelves } = await buildHierarchy(pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    const hotpathEntries = await metadataStore.getHotpathEntries();
    const hotpathIds = new Set(hotpathEntries.map((e) => e.entityId));

    const allEntityIds = [
      ...books.map((b) => b.bookId),
      ...volumes.map((v) => v.volumeId),
      ...shelves.map((s) => s.shelfId),
    ];

    // With an empty hotpath, the first promotion sweep (for books) should admit at least one entity.
    const atLeastOneAdmitted = allEntityIds.some((id) => hotpathIds.has(id));
    expect(atLeastOneAdmitted).toBe(true);
  });

  it("returns empty arrays for empty page input", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();

    const result = await buildHierarchy([], {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    expect(result.books).toHaveLength(0);
    expect(result.volumes).toHaveLength(0);
    expect(result.shelves).toHaveLength(0);
  });

  it("ingestText produces Books, Volumes, and Shelves via HierarchyBuilder", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();

    const backend = new DeterministicDummyEmbeddingBackend({ dimension: PROFILE.embeddingDimension });
    const runner = new EmbeddingRunner(async () => ({
      backend,
      selectedKind: "dummy" as const,
      reason: "forced" as const,
      supportedKinds: ["dummy" as const],
      measurements: [],
    }));

    const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.";
    const result = await ingestText(text, {
      modelProfile: PROFILE,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    // At least one Book produced
    expect(result.books.length).toBeGreaterThanOrEqual(1);
    expect(result.book).toBeDefined();
    // Every page must belong to at least one book
    const allBookPageIds = result.books.flatMap((b) => b.pageIds);
    for (const page of result.pages) {
      expect(allBookPageIds).toContain(page.pageId);
    }
    // Every book's medoid must be one of its own pages
    for (const book of result.books) {
      expect(book.pageIds).toContain(book.medoidPageId);
    }
    // Volumes and Shelves are now produced during ingest via HierarchyBuilder
    expect(result.volumes.length).toBeGreaterThanOrEqual(1);
    expect(result.shelves.length).toBeGreaterThanOrEqual(1);
  });

  it("adds SemanticNeighbor edges between consecutive pages within each book slice", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(4);

    const { books } = await buildHierarchy(pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    // For each book with at least 2 pages, every consecutive pair should have
    // a SemanticNeighbor edge in both directions.
    for (const book of books) {
      for (let i = 0; i < book.pageIds.length - 1; i++) {
        const aId = book.pageIds[i];
        const bId = book.pageIds[i + 1];

        // Forward: a → b
        const aNeighbors = await metadataStore.getSemanticNeighbors(aId);
        const aHasB = aNeighbors.some((n) => n.neighborPageId === bId);
        expect(aHasB).toBe(true);

        // Reverse: b → a
        const bNeighbors = await metadataStore.getSemanticNeighbors(bId);
        const bHasA = bNeighbors.some((n) => n.neighborPageId === aId);
        expect(bHasA).toBe(true);

        // Edge data should be structurally valid.
        const edge = aNeighbors.find((n) => n.neighborPageId === bId)!;
        expect(edge.cosineSimilarity).toBeGreaterThanOrEqual(-1);
        expect(edge.cosineSimilarity).toBeLessThanOrEqual(1);
        expect(edge.distance).toBeCloseTo(1 - edge.cosineSimilarity, 5);
      }
    }
  });
});
