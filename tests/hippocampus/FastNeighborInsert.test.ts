import { describe, expect, it, beforeEach } from "vitest";
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";

import { IndexedDbMetadataStore } from "../../storage/IndexedDbMetadataStore";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import { generateKeyPair } from "../../core/crypto/sign";
import { ingestText } from "../../hippocampus/Ingest";
import { insertSemanticNeighbors } from "../../hippocampus/FastNeighborInsert";
import type { ModelProfile } from "../../core/ModelProfile";

let dbCounter = 0;
function freshDbName(): string {
  return `cortex-neighbor-test-${Date.now()}-${++dbCounter}`;
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

describe("FastNeighborInsert", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["indexedDB"] = new IDBFactory();
    (globalThis as Record<string, unknown>)["IDBKeyRange"] = FakeIDBKeyRange;
  });

  it("does not create Hebbian (edges_hebbian) entries", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(4);

    await insertSemanticNeighbors(pageIds, pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
    });

    // getNeighbors returns Hebbian edges; they should remain empty.
    for (const id of pageIds) {
      const hebbianEdges = await metadataStore.getNeighbors(id);
      expect(hebbianEdges).toHaveLength(0);
    }
  });

  it("neighbor lists are bounded by maxDegree", async () => {
    const maxDegree = 2;
    const { metadataStore, vectorStore, pageIds } = await makeFixture(8);

    await insertSemanticNeighbors(pageIds, pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
      maxDegree,
      cutoffDistance: 1.0, // accept everything
    });

    for (const id of pageIds) {
      const neighbors = await metadataStore.getSemanticNeighbors(id);
      expect(neighbors.length).toBeLessThanOrEqual(maxDegree);
    }
  });

  it("neighbor lists are sorted by cosineSimilarity descending", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(4);

    await insertSemanticNeighbors(pageIds, pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
      cutoffDistance: 1.0,
    });

    for (const id of pageIds) {
      const neighbors = await metadataStore.getSemanticNeighbors(id);
      for (let i = 1; i < neighbors.length; i++) {
        expect(neighbors[i - 1].cosineSimilarity).toBeGreaterThanOrEqual(
          neighbors[i].cosineSimilarity,
        );
      }
    }
  });

  it("reverse edges are created: if A has B as neighbor, B has A as neighbor", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(4);

    await insertSemanticNeighbors(pageIds, pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
      cutoffDistance: 1.0,
    });

    for (const pageA of pageIds) {
      const aNeighbors = await metadataStore.getSemanticNeighbors(pageA);
      for (const n of aNeighbors) {
        const bNeighbors = await metadataStore.getSemanticNeighbors(n.neighborPageId);
        const bHasA = bNeighbors.some((bn) => bn.neighborPageId === pageA);
        expect(bHasA).toBe(true);
      }
    }
  });

  it("evicts lowest-similarity neighbor when maxDegree is exceeded on reverse insert", async () => {
    const maxDegree = 1;
    const { metadataStore, vectorStore, pageIds } = await makeFixture(4);

    await insertSemanticNeighbors(pageIds, pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
      maxDegree,
      cutoffDistance: 1.0,
    });

    // With maxDegree=1, each page should have at most 1 neighbor.
    for (const id of pageIds) {
      const neighbors = await metadataStore.getSemanticNeighbors(id);
      expect(neighbors.length).toBeLessThanOrEqual(maxDegree);
    }
  });

  it("calls runPromotionSweep: new pages are considered for hotpath admission", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(4);

    // Clear any existing hotpath entries so we start clean.
    const existingEntries = await metadataStore.getHotpathEntries();
    for (const e of existingEntries) {
      await metadataStore.removeHotpathEntry(e.entityId);
    }

    // Insert only a subset as "new" pages.
    const newIds = pageIds.slice(0, 2);
    await insertSemanticNeighbors(newIds, pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
      cutoffDistance: 1.0,
    });

    const entries = await metadataStore.getHotpathEntries();
    const admittedIds = new Set(entries.map((e) => e.entityId));

    // At least one of the new pages should have been considered (admitted if capacity allows).
    const anyAdmitted = newIds.some((id) => admittedIds.has(id));
    expect(anyAdmitted).toBe(true);
  });

  it("pages with distance above cutoff are not connected", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(4);

    // Use a cutoff of 0 so nothing qualifies.
    await insertSemanticNeighbors(pageIds, pageIds, {
      modelProfile: PROFILE,
      vectorStore,
      metadataStore,
      cutoffDistance: 0,
    });

    for (const id of pageIds) {
      const neighbors = await metadataStore.getSemanticNeighbors(id);
      expect(neighbors).toHaveLength(0);
    }
  });

  it("handles empty newPageIds gracefully", async () => {
    const { metadataStore, vectorStore, pageIds } = await makeFixture(4);

    await expect(
      insertSemanticNeighbors([], pageIds, {
        modelProfile: PROFILE,
        vectorStore,
        metadataStore,
      }),
    ).resolves.toBeUndefined();
  });
});
