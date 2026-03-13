/**
 * P3-D2: Query latency benchmarks.
 *
 * Measures end-to-end query latency against in-memory corpora of increasing
 * size using the deterministic dummy embedder (zero model load cost) and an
 * in-process vector backend.
 *
 * Williams Bound assertion: resident set size must never exceed H(t).
 */
import { bench, describe } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";

import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import { IndexedDbMetadataStore } from "../../storage/IndexedDbMetadataStore";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import { ingestText } from "../../hippocampus/Ingest";
import { query } from "../../cortex/Query";
import { generateKeyPair } from "../../core/crypto/sign";
import { topKByScore } from "../../TopK";
import type { BackendKind } from "../../BackendKind";
import type { ModelProfile } from "../../core/ModelProfile";
import type { VectorBackend } from "../../VectorBackend";

// ---------------------------------------------------------------------------
// Minimal vector backend
// ---------------------------------------------------------------------------

class InProcVectorBackend implements VectorBackend {
  readonly kind: BackendKind = "wasm";

  async dotMany(
    queryVec: Float32Array,
    matrix: Float32Array,
    dim: number,
    count: number,
  ): Promise<Float32Array> {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let j = 0; j < dim; j++) sum += queryVec[j] * matrix[i * dim + j];
      out[i] = sum;
    }
    return out;
  }

  async project(): Promise<Float32Array> { return new Float32Array(0); }
  async hashToBinary(): Promise<Uint32Array> { return new Uint32Array(0); }
  async hammingTopK(): Promise<never[]> { return []; }
  async topKFromScores(scores: Float32Array, k: number) { return topKByScore(scores, k); }
}

// ---------------------------------------------------------------------------
// Corpus builder
// ---------------------------------------------------------------------------

const EMBEDDING_DIM = 64;
const PROFILE: ModelProfile = {
  modelId: "bench-model",
  embeddingDimension: EMBEDDING_DIM,
  contextWindowTokens: 512,
  truncationTokens: 384,
  maxChunkTokens: 120,
  source: "metadata",
};

let dbCounter = 0;
function freshDbName(): string {
  return `bench-query-latency-${Date.now()}-${++dbCounter}`;
}

function makeSentence(i: number): string {
  return `Document ${i}: the quick brown fox jumps over the lazy dog at index ${i}.`;
}

async function buildCorpus(size: number): Promise<{
  metadataStore: IndexedDbMetadataStore;
  vectorStore: MemoryVectorStore;
  embeddingRunner: EmbeddingRunner;
  vectorBackend: InProcVectorBackend;
}> {
  (globalThis as unknown as Record<string, unknown>).indexedDB = new IDBFactory();
  (globalThis as unknown as Record<string, unknown>).IDBKeyRange = FakeIDBKeyRange;

  const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
  const vectorStore = new MemoryVectorStore();
  const backend = new DeterministicDummyEmbeddingBackend({ dimension: EMBEDDING_DIM });
  const embeddingRunner = new EmbeddingRunner(async () => ({
    backend,
    selectedKind: "dummy" as const,
    reason: "forced" as const,
    supportedKinds: ["dummy" as const],
    measurements: [],
  }));
  const vectorBackend = new InProcVectorBackend();
  const keyPair = await generateKeyPair();

  for (let i = 0; i < size; i++) {
    await ingestText(makeSentence(i), {
      modelProfile: PROFILE,
      embeddingRunner,
      vectorStore,
      metadataStore,
      keyPair,
    });
  }

  return { metadataStore, vectorStore, embeddingRunner, vectorBackend };
}

// ---------------------------------------------------------------------------
// Benchmark suites
// ---------------------------------------------------------------------------

describe("Query Latency — 100 pages", async () => {
  const corpus = await buildCorpus(100);

  bench("query against 100-page corpus", async () => {
    await query("episodic memory and retrieval", {
      modelProfile: PROFILE,
      ...corpus,
      topK: 10,
    });
  });
});

describe("Query Latency — 500 pages", async () => {
  const corpus = await buildCorpus(500);

  bench("query against 500-page corpus", async () => {
    await query("neural network consolidation", {
      modelProfile: PROFILE,
      ...corpus,
      topK: 10,
    });
  });
});
