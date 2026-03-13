import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";

import { ExperienceReplay } from "../../daydreamer/ExperienceReplay";
import { IndexedDbMetadataStore } from "../../storage/IndexedDbMetadataStore";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import { generateKeyPair } from "../../core/crypto/sign";
import { ingestText } from "../../hippocampus/Ingest";
import { topKByScore } from "../../TopK";
import type { BackendKind } from "../../BackendKind";
import type { ModelProfile } from "../../core/ModelProfile";
import type { VectorBackend } from "../../VectorBackend";

// ---------------------------------------------------------------------------
// Minimal vector backend for tests
// ---------------------------------------------------------------------------

class TestVectorBackend implements VectorBackend {
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
      const offset = i * dim;
      for (let j = 0; j < dim; j++) {
        sum += queryVec[j] * matrix[offset + j];
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

  async hammingTopK(): Promise<never> {
    throw new Error("Not implemented");
  }

  async topKFromScores(scores: Float32Array, k: number) {
    return topKByScore(scores, k);
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;
function freshDbName(): string {
  return `cortex-experience-replay-${Date.now()}-${++dbCounter}`;
}

const EMBEDDING_DIM = 16;

function makeProfile(): ModelProfile {
  return {
    modelId: "test-model",
    embeddingDimension: EMBEDDING_DIM,
    contextWindowTokens: 128,
    truncationTokens: 96,
    maxChunkTokens: 40,
    source: "metadata",
  };
}

function makeRunner(): EmbeddingRunner {
  const backend = new DeterministicDummyEmbeddingBackend({ dimension: EMBEDDING_DIM });
  return new EmbeddingRunner(async () => ({
    backend,
    selectedKind: "dummy" as const,
    reason: "forced" as const,
    supportedKinds: ["dummy" as const],
    measurements: [],
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExperienceReplay", () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, unknown>).indexedDB = new IDBFactory();
    (globalThis as unknown as Record<string, unknown>).IDBKeyRange = FakeIDBKeyRange;
  });

  it("returns zero counts when the corpus is empty", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const vectorBackend = new TestVectorBackend();
    const runner = makeRunner();
    const profile = makeProfile();

    const replay = new ExperienceReplay({ queriesPerCycle: 3 });
    const result = await replay.run(
      profile,
      runner,
      vectorStore,
      metadataStore,
      vectorBackend,
    );

    expect(result.queriesExecuted).toBe(0);
    expect(result.edgesStrengthened).toBe(0);
    expect(result.completedAt).toBeTruthy();
  });

  it("executes at most queriesPerCycle queries when corpus is large enough", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const vectorBackend = new TestVectorBackend();
    const runner = makeRunner();
    const profile = makeProfile();
    const keyPair = await generateKeyPair();

    // Ingest enough content to fill the sample pool
    const texts = [
      "The hippocampus encodes episodic memory in the brain.",
      "The cortex handles routing and coherence of information.",
      "Hebbian learning strengthens connections that fire together.",
      "The daydreamer consolidates memories during idle periods.",
      "Vector embeddings capture semantic meaning of text.",
      "WebGPU accelerates matrix multiplication in the browser.",
    ];

    for (const text of texts) {
      await ingestText(text, {
        modelProfile: profile,
        embeddingRunner: runner,
        vectorStore,
        metadataStore,
        keyPair,
      });
    }

    const replay = new ExperienceReplay({ queriesPerCycle: 3, topK: 3 });
    const result = await replay.run(
      profile,
      runner,
      vectorStore,
      metadataStore,
      vectorBackend,
    );

    expect(result.queriesExecuted).toBe(3);
    expect(result.completedAt).toBeTruthy();
  });

  it("executes fewer queries than queriesPerCycle when corpus is smaller", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const vectorBackend = new TestVectorBackend();
    const runner = makeRunner();
    const profile = makeProfile();
    const keyPair = await generateKeyPair();

    // Only ingest 2 pages
    await ingestText("Short text A.", {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });
    await ingestText("Short text B.", {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
    });

    const replay = new ExperienceReplay({ queriesPerCycle: 10, topK: 5 });
    const result = await replay.run(
      profile,
      runner,
      vectorStore,
      metadataStore,
      vectorBackend,
    );

    // Should execute at most 2 queries (one per available page)
    expect(result.queriesExecuted).toBeLessThanOrEqual(2);
    expect(result.queriesExecuted).toBeGreaterThan(0);
  });

  it("strengthens edges between query source and result pages", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const vectorBackend = new TestVectorBackend();
    const runner = makeRunner();
    const profile = makeProfile();
    const keyPair = await generateKeyPair();

    const texts = [
      "Neurons that fire together wire together via Hebbian dynamics.",
      "Synaptic plasticity underpins learning and memory consolidation.",
      "Long-term potentiation strengthens neural pathways.",
    ];

    for (const text of texts) {
      await ingestText(text, {
        modelProfile: profile,
        embeddingRunner: runner,
        vectorStore,
        metadataStore,
        keyPair,
      });
    }

    const replay = new ExperienceReplay({
      queriesPerCycle: 2,
      topK: 2,
      ltpIncrement: 0.25,
    });

    const result = await replay.run(
      profile,
      runner,
      vectorStore,
      metadataStore,
      vectorBackend,
    );

    expect(result.edgesStrengthened).toBeGreaterThan(0);
  });

  it("increments edge weight by ltpIncrement for previously unseen pairs", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const vectorBackend = new TestVectorBackend();
    const runner = makeRunner();
    const profile = makeProfile();
    const keyPair = await generateKeyPair();

    const texts = [
      "Alpha topic covers encoding and retrieval.",
      "Beta topic covers storage and persistence.",
    ];

    for (const text of texts) {
      await ingestText(text, {
        modelProfile: profile,
        embeddingRunner: runner,
        vectorStore,
        metadataStore,
        keyPair,
      });
    }

    const ltpIncrement = 0.2;
    const replay = new ExperienceReplay({
      queriesPerCycle: 2,
      topK: 2,
      ltpIncrement,
    });

    await replay.run(profile, runner, vectorStore, metadataStore, vectorBackend);

    // Edges written should have weight >= ltpIncrement
    const allPages = await metadataStore.getAllPages();
    for (const page of allPages) {
      const neighbors = await metadataStore.getNeighbors(page.pageId);
      for (const edge of neighbors) {
        expect(edge.weight).toBeGreaterThanOrEqual(ltpIncrement);
      }
    }
  });

  it("does not exceed maxEdgeWeight after repeated cycles", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const vectorBackend = new TestVectorBackend();
    const runner = makeRunner();
    const profile = makeProfile();
    const keyPair = await generateKeyPair();

    const texts = [
      "Gamma pattern reinforcement over time.",
      "Delta pattern consolidation mechanism.",
    ];

    for (const text of texts) {
      await ingestText(text, {
        modelProfile: profile,
        embeddingRunner: runner,
        vectorStore,
        metadataStore,
        keyPair,
      });
    }

    const maxEdgeWeight = 0.5;
    const replay = new ExperienceReplay({
      queriesPerCycle: 2,
      topK: 2,
      ltpIncrement: 0.3,
      maxEdgeWeight,
    });

    // Run multiple cycles; edge weights must not exceed the cap
    for (let cycle = 0; cycle < 5; cycle++) {
      await replay.run(profile, runner, vectorStore, metadataStore, vectorBackend);
    }

    const allPages = await metadataStore.getAllPages();
    for (const page of allPages) {
      const neighbors = await metadataStore.getNeighbors(page.pageId);
      for (const edge of neighbors) {
        expect(edge.weight).toBeLessThanOrEqual(maxEdgeWeight + 1e-9);
      }
    }
  });

  it("reports a valid ISO timestamp in completedAt", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const vectorBackend = new TestVectorBackend();
    const runner = makeRunner();
    const profile = makeProfile();

    const replay = new ExperienceReplay();
    const result = await replay.run(
      profile,
      runner,
      vectorStore,
      metadataStore,
      vectorBackend,
    );

    expect(() => new Date(result.completedAt)).not.toThrow();
    expect(Number.isFinite(new Date(result.completedAt).getTime())).toBe(true);
  });
});
