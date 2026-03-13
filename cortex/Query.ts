import type { ModelProfile } from "../core/ModelProfile";
import type { MetadataStore, Page, VectorStore } from "../core/types";
import type { VectorBackend } from "../VectorBackend";
import type { EmbeddingRunner } from "../embeddings/EmbeddingRunner";
import { runPromotionSweep } from "../core/SalienceEngine";
import type { QueryResult } from "./QueryResult";

export interface QueryOptions {
  modelProfile: ModelProfile;
  embeddingRunner: EmbeddingRunner;
  vectorStore: VectorStore;
  metadataStore: MetadataStore;
  vectorBackend: VectorBackend;
  topK?: number;
}

function dot(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Concatenates an array of equal-length vectors into a single flat buffer.
 * @param vectors - Must be non-empty; every element must have the same length.
 */
function concatVectors(vectors: Float32Array[]): Float32Array {
  const dim = vectors[0].length;
  const out = new Float32Array(vectors.length * dim);
  for (let i = 0; i < vectors.length; i++) {
    out.set(vectors[i], i * dim);
  }
  return out;
}

async function scorePages(
  queryEmbedding: Float32Array,
  pages: Page[],
  vectorStore: VectorStore,
  vectorBackend: VectorBackend,
  maxResults: number,
): Promise<Array<{ page: Page; score: number }>> {
  if (pages.length === 0) return [];

  const [firstPage] = pages;
  const dim = firstPage.embeddingDim;
  const offsets = pages.map((p) => p.embeddingOffset);

  // If all pages share the same embedding dimension and it matches the query,
  // use the vector backend for fast scoring.
  const uniformDim = pages.every((p) => p.embeddingDim === dim);
  const canUseBackend = uniformDim && queryEmbedding.length === dim;

  if (canUseBackend) {
    const embeddings = await vectorStore.readVectors(offsets, dim);
    const matrix = concatVectors(embeddings);
    const scores = await vectorBackend.dotMany(queryEmbedding, matrix, dim, pages.length);
    const topk = await vectorBackend.topKFromScores(scores, Math.min(maxResults, pages.length));
    return topk.map((r) => ({ page: pages[r.index], score: r.score }));
  }

  // Fallback: compute dot product per page.
  const scored = await Promise.all(
    pages.map(async (page) => {
      const vec = await vectorStore.readVector(page.embeddingOffset, page.embeddingDim);
      return { page, score: dot(queryEmbedding, vec) };
    }),
  );

  scored.sort((a, b) => b.score - a.score || a.page.pageId.localeCompare(b.page.pageId));
  return scored.slice(0, Math.min(maxResults, scored.length));
}

export async function query(
  queryText: string,
  options: QueryOptions,
): Promise<QueryResult> {
  const {
    modelProfile,
    embeddingRunner,
    vectorStore,
    metadataStore,
    vectorBackend,
    topK = 10,
  } = options;

  const nowIso = new Date().toISOString();

  const embeddings = await embeddingRunner.embed([queryText]);
  if (embeddings.length !== 1) {
    throw new Error("Embedding provider returned unexpected number of embeddings");
  }
  const queryEmbedding = embeddings[0];

  // Score resident (hotpath) pages first.
  const hotpathEntries = await metadataStore.getHotpathEntries("page");
  const hotpathIds = hotpathEntries.map((e) => e.entityId);

  const hotpathPages = (await Promise.all(
    hotpathIds.map((id) => metadataStore.getPage(id)),
  )).filter((p): p is Page => p !== undefined);

  const hotpathResults = await scorePages(
    queryEmbedding,
    hotpathPages,
    vectorStore,
    vectorBackend,
    topK,
  );

  const seen = new Set(hotpathResults.map((r) => r.page.pageId));

  // If we still need more results, score remaining pages (warm/cold).
  const remaining = Math.max(0, topK - hotpathResults.length);
  const coldResults: Array<{ page: Page; score: number }> = [];

  if (remaining > 0) {
    const allPages = await metadataStore.getAllPages();
    const candidates = allPages.filter((p) => !seen.has(p.pageId));

    const scored = await scorePages(
      queryEmbedding,
      candidates,
      vectorStore,
      vectorBackend,
      remaining,
    );

    coldResults.push(...scored);
  }

  const combined = [...hotpathResults, ...coldResults];
  combined.sort((a, b) => b.score - a.score);

  // Ensure combined results are sorted by descending score for top-K semantics.
  combined.sort((a, b) => b.score - a.score);

  // Update activity for returned pages
  await Promise.all(combined.map(async ({ page }) => {
    const activity = await metadataStore.getPageActivity(page.pageId);
    const updated = {
      pageId: page.pageId,
      queryHitCount: (activity?.queryHitCount ?? 0) + 1,
      lastQueryAt: nowIso,
      communityId: activity?.communityId,
    };
    await metadataStore.putPageActivity(updated);
  }));

  // Recompute salience and run promotion sweep for pages returned in this query.
  await runPromotionSweep(combined.map((r) => r.page.pageId), metadataStore);

  return {
    pages: combined.map((r) => r.page),
    scores: combined.map((r) => r.score),
    metadata: {
      queryText,
      topK,
      returned: combined.length,
      timestamp: nowIso,
      modelId: modelProfile.modelId,
    },
  };
}
