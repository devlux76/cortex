import { describe, expect, it, vi } from "vitest";

import type { EmbeddingBackend } from "../../embeddings/EmbeddingBackend";
import {
  DEFAULT_PROVIDER_BENCHMARK_POLICY,
  DEFAULT_PROVIDER_ORDER,
  type EmbeddingProviderCandidate,
  resolveEmbeddingBackend,
} from "../../embeddings/ProviderResolver";

class FakeBackend implements EmbeddingBackend {
  readonly kind: string;
  readonly dimension = 8;

  constructor(kind: string) {
    this.kind = kind;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array(this.dimension));
  }
}

function candidate(
  kind: string,
  supported: boolean,
): EmbeddingProviderCandidate {
  return {
    kind,
    isSupported: async () => supported,
    createBackend: async () => new FakeBackend(kind),
  };
}

describe("resolveEmbeddingBackend", () => {
  it("selects the fastest supported provider when benchmarking is enabled", async () => {
    const result = await resolveEmbeddingBackend({
      candidates: [
        candidate("webnn", true),
        candidate("webgpu", true),
        candidate("wasm", true),
      ],
      benchmark: {
        enabled: true,
      },
      benchmarkBackend: async (backend) => {
        const timings: Record<string, number> = {
          webnn: 8,
          webgpu: 2,
          wasm: 5,
        };
        return timings[backend.kind];
      },
    });

    expect(result.selectedKind).toBe("webgpu");
    expect(result.reason).toBe("benchmark");
    expect(result.measurements.map((m) => m.kind)).toEqual([
      "webnn",
      "webgpu",
      "wasm",
    ]);
  });

  it("falls back to ordered capability selection when benchmarking is disabled", async () => {
    const result = await resolveEmbeddingBackend({
      candidates: [
        candidate("webgpu", true),
        candidate("wasm", true),
      ],
      preferredOrder: ["webgpu", "wasm"],
      benchmark: {
        enabled: false,
      },
    });

    expect(result.selectedKind).toBe("webgpu");
    expect(result.reason).toBe("capability-order");
    expect(result.measurements).toHaveLength(0);
  });

  it("supports forcing a specific provider kind", async () => {
    const result = await resolveEmbeddingBackend({
      candidates: [
        candidate("dummy", true),
        candidate("wasm", true),
      ],
      forceKind: "dummy",
      benchmark: {
        enabled: true,
      },
    });

    expect(result.selectedKind).toBe("dummy");
    expect(result.reason).toBe("forced");
  });

  it("throws when forced provider is not supported", async () => {
    await expect(
      resolveEmbeddingBackend({
        candidates: [candidate("dummy", false)],
        forceKind: "dummy",
      }),
    ).rejects.toThrow(/not supported/i);
  });

  it("throws when no providers are supported", async () => {
    await expect(
      resolveEmbeddingBackend({
        candidates: [candidate("webnn", false), candidate("wasm", false)],
      }),
    ).rejects.toThrow(/no supported embedding providers/i);
  });

  it("exposes stable defaults", () => {
    expect(DEFAULT_PROVIDER_ORDER).toEqual([
      "webnn",
      "webgpu",
      "webgl",
      "wasm",
      "dummy",
    ]);
    expect(DEFAULT_PROVIDER_BENCHMARK_POLICY.enabled).toBe(true);
    expect(DEFAULT_PROVIDER_BENCHMARK_POLICY.timedRuns).toBe(3);
    expect(DEFAULT_PROVIDER_BENCHMARK_POLICY.warmupRuns).toBe(1);
    expect(DEFAULT_PROVIDER_BENCHMARK_POLICY.sampleTexts.length).toBeGreaterThan(0);
  });

  it("does not benchmark unsupported providers", async () => {
    const benchmarkBackend = vi.fn(async () => 1);

    const result = await resolveEmbeddingBackend({
      candidates: [
        candidate("webnn", false),
        candidate("webgpu", true),
      ],
      benchmark: { enabled: true },
      benchmarkBackend,
    });

    expect(result.selectedKind).toBe("webgpu");
    expect(benchmarkBackend).toHaveBeenCalledTimes(1);
  });
});
