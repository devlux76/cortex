// ---------------------------------------------------------------------------
// FullNeighborRecalc — Periodic full semantic neighbor graph recalculation (P2-C)
// ---------------------------------------------------------------------------
//
// The fast incremental neighbor insert used during ingest is approximate.
// This module performs a full pairwise recalculation for dirty volumes,
// bounded by the Williams-Bound-derived maintenance budget so the idle loop
// is not starved.
//
// Per idle cycle, the scheduler processes at most computeCapacity(graphMass)
// pairwise comparisons (O(sqrt(t * log(1+t))) growth).
// ---------------------------------------------------------------------------

import type { Hash, MetadataStore, MetroidNeighbor, Page, VectorStore } from "../core/types";
import { computeCapacity, DEFAULT_HOTPATH_POLICY, type HotpathPolicy } from "../core/HotpathPolicy";
import { batchComputeSalience, runPromotionSweep } from "../core/SalienceEngine";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface FullNeighborRecalcOptions {
  metadataStore: MetadataStore;
  vectorStore: VectorStore;
  policy?: HotpathPolicy;
  /** Maximum Metroid neighbors stored per page. Default: 16. */
  maxNeighbors?: number;
  /** Current timestamp (ms since epoch). Defaults to Date.now(). */
  now?: number;
}

export interface RecalcResult {
  volumesProcessed: number;
  pagesProcessed: number;
  pairsComputed: number;
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ---------------------------------------------------------------------------
// Main recalc function
// ---------------------------------------------------------------------------

/**
 * Run one cycle of full neighbor graph recalculation.
 *
 * Finds all volumes flagged as dirty (via `needsMetroidRecalc`), loads
 * their pages, computes pairwise cosine similarities, and updates the
 * Metroid neighbor index. Processing is bounded by the Williams-Bound-derived
 * maintenance budget to avoid blocking the idle loop.
 *
 * After recalculation, salience is recomputed for affected pages and a
 * promotion sweep is run to keep the hotpath current.
 */
export async function runFullNeighborRecalc(
  options: FullNeighborRecalcOptions,
): Promise<RecalcResult> {
  const {
    metadataStore,
    vectorStore,
    policy = DEFAULT_HOTPATH_POLICY,
    maxNeighbors = 16,
    now = Date.now(),
  } = options;

  // Find all dirty volumes
  const allVolumes = await metadataStore.getAllVolumes();
  const dirtyVolumes = (
    await Promise.all(
      allVolumes.map(async (v) => ({
        volume: v,
        dirty: await metadataStore.needsMetroidRecalc(v.volumeId),
      })),
    )
  )
    .filter((x) => x.dirty)
    .map((x) => x.volume);

  if (dirtyVolumes.length === 0) {
    return { volumesProcessed: 0, pagesProcessed: 0, pairsComputed: 0 };
  }

  // Compute per-cycle pair budget: O(sqrt(t * log(1+t)))
  const totalGraphMass = (await metadataStore.getAllPages()).length;
  const pairBudget = Math.max(1, computeCapacity(totalGraphMass, policy.c));

  let totalVolumesProcessed = 0;
  let totalPagesProcessed = 0;
  let totalPairsComputed = 0;

  const affectedPageIds = new Set<Hash>();

  for (const volume of dirtyVolumes) {
    if (totalPairsComputed >= pairBudget) break;

    // Collect all pages in this volume (via books)
    const volumePages: Page[] = [];
    for (const bookId of volume.bookIds) {
      const book = await metadataStore.getBook(bookId);
      if (!book) continue;
      for (const pageId of book.pageIds) {
        const page = await metadataStore.getPage(pageId);
        if (page) volumePages.push(page);
      }
    }

    if (volumePages.length === 0) {
      await metadataStore.clearMetroidRecalcFlag(volume.volumeId);
      totalVolumesProcessed++;
      continue;
    }

    // Load all embedding vectors for this volume's pages
    const vectors = await Promise.all(
      volumePages.map((p) =>
        vectorStore.readVector(p.embeddingOffset, p.embeddingDim),
      ),
    );

    // Compute pairwise similarities and build neighbor lists
    const pairsInVolume = volumePages.length * (volumePages.length - 1);
    if (totalPairsComputed + pairsInVolume > pairBudget && totalVolumesProcessed > 0) {
      // Budget exhausted — leave this volume dirty for next cycle
      break;
    }

    for (let i = 0; i < volumePages.length; i++) {
      const page = volumePages[i];
      const vecI = vectors[i];

      const neighbors: MetroidNeighbor[] = [];

      for (let j = 0; j < volumePages.length; j++) {
        if (i === j) continue;
        const sim = cosineSimilarity(vecI, vectors[j]);
        neighbors.push({
          neighborPageId: volumePages[j].pageId,
          cosineSimilarity: sim,
          distance: 1 - sim,
        });
        totalPairsComputed++;
      }

      // Sort by similarity descending; keep top maxNeighbors
      neighbors.sort(
        (a, b) =>
          b.cosineSimilarity - a.cosineSimilarity ||
          a.neighborPageId.localeCompare(b.neighborPageId),
      );
      const topNeighbors = neighbors.slice(0, maxNeighbors);

      await metadataStore.putMetroidNeighbors(page.pageId, topNeighbors);
      affectedPageIds.add(page.pageId);
    }

    // Clear the dirty flag
    await metadataStore.clearMetroidRecalcFlag(volume.volumeId);
    totalVolumesProcessed++;
    totalPagesProcessed += volumePages.length;
  }

  // Recompute salience and run promotion sweep for all affected pages
  if (affectedPageIds.size > 0) {
    const ids = [...affectedPageIds];
    await batchComputeSalience(ids, metadataStore, policy, now);
    await runPromotionSweep(ids, metadataStore, policy, now);
  }

  return {
    volumesProcessed: totalVolumesProcessed,
    pagesProcessed: totalPagesProcessed,
    pairsComputed: totalPairsComputed,
  };
}
