import type { Hash, MetadataStore, SemanticNeighbor, VectorStore } from "../core/types";
import type { ModelProfile } from "../core/ModelProfile";
import type { HotpathPolicy } from "../core/HotpathPolicy";
import { computeNeighborMaxDegree } from "../core/HotpathPolicy";
import { runPromotionSweep } from "../core/SalienceEngine";

// Hard cap for the semantic neighbor degree: even if the Williams formula
// returns a higher value, we never allow a node to have more than this many
// semantic neighbors.  Kept as a policy constant (not model-derived).
const NEIGHBOR_DEGREE_HARD_CAP = 32;

// Default cosine-distance cutoff when no policy hint is available.
// Cosine distance 0.5 ≡ cosine similarity 0.5 (≥ 0.5 similarity passes).
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
    cutoffDistance = DEFAULT_CUTOFF_DISTANCE,
  } = options;

  // Derive maxDegree from the Williams bound if a policy is supplied and the
  // caller has not pinned an explicit value.  This keeps the semantic neighbor
  // graph sparse in proportion to corpus size rather than hardcoding a constant.
  let maxDegree: number;
  if (options.maxDegree !== undefined) {
    maxDegree = options.maxDegree;
  } else if (policy) {
    maxDegree = computeNeighborMaxDegree(allPageIds.length, policy.c, NEIGHBOR_DEGREE_HARD_CAP);
  } else {
    maxDegree = NEIGHBOR_DEGREE_HARD_CAP;
  }

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

  // (a) Throw if any newPageId is missing from the store — a missing new page
  // is always a programming error (it should have been persisted before calling
  // insertSemanticNeighbors) and would silently corrupt the graph.
  for (const newId of newPageIds) {
    if (!offsetMap.has(newId)) {
      throw new Error(
        `Page ${newId} not found in metadata store; persist it before inserting semantic neighbors`,
      );
    }
  }

  // (b) Filter allPageIds to only those that are present in the store.
  // Missing entries are silently dropped — they may have been deleted between
  // the getAllPages() call and this point. The vector/id arrays stay aligned.
  const resolvedPageIds: Hash[] = [];
  const resolvedOffsets: number[] = [];
  for (const id of allPageIds) {
    const offset = offsetMap.get(id);
    if (offset !== undefined) {
      resolvedPageIds.push(id);
      resolvedOffsets.push(offset);
    }
  }

  const allVectors = await vectorStore.readVectors(resolvedOffsets, dim);
  const vectorMap = new Map<Hash, Float32Array>();
  for (let i = 0; i < resolvedPageIds.length; i++) {
    vectorMap.set(resolvedPageIds[i], allVectors[i]);
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
