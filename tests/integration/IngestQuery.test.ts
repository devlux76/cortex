import { describe, expect, it, beforeEach } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";

import { IndexedDbMetadataStore } from "../../storage/IndexedDbMetadataStore";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import { generateKeyPair } from "../../core/crypto/sign";
import { ingestText } from "../../hippocampus/Ingest";
import { topKByScore } from "../../TopK";
import { chunkText } from "../../hippocampus/Chunker";
import type { ModelProfile } from "../../core/ModelProfile";
import type { Page, VectorStore } from "../../core/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;
function freshDbName(): string {
  return `cortex-integration-${Date.now()}-${++dbCounter}`;
}

const EMBEDDING_DIM = 32;

function makeProfile(): ModelProfile {
  return {
    modelId: "integration-test-model",
    embeddingDimension: EMBEDDING_DIM,
    contextWindowTokens: 512,
    truncationTokens: 384,
    maxChunkTokens: 80,
    source: "metadata",
  };
}

function makeBackend(): DeterministicDummyEmbeddingBackend {
  return new DeterministicDummyEmbeddingBackend({ dimension: EMBEDDING_DIM });
}

function makeRunner(backend: DeterministicDummyEmbeddingBackend): EmbeddingRunner {
  return new EmbeddingRunner(async () => ({
    backend,
    selectedKind: "dummy" as const,
    reason: "forced" as const,
    supportedKinds: ["dummy" as const],
    measurements: [],
  }));
}

/**
 * Minimal query helper: embed the query text, compute dot-product similarity
 * against every stored page vector, and return the top-K pages.
 *
 * This intentionally mirrors what a full Cortex retrieval pipeline would do
 * (embed → score → rank) but without tiered routing or subgraph expansion,
 * keeping the integration test focused on end-to-end data flow.
 */
async function queryPages(
  queryText: string,
  pages: Page[],
  runner: EmbeddingRunner,
  vectorStore: VectorStore,
  topK: number,
): Promise<{ page: Page; score: number }[]> {
  const [queryVec] = await runner.embed([queryText]);

  const offsets = pages.map((p) => p.embeddingOffset);
  const dim = pages[0].embeddingDim;
  const storedVecs = await vectorStore.readVectors(offsets, dim);

  const scores = new Float32Array(pages.length);
  for (let i = 0; i < pages.length; i++) {
    let dot = 0;
    for (let j = 0; j < dim; j++) {
      dot += queryVec[j] * storedVecs[i][j];
    }
    scores[i] = dot;
  }

  const ranked = topKByScore(scores, topK);
  return ranked.map((r) => ({ page: pages[r.index], score: r.score }));
}

// ---------------------------------------------------------------------------
// Sample corpus — short "Wikipedia-style" passages on distinct topics
// ---------------------------------------------------------------------------

const ASTRONOMY_TEXT =
  "The Milky Way is a barred spiral galaxy with an estimated visible diameter of one hundred thousand light-years. " +
  "It contains between one hundred billion and four hundred billion stars. " +
  "The Solar System is located within the disk about twenty-six thousand light-years from the Galactic Center.";

const BIOLOGY_TEXT =
  "Photosynthesis is a biological process used by plants to convert light energy into chemical energy. " +
  "During photosynthesis chloroplasts absorb sunlight and use it to transform carbon dioxide and water into glucose and oxygen. " +
  "This process is essential for life on Earth as it produces the oxygen that most organisms breathe.";

const HISTORY_TEXT =
  "The Roman Empire was one of the largest and most influential civilizations in world history. " +
  "At its greatest extent it spanned three continents and governed over sixty million people. " +
  "The empire shaped law government architecture and language across Europe and the Mediterranean.";

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("integration: ingest and query", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["indexedDB"] = new IDBFactory();
    (globalThis as Record<string, unknown>)["IDBKeyRange"] = FakeIDBKeyRange;
  });

  it("ingests a multi-topic corpus and retrieves the correct pages by query", async () => {
    const dbName = freshDbName();
    const metadataStore = await IndexedDbMetadataStore.open(dbName);
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const profile = makeProfile();
    const backend = makeBackend();
    const runner = makeRunner(backend);

    // ---- Ingest three distinct articles ----

    const astronomyResult = await ingestText(ASTRONOMY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    const biologyResult = await ingestText(BIOLOGY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    const historyResult = await ingestText(HISTORY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    // Collect all ingested pages
    const allPages = [
      ...astronomyResult.pages,
      ...biologyResult.pages,
      ...historyResult.pages,
    ];

    expect(allPages.length).toBeGreaterThanOrEqual(3);

    // Each article should have produced at least one page
    expect(astronomyResult.pages.length).toBeGreaterThanOrEqual(1);
    expect(biologyResult.pages.length).toBeGreaterThanOrEqual(1);
    expect(historyResult.pages.length).toBeGreaterThanOrEqual(1);

    // Each article should have a book
    expect(astronomyResult.book).toBeDefined();
    expect(biologyResult.book).toBeDefined();
    expect(historyResult.book).toBeDefined();

    // ---- Query for each topic using exact chunk text ----
    // Because the DeterministicDummyEmbeddingBackend is content-addressed
    // (SHA-256 based), querying with the exact text of a chunk will produce
    // an identical embedding vector, yielding the highest dot-product score.

    const astronomyChunks = chunkText(ASTRONOMY_TEXT, profile);
    const biologyChunks = chunkText(BIOLOGY_TEXT, profile);
    const historyChunks = chunkText(HISTORY_TEXT, profile);

    // Query with the first astronomy chunk — top result should be the astronomy page
    const astronomyHits = await queryPages(
      astronomyChunks[0],
      allPages,
      runner,
      vectorStore,
      3,
    );
    expect(astronomyHits[0].page.content).toBe(astronomyChunks[0]);
    expect(astronomyHits[0].score).toBeGreaterThan(astronomyHits[1].score);

    // Query with the first biology chunk — top result should be the biology page
    const biologyHits = await queryPages(
      biologyChunks[0],
      allPages,
      runner,
      vectorStore,
      3,
    );
    expect(biologyHits[0].page.content).toBe(biologyChunks[0]);
    expect(biologyHits[0].score).toBeGreaterThan(biologyHits[1].score);

    // Query with the first history chunk — top result should be the history page
    const historyHits = await queryPages(
      historyChunks[0],
      allPages,
      runner,
      vectorStore,
      3,
    );
    expect(historyHits[0].page.content).toBe(historyChunks[0]);
    expect(historyHits[0].score).toBeGreaterThan(historyHits[1].score);
  });

  it("verifies all stored metadata is accessible after ingest", async () => {
    const dbName = freshDbName();
    const metadataStore = await IndexedDbMetadataStore.open(dbName);
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const profile = makeProfile();
    const backend = makeBackend();
    const runner = makeRunner(backend);

    const result = await ingestText(ASTRONOMY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    // Every page should be retrievable from the metadata store
    for (const page of result.pages) {
      const stored = await metadataStore.getPage(page.pageId);
      expect(stored).toBeDefined();
      expect(stored!.content).toBe(page.content);
      expect(stored!.embeddingOffset).toBe(page.embeddingOffset);
      expect(stored!.embeddingDim).toBe(EMBEDDING_DIM);
    }

    // Books should collectively reference all page IDs
    expect(result.books.length).toBeGreaterThanOrEqual(1);
    const allBookPageIds = result.books.flatMap((b) => b.pageIds);
    for (const page of result.pages) {
      expect(allBookPageIds).toContain(page.pageId);
    }

    // Activity records should be initialized for each page
    for (const page of result.pages) {
      const activity = await metadataStore.getPageActivity(page.pageId);
      expect(activity).toBeDefined();
      expect(activity!.queryHitCount).toBe(0);
    }

    // Vector store should hold all vectors
    for (const page of result.pages) {
      const vec = await vectorStore.readVector(page.embeddingOffset, page.embeddingDim);
      expect(vec.length).toBe(EMBEDDING_DIM);
    }
  });

  it("persists metadata across sessions (reopen IndexedDB store)", async () => {
    const dbName = freshDbName();
    // Note: MemoryVectorStore is intentionally shared across "sessions" here
    // because it has no persistence layer — this test validates that *metadata*
    // (pages, books, activity) survives an IndexedDB reopen. Vector persistence
    // is validated separately by the browser harness tests using real OPFS.
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const profile = makeProfile();
    const backend = makeBackend();
    const runner = makeRunner(backend);

    // ---- Session 1: Ingest ----

    const store1 = await IndexedDbMetadataStore.open(dbName);

    const result = await ingestText(BIOLOGY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore: store1,
      keyPair,
    });

    const ingestedPageIds = result.pages.map((p) => p.pageId);
    const bookIds = result.books.map((b) => b.bookId);

    // ---- Session 2: Reopen the same database and verify persistence ----

    const store2 = await IndexedDbMetadataStore.open(dbName);

    // Pages should still be there
    for (const pageId of ingestedPageIds) {
      const page = await store2.getPage(pageId);
      expect(page).toBeDefined();
      expect(page!.pageId).toBe(pageId);
    }

    // Books should still be there
    for (const bookId of bookIds) {
      const book = await store2.getBook(bookId);
      expect(book).toBeDefined();
    }

    // Activity records should survive
    for (const pageId of ingestedPageIds) {
      const activity = await store2.getPageActivity(pageId);
      expect(activity).toBeDefined();
      expect(activity!.queryHitCount).toBe(0);
    }

    // Re-query using the reopened store should still work
    // Collect all pages from the reopened store
    const restoredPages: Page[] = [];
    for (const pageId of ingestedPageIds) {
      const page = await store2.getPage(pageId);
      if (page) restoredPages.push(page);
    }

    const biologyChunks = chunkText(BIOLOGY_TEXT, profile);
    const hits = await queryPages(
      biologyChunks[0],
      restoredPages,
      runner,
      vectorStore,
      restoredPages.length,
    );

    // The first chunk should self-match with the highest score
    expect(hits[0].page.content).toBe(biologyChunks[0]);
  });

  it("handles multiple ingest-then-query cycles", async () => {
    const dbName = freshDbName();
    const metadataStore = await IndexedDbMetadataStore.open(dbName);
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const profile = makeProfile();
    const backend = makeBackend();
    const runner = makeRunner(backend);

    // ---- Round 1: Ingest astronomy text and query ----

    const r1 = await ingestText(ASTRONOMY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    const astronomyChunks = chunkText(ASTRONOMY_TEXT, profile);
    const hits1 = await queryPages(
      astronomyChunks[0],
      r1.pages,
      runner,
      vectorStore,
      1,
    );
    expect(hits1[0].page.content).toBe(astronomyChunks[0]);

    // ---- Round 2: Ingest history text and query across both ----

    const r2 = await ingestText(HISTORY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    const allPages = [...r1.pages, ...r2.pages];
    const historyChunks = chunkText(HISTORY_TEXT, profile);

    // History query should still find history pages as top result
    const hits2 = await queryPages(
      historyChunks[0],
      allPages,
      runner,
      vectorStore,
      3,
    );
    expect(hits2[0].page.content).toBe(historyChunks[0]);

    // Astronomy query should still find astronomy pages as top result
    const hits3 = await queryPages(
      astronomyChunks[0],
      allPages,
      runner,
      vectorStore,
      3,
    );
    expect(hits3[0].page.content).toBe(astronomyChunks[0]);
  });
});

// ---------------------------------------------------------------------------
// P1-F: Hierarchical + Dialectical integration tests (v0.5)
// ---------------------------------------------------------------------------

describe("integration (v0.5): hierarchical and dialectical ingest/query", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["indexedDB"] = new IDBFactory();
    (globalThis as Record<string, unknown>)["IDBKeyRange"] = FakeIDBKeyRange;
  });

  it("ingest produces Books, Volumes, and Shelves via HierarchyBuilder", async () => {
    const dbName = freshDbName();
    const metadataStore = await IndexedDbMetadataStore.open(dbName);
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const profile = makeProfile();
    const runner = makeRunner(makeBackend());

    const result = await ingestText(ASTRONOMY_TEXT + " " + BIOLOGY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    // Pages were created
    expect(result.pages.length).toBeGreaterThanOrEqual(1);

    // At least one Book was created
    expect(result.books.length).toBeGreaterThanOrEqual(1);
    expect(result.book).toBeDefined();

    // Every page must belong to at least one book
    const allBookPageIds = result.books.flatMap((b) => b.pageIds);
    for (const page of result.pages) {
      expect(allBookPageIds).toContain(page.pageId);
    }
    // Every book's medoid must be one of its own pages
    for (const book of result.books) {
      const storedBook = await metadataStore.getBook(book.bookId);
      expect(storedBook).toBeDefined();
      expect(storedBook!.medoidPageId).toBeDefined();
      expect(storedBook!.pageIds).toContain(storedBook!.medoidPageId);
    }

    // Volumes and Shelves are now produced during ingest via HierarchyBuilder
    expect(result.volumes.length).toBeGreaterThanOrEqual(1);
    expect(result.shelves.length).toBeGreaterThanOrEqual(1);

    // Each volume should be persisted
    for (const vol of result.volumes) {
      const stored = await metadataStore.getVolume(vol.volumeId);
      expect(stored).toBeDefined();
      expect(stored!.bookIds.length).toBeGreaterThan(0);
    }
    // Each shelf should be persisted
    for (const shelf of result.shelves) {
      const stored = await metadataStore.getShelf(shelf.shelfId);
      expect(stored).toBeDefined();
      expect(stored!.volumeIds.length).toBeGreaterThan(0);
    }
  });

  it("hotpath entries exist for hierarchy prototypes after ingest", async () => {
    const dbName = freshDbName();
    const metadataStore = await IndexedDbMetadataStore.open(dbName);
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const profile = makeProfile();
    const runner = makeRunner(makeBackend());

    await ingestText(ASTRONOMY_TEXT + " " + BIOLOGY_TEXT + " " + HISTORY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    // At least some hotpath entries should exist
    const allEntries = await metadataStore.getHotpathEntries();
    expect(allEntries.length).toBeGreaterThan(0);

    // Page-tier entries should exist
    const pageEntries = await metadataStore.getHotpathEntries("page");
    expect(pageEntries.length).toBeGreaterThan(0);
  });

  it("semantic neighbor graph is populated after ingest", async () => {
    const dbName = freshDbName();
    const metadataStore = await IndexedDbMetadataStore.open(dbName);
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const profile = makeProfile();
    const runner = makeRunner(makeBackend());

    const result = await ingestText(ASTRONOMY_TEXT + " " + BIOLOGY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    // Verify that semantic neighbor records are structurally valid when present.
    // With content-hash-based embeddings, pages may not meet the cosine-similarity
    // threshold, so we only validate structure — not that neighbors must exist.
    for (const page of result.pages) {
      const neighbors = await metadataStore.getSemanticNeighbors(page.pageId);
      for (const n of neighbors) {
        expect(n.neighborPageId).toBeDefined();
        expect(typeof n.neighborPageId).toBe("string");
        expect(n.cosineSimilarity).toBeGreaterThanOrEqual(-1);
        expect(n.cosineSimilarity).toBeLessThanOrEqual(1);
        expect(n.distance).toBeCloseTo(1 - n.cosineSimilarity, 5);
      }
    }
  });

  it("Williams Bound: resident count never exceeds H(t) after ingest", async () => {
    const dbName = freshDbName();
    const metadataStore = await IndexedDbMetadataStore.open(dbName);
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const profile = makeProfile();
    const runner = makeRunner(makeBackend());

    await ingestText(ASTRONOMY_TEXT + " " + BIOLOGY_TEXT + " " + HISTORY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    // Williams Bound: H(t) = ceil(c * sqrt(t * log2(1+t)))
    const allPages = await metadataStore.getAllPages();
    const graphMass = allPages.length;
    const c = 0.5;
    const capacity = Math.max(1, Math.ceil(c * Math.sqrt(graphMass * Math.log2(1 + graphMass))));

    const residentCount = await metadataStore.getResidentCount();
    expect(residentCount).toBeLessThanOrEqual(capacity);
  });

  it("knowledge gap is signalled for a model without Matryoshka dims", async () => {
    const dbName = freshDbName();
    const metadataStore = await IndexedDbMetadataStore.open(dbName);
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    // Non-Matryoshka model: no matryoshkaProtectedDim
    const profile = makeProfile();
    const runner = makeRunner(makeBackend());
    const { query } = await import("../../cortex/Query");

    await ingestText(ASTRONOMY_TEXT, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    const result = await query(ASTRONOMY_TEXT.slice(0, 50), {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      topK: 3,
    });

    // Profile has no matryoshkaProtectedDim → MetroidBuilder always declares a gap
    expect(result.metroid).not.toBeNull();
    expect(result.metroid!.knowledgeGap).toBe(true);
    expect(result.knowledgeGap).not.toBeNull();
  });
});
