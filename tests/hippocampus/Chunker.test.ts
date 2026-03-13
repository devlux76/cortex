import { describe, expect, it } from "vitest";

import { chunkText, chunkTextWithMaxTokens } from "../../hippocampus/Chunker";

describe("chunkTextWithMaxTokens", () => {
  it("returns empty array for empty input", () => {
    expect(chunkTextWithMaxTokens("", 10)).toEqual([]);
    expect(chunkTextWithMaxTokens("   \n\t  ", 10)).toEqual([]);
  });

  it("returns a single chunk when text fits within the limit", () => {
    const text = "Hello world.";
    expect(chunkTextWithMaxTokens(text, 10)).toEqual([text]);
  });

  it("handles single-token input", () => {
    const text = "Word";
    expect(chunkTextWithMaxTokens(text, 5)).toEqual([text]);
  });

  it("scales to very large inputs without blowing the stack", () => {
    const numTokens = 10_000;
    const tokens = Array.from({ length: numTokens }, (_, i) => `w${i}`);
    const text = tokens.join(" ");
    const chunks = chunkTextWithMaxTokens(text, 256);

    expect(chunks.every((chunk) => chunk.split(/\s+/).length <= 256)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("splits into multiple chunks when token count exceeds the limit", () => {
    const tokens = Array.from({ length: 25 }, (_, i) => `word${i}`);
    const text = tokens.join(" ");
    const chunks = chunkTextWithMaxTokens(text, 10);

    expect(chunks.every((chunk) => chunk.split(/\s+/).length <= 10)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("prefers sentence boundaries when possible", () => {
    const text = "A. B. C. D.";
    const chunks = chunkTextWithMaxTokens(text, 5);
    expect(chunks).toEqual([text]);
  });

  it("splits a single long sentence that exceeds the token budget", () => {
    const sentenceTokens = Array.from({ length: 20 }, (_, i) => `w${i}`);
    const sentence = sentenceTokens.join(" ") + ".";
    const chunks = chunkTextWithMaxTokens(sentence, 7);

    expect(chunks.every((chunk) => chunk.split(/\s+/).length <= 7)).toBe(true);
    expect(chunks.length).toBe(3);
    expect(chunks.join(" ")).toContain("w0");
  });
});

describe("chunkText", () => {
  it("uses the profile's maxChunkTokens", () => {
    const profile = {
      modelId: "dummy",
      embeddingDimension: 1,
      contextWindowTokens: 1,
      truncationTokens: 1,
      maxChunkTokens: 3,
      source: "metadata" as const,
    };

    const chunks = chunkText("A B C D E", profile);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.split(/\s+/).length <= 3)).toBe(true);
  });
});
