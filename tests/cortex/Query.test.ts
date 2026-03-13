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
import type { ModelProfile } from "../../core/ModelProfile";
import type { VectorBackend } from "../../VectorBackend";

class TestVectorBackend implements VectorBackend {
  readonly kind = "test" as const;

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

describe("cortex query (minimal)", () => {
  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory();
    (globalThis as any).IDBKeyRange = FakeIDBKeyRange;
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
  });
});
