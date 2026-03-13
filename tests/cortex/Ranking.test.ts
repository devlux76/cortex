import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";

import { IndexedDbMetadataStore } from "../../storage/IndexedDbMetadataStore";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import { generateKeyPair } from "../../core/crypto/sign";
import { ingestText } from "../../hippocampus/Ingest";
import {
  rankBooks,
  rankPages,
  rankShelves,
  rankVolumes,
  spillToWarm,
} from "../../cortex/Ranking";
import type { ModelProfile } from "../../core/ModelProfile";

let dbCounter = 0;
function freshDbName(): string {
  return `ranking-test-${Date.now()}-${++dbCounter}`;
}

const PROFILE: ModelProfile = {
  modelId: "test-model",
  embeddingDimension: 4,
  contextWindowTokens: 64,
  truncationTokens: 48,
  maxChunkTokens: 5,
  source: "metadata",
};

function makeRunner(dim = 4) {
  const backend = new DeterministicDummyEmbeddingBackend({ dimension: dim });
  return new EmbeddingRunner(async () => ({
    backend,
    selectedKind: "dummy" as const,
    reason: "forced" as const,
    supportedKinds: ["dummy" as const],
    measurements: [],
  }));
}

describe("Ranking", () => {
  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory();
    (globalThis as any).IDBKeyRange = FakeIDBKeyRange;
  });

  it("rankPages: empty input returns empty array", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0]);

    const results = await rankPages(query, [], 10, { vectorStore, metadataStore });
    expect(results).toHaveLength(0);
  });

  it("rankShelves: empty input returns empty array", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0]);

    const results = await rankShelves(query, [], 10, { vectorStore, metadataStore });
    expect(results).toHaveLength(0);
  });

  it("rankVolumes: empty input returns empty array", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0]);

    const results = await rankVolumes(query, [], 10, { vectorStore, metadataStore });
    expect(results).toHaveLength(0);
  });

  it("rankBooks: empty input returns empty array", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0]);

    const results = await rankBooks(query, [], 10, { vectorStore, metadataStore });
    expect(results).toHaveLength(0);
  });

  it("rankPages: resident pages are scored and sorted by descending score", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const runner = makeRunner();

    const text = "Alpha beta gamma delta epsilon zeta.";
    const ingestResult = await ingestText(text, {
      modelProfile: PROFILE,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    expect(ingestResult.pages.length).toBeGreaterThanOrEqual(1);

    const pageIds = ingestResult.pages.map((p) => p.pageId);

    // Use the embedding of the first page as the query — it should rank highest.
    const firstPage = ingestResult.pages[0];
    const queryVec = await vectorStore.readVector(firstPage.embeddingOffset, firstPage.embeddingDim);

    const results = await rankPages(queryVec, pageIds, pageIds.length, { vectorStore, metadataStore });

    expect(results.length).toBe(pageIds.length);
    // Scores must be in non-increasing order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
    // The first page should be the top result (cosine similarity with itself == 1)
    expect(results[0].id).toBe(firstPage.pageId);
    expect(results[0].score).toBeCloseTo(1.0, 4);
  });

  it("rankVolumes: resident volumes are scored correctly", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const runner = makeRunner();

    // Ingest enough text to build a hierarchy including volumes
    const text = "One two three four five six seven eight nine ten eleven twelve.";
    const ingestResult = await ingestText(text, {
      modelProfile: PROFILE,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    const volumeIds = (ingestResult.volumes ?? []).map((v) => v.volumeId);
    if (volumeIds.length === 0) {
      // No volumes built — skip the scoring assertions; the structure test still passes
      return;
    }

    const query = new Float32Array(PROFILE.embeddingDimension).fill(0);
    query[0] = 1;

    const results = await rankVolumes(query, volumeIds, volumeIds.length, {
      vectorStore,
      metadataStore,
    });

    expect(results.length).toBe(volumeIds.length);
    // Scores must be in non-increasing order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
    // All result IDs should be from the provided set
    for (const r of results) {
      expect(volumeIds).toContain(r.id);
    }
  });

  it("rankBooks: resident books are scored correctly", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const runner = makeRunner();

    const text = "Red orange yellow green blue indigo violet purple pink.";
    const ingestResult = await ingestText(text, {
      modelProfile: PROFILE,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    if (!ingestResult.book) {
      // No book built — skip
      return;
    }

    const bookIds = [ingestResult.book.bookId];
    const medoidPage = await metadataStore.getPage(ingestResult.book.medoidPageId);
    expect(medoidPage).toBeDefined();

    // Query using the medoid page embedding — that book should score highest
    const queryVec = await vectorStore.readVector(medoidPage!.embeddingOffset, medoidPage!.embeddingDim);

    const results = await rankBooks(queryVec, bookIds, bookIds.length, {
      vectorStore,
      metadataStore,
    });

    expect(results.length).toBe(1);
    expect(results[0].id).toBe(ingestResult.book.bookId);
    expect(results[0].score).toBeCloseTo(1.0, 4);
  });

  it("rankShelves: resident shelves are scored correctly", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const runner = makeRunner();

    const text = "Dog cat bird fish horse cow sheep goat rabbit deer.";
    const ingestResult = await ingestText(text, {
      modelProfile: PROFILE,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    const shelfIds = (ingestResult.shelves ?? []).map((s) => s.shelfId);
    if (shelfIds.length === 0) {
      return;
    }

    const query = new Float32Array(PROFILE.embeddingDimension).fill(0);
    query[0] = 1;

    const results = await rankShelves(query, shelfIds, shelfIds.length, {
      vectorStore,
      metadataStore,
    });

    expect(results.length).toBe(shelfIds.length);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
    for (const r of results) {
      expect(shelfIds).toContain(r.id);
    }
  });

  it("spillToWarm('page') returns all pages scored and sorted", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const runner = makeRunner();

    const text = "Sun moon star sky cloud rain snow fog wind hail.";
    const ingestResult = await ingestText(text, {
      modelProfile: PROFILE,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    expect(ingestResult.pages.length).toBeGreaterThanOrEqual(1);

    const firstPage = ingestResult.pages[0];
    const queryVec = await vectorStore.readVector(firstPage.embeddingOffset, firstPage.embeddingDim);

    const results = await spillToWarm("page", queryVec, 100, { vectorStore, metadataStore });

    expect(results.length).toBe(ingestResult.pages.length);
    // Scores descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
    // First page scores ~1.0 (self-similarity)
    expect(results[0].id).toBe(firstPage.pageId);
    expect(results[0].score).toBeCloseTo(1.0, 4);
  });

  it("spillToWarm non-page tiers return empty array", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0]);

    for (const tier of ["shelf", "volume", "book"] as const) {
      const results = await spillToWarm(tier, query, 10, { vectorStore, metadataStore });
      expect(results).toHaveLength(0);
    }
  });

  it("spillToWarm('page') on empty corpus returns empty array", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0]);

    const results = await spillToWarm("page", query, 10, { vectorStore, metadataStore });
    expect(results).toHaveLength(0);
  });

  it("rankPages: topK limits the number of results", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();
    const runner = makeRunner();

    const text = "Alpha beta gamma delta epsilon zeta eta theta.";
    const ingestResult = await ingestText(text, {
      modelProfile: PROFILE,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    expect(ingestResult.pages.length).toBeGreaterThanOrEqual(2);

    const pageIds = ingestResult.pages.map((p) => p.pageId);
    const query = new Float32Array(PROFILE.embeddingDimension).fill(0);
    query[0] = 1;

    const results = await rankPages(query, pageIds, 1, { vectorStore, metadataStore });
    expect(results).toHaveLength(1);
  });
});
