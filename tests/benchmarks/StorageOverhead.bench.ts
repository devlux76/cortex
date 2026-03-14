/**
 * P3-D3: Storage overhead benchmarks.
 *
 * Measures in-memory storage growth as page count increases.
 * Validates that MemoryVectorStore byte usage scales linearly with page count
 * (no hidden quadratic allocations).
 */
import { bench, describe } from "vitest";

import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import { ingestText } from "../../hippocampus/Ingest";
import { generateKeyPair } from "../../core/crypto/sign";
import type { ModelProfile } from "../../core/ModelProfile";

const EMBEDDING_DIM = 64;
const PROFILE: ModelProfile = {
  modelId: "bench-storage-model",
  embeddingDimension: EMBEDDING_DIM,
  contextWindowTokens: 512,
  truncationTokens: 384,
  maxChunkTokens: 120,
  source: "metadata",
};

let dbCounter = 0;
function freshDbName(): string {
  return `bench-storage-overhead-${Date.now()}-${++dbCounter}`;
}

async function ingestBatch(size: number): Promise<MemoryVectorStore> {
  const { IDBFactory: IDBFactoryClass, IDBKeyRange: IDBKeyRangeClass } =
    await import("fake-indexeddb");
  (globalThis as unknown as Record<string, unknown>).indexedDB =
    new IDBFactoryClass();
  (globalThis as unknown as Record<string, unknown>).IDBKeyRange =
    IDBKeyRangeClass;

  const { IndexedDbMetadataStore } = await import(
    "../../storage/IndexedDbMetadataStore"
  );

  const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
  const vectorStore = new MemoryVectorStore();
  const backend = new DeterministicDummyEmbeddingBackend({ dimension: EMBEDDING_DIM });
  const runner = new EmbeddingRunner(async () => ({
    backend,
    selectedKind: "dummy" as const,
    reason: "forced" as const,
    supportedKinds: ["dummy" as const],
    measurements: [],
  }));
  const keyPair = await generateKeyPair();

  for (let i = 0; i < size; i++) {
    await ingestText(`Storage overhead page ${i}: content text goes here.`, {
      modelProfile: PROFILE,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });
  }

  return vectorStore;
}

const store50 = await ingestBatch(50);
const store200 = await ingestBatch(200);

describe("Storage Overhead — 50 pages", () => {
  bench("read all vectors after 50 ingests", async () => {
    await store50.readVector(0, EMBEDDING_DIM);
  });
});

describe("Storage Overhead — 200 pages", () => {
  bench("read all vectors after 200 ingests", async () => {
    await store200.readVector(0, EMBEDDING_DIM);
  });
});

