import { describe, expect, it, vi } from "vitest";

import type { EmbeddingBackend } from "../../embeddings/EmbeddingBackend";
import { EmbeddingRunner } from "../../embeddings/EmbeddingRunner";
import type { ResolvedEmbeddingBackend } from "../../embeddings/ProviderResolver";

class CountingBackend implements EmbeddingBackend {
  readonly kind = "dummy";
  readonly dimension = 4;
  calls = 0;

  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    return texts.map(() => new Float32Array([1, 2, 3, 4]));
  }
}

describe("EmbeddingRunner", () => {
  it("resolves backend once and reuses it", async () => {
    const backend = new CountingBackend();
    const resolve = vi.fn(async (): Promise<ResolvedEmbeddingBackend> => ({
      backend,
      selectedKind: "dummy",
      reason: "forced",
      supportedKinds: ["dummy"],
      measurements: [],
    }));

    const runner = new EmbeddingRunner(resolve);

    await runner.embed(["a"]);
    await runner.embed(["b", "c"]);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(backend.calls).toBe(2);
    expect(runner.selectedKind).toBe("dummy");
  });

  it("can expose full resolved selection metadata", async () => {
    const backend = new CountingBackend();
    const selection: ResolvedEmbeddingBackend = {
      backend,
      selectedKind: "dummy",
      reason: "benchmark",
      supportedKinds: ["dummy", "wasm"],
      measurements: [
        { kind: "dummy", meanMs: 1.2 },
        { kind: "wasm", meanMs: 2.1 },
      ],
    };

    const runner = new EmbeddingRunner(async () => selection);
    const resolved = await runner.getSelection();

    expect(resolved).toEqual(selection);
  });
});
