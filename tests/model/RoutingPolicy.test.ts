import { describe, expect, it } from "vitest";

import {
  createRoutingPolicy,
  resolveRoutingPolicyForModel,
} from "../../Policy";
import { ModelProfileResolver } from "../../core/ModelProfileResolver";

describe("createRoutingPolicy", () => {
  it("derives projection dimensions from embedding dimension", () => {
    const policy = createRoutingPolicy({ embeddingDimension: 1536 });

    expect(policy.broad.dimIn).toBe(1536);
    expect(policy.normal.dimIn).toBe(1536);
    expect(policy.narrow.dimIn).toBe(1536);

    expect(policy.broad.dimOut).toBe(192);
    expect(policy.normal.dimOut).toBe(384);
    expect(policy.narrow.dimOut).toBe(768);
    expect(policy.broad.bits).toBe(128);
  });

  it("keeps dimensions bounded and aligned", () => {
    const policy = createRoutingPolicy(
      { embeddingDimension: 99 },
      {
        dimAlignment: 8,
      }
    );

    expect(policy.broad.dimOut).toBe(8);
    expect(policy.normal.dimOut).toBe(24);
    expect(policy.narrow.dimOut).toBe(48);
  });

  it("computes deterministic contiguous projection offsets", () => {
    const policy = createRoutingPolicy({ embeddingDimension: 256 });

    expect(policy.broad.offset).toBe(0);
    expect(policy.normal.offset).toBe(8192);
    expect(policy.narrow.offset).toBe(24576);
  });
});

describe("resolveRoutingPolicyForModel", () => {
  it("resolves from metadata and derives policy in one call", () => {
    const result = resolveRoutingPolicyForModel({
      modelId: "nomic-embed-text",
      metadata: {
        embeddingDimension: 768,
        contextWindowTokens: 8192,
      },
    });

    expect(result.modelProfile.source).toBe("metadata");
    expect(result.modelProfile.embeddingDimension).toBe(768);
    expect(result.routingPolicy.broad.dimIn).toBe(768);
    expect(result.routingPolicy.normal.dimOut).toBe(192);
  });

  it("resolves from registry when metadata is missing", () => {
    const result = resolveRoutingPolicyForModel(
      { modelId: "all-MiniLM-L6-v2" },
      {
        resolverOptions: {
          registry: {
            "all-minilm-l6-v2": {
              embeddingDimension: 384,
              contextWindowTokens: 512,
            },
          },
        },
      },
    );

    expect(result.modelProfile.source).toBe("registry");
    expect(result.routingPolicy.narrow.dimIn).toBe(384);
  });

  it("supports injected resolver and routing overrides", () => {
    const resolver = new ModelProfileResolver({
      registry: {
        "my-model": {
          embeddingDimension: 1024,
          contextWindowTokens: 4096,
        },
      },
    });

    const result = resolveRoutingPolicyForModel(
      { modelId: "my-model" },
      {
        resolver,
        routingPolicyOverrides: {
          broadHashBits: 64,
        },
      },
    );

    expect(result.modelProfile.embeddingDimension).toBe(1024);
    expect(result.routingPolicy.broad.bits).toBe(64);
  });
});
