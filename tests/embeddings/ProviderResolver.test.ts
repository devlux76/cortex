import { describe, expect, it, vi } from "vitest";

import type { EmbeddingBackend } from "../../embeddings/EmbeddingBackend";
import {
  DEFAULT_PROVIDER_BENCHMARK_POLICY,
  DEFAULT_PROVIDER_ORDER,
  type EmbeddingProviderCandidate,
  createTransformersJsProviderCandidates,
  resolveEmbeddingBackend,
} from "../../embeddings/ProviderResolver";
import { TransformersJsEmbeddingBackend } from "../../embeddings/TransformersJsEmbeddingBackend";

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

describe("createTransformersJsProviderCandidates", () => {
  it("returns three candidates for webnn, webgpu, and wasm", () => {
    const candidates = createTransformersJsProviderCandidates();
    const kinds = candidates.map((c) => c.kind);
    expect(kinds).toEqual(["webnn", "webgpu", "wasm"]);
  });

  it("each candidate creates a TransformersJsEmbeddingBackend with the matching device", async () => {
    const candidates = createTransformersJsProviderCandidates({ dimension: 64 });
    for (const candidate of candidates) {
      const backend = await candidate.createBackend();
      expect(backend).toBeInstanceOf(TransformersJsEmbeddingBackend);
      expect((backend as TransformersJsEmbeddingBackend).device).toBe(
        candidate.kind,
      );
      expect((backend as TransformersJsEmbeddingBackend).dimension).toBe(64);
    }
  });

  it("wasm candidate is always supported", async () => {
    const candidates = createTransformersJsProviderCandidates();
    const wasmCandidate = candidates.find((c) => c.kind === "wasm");
    expect(wasmCandidate).toBeDefined();
    expect(await wasmCandidate!.isSupported()).toBe(true);
  });

  it("webgpu candidate support reflects navigator.gpu availability", async () => {
    const candidates = createTransformersJsProviderCandidates();
    const webgpuCandidate = candidates.find((c) => c.kind === "webgpu");
    expect(webgpuCandidate).toBeDefined();

    // In a Node/vitest environment there is no navigator.gpu, so should be false.
    expect(await webgpuCandidate!.isSupported()).toBe(false);
  });

  it("webnn candidate support reflects navigator.ml availability", async () => {
    const candidates = createTransformersJsProviderCandidates();
    const webnnCandidate = candidates.find((c) => c.kind === "webnn");
    expect(webnnCandidate).toBeDefined();

    // In a Node/vitest environment there is no navigator.ml, so should be false.
    expect(await webnnCandidate!.isSupported()).toBe(false);
  });

  it("forwards shared options to each backend", async () => {
    const options = {
      modelId: "custom/model",
      documentPrefix: "doc: ",
      queryPrefix: "q: ",
    };
    const candidates = createTransformersJsProviderCandidates(options);
    for (const candidate of candidates) {
      const backend = (await candidate.createBackend()) as TransformersJsEmbeddingBackend;
      expect(backend.modelId).toBe("custom/model");
      expect(backend.documentPrefix).toBe("doc: ");
      expect(backend.queryPrefix).toBe("q: ");
    }
  });
});
