import { describe, expect, it } from "vitest";

import { buildPage } from "../../hippocampus/PageBuilder";
import type { Page } from "../../core/types";
import { generateKeyPair } from "../../core/crypto/sign";
import { verifySignature } from "../../core/crypto/verify";
import { hashBinary, hashText } from "../../core/crypto/hash";

function canonicalizePageForSigning(page: Omit<Page, "signature">) {
  return JSON.stringify({
    pageId: page.pageId,
    content: page.content,
    embeddingOffset: page.embeddingOffset,
    embeddingDim: page.embeddingDim,
    contentHash: page.contentHash,
    vectorHash: page.vectorHash,
    prevPageId: page.prevPageId ?? null,
    nextPageId: page.nextPageId ?? null,
    creatorPubKey: page.creatorPubKey,
    createdAt: page.createdAt,
  });
}

describe("buildPage", () => {
  it("produces deterministic hashes and a valid signature", async () => {
    const keyPair = await generateKeyPair();
    const content = "Hello world";
    const embedding = new Float32Array([1, 2, 3, 4]);
    const createdAt = "2026-03-13T00:00:00.000Z";

    const page = await buildPage({
      content,
      embedding,
      embeddingOffset: 0,
      embeddingDim: embedding.length,
      creatorPubKey: keyPair.publicKey,
      signingKey: keyPair.signingKey,
      prevPageId: "prev-id",
      nextPageId: "next-id",
      createdAt,
    });

    const expectedContentHash = await hashText(content);
    expect(page.pageId).toBe(expectedContentHash);
    expect(page.contentHash).toBe(expectedContentHash);

    const rawVector = embedding.buffer.slice(
      embedding.byteOffset,
      embedding.byteOffset + embedding.byteLength,
    );
    const expectedVectorHash = await hashBinary(rawVector);
    expect(page.vectorHash).toBe(expectedVectorHash);

    const canonical = canonicalizePageForSigning({
      ...page,
      signature: "",
    });

    const verified = await verifySignature(canonical, page.signature, keyPair.publicKey);
    expect(verified).toBe(true);

    // Determinism: repeated build with same inputs should yield identical signature.
    const page2 = await buildPage({
      content,
      embedding,
      embeddingOffset: 0,
      embeddingDim: embedding.length,
      creatorPubKey: keyPair.publicKey,
      signingKey: keyPair.signingKey,
      prevPageId: "prev-id",
      nextPageId: "next-id",
      createdAt,
    });
    expect(page2.signature).toBe(page.signature);
  });

  it("throws when embeddingDim does not match embedding length", async () => {
    const keyPair = await generateKeyPair();
    const embedding = new Float32Array([1, 2, 3]);

    await expect(
      buildPage({
        content: "test",
        embedding,
        embeddingOffset: 0,
        embeddingDim: embedding.length + 1,
        creatorPubKey: keyPair.publicKey,
        signingKey: keyPair.signingKey,
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/Embedding dimension mismatch/);
  });
});
