import { describe, expect, it } from "vitest";

import { ModelProfileResolver } from "../../core/ModelProfileResolver";

describe("ModelProfileResolver", () => {
  it("resolves directly from metadata", () => {
    const resolver = new ModelProfileResolver();

    const profile = resolver.resolve({
      modelId: "nomic-embed-text",
      metadata: {
        embeddingDimension: 768,
        contextWindowTokens: 8192,
      },
    });

    expect(profile.embeddingDimension).toBe(768);
    expect(profile.contextWindowTokens).toBe(8192);
    expect(profile.source).toBe("metadata");
  });

  it("resolves from registry when metadata is absent", () => {
    const resolver = new ModelProfileResolver({
      registry: {
        "all-minilm-l6-v2": {
          embeddingDimension: 384,
          contextWindowTokens: 512,
        },
      },
    });

    const profile = resolver.resolve({ modelId: "all-MiniLM-L6-v2" });

    expect(profile.embeddingDimension).toBe(384);
    expect(profile.contextWindowTokens).toBe(512);
    expect(profile.source).toBe("registry");
  });

  it("supports mixed resolution when metadata partially overrides registry", () => {
    const resolver = new ModelProfileResolver({
      registry: {
        "my-model": {
          embeddingDimension: 1024,
          contextWindowTokens: 4096,
        },
      },
    });

    const profile = resolver.resolve({
      modelId: "my-model",
      metadata: {
        contextWindowTokens: 8192,
      },
    });

    expect(profile.embeddingDimension).toBe(1024);
    expect(profile.contextWindowTokens).toBe(8192);
    expect(profile.source).toBe("mixed");
  });

  it("throws when required values cannot be resolved", () => {
    const resolver = new ModelProfileResolver();

    expect(() => resolver.resolve({ modelId: "unknown" })).toThrow(
      /cannot resolve model profile/i
    );
  });
});
