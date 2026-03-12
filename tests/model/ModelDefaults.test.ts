import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_DERIVATION_POLICY,
  buildModelProfileFromSeed,
  deriveChunkTokenLimit,
  deriveTruncationTokens,
} from "../../core/ModelDefaults";

describe("deriveTruncationTokens", () => {
  it("derives truncation from context window using policy ratio", () => {
    const result = deriveTruncationTokens(8192);
    expect(result).toBe(6144);
  });

  it("enforces a floor when context window is very small", () => {
    const result = deriveTruncationTokens(64, {
      ...DEFAULT_MODEL_DERIVATION_POLICY,
      minTruncationTokens: 96,
    });

    expect(result).toBe(96);
  });
});

describe("deriveChunkTokenLimit", () => {
  it("derives chunk size from truncation budget and caps at max", () => {
    const result = deriveChunkTokenLimit(32768, {
      ...DEFAULT_MODEL_DERIVATION_POLICY,
      maxChunkTokens: 4096,
    });

    expect(result).toBe(4096);
  });

  it("enforces chunk floor for tiny contexts", () => {
    const result = deriveChunkTokenLimit(128, {
      ...DEFAULT_MODEL_DERIVATION_POLICY,
      minChunkTokens: 96,
    });

    expect(result).toBe(96);
  });
});

describe("buildModelProfileFromSeed", () => {
  it("builds a complete profile from authoritative seed metadata", () => {
    const profile = buildModelProfileFromSeed({
      modelId: "my-embed-model",
      embeddingDimension: 1536,
      contextWindowTokens: 8192,
      source: "metadata",
    });

    expect(profile).toEqual({
      modelId: "my-embed-model",
      embeddingDimension: 1536,
      contextWindowTokens: 8192,
      truncationTokens: 6144,
      maxChunkTokens: 1536,
      source: "metadata",
    });
  });

  it("throws for invalid numeric metadata", () => {
    expect(() =>
      buildModelProfileFromSeed({
        modelId: "bad-model",
        embeddingDimension: 0,
        contextWindowTokens: 8192,
        source: "metadata",
      })
    ).toThrow(/embeddingDimension/i);
  });
});
