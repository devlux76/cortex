import { describe, expect, it, vi } from "vitest";

import {
  OrtWebglEmbeddingBackend,
} from "../../embeddings/OrtWebglEmbeddingBackend";
import { createWebglProviderCandidate } from "../../embeddings/ProviderResolver";

describe("OrtWebglEmbeddingBackend", () => {
  it("exposes kind='webgl'", () => {
    const backend = new OrtWebglEmbeddingBackend({ dimension: 8 });
    expect(backend.kind).toBe("webgl");
  });

  it("exposes the configured dimension", () => {
    const backend = new OrtWebglEmbeddingBackend({ dimension: 32 });
    expect(backend.dimension).toBe(32);
  });

  it("exposes the configured modelId", () => {
    const backend = new OrtWebglEmbeddingBackend({ modelId: "test-model", dimension: 8 });
    expect(backend.modelId).toBe("test-model");
  });

  it("calls embed() and produces one vector per input text", async () => {
    const backend = new OrtWebglEmbeddingBackend({ dimension: 8 });

    const fakePipeline = vi.fn(async (texts: string[]) => {
      const flat = new Float32Array(texts.length * 8).fill(0.1);
      return { data: flat };
    });

    // Inject a fake pipeline to avoid loading a real model
    (backend as unknown as { pipelinePromise: Promise<unknown> }).pipelinePromise =
      Promise.resolve(fakePipeline);

    const results = await backend.embed(["hello", "world"]);

    expect(results).toHaveLength(2);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[0]).toHaveLength(8);
    expect(results[1]).toBeInstanceOf(Float32Array);
    expect(results[1]).toHaveLength(8);
  });

  it("calls embedQueries() and produces one vector per input text", async () => {
    const backend = new OrtWebglEmbeddingBackend({ dimension: 8 });

    const fakePipeline = vi.fn(async (texts: string[]) => {
      const flat = new Float32Array(texts.length * 8).fill(0.2);
      return { data: flat };
    });

    (backend as unknown as { pipelinePromise: Promise<unknown> }).pipelinePromise =
      Promise.resolve(fakePipeline);

    const results = await backend.embedQueries(["search query"]);

    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[0]).toHaveLength(8);
  });

  it("prepends documentPrefix when embedding documents", async () => {
    const backend = new OrtWebglEmbeddingBackend({
      dimension: 8,
      documentPrefix: "passage: ",
    });

    const captured: string[] = [];
    const fakePipeline = vi.fn(async (texts: string[]) => {
      captured.push(...texts);
      const flat = new Float32Array(texts.length * 8).fill(0.0);
      return { data: flat };
    });

    (backend as unknown as { pipelinePromise: Promise<unknown> }).pipelinePromise =
      Promise.resolve(fakePipeline);

    await backend.embed(["my document"]);

    expect(captured[0]).toBe("passage: my document");
  });

  it("prepends queryPrefix when embedding queries", async () => {
    const backend = new OrtWebglEmbeddingBackend({
      dimension: 8,
      queryPrefix: "query: ",
    });

    const captured: string[] = [];
    const fakePipeline = vi.fn(async (texts: string[]) => {
      captured.push(...texts);
      const flat = new Float32Array(texts.length * 8).fill(0.0);
      return { data: flat };
    });

    (backend as unknown as { pipelinePromise: Promise<unknown> }).pipelinePromise =
      Promise.resolve(fakePipeline);

    await backend.embedQueries(["my query"]);

    expect(captured[0]).toBe("query: my query");
  });

  it("slices output to the configured dimension when model outputs more dimensions", async () => {
    const backend = new OrtWebglEmbeddingBackend({ dimension: 4 });

    // Model outputs 8 dims per text, but we only want 4
    const fakePipeline = vi.fn(async (texts: string[]) => {
      const flat = new Float32Array(texts.length * 8);
      for (let i = 0; i < flat.length; i++) flat[i] = i * 0.01;
      return { data: flat };
    });

    (backend as unknown as { pipelinePromise: Promise<unknown> }).pipelinePromise =
      Promise.resolve(fakePipeline);

    const results = await backend.embed(["hello"]);

    expect(results[0]).toHaveLength(4);
  });

  it("reuses the same pipeline across multiple embed() calls", async () => {
    const backend = new OrtWebglEmbeddingBackend({ dimension: 8 });
    let loadCount = 0;

    const fakePipeline = vi.fn(async (texts: string[]) => {
      const flat = new Float32Array(texts.length * 8).fill(0.0);
      return { data: flat };
    });

    const originalLoadPipeline = (
      backend as unknown as { loadPipeline: () => Promise<unknown> }
    ).loadPipeline.bind(backend);

    (backend as unknown as { loadPipeline: () => Promise<unknown> }).loadPipeline =
      async () => {
        loadCount++;
        return originalLoadPipeline() as unknown;
      };

    (backend as unknown as { pipelinePromise: Promise<unknown> }).pipelinePromise =
      Promise.resolve(fakePipeline);

    await backend.embed(["first"]);
    await backend.embed(["second"]);

    // pipelinePromise was set externally so loadPipeline shouldn't run
    expect(loadCount).toBe(0);
  });
});

describe("createWebglProviderCandidate", () => {
  it("returns a candidate with kind='webgl'", () => {
    const candidate = createWebglProviderCandidate();
    expect(candidate.kind).toBe("webgl");
  });

  it("isSupported returns false when WebGL2RenderingContext is absent", async () => {
    const original = globalThis.WebGL2RenderingContext;
    try {
      // @ts-expect-error -- intentionally removing for test
      delete globalThis.WebGL2RenderingContext;
      const candidate = createWebglProviderCandidate();
      const supported = await candidate.isSupported();
      expect(supported).toBe(false);
    } finally {
      if (original !== undefined) {
        globalThis.WebGL2RenderingContext = original;
      }
    }
  });

  it("isSupported returns true when WebGL2RenderingContext is present", async () => {
    const original = globalThis.WebGL2RenderingContext;
    try {
      // @ts-expect-error -- intentionally stubbing for test
      globalThis.WebGL2RenderingContext = class {};
      const candidate = createWebglProviderCandidate();
      const supported = await candidate.isSupported();
      expect(supported).toBe(true);
    } finally {
      if (original !== undefined) {
        globalThis.WebGL2RenderingContext = original;
      } else {
        // @ts-expect-error -- cleaning up stub
        delete globalThis.WebGL2RenderingContext;
      }
    }
  });

  it("createBackend returns an OrtWebglEmbeddingBackend", async () => {
    const candidate = createWebglProviderCandidate({ dimension: 16 });
    const backend = await candidate.createBackend();
    expect(backend.kind).toBe("webgl");
    expect(backend.dimension).toBe(16);
  });
});
