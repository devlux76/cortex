import type { Book, Hash, MetadataStore, SemanticNeighbor, Shelf, Volume, VectorStore } from "../core/types";
import type { ModelProfile } from "../core/ModelProfile";
import type { HotpathPolicy } from "../core/HotpathPolicy";
import { hashText } from "../core/crypto/hash";
import { runPromotionSweep } from "../core/SalienceEngine";

// Clustering fan-out targets — policy constants, not model-derived.
// 8 pages/book keeps books coarse enough for medoid selection to be meaningful
// without O(n²) pair-wise cost blowing up. 4 books/volume and 4 volumes/shelf
// mirror a balanced 4-ary hierarchy consistent with Williams Bound routing.
const PAGES_PER_BOOK = 8;
const BOOKS_PER_VOLUME = 4;
const VOLUMES_PER_SHELF = 4;

// Max neighbors per page for the adjacency edges added by the hierarchy builder.
// Adjacency edges represent document-order contiguity and bypass the cosine
// cutoff used by FastNeighborInsert, so they must still be bounded by policy.
const ADJACENCY_MAX_DEGREE = 16;

export interface BuildHierarchyOptions {
  modelProfile: ModelProfile;
  vectorStore: VectorStore;
  metadataStore: MetadataStore;
  policy?: HotpathPolicy;
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

function cosineDistance(a: Float32Array, b: Float32Array): number {
  return 1 - cosineSimilarity(a, b);
}

function computeCentroid(vectors: Float32Array[]): Float32Array {
  const dim = vectors[0].length;
  const centroid = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += v[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    centroid[i] /= vectors.length;
  }
  return centroid;
}

/** Returns the index in `vectors` whose sum of distances to all others is minimal. */
function selectMedoidIndex(vectors: Float32Array[]): number {
  if (vectors.length === 1) return 0;

  let bestIndex = 0;
  let bestTotalDistance = Infinity;

  for (let i = 0; i < vectors.length; i++) {
    let totalDistance = 0;
    for (let j = 0; j < vectors.length; j++) {
      if (i !== j) totalDistance += cosineDistance(vectors[i], vectors[j]);
    }
    if (totalDistance < bestTotalDistance) {
      bestTotalDistance = totalDistance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Merge a candidate into a neighbor list, respecting maxDegree.
 * If at capacity, evicts the neighbor with the lowest cosineSimilarity.
 * Returns the updated list sorted by cosineSimilarity descending.
 */
function mergeAdjacentNeighbor(
  existing: SemanticNeighbor[],
  candidate: SemanticNeighbor,
  maxDegree: number,
): SemanticNeighbor[] {
  const deduped = existing.filter((n) => n.neighborPageId !== candidate.neighborPageId);

  if (deduped.length < maxDegree) {
    deduped.push(candidate);
  } else {
    let weakestIdx = 0;
    for (let i = 1; i < deduped.length; i++) {
      if (deduped[i].cosineSimilarity < deduped[weakestIdx].cosineSimilarity) {
        weakestIdx = i;
      }
    }
    if (candidate.cosineSimilarity > deduped[weakestIdx].cosineSimilarity) {
      deduped[weakestIdx] = candidate;
    }
  }

  deduped.sort((a, b) => b.cosineSimilarity - a.cosineSimilarity);
  return deduped;
}

export async function buildHierarchy(
  pageIds: Hash[],
  options: BuildHierarchyOptions,
): Promise<{ books: Book[]; volumes: Volume[]; shelves: Shelf[] }> {
  const { modelProfile, vectorStore, metadataStore, policy } = options;
  const dim = modelProfile.embeddingDimension;

  if (pageIds.length === 0) {
    return { books: [], volumes: [], shelves: [] };
  }

  // Fetch all page records to get their embedding offsets.
  const pageRecords = await Promise.all(pageIds.map((id) => metadataStore.getPage(id)));
  const pageOffsets = pageRecords.map((p, i) => {
    if (!p) throw new Error(`Page ${pageIds[i]} not found during hierarchy build`);
    return p.embeddingOffset;
  });
  const pageVectors = await vectorStore.readVectors(pageOffsets, dim);

  // Build a Map<pageId, vector> for O(1) lookups throughout the hierarchy build.
  const pageVectorMap = new Map<Hash, Float32Array>();
  for (let i = 0; i < pageIds.length; i++) {
    pageVectorMap.set(pageIds[i], pageVectors[i]);
  }

  // -------------------------------------------------------------------------
  // Level 1: Pages → Books
  // -------------------------------------------------------------------------
  const pageChunks = chunkArray(pageIds, PAGES_PER_BOOK);
  const books: Book[] = [];

  for (const chunk of pageChunks) {
    const sortedChunk = [...chunk].sort();
    const bookId = await hashText(sortedChunk.join("|"));

    const chunkVectors = chunk.map((id) => {
      const vec = pageVectorMap.get(id);
      if (!vec) throw new Error(`Vector not found for page ${id}`);
      return vec;
    });

    const medoidIdx = selectMedoidIndex(chunkVectors);
    const medoidPageId = chunk[medoidIdx];

    const book: Book = { bookId, pageIds: chunk, medoidPageId, meta: {} };
    await metadataStore.putBook(book);
    books.push(book);
  }

  // Add SemanticNeighbor edges between consecutive pages within each book slice.
  // These document-order adjacency edges are always inserted regardless of cosine
  // cutoff, because adjacent text chunks of the same source are always related.
  for (const book of books) {
    for (let i = 0; i < book.pageIds.length - 1; i++) {
      const aId = book.pageIds[i];
      const bId = book.pageIds[i + 1];
      const aVec = pageVectorMap.get(aId);
      const bVec = pageVectorMap.get(bId);
      if (!aVec || !bVec) continue;

      const sim = cosineSimilarity(aVec, bVec);
      const dist = 1 - sim;
      const forwardEdge: SemanticNeighbor = { neighborPageId: bId, cosineSimilarity: sim, distance: dist };
      const reverseEdge: SemanticNeighbor = { neighborPageId: aId, cosineSimilarity: sim, distance: dist };

      // Forward: a → b
      const existingA = await metadataStore.getSemanticNeighbors(aId);
      await metadataStore.putSemanticNeighbors(aId, mergeAdjacentNeighbor(existingA, forwardEdge, ADJACENCY_MAX_DEGREE));

      // Reverse: b → a
      const existingB = await metadataStore.getSemanticNeighbors(bId);
      await metadataStore.putSemanticNeighbors(bId, mergeAdjacentNeighbor(existingB, reverseEdge, ADJACENCY_MAX_DEGREE));
    }
  }

  await runPromotionSweep(books.map((b) => b.bookId), metadataStore, policy);

  // -------------------------------------------------------------------------
  // Level 2: Books → Volumes
  // -------------------------------------------------------------------------
  const bookChunks = chunkArray(books, BOOKS_PER_VOLUME);
  const volumes: Volume[] = [];

  for (const bookChunk of bookChunks) {
    const sortedBookIds = bookChunk.map((b) => b.bookId).sort();
    const volumeId = await hashText(sortedBookIds.join("|"));

    const medoidVectors = bookChunk.map((b) => {
      const vec = pageVectorMap.get(b.medoidPageId);
      if (!vec) throw new Error(`Vector not found for medoid page ${b.medoidPageId}`);
      return vec;
    });

    const centroid = computeCentroid(medoidVectors);
    const prototypeOffset = await vectorStore.appendVector(centroid);

    // Average squared cosine distance from centroid.
    let variance = 0;
    for (const v of medoidVectors) {
      const dist = cosineDistance(v, centroid);
      variance += dist * dist;
    }
    variance /= medoidVectors.length;

    const volume: Volume = {
      volumeId,
      bookIds: bookChunk.map((b) => b.bookId),
      prototypeOffsets: [prototypeOffset],
      prototypeDim: dim,
      variance,
    };
    await metadataStore.putVolume(volume);
    volumes.push(volume);
  }

  await runPromotionSweep(volumes.map((v) => v.volumeId), metadataStore, policy);

  // -------------------------------------------------------------------------
  // Level 3: Volumes → Shelves
  // -------------------------------------------------------------------------
  const volumeChunks = chunkArray(volumes, VOLUMES_PER_SHELF);
  const shelves: Shelf[] = [];

  for (const volumeChunk of volumeChunks) {
    const sortedVolumeIds = volumeChunk.map((v) => v.volumeId).sort();
    const shelfId = await hashText(sortedVolumeIds.join("|"));

    const protoVectors = await Promise.all(
      volumeChunk.map((v) => vectorStore.readVector(v.prototypeOffsets[0], dim)),
    );

    const routingCentroid = computeCentroid(protoVectors);
    const routingOffset = await vectorStore.appendVector(routingCentroid);

    const shelf: Shelf = {
      shelfId,
      volumeIds: volumeChunk.map((v) => v.volumeId),
      routingPrototypeOffsets: [routingOffset],
      routingDim: dim,
    };
    await metadataStore.putShelf(shelf);
    shelves.push(shelf);
  }

  await runPromotionSweep(shelves.map((s) => s.shelfId), metadataStore, policy);

  return { books, volumes, shelves };
}
