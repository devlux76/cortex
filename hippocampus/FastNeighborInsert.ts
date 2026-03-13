import type { Hash, MetadataStore, SemanticNeighbor, VectorStore } from "../core/types";
import type { ModelProfile } from "../core/ModelProfile";
import type { HotpathPolicy } from "../core/HotpathPolicy";
import { runPromotionSweep } from "../core/SalienceEngine";

// Policy constants, not model-derived.
// 16 neighbors keeps the graph sparse while giving enough connectivity for BFS.
// 0.5 cosine distance (≥0.5 similarity) filters noise without losing near-duplicates.
const DEFAULT_MAX_DEGREE = 16;
const DEFAULT_CUTOFF_DISTANCE = 0.5;

export interface FastNeighborInsertOptions {
  modelProfile: ModelProfile;
  vectorStore: VectorStore;
  metadataStore: MetadataStore;
  policy?: HotpathPolicy;
  maxDegree?: number;
  cutoffDistance?: number;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Merge a new candidate into an existing neighbor list, respecting maxDegree.
 * If at capacity, evict the entry with the lowest cosineSimilarity to make room.
 * Returns the updated list sorted by cosineSimilarity descending.
 */
function mergeNeighbor(
  existing: SemanticNeighbor[],
  candidate: SemanticNeighbor,
  maxDegree: number,
): SemanticNeighbor[] {
  // Avoid duplicates.
  const deduped = existing.filter((n) => n.neighborPageId !== candidate.neighborPageId);

  if (deduped.length < maxDegree) {
    deduped.push(candidate);
  } else {
    // Find weakest existing neighbor.
    let weakestIdx = 0;
    for (let i = 1; i < deduped.length; i++) {
      if (deduped[i].cosineSimilarity < deduped[weakestIdx].cosineSimilarity) {
        weakestIdx = i;
      }
    }
    if (candidate.cosineSimilarity > deduped[weakestIdx].cosineSimilarity) {
      deduped[weakestIdx] = candidate;
    }
    // If candidate is weaker than all existing, discard it (return unchanged).
  }

  deduped.sort((a, b) => b.cosineSimilarity - a.cosineSimilarity);
  return deduped;
}

/**
 * Build and persist semantic neighbor edges for `newPageIds`.
 *
 * Forward edges (newPage → neighbor) and reverse edges (neighbor → newPage)
 * are both stored. This is NOT Hebbian — no edges_hebbian records are created.
 */
export async function insertSemanticNeighbors(
  newPageIds: Hash[],
  allPageIds: Hash[],
  options: FastNeighborInsertOptions,
): Promise<void> {
  const {
    modelProfile,
    vectorStore,
    metadataStore,
    policy,
    maxDegree = DEFAULT_MAX_DEGREE,
    cutoffDistance = DEFAULT_CUTOFF_DISTANCE,
  } = options;

  if (newPageIds.length === 0) return;

  const dim = modelProfile.embeddingDimension;

  // Fetch all page records in batch for their embedding offsets.
  const allPageRecords = await Promise.all(
    allPageIds.map((id) => metadataStore.getPage(id)),
  );

  const offsetMap = new Map<Hash, number>();
  for (let i = 0; i < allPageIds.length; i++) {
    const p = allPageRecords[i];
    if (p) offsetMap.set(allPageIds[i], p.embeddingOffset);
  }

  const allOffsets = allPageIds.map((id) => offsetMap.get(id) ?? 0);
  const allVectors = await vectorStore.readVectors(allOffsets, dim);
  const vectorMap = new Map<Hash, Float32Array>();
  for (let i = 0; i < allPageIds.length; i++) {
    vectorMap.set(allPageIds[i], allVectors[i]);
  }

  // Collect all (pageId, neighborPageId) pairs that need their stored neighbor
  // lists updated, keyed by pageId.
  const pendingUpdates = new Map<Hash, SemanticNeighbor[]>();

  const getOrLoadNeighbors = async (pageId: Hash): Promise<SemanticNeighbor[]> => {
    if (pendingUpdates.has(pageId)) return pendingUpdates.get(pageId)!;
    const stored = await metadataStore.getSemanticNeighbors(pageId);
    pendingUpdates.set(pageId, stored);
    return stored;
  };

  for (const newId of newPageIds) {
    const newVec = vectorMap.get(newId);
    if (!newVec) continue;

    // Compute similarity to every other page.
    const candidates: SemanticNeighbor[] = [];
    for (const otherId of allPageIds) {
      if (otherId === newId) continue;
      const otherVec = vectorMap.get(otherId);
      if (!otherVec) continue;

      const sim = cosineSimilarity(newVec, otherVec);
      const dist = 1 - sim;
      if (dist <= cutoffDistance) {
        candidates.push({ neighborPageId: otherId, cosineSimilarity: sim, distance: dist });
      }
    }

    // Sort descending and cap to maxDegree for the forward list.
    candidates.sort((a, b) => b.cosineSimilarity - a.cosineSimilarity);
    const forwardNeighbors = candidates.slice(0, maxDegree);

    // Merge into the new page's own neighbor list.
    let newPageNeighbors = await getOrLoadNeighbors(newId);
    for (const candidate of forwardNeighbors) {
      newPageNeighbors = mergeNeighbor(newPageNeighbors, candidate, maxDegree);
    }
    pendingUpdates.set(newId, newPageNeighbors);

    // Insert reverse edges: for each accepted forward neighbor, add newId to
    // that neighbor's list.
    for (const fwd of forwardNeighbors) {
      const reverseCandidate: SemanticNeighbor = {
        neighborPageId: newId,
        cosineSimilarity: fwd.cosineSimilarity,
        distance: fwd.distance,
      };
      let neighborList = await getOrLoadNeighbors(fwd.neighborPageId);
      neighborList = mergeNeighbor(neighborList, reverseCandidate, maxDegree);
      pendingUpdates.set(fwd.neighborPageId, neighborList);
    }
  }

  // Flush all updated neighbor lists to the store.
  await Promise.all(
    [...pendingUpdates.entries()].map(([pageId, neighbors]) =>
      metadataStore.putSemanticNeighbors(pageId, neighbors),
    ),
  );

  // Mark affected volumes dirty so the Daydreamer knows to recompute.
  for (const newId of newPageIds) {
    const books = await metadataStore.getBooksByPage(newId);
    for (const book of books) {
      const vols = await metadataStore.getVolumesByBook(book.bookId);
      for (const vol of vols) {
        await metadataStore.flagVolumeForNeighborRecalc(vol.volumeId);
      }
    }
  }

  await runPromotionSweep(newPageIds, metadataStore, policy);
}
