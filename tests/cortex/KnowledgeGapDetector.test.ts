import { describe, expect, it } from "vitest";
import {
  detectKnowledgeGap,
  buildCuriosityProbe,
} from "../../cortex/KnowledgeGapDetector";
import type { Metroid } from "../../cortex/MetroidBuilder";
import type { ModelProfile } from "../../core/ModelProfile";

const TEST_PROFILE: ModelProfile = {
  modelId: "test-model-x",
  embeddingDimension: 8,
  contextWindowTokens: 128,
  truncationTokens: 96,
  maxChunkTokens: 16,
  source: "metadata",
  matryoshkaProtectedDim: 4,
};

const QUERY_EMBEDDING = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

function metroidWithGap(m1 = "page-abc"): Metroid {
  return { m1, m2: null, c: null, knowledgeGap: true };
}

function metroidWithoutGap(): Metroid {
  return {
    m1: "page-abc",
    m2: "page-xyz",
    c: new Float32Array(8).fill(0.5),
    knowledgeGap: false,
  };
}

describe("detectKnowledgeGap", () => {
  it("returns null when metroid has a valid m2 (no gap)", async () => {
    const result = await detectKnowledgeGap(
      "what is gravity?",
      QUERY_EMBEDDING,
      metroidWithoutGap(),
      TEST_PROFILE,
    );
    expect(result).toBeNull();
  });

  it("returns a KnowledgeGap when metroid.knowledgeGap is true", async () => {
    const result = await detectKnowledgeGap(
      "what is dark matter?",
      QUERY_EMBEDDING,
      metroidWithGap("page-abc"),
      TEST_PROFILE,
    );
    expect(result).not.toBeNull();
  });

  it("KnowledgeGap contains the correct queryText", async () => {
    const text = "what is dark matter?";
    const result = await detectKnowledgeGap(
      text,
      QUERY_EMBEDDING,
      metroidWithGap(),
      TEST_PROFILE,
    );
    expect(result?.queryText).toBe(text);
  });

  it("KnowledgeGap uses m1 as knowledgeBoundary", async () => {
    const result = await detectKnowledgeGap(
      "anything",
      QUERY_EMBEDDING,
      metroidWithGap("my-page-id"),
      TEST_PROFILE,
    );
    expect(result?.knowledgeBoundary).toBe("my-page-id");
  });

  it("KnowledgeGap has knowledgeBoundary null when m1 is empty string", async () => {
    const result = await detectKnowledgeGap(
      "anything",
      QUERY_EMBEDDING,
      metroidWithGap(""),
      TEST_PROFILE,
    );
    expect(result?.knowledgeBoundary).toBeNull();
  });

  it("KnowledgeGap includes detectedAt as an ISO timestamp", async () => {
    const before = new Date().toISOString();
    const result = await detectKnowledgeGap(
      "anything",
      QUERY_EMBEDDING,
      metroidWithGap(),
      TEST_PROFILE,
    );
    const after = new Date().toISOString();
    expect(result?.detectedAt).toBeDefined();
    expect(result!.detectedAt >= before).toBe(true);
    expect(result!.detectedAt <= after).toBe(true);
  });
});

describe("buildCuriosityProbe", () => {
  async function makeGap(queryText = "what is quark?") {
    const gap = await detectKnowledgeGap(
      queryText,
      QUERY_EMBEDDING,
      metroidWithGap("anchor-page"),
      TEST_PROFILE,
    );
    return gap!;
  }

  it("probe has the correct modelUrn format", async () => {
    const probe = await buildCuriosityProbe(await makeGap(), TEST_PROFILE);
    expect(probe.modelUrn).toBe(`urn:model:${TEST_PROFILE.modelId}`);
  });

  it("modelUrn includes the modelId", async () => {
    const customProfile: ModelProfile = { ...TEST_PROFILE, modelId: "custom-embed-v2" };
    const probe = await buildCuriosityProbe(await makeGap(), customProfile);
    expect(probe.modelUrn).toContain("custom-embed-v2");
  });

  it("probeId is deterministic for the same inputs", async () => {
    const gap = await makeGap("determinism test");
    const probe1 = await buildCuriosityProbe(gap, TEST_PROFILE);
    const probe2 = await buildCuriosityProbe(gap, TEST_PROFILE);
    expect(probe1.probeId).toBe(probe2.probeId);
  });

  it("mimeType defaults to 'text/plain'", async () => {
    const probe = await buildCuriosityProbe(await makeGap(), TEST_PROFILE);
    expect(probe.mimeType).toBe("text/plain");
  });

  it("mimeType can be overridden", async () => {
    const probe = await buildCuriosityProbe(
      await makeGap(),
      TEST_PROFILE,
      "application/json",
    );
    expect(probe.mimeType).toBe("application/json");
  });

  it("probe carries the original queryText", async () => {
    const text = "original query text";
    const probe = await buildCuriosityProbe(await makeGap(text), TEST_PROFILE);
    expect(probe.queryText).toBe(text);
  });

  it("probe knowledgeBoundary matches the gap boundary", async () => {
    const gap = await makeGap();
    const probe = await buildCuriosityProbe(gap, TEST_PROFILE);
    expect(probe.knowledgeBoundary).toBe(gap.knowledgeBoundary);
  });

  it("probe has a createdAt ISO timestamp", async () => {
    const before = new Date().toISOString();
    const probe = await buildCuriosityProbe(await makeGap(), TEST_PROFILE);
    const after = new Date().toISOString();
    expect(probe.createdAt >= before).toBe(true);
    expect(probe.createdAt <= after).toBe(true);
  });
});
