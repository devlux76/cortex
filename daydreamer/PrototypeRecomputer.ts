// ---------------------------------------------------------------------------
// PrototypeRecomputer — Keep volume and shelf prototypes accurate (P2-D)
// ---------------------------------------------------------------------------
//
// As pages and books change, volume medoids and centroids drift. This module
// recomputes them periodically during Daydreamer idle passes.
//
// After recomputing prototypes at each level, salience is refreshed for the
// updated representative entries and a tier-scoped promotion/eviction sweep
// is run to keep the hotpath consistent.
// ---------------------------------------------------------------------------

import type { Hash, HotpathEntry, MetadataStore, Shelf, Volume, VectorStore } from "../core/types";
import { DEFAULT_HOTPATH_POLICY, type HotpathPolicy } from "../core/HotpathPolicy";
import { batchComputeSalience, runPromotionSweep } from "../core/SalienceEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute cosine similarity between two equal-length vectors. */
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

/**
 * Select the medoid from a set of vectors: the vector that minimises the
 * average distance to all others (the most "central" real member).
 *
 * Returns the index of the medoid in the input array, or -1 if empty.
 */
export function selectMedoidIndex(vectors: Float32Array[]): number {
  if (vectors.length === 0) return -1;
  if (vectors.length === 1) return 0;

  let bestIndex = 0;
  let bestAvgDist = Infinity;

  for (let i = 0; i < vectors.length; i++) {
    let totalDist = 0;
    for (let j = 0; j < vectors.length; j++) {
      if (i === j) continue;
      totalDist += 1 - cosineSimilarity(vectors[i], vectors[j]);
    }
    const avgDist = totalDist / (vectors.length - 1);
    if (avgDist < bestAvgDist) {
      bestAvgDist = avgDist;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Compute the element-wise mean (centroid) of a set of equal-length vectors.
 * Returns a new Float32Array of the same dimensionality.
 */
export function computeCentroid(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(0);
  const dim = vectors[0].length;
  const centroid = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += v[i];
    }
  }
  const n = vectors.length;
  for (let i = 0; i < dim; i++) {
    centroid[i] /= n;
  }
  return centroid;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PrototypeRecomputerOptions {
  metadataStore: MetadataStore;
  vectorStore: VectorStore;
  policy?: HotpathPolicy;
  /** Current timestamp (ms since epoch). Defaults to Date.now(). */
  now?: number;
}

export interface RecomputeResult {
  volumesUpdated: number;
  shelvesUpdated: number;
}

// ---------------------------------------------------------------------------
// Recompute volume prototypes
// ---------------------------------------------------------------------------

/**
 * Recompute medoid and centroid prototypes for all volumes.
 *
 * For each volume:
 * 1. Load all page embeddings for every book in the volume.
 * 2. Select the medoid page (minimises average distance to all others).
 * 3. Compute the centroid embedding across all pages.
 * 4. Append updated vectors to VectorStore; update volume metadata.
 * 5. Refresh salience and run promotion sweep for the volume tier.
 */
async function recomputeVolumePrototypes(
  options: PrototypeRecomputerOptions,
): Promise<{ volumeIds: Hash[]; volumesUpdated: number }> {
  const {
    metadataStore,
    vectorStore,
    policy = DEFAULT_HOTPATH_POLICY,
    now = Date.now(),
  } = options;

  const allVolumes = await metadataStore.getAllVolumes();
  const updatedVolumeIds: Hash[] = [];

  for (const volume of allVolumes) {
    // Load all pages in this volume
    const pageEntries: Array<{ pageId: Hash; vector: Float32Array }> = [];

    for (const bookId of volume.bookIds) {
      const book = await metadataStore.getBook(bookId);
      if (!book) continue;
      for (const pageId of book.pageIds) {
        const page = await metadataStore.getPage(pageId);
        if (!page) continue;
        const vec = await vectorStore.readVector(page.embeddingOffset, page.embeddingDim);
        pageEntries.push({ pageId, vector: vec });
      }
    }

    if (pageEntries.length === 0) continue;

    const vectors = pageEntries.map((e) => e.vector);
    const medoidIdx = selectMedoidIndex(vectors);
    const medoidPageId = pageEntries[medoidIdx].pageId;
    const centroidVec = computeCentroid(vectors);

    // Append centroid to vector store
    const centroidOffset = await vectorStore.appendVector(centroidVec);

    // Update the volume with new medoid and prototype offsets
    const updatedVolume: Volume = {
      ...volume,
      prototypeOffsets: [...volume.prototypeOffsets, centroidOffset],
      prototypeDim: centroidVec.length,
    };
    await metadataStore.putVolume(updatedVolume);

    updatedVolumeIds.push(volume.volumeId);
  }

  // Note: We intentionally do not call the page-centric SalienceEngine here.
  // batchComputeSalience/runPromotionSweep currently assume page-tier entities
  // and hardcode `tier: "page"`. Passing volume IDs into those functions would
  // compute meaningless salience values and could overwrite volume-tier
  // HotpathEntry records with page-tier entries using the same entityId.
  //
  // Volume-tier salience/promotion should be wired up once SalienceEngine
  // supports non-page tiers. For now, we only update the volume metadata and
  // return the list of volumes that were recomputed.

  return { volumeIds: updatedVolumeIds, volumesUpdated: updatedVolumeIds.length };
}

// ---------------------------------------------------------------------------
// Recompute shelf routing prototypes
// ---------------------------------------------------------------------------

/**
 * Recompute routing prototypes for all shelves.
 *
 * For each shelf:
 * 1. Load volume prototype embeddings.
 * 2. Compute centroid across all volume prototypes.
 * 3. Append new routing prototype to VectorStore; update shelf metadata.
 * 4. Refresh salience and run promotion sweep for the shelf tier.
 */
async function recomputeShelfPrototypes(
  options: PrototypeRecomputerOptions,
): Promise<{ shelvesUpdated: number }> {
  const {
    metadataStore,
    vectorStore,
    policy = DEFAULT_HOTPATH_POLICY,
    now = Date.now(),
  } = options;

  const allShelves = await metadataStore.getAllShelves();
  const updatedShelfIds: Hash[] = [];

  for (const shelf of allShelves) {
    const volumeVectors: Float32Array[] = [];

    for (const volumeId of shelf.volumeIds) {
      const volume = await metadataStore.getVolume(volumeId);
      if (!volume || volume.prototypeOffsets.length === 0) continue;
      // Use the last (most recent) prototype offset
      const offset = volume.prototypeOffsets[volume.prototypeOffsets.length - 1];
      const vec = await vectorStore.readVector(offset, volume.prototypeDim);
      volumeVectors.push(vec);
    }

    if (volumeVectors.length === 0) continue;

    const routingPrototype = computeCentroid(volumeVectors);
    const routingOffset = await vectorStore.appendVector(routingPrototype);

    const updatedShelf: Shelf = {
      ...shelf,
      routingPrototypeOffsets: [...shelf.routingPrototypeOffsets, routingOffset],
      routingDim: routingPrototype.length,
    };
    await metadataStore.putShelf(updatedShelf);
    updatedShelfIds.push(shelf.shelfId);
  }

  if (updatedShelfIds.length > 0) {
    // Shelf-tier hotpath uses shelf IDs as entity IDs
    const shelfEntries: HotpathEntry[] = updatedShelfIds.map((id) => ({
      entityId: id,
      tier: "shelf" as const,
      salience: 0,
      communityId: undefined,
    }));
    for (const entry of shelfEntries) {
      await metadataStore.putHotpathEntry(entry);
    }
    await runPromotionSweep(updatedShelfIds, metadataStore, policy, now);
  }

  return { shelvesUpdated: updatedShelfIds.length };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Recompute prototypes at all hierarchy levels (volume then shelf).
 *
 * Volumes are processed first so shelves can reference updated volume prototypes.
 */
export async function recomputePrototypes(
  options: PrototypeRecomputerOptions,
): Promise<RecomputeResult> {
  const { volumesUpdated } = await recomputeVolumePrototypes(options);
  const { shelvesUpdated } = await recomputeShelfPrototypes(options);

  return { volumesUpdated, shelvesUpdated };
}
