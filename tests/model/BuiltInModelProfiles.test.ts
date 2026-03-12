import { describe, expect, it } from "vitest";

import {
  BUILT_IN_MODEL_REGISTRY,
  EMBEDDING_GEMMA_300M_MODEL_ID,
  EMBEDDING_GEMMA_300M_PROFILE,
} from "../../core/BuiltInModelProfiles";
import { ModelProfileResolver } from "../../core/ModelProfileResolver";

describe("BuiltInModelProfiles", () => {
  it("exports a non-empty BUILT_IN_MODEL_REGISTRY", () => {
    expect(Object.keys(BUILT_IN_MODEL_REGISTRY).length).toBeGreaterThan(0);
  });

  it("includes an entry for the default EmbeddingGemma-300M model", () => {
    expect(BUILT_IN_MODEL_REGISTRY[EMBEDDING_GEMMA_300M_MODEL_ID]).toBeDefined();
  });

  it("EmbeddingGemma-300M profile has valid positive numeric dimensions", () => {
    expect(Number.isInteger(EMBEDDING_GEMMA_300M_PROFILE.embeddingDimension)).toBe(true);
    expect(EMBEDDING_GEMMA_300M_PROFILE.embeddingDimension).toBeGreaterThan(0);
    expect(Number.isInteger(EMBEDDING_GEMMA_300M_PROFILE.contextWindowTokens)).toBe(true);
    expect(EMBEDDING_GEMMA_300M_PROFILE.contextWindowTokens).toBeGreaterThan(0);
  });

  it("can resolve the EmbeddingGemma-300M profile through ModelProfileResolver", () => {
    const resolver = new ModelProfileResolver({ registry: BUILT_IN_MODEL_REGISTRY });
    const profile = resolver.resolve({ modelId: EMBEDDING_GEMMA_300M_MODEL_ID });

    expect(profile.modelId).toBe(EMBEDDING_GEMMA_300M_MODEL_ID);
    expect(profile.embeddingDimension).toBe(EMBEDDING_GEMMA_300M_PROFILE.embeddingDimension);
    expect(profile.contextWindowTokens).toBe(EMBEDDING_GEMMA_300M_PROFILE.contextWindowTokens);
    expect(profile.source).toBe("registry");
  });

  it("BUILT_IN_MODEL_REGISTRY is frozen (immutable)", () => {
    expect(Object.isFrozen(BUILT_IN_MODEL_REGISTRY)).toBe(true);
  });
});
