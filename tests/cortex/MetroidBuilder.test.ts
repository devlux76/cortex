import { describe, expect, it } from "vitest";
import { buildMetroid } from "../../cortex/MetroidBuilder";
import { MemoryVectorStore } from "../../storage/MemoryVectorStore";
import type { ModelProfile } from "../../core/ModelProfile";

/**
 * Test profile: 8-dimensional embeddings with a Matryoshka protected floor
 * of 4. This makes the split easy to reason about in tests:
 *   dims 0–3  → protected (copied from m1 into centroid)
 *   dims 4–7  → free      (averaged between m1 and m2)
 */
const TEST_PROFILE: ModelProfile = {
  modelId: "test-matryoshka",
  embeddingDimension: 8,
  contextWindowTokens: 128,
  truncationTokens: 96,
  maxChunkTokens: 16,
  source: "metadata",
  matryoshkaProtectedDim: 4,
};

const NON_MATRYOSHKA_PROFILE: ModelProfile = {
  ...TEST_PROFILE,
  modelId: "test-flat",
  matryoshkaProtectedDim: undefined,
};

/** Stores a Float32Array and returns a candidate descriptor. */
async function storeCand(
  store: MemoryVectorStore,
  id: string,
  values: number[],
) {
  const vec = new Float32Array(values);
  const offset = await store.appendVector(vec);
  return { pageId: id, embeddingOffset: offset, embeddingDim: values.length };
}

describe("buildMetroid", () => {
  it("returns knowledgeGap=true when no candidates are given", async () => {
    const store = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);
    const result = await buildMetroid(query, [], {
      modelProfile: TEST_PROFILE,
      vectorStore: store,
    });
    expect(result.knowledgeGap).toBe(true);
    expect(result.m1).toBe("");
    expect(result.m2).toBeNull();
    expect(result.c).toBeNull();
  });

  it("returns knowledgeGap=true for a non-Matryoshka model", async () => {
    const store = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);
    const cand = await storeCand(store, "p1", [1, 0, 0, 0, 0, 0, 0, 0]);
    const result = await buildMetroid(query, [cand], {
      modelProfile: NON_MATRYOSHKA_PROFILE,
      vectorStore: store,
    });
    expect(result.knowledgeGap).toBe(true);
    expect(result.m1).toBe("p1");
    expect(result.m2).toBeNull();
    expect(result.c).toBeNull();
  });

  it("selects the candidate with highest cosine similarity to the query as m1", async () => {
    const store = new MemoryVectorStore();
    // query points in direction [1,0,0,0,…]
    const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

    // p1: very similar to query
    const c1 = await storeCand(store, "p1", [0.9, 0.1, 0, 0, 0, 0, 0, 0]);
    // p2: opposite in first dim
    const c2 = await storeCand(store, "p2", [-1, 0, 0, 0, 1, 0, 0, 0]);

    const result = await buildMetroid(query, [c1, c2], {
      modelProfile: TEST_PROFILE,
      vectorStore: store,
    });
    expect(result.m1).toBe("p1");
  });

  it("selects m2 as the medoid of the cosine-opposite set in free dims", async () => {
    const store = new MemoryVectorStore();
    // query is along [1,0,0,0, …]
    const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

    // m1 candidate: closest to query; free dims = [1,0,0,0]
    const c1 = await storeCand(store, "m1", [1, 0, 0, 0, 1, 0, 0, 0]);
    // c2: free dims opposite to m1 free dims [-1,0,0,0] → score = -cos([-1,0,0,0],[1,0,0,0]) = -(-1) = 1
    const c2 = await storeCand(store, "m2", [0, 1, 0, 0, -1, 0, 0, 0]);
    // c3: free dims neutral [0,1,0,0] → score = 0
    const c3 = await storeCand(store, "m3", [0, 0, 1, 0, 0, 1, 0, 0]);

    const result = await buildMetroid(query, [c1, c2, c3], {
      modelProfile: TEST_PROFILE,
      vectorStore: store,
    });
    expect(result.m1).toBe("m1");
    expect(result.m2).not.toBeNull();
    expect(result.knowledgeGap).toBe(false);
  });

  it("computes centroid: protected dims copied from m1, free dims averaged", async () => {
    const store = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

    // m1: [1,2,3,4 | 1,0,0,0]  — protected=[1,2,3,4], free=[1,0,0,0]
    const c1 = await storeCand(store, "m1", [1, 2, 3, 4, 1, 0, 0, 0]);
    // m2 candidate with opposite free dims: free=[-1,0,0,0]
    const c2 = await storeCand(store, "m2", [0, 0, 0, 0, -1, 0, 0, 0]);

    const result = await buildMetroid(query, [c1, c2], {
      modelProfile: TEST_PROFILE,
      vectorStore: store,
    });

    expect(result.c).not.toBeNull();
    const c = result.c!;

    // Protected dims (0–3) must equal m1's protected dims.
    expect(c[0]).toBeCloseTo(1);
    expect(c[1]).toBeCloseTo(2);
    expect(c[2]).toBeCloseTo(3);
    expect(c[3]).toBeCloseTo(4);

    // Free dims (4–7) must be averaged between m1 and m2.
    // m1 free=[1,0,0,0], m2 free=[-1,0,0,0] → centroid free=[0,0,0,0]
    expect(c[4]).toBeCloseTo(0);
    expect(c[5]).toBeCloseTo(0);
    expect(c[6]).toBeCloseTo(0);
    expect(c[7]).toBeCloseTo(0);
  });

  it("centroid c is frozen: multiple calls with same inputs produce the same c", async () => {
    const store = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

    const c1 = await storeCand(store, "m1", [1, 2, 3, 4, 1, 0, 0, 0]);
    const c2 = await storeCand(store, "m2", [0, 0, 0, 0, -1, 0, 0, 0]);

    const r1 = await buildMetroid(query, [c1, c2], {
      modelProfile: TEST_PROFILE,
      vectorStore: store,
    });
    const r2 = await buildMetroid(query, [c1, c2], {
      modelProfile: TEST_PROFILE,
      vectorStore: store,
    });

    expect(r1.c).not.toBeNull();
    expect(r2.c).not.toBeNull();
    expect(Array.from(r1.c!)).toEqual(Array.from(r2.c!));
  });

  it("returns knowledgeGap=true when no valid m2 can be found", async () => {
    const store = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

    // Only one candidate → m1 is chosen and no others remain for m2.
    const c1 = await storeCand(store, "only", [1, 0, 0, 0, 1, 0, 0, 0]);

    const result = await buildMetroid(query, [c1], {
      modelProfile: TEST_PROFILE,
      vectorStore: store,
    });
    expect(result.m1).toBe("only");
    expect(result.knowledgeGap).toBe(true);
    expect(result.m2).toBeNull();
  });

  it("protected dims are not searched for antithesis", async () => {
    const store = new MemoryVectorStore();
    // query along protected dim only
    const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

    // m1 is clearly best in cosine sim to query
    const c1 = await storeCand(store, "m1", [1, 0, 0, 0, 1, 0, 0, 0]);
    // Candidate only differs in protected dims (should NOT influence m2 selection)
    const c2 = await storeCand(store, "c2", [-1, 0, 0, 0, -1, 0, 0, 0]);

    const result = await buildMetroid(query, [c1, c2], {
      modelProfile: TEST_PROFILE,
      vectorStore: store,
    });
    // m1 should be found
    expect(result.m1).toBe("m1");
    // c2 has opposite free dims to m1 → it qualifies as m2
    expect(result.m2).toBe("c2");
    // c is not null — gap resolved
    expect(result.knowledgeGap).toBe(false);
  });

  it("is deterministic: same inputs always produce the same Metroid", async () => {
    const store = new MemoryVectorStore();
    const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

    const c1 = await storeCand(store, "p1", [1, 0, 0, 0, 1, 0, 0, 0]);
    const c2 = await storeCand(store, "p2", [0, 1, 0, 0, -1, 0, 0, 0]);
    const c3 = await storeCand(store, "p3", [0, 0, 1, 0, 0, -1, 0, 0]);

    const r1 = await buildMetroid(query, [c1, c2, c3], {
      modelProfile: TEST_PROFILE,
      vectorStore: store,
    });
    const r2 = await buildMetroid(query, [c1, c2, c3], {
      modelProfile: TEST_PROFILE,
      vectorStore: store,
    });

    expect(r1.m1).toBe(r2.m1);
    expect(r1.m2).toBe(r2.m2);
    expect(r1.knowledgeGap).toBe(r2.knowledgeGap);
    if (r1.c && r2.c) {
      expect(Array.from(r1.c)).toEqual(Array.from(r2.c));
    }
  });
});
