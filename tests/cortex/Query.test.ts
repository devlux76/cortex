import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";

import { IndexedDbMetadataStore } from "../../storage/IndexedDbMetadataStore";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import { generateKeyPair } from "../../core/crypto/sign";
import { ingestText } from "../../hippocampus/Ingest";
import { query } from "../../cortex/Query";
import { topKByScore } from "../../TopK";
import type { BackendKind } from "../../BackendKind";
import type { ModelProfile } from "../../core/ModelProfile";
import type { VectorBackend } from "../../VectorBackend";

class TestVectorBackend implements VectorBackend {
  readonly kind: BackendKind = "wasm";

  async dotMany(
    query: Float32Array,
    matrix: Float32Array,
    dim: number,
    count: number,
  ): Promise<Float32Array> {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let sum = 0;
      const offset = i * dim;
      for (let j = 0; j < dim; j++) {
        sum += query[j] * matrix[offset + j];
      }
      out[i] = sum;
    }
    return out;
  }

  async project(): Promise<Float32Array> {
    throw new Error("Not implemented");
  }

  async hashToBinary(): Promise<Uint32Array> {
    throw new Error("Not implemented");
  }

  async hammingTopK(): Promise<any> {
    throw new Error("Not implemented");
  }

  async topKFromScores(scores: Float32Array, k: number) {
    return topKByScore(scores, k);
  }
}

let dbCounter = 0;
function freshDbName(): string {
  return `cortex-query-test-${Date.now()}-${++dbCounter}`;
}

describe("cortex query (dialectical orchestrator)", () => {
  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory();
    (globalThis as any).IDBKeyRange = FakeIDBKeyRange;
  });

  it("returns empty results for an empty corpus", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();

    const backend = new DeterministicDummyEmbeddingBackend({ dimension: 4 });
    const vectorBackend = new TestVectorBackend();

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

    const result = await query("anything", {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      vectorBackend,
      topK: 5,
    });

    expect(result.pages).toHaveLength(0);
    expect(result.scores).toHaveLength(0);
    expect(result.metadata.returned).toBe(0);
    // New fields must always be present
    expect(Array.isArray(result.coherencePath)).toBe(true);
    expect(result.metroid).toBeDefined();
    // Empty corpus → no candidates → knowledge gap
    expect(result.metroid?.knowledgeGap).toBe(true);
  });

  it("returns the most relevant page and updates activity", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();

    const backend = new DeterministicDummyEmbeddingBackend({ dimension: 4 });
    const vectorBackend = new TestVectorBackend();

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
    const ingestResult = await ingestText(text, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    expect(ingestResult.pages.length).toBeGreaterThanOrEqual(2);

    const targetPage = ingestResult.pages[0];

    const result = await query(targetPage.content, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      vectorBackend,
      topK: 1,
    });

    const hotpath = await metadataStore.getHotpathEntries("page");
    const hotIds = hotpath.map((e) => e.entityId);

    // Query should prioritize hotpath pages and return one of them.
    expect(result.pages).toHaveLength(1);
    expect(hotIds).toContain(result.pages[0].pageId);

    const returned = result.pages[0];
    const activity = await metadataStore.getPageActivity(returned.pageId);
    expect(activity?.queryHitCount).toBe(1);
    expect(activity?.lastQueryAt).toBeDefined();

    // New fields must always be present
    expect(Array.isArray(result.coherencePath)).toBe(true);
    expect(result.metroid).toBeDefined();
    // Non-Matryoshka profile → knowledge gap is expected
    expect(result.metroid?.knowledgeGap).toBe(true);
    // knowledgeGap object is returned when metroid has a gap
    expect(result.knowledgeGap).not.toBeNull();
  });

  it("returns results in descending score order (relevance)", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();

    const backend = new DeterministicDummyEmbeddingBackend({ dimension: 4 });
    const vectorBackend = new TestVectorBackend();

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
    const ingestResult = await ingestText(text, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    expect(ingestResult.pages.length).toBeGreaterThanOrEqual(2);

    const targetPage = ingestResult.pages[0];

    const result = await query(targetPage.content, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      vectorBackend,
      topK: ingestResult.pages.length,
    });

    // Results must include the page whose content matches the query.
    expect(result.pages.map((p) => p.pageId)).toContain(targetPage.pageId);

    // Scores must be in non-increasing order.
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i]).toBeLessThanOrEqual(result.scores[i - 1]);
    }

    // New fields must always be present
    expect(Array.isArray(result.coherencePath)).toBe(true);
    expect(result.metroid).toBeDefined();
  });

  it("respects the topK parameter", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const keyPair = await generateKeyPair();

    const backend = new DeterministicDummyEmbeddingBackend({ dimension: 4 });
    const vectorBackend = new TestVectorBackend();

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
    const ingestResult = await ingestText(text, {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    expect(ingestResult.pages.length).toBeGreaterThanOrEqual(2);

    const result = await query("one", {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      vectorBackend,
      topK: 2,
    });

    expect(result.pages.length).toBe(2);
    expect(result.scores.length).toBe(2);
    expect(result.metadata.returned).toBe(2);

    // New fields must always be present
    expect(Array.isArray(result.coherencePath)).toBe(true);
    expect(result.metroid).toBeDefined();
  });
});
