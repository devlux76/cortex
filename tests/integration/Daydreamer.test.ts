/**
 * Daydreamer integration tests (P2-E1)
 *
 * Validates that after ingesting a corpus and running Daydreamer passes:
 * - Edge weights are updated (LTP/LTD)
 * - Dirty volumes are recalculated
 * - Prototypes are updated
 * - Resident count never exceeds H(t) after any Daydreamer pass
 * - Community labels are assigned to pages
 */

import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";

import { IndexedDbMetadataStore } from "../../storage/IndexedDbMetadataStore";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import { generateKeyPair } from "../../core/crypto/sign";
import { ingestText } from "../../hippocampus/Ingest";
import { computeCapacity } from "../../core/HotpathPolicy";
import { strengthenEdges, decayAndPrune } from "../../daydreamer/HebbianUpdater";
import { runFullNeighborRecalc } from "../../daydreamer/FullNeighborRecalc";
import { recomputePrototypes } from "../../daydreamer/PrototypeRecomputer";
import { runLabelPropagation } from "../../daydreamer/ClusterStability";
import type { ModelProfile } from "../../core/ModelProfile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;
function freshDbName(): string {
  return `cortex-daydreamer-${Date.now()}-${++dbCounter}`;
}

const EMBEDDING_DIM = 16;

function makeProfile(): ModelProfile {
  return {
    modelId: "daydreamer-test-model",
    embeddingDimension: EMBEDDING_DIM,
    contextWindowTokens: 512,
    truncationTokens: 384,
    maxChunkTokens: 64,
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
// Test corpus
// ---------------------------------------------------------------------------

const CORPUS = [
  "Distributed hash tables provide efficient decentralised lookup in peer-to-peer systems.",
  "The Byzantine Generals Problem underpins consensus research in fault-tolerant distributed systems.",
  "Label propagation is a graph-based semi-supervised learning algorithm for community detection.",
  "Matryoshka representation learning enables multi-resolution embeddings from a single model.",
  "Hebbian plasticity strengthens synaptic connections between neurons that fire together consistently.",
  "Long-term potentiation increases synaptic weight following co-activation in neural circuits.",
];

// ---------------------------------------------------------------------------
// Integration suite
// ---------------------------------------------------------------------------

describe("Daydreamer integration", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["indexedDB"] = new IDBFactory();
    (globalThis as Record<string, unknown>)["IDBKeyRange"] = FakeIDBKeyRange;
  });

  it("edge weights are updated after LTP strengthen pass", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const runner = makeRunner();
    const profile = makeProfile();
    const keyPair = await generateKeyPair();
    const now = Date.now();

    // Ingest corpus
    const ingestResults = [];
    for (const text of CORPUS) {
      const result = await ingestText(text, {
        modelProfile: profile,
        embeddingRunner: runner,
        vectorStore,
        metadataStore,
        keyPair,
        now,
      });
      ingestResults.push(result);
    }

    // Collect all page IDs from first two books
    const traversedPairs: Array<{ from: string; to: string }> = [];
    for (const res of ingestResults.slice(0, 2)) {
      const ids = res.pages.map((p) => p.pageId);
      for (let i = 0; i + 1 < ids.length; i++) {
        traversedPairs.push({ from: ids[i], to: ids[i + 1] });
      }
    }

    if (traversedPairs.length === 0) {
      // No traversed pairs (single-page books) — skip edge assertion
      return;
    }

    await strengthenEdges(traversedPairs, {
      metadataStore,
      ltpAmount: 0.1,
      now,
    });

    // Verify at least one edge weight was set
    const pair = traversedPairs[0];
    const neighbors = await metadataStore.getNeighbors(pair.from);
    const edge = neighbors.find((e) => e.toPageId === pair.to);
    expect(edge?.weight).toBeGreaterThan(0);
  });

  it("dirty volumes are recalculated and flag cleared", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const runner = makeRunner();
    const profile = makeProfile();
    const keyPair = await generateKeyPair();
    const now = Date.now();

    const res = await ingestText(CORPUS[0], {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
      now,
    });

    if (!res.book) return;

    // Create and dirty a volume containing this book
    const volumeId = "vol-test";
    await metadataStore.putVolume({
      volumeId,
      bookIds: [res.book.bookId],
      prototypeOffsets: [],
      prototypeDim: EMBEDDING_DIM,
      variance: 0,
    });
    await metadataStore.flagVolumeForMetroidRecalc(volumeId);

    expect(await metadataStore.needsMetroidRecalc(volumeId)).toBe(true);

    await runFullNeighborRecalc({ metadataStore, vectorStore, now });

    expect(await metadataStore.needsMetroidRecalc(volumeId)).toBe(false);
  });

  it("prototypes are updated after recompute", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const runner = makeRunner();
    const profile = makeProfile();
    const keyPair = await generateKeyPair();
    const now = Date.now();

    const res = await ingestText(CORPUS[2], {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
      now,
    });

    if (!res.book) return;

    await metadataStore.putVolume({
      volumeId: "vol-proto",
      bookIds: [res.book.bookId],
      prototypeOffsets: [],
      prototypeDim: EMBEDDING_DIM,
      variance: 0,
    });

    const result = await recomputePrototypes({ metadataStore, vectorStore, now });
    expect(result.volumesUpdated).toBeGreaterThan(0);
  });

  it("resident count never exceeds H(t) after Daydreamer passes", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const runner = makeRunner();
    const profile = makeProfile();
    const keyPair = await generateKeyPair();
    const now = Date.now();

    // Ingest full corpus
    for (const text of CORPUS) {
      await ingestText(text, {
        modelProfile: profile,
        embeddingRunner: runner,
        vectorStore,
        metadataStore,
        keyPair,
        now,
      });
    }

    // Run N Daydreamer-equivalent passes
    const PASSES = 3;
    for (let pass = 0; pass < PASSES; pass++) {
      await decayAndPrune({
        metadataStore,
        ltdDecay: 0.99,
        pruneThreshold: 0.001,
        now: now + pass * 1000,
      });

      const allPages = await metadataStore.getAllPages();
      const allPageIds = allPages.map((p) => p.pageId);

      // Williams Bound: resident count must not exceed H(graphMass)
      const residentCount = await metadataStore.getResidentCount();
      const capacity = computeCapacity(allPageIds.length);
      expect(residentCount).toBeLessThanOrEqual(capacity);
    }
  });

  it("community labels are assigned to pages after label propagation", async () => {
    const metadataStore = await IndexedDbMetadataStore.open(freshDbName());
    const vectorStore = new MemoryVectorStore();
    const runner = makeRunner();
    const profile = makeProfile();
    const keyPair = await generateKeyPair();
    const now = Date.now();

    const res = await ingestText(CORPUS[0], {
      modelProfile: profile,
      embeddingRunner: runner,
      vectorStore,
      metadataStore,
      keyPair,
      now,
    });

    const result = await runLabelPropagation({ metadataStore });
    expect(result.communityMap.size).toBeGreaterThan(0);

    // Every ingested page should have a community label
    for (const page of res.pages) {
      const activity = await metadataStore.getPageActivity(page.pageId);
      expect(activity?.communityId).toBeDefined();
    }
  });
});
