import type { Hash, Page } from "../core/types";
import type { KeyPair } from "../core/crypto/sign";
import { hashBinary, hashText } from "../core/crypto/hash";
import { signData } from "../core/crypto/sign";

export interface BuildPageOptions {
  content: string;
  embedding: Float32Array;
  embeddingOffset: number;
  embeddingDim: number;
  creatorPubKey: string;
  signingKey: CryptoKey;
  prevPageId?: Hash | null;
  nextPageId?: Hash | null;
  createdAt?: string;
}

/**
 * Build a Page entity from content + embedding.
 *
 * Creates deterministic `pageId`/`contentHash` from content, a `vectorHash` from
 * the raw embedding bytes, and signs the page using the provided key.
 */
export async function buildPage(options: BuildPageOptions): Promise<Page> {
  const {
    content,
    embedding,
    embeddingOffset,
    embeddingDim,
    creatorPubKey,
    signingKey,
    prevPageId = null,
    nextPageId = null,
    createdAt = new Date().toISOString(),
  } = options;

  if (embedding.length !== embeddingDim) {
    throw new Error(
      `Embedding dimension mismatch: expected ${embeddingDim}, got ${embedding.length}`,
    );
  }

  const contentHash = await hashText(content);
  const pageId = contentHash;

  const rawVector = embedding.buffer.slice(
    embedding.byteOffset,
    embedding.byteOffset + embedding.byteLength,
  );
  const vectorHash = await hashBinary(rawVector);

  const unsignedPage = {
    pageId,
    content,
    embeddingOffset,
    embeddingDim,
    contentHash,
    vectorHash,
    prevPageId: prevPageId ?? null,
    nextPageId: nextPageId ?? null,
    creatorPubKey,
    createdAt,
  } as const;

  // Deterministic canonical representation used for signing.
  const canonical = canonicalizePageForSigning(unsignedPage);
  const signature = await signData(canonical, signingKey);

  return {
    ...unsignedPage,
    signature,
  };
}

function canonicalizePageForSigning(page: Omit<Page, "signature">): string {
  // Keep key order stable for deterministic signing.
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
