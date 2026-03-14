/**
 * P3-D1: TransformersJs embedding throughput benchmarks.
 *
 * Measures embedding throughput (embeddings/sec) for various batch sizes
 * using the DeterministicDummyEmbeddingBackend as a structural proxy.
 *
 * When running on hardware with model download capability, replace the
 * backend with TransformersJsEmbeddingBackend to measure real model
 * inference throughput:
 *
 *   const backend = new TransformersJsEmbeddingBackend({
 *     device: "wasm",   // or "webgpu" / "webnn"
 *     dimension: 768,
 *   });
 */
import { bench, describe } from "vitest";

import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";

const EMBEDDING_DIM = 768;
const backend = new DeterministicDummyEmbeddingBackend({ dimension: EMBEDDING_DIM });

function buildBatch(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) =>
    `${prefix} sentence number ${i}: the embedding model processes this text.`,
  );
}

const batch1 = buildBatch(1, "single");
const batch8 = buildBatch(8, "small-batch");
const batch32 = buildBatch(32, "medium-batch");
const batch128 = buildBatch(128, "large-batch");

describe("TransformersJs Embedding Throughput", () => {
  bench("single text (batch=1)", async () => {
    await backend.embed(batch1);
  });

  bench("small batch (batch=8)", async () => {
    await backend.embed(batch8);
  });

  bench("medium batch (batch=32)", async () => {
    await backend.embed(batch32);
  });

  bench("large batch (batch=128)", async () => {
    await backend.embed(batch128);
  });
});
