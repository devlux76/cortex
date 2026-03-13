import { describe, expect, it, beforeEach } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";

import { IndexedDbMetadataStore } from "../../storage/IndexedDbMetadataStore";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import { generateKeyPair } from "../../core/crypto/sign";
import { ingestText } from "../../hippocampus/Ingest";
import type { ModelProfile } from "../../core/ModelProfile";

let dbCounter = 0;
function freshDbName(): string {
  return `cortex-ingest-test-${Date.now()}-${++dbCounter}`;
}

describe("hippocampus ingest", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["indexedDB"] = new IDBFactory();
    (globalThis as Record<string, unknown>)["IDBKeyRange"] = FakeIDBKeyRange;
  });

  it("persists pages, metadata, and book records", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();

    const backend = new DeterministicDummyEmbeddingBackend({ dimension: 4 });
    const runner = new EmbeddingRunner(async () => ({
      backend,
      selectedKind: "dummy" as const,
      reason: "forced" as const,
      supportedKinds: ["dummy" as const],
      measurements: [],
    }));

    const profile: ModelProfile = {
      modelId: "test-model",
      embeddingDimension: 4,
      contextWindowTokens: 64,
      truncationTokens: 48,
      maxChunkTokens: 5,
      source: "metadata",
    };

    const text = "One two three four five six seven eight nine ten.";

    const result = await ingestText(text, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    expect(result.pages.length).toBeGreaterThanOrEqual(2);

    // Stored page should match returned page
    const stored = await metadataStore.getPage(result.pages[0].pageId);
    expect(stored).toEqual(result.pages[0]);

    // Activity record should be initialized
    const activity = await metadataStore.getPageActivity(result.pages[0].pageId);
    expect(activity).toEqual({
      pageId: result.pages[0].pageId,
      queryHitCount: 0,
      lastQueryAt: result.pages[0].createdAt,
    });

    // Book should contain the pages
    const storedBook = await metadataStore.getBook(result.book!.bookId);
    expect(storedBook).toEqual(result.book);

    // Vector store should have data stored for each page
    expect(vectorStore.byteLength).toBeGreaterThan(0);
  });
});
