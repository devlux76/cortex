import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUMMY_EMBEDDING_DIMENSION,
  SHA256_BLOCK_BYTES,
  DeterministicDummyEmbeddingBackend,
} from "../../embeddings/DeterministicDummyEmbeddingBackend";

describe("DeterministicDummyEmbeddingBackend", () => {
  it("returns 1024 dimensions by default", async () => {
    const backend = new DeterministicDummyEmbeddingBackend();
    const [vector] = await backend.embed(["hello cortex"]);

    expect(vector).toHaveLength(DEFAULT_DUMMY_EMBEDDING_DIMENSION);
  });

  it("is deterministic for identical input", async () => {
    const backend = new DeterministicDummyEmbeddingBackend();

    const [first] = await backend.embed(["same input"]);
    const [second] = await backend.embed(["same input"]);

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("produces different vectors for different input", async () => {
    const backend = new DeterministicDummyEmbeddingBackend();

    const [a, b] = await backend.embed(["alpha", "beta"]);

    const differs = a.some((value, index) => value !== b[index]);
    expect(differs).toBe(true);
  });

  it("pads input to SHA-256 block boundary using zero bytes", async () => {
    const backend = new DeterministicDummyEmbeddingBackend();
    const base = "abc";

    const inputBytes = new TextEncoder().encode(base).byteLength;
    const remainder = inputBytes % SHA256_BLOCK_BYTES;
    const padCount = remainder === 0 ? 0 : SHA256_BLOCK_BYTES - remainder;

    const equivalentExplicitlyPadded = base + "\0".repeat(padCount);

    const [autoPadded] = await backend.embed([base]);
    const [alreadyPadded] = await backend.embed([equivalentExplicitlyPadded]);

    expect(Array.from(autoPadded)).toEqual(Array.from(alreadyPadded));
  });

  it("supports custom output dimensions", async () => {
    const backend = new DeterministicDummyEmbeddingBackend({ dimension: 97 });
    const [vector] = await backend.embed(["custom-dim"]);

    expect(vector).toHaveLength(97);
  });

  it("rejects invalid dimensions", () => {
    expect(() => new DeterministicDummyEmbeddingBackend({ dimension: 0 })).toThrow(
      /dimension/i,
    );
  });
});
