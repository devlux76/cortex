import type { Hash, MetadataStore, VectorStore } from "../core/types";
import type { VectorBackend } from "../VectorBackend";

export interface RankingOptions {
  vectorStore: VectorStore;
  metadataStore: MetadataStore;
  vectorBackend?: VectorBackend;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function pickTopK(
  scored: Array<{ id: Hash; score: number }>,
  k: number,
): Array<{ id: Hash; score: number }> {
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, k);
}

/**
 * Ranks shelves by cosine similarity of their routing prototype to the query.
 * Uses routingPrototypeOffsets[0] as the representative vector.
 */
export async function rankShelves(
  queryEmbedding: Float32Array,
  residentShelfIds: Hash[],
  topK: number,
  options: RankingOptions,
): Promise<Array<{ id: Hash; score: number }>> {
  if (residentShelfIds.length === 0) return [];

  const { vectorStore, metadataStore } = options;
  const scored: Array<{ id: Hash; score: number }> = [];

  for (const shelfId of residentShelfIds) {
    const shelf = await metadataStore.getShelf(shelfId);
    if (!shelf || shelf.routingPrototypeOffsets.length === 0) continue;
    const vec = await vectorStore.readVector(shelf.routingPrototypeOffsets[0], shelf.routingDim);
    scored.push({ id: shelfId, score: cosineSimilarity(queryEmbedding, vec) });
  }

  return pickTopK(scored, topK);
}

/**
 * Ranks volumes by cosine similarity of their first prototype to the query.
 * Uses prototypeOffsets[0] as the representative vector.
 */
export async function rankVolumes(
  queryEmbedding: Float32Array,
  residentVolumeIds: Hash[],
  topK: number,
  options: RankingOptions,
): Promise<Array<{ id: Hash; score: number }>> {
  if (residentVolumeIds.length === 0) return [];

  const { vectorStore, metadataStore } = options;
  const scored: Array<{ id: Hash; score: number }> = [];

  for (const volumeId of residentVolumeIds) {
    const volume = await metadataStore.getVolume(volumeId);
    if (!volume || volume.prototypeOffsets.length === 0) continue;
    const vec = await vectorStore.readVector(volume.prototypeOffsets[0], volume.prototypeDim);
    scored.push({ id: volumeId, score: cosineSimilarity(queryEmbedding, vec) });
  }

  return pickTopK(scored, topK);
}

/**
 * Ranks books by cosine similarity of their medoid page embedding to the query.
 */
export async function rankBooks(
  queryEmbedding: Float32Array,
  residentBookIds: Hash[],
  topK: number,
  options: RankingOptions,
): Promise<Array<{ id: Hash; score: number }>> {
  if (residentBookIds.length === 0) return [];

  const { vectorStore, metadataStore } = options;
  const scored: Array<{ id: Hash; score: number }> = [];

  for (const bookId of residentBookIds) {
    const book = await metadataStore.getBook(bookId);
    if (!book) continue;
    const medoidPage = await metadataStore.getPage(book.medoidPageId);
    if (!medoidPage) continue;
    const vec = await vectorStore.readVector(medoidPage.embeddingOffset, medoidPage.embeddingDim);
    scored.push({ id: bookId, score: cosineSimilarity(queryEmbedding, vec) });
  }

  return pickTopK(scored, topK);
}

/**
 * Ranks pages by cosine similarity of their embedding to the query.
 */
export async function rankPages(
  queryEmbedding: Float32Array,
  residentPageIds: Hash[],
  topK: number,
  options: RankingOptions,
): Promise<Array<{ id: Hash; score: number }>> {
  if (residentPageIds.length === 0) return [];

  const { vectorStore, metadataStore } = options;
  const scored: Array<{ id: Hash; score: number }> = [];

  for (const pageId of residentPageIds) {
    const page = await metadataStore.getPage(pageId);
    if (!page) continue;
    const vec = await vectorStore.readVector(page.embeddingOffset, page.embeddingDim);
    scored.push({ id: pageId, score: cosineSimilarity(queryEmbedding, vec) });
  }

  return pickTopK(scored, topK);
}

/**
 * Spills to the warm tier when the resident set provides insufficient coverage.
 * For "page": scores all pages in the store.
 * For other tiers: returns [] (warm spill is only implemented for pages at this stage).
 */
export async function spillToWarm(
  tier: "shelf" | "volume" | "book" | "page",
  queryEmbedding: Float32Array,
  topK: number,
  options: RankingOptions,
): Promise<Array<{ id: Hash; score: number }>> {
  if (tier !== "page") return [];

  const { vectorStore, metadataStore } = options;
  const allPages = await metadataStore.getAllPages();
  if (allPages.length === 0) return [];

  const scored: Array<{ id: Hash; score: number }> = [];
  for (const page of allPages) {
    const vec = await vectorStore.readVector(page.embeddingOffset, page.embeddingDim);
    scored.push({ id: page.pageId, score: cosineSimilarity(queryEmbedding, vec) });
  }

  return pickTopK(scored, topK);
}
