import { bench, describe } from "vitest";

import { DeterministicDummyEmbeddingBackend } from "../../embeddings/DeterministicDummyEmbeddingBackend";

const backend = new DeterministicDummyEmbeddingBackend({ dimension: 1024 });

function buildDeterministicBatch(count: number, tokenSeed: string): string[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = `${tokenSeed}-${index.toString(16).padStart(4, "0")}`;
    return `${suffix} ${suffix} ${suffix} ${suffix}`;
  });
}

const singleShort = ["where is the cache invalidation boundary?"];
const batch16Medium = buildDeterministicBatch(16, "cortex-medium");
const batch64Short = buildDeterministicBatch(64, "cortex-short");

describe("Dummy Embedder Hotpath", () => {
  bench("single short input", async () => {
    await backend.embed(singleShort);
  });

  bench("batch 16 medium inputs", async () => {
    await backend.embed(batch16Medium);
  });

  bench("batch 64 short inputs", async () => {
    await backend.embed(batch64Short);
  });
});
