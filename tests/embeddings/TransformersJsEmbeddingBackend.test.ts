import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMBEDDING_GEMMA_300M_DOCUMENT_PREFIX,
  EMBEDDING_GEMMA_300M_EMBEDDING_DIMENSION,
  EMBEDDING_GEMMA_300M_MODEL_ID,
  EMBEDDING_GEMMA_300M_QUERY_PREFIX,
  TransformersJsEmbeddingBackend,
} from "../../embeddings/TransformersJsEmbeddingBackend";

// ---------------------------------------------------------------------------
// Fake Tensor helpers
// ---------------------------------------------------------------------------

function makeFakeTensor(values: number[]): { data: Float32Array } {
  return { data: new Float32Array(values) };
}

// ---------------------------------------------------------------------------
// Pipeline mock factory
// ---------------------------------------------------------------------------

function makePipelineMock(outputData: number[]): () => Promise<unknown> {
  return vi.fn().mockResolvedValue(makeFakeTensor(outputData));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBackend(
  overrides: ConstructorParameters<typeof TransformersJsEmbeddingBackend>[0] = {},
): TransformersJsEmbeddingBackend {
  return new TransformersJsEmbeddingBackend(overrides);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TransformersJsEmbeddingBackend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes correct defaults", () => {
    const backend = makeBackend();
    expect(backend.kind).toBe("transformers-js:wasm");
    expect(backend.modelId).toBe(EMBEDDING_GEMMA_300M_MODEL_ID);
    expect(backend.dimension).toBe(EMBEDDING_GEMMA_300M_EMBEDDING_DIMENSION);
    expect(backend.documentPrefix).toBe(EMBEDDING_GEMMA_300M_DOCUMENT_PREFIX);
    expect(backend.queryPrefix).toBe(EMBEDDING_GEMMA_300M_QUERY_PREFIX);
    expect(backend.device).toBe("wasm");
  });

  it("encodes device into kind", () => {
    expect(makeBackend({ device: "webgpu" }).kind).toBe(
      "transformers-js:webgpu",
    );
    expect(makeBackend({ device: "webnn" }).kind).toBe(
      "transformers-js:webnn",
    );
    expect(makeBackend({ device: "wasm" }).kind).toBe("transformers-js:wasm");
  });

  it("accepts custom modelId, dimension, and prefixes", () => {
    const backend = makeBackend({
      modelId: "custom/model",
      dimension: 256,
      documentPrefix: "doc: ",
      queryPrefix: "q: ",
    });
    expect(backend.modelId).toBe("custom/model");
    expect(backend.dimension).toBe(256);
    expect(backend.documentPrefix).toBe("doc: ");
    expect(backend.queryPrefix).toBe("q: ");
  });

  it("embed() prepends documentPrefix and returns Float32Arrays", async () => {
    const backend = makeBackend({
      dimension: 4,
      documentPrefix: "passage: ",
    });

    const pipelineFn = makePipelineMock([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    vi.spyOn(backend as unknown as { loadPipeline: () => unknown }, "loadPipeline").mockResolvedValue(pipelineFn);

    const result = await backend.embed(["hello", "world"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(Float32Array);
    expect(result[1]).toBeInstanceOf(Float32Array);

    const calledWith = (pipelineFn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledWith[0]).toEqual(["passage: hello", "passage: world"]);
    expect(calledWith[1]).toEqual({ pooling: "mean", normalize: true });
  });

  it("embedQueries() prepends queryPrefix", async () => {
    const backend = makeBackend({
      dimension: 4,
      queryPrefix: "query: ",
    });

    const pipelineFn = makePipelineMock([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    vi.spyOn(backend as unknown as { loadPipeline: () => unknown }, "loadPipeline").mockResolvedValue(pipelineFn);

    await backend.embedQueries(["what is CORTEX?"]);

    const calledWith = (pipelineFn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledWith[0]).toEqual(["query: what is CORTEX?"]);
  });

  it("slices output to configured dimension (matryoshka)", async () => {
    const fullDim = 8;
    const sliceDim = 4;
    const raw = Array.from({ length: fullDim }, (_, i) => i + 1);

    const backend = makeBackend({ dimension: sliceDim });
    const pipelineFn = makePipelineMock(raw);
    vi.spyOn(backend as unknown as { loadPipeline: () => unknown }, "loadPipeline").mockResolvedValue(pipelineFn);

    const result = await backend.embed(["test"]);

    expect(result[0].length).toBe(sliceDim);
    expect(Array.from(result[0])).toEqual([1, 2, 3, 4]);
  });

  it("does not slice when output is exactly configured dimension", async () => {
    const dim = 4;
    const raw = [0.1, 0.2, 0.3, 0.4];

    const backend = makeBackend({ dimension: dim });
    const pipelineFn = makePipelineMock(raw);
    vi.spyOn(backend as unknown as { loadPipeline: () => unknown }, "loadPipeline").mockResolvedValue(pipelineFn);

    const result = await backend.embed(["test"]);

    expect(result[0].length).toBe(dim);
  });

  it("loads the pipeline only once across multiple embed() calls", async () => {
    const backend = makeBackend({ dimension: 4 });
    const pipelineFn = makePipelineMock([0.1, 0.2, 0.3, 0.4]);

    const loadPipelineSpy = vi
      .spyOn(backend as unknown as { loadPipeline: () => unknown }, "loadPipeline")
      .mockResolvedValue(pipelineFn);

    await backend.embed(["a"]);
    await backend.embed(["b"]);
    await backend.embedQueries(["c"]);

    expect(loadPipelineSpy).toHaveBeenCalledTimes(1);
    expect((pipelineFn as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it("returns empty array when texts is empty", async () => {
    const backend = makeBackend({ dimension: 4 });
    const pipelineFn = makePipelineMock([]);
    vi.spyOn(backend as unknown as { loadPipeline: () => unknown }, "loadPipeline").mockResolvedValue(pipelineFn);

    const result = await backend.embed([]);
    expect(result).toHaveLength(0);
  });

  it("skips prefix if documentPrefix is empty string", async () => {
    const backend = makeBackend({ dimension: 4, documentPrefix: "" });
    const pipelineFn = makePipelineMock([0.1, 0.2, 0.3, 0.4]);
    vi.spyOn(backend as unknown as { loadPipeline: () => unknown }, "loadPipeline").mockResolvedValue(pipelineFn);

    await backend.embed(["raw text"]);

    const calledWith = (pipelineFn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledWith[0]).toEqual(["raw text"]);
  });
});
