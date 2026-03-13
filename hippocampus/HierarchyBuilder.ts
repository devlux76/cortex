import type { Book, Hash, MetadataStore, Shelf, Volume, VectorStore } from "../core/types";
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

  // -------------------------------------------------------------------------
  // Level 1: Pages → Books
  // -------------------------------------------------------------------------
  const pageChunks = chunkArray(pageIds, PAGES_PER_BOOK);
  const books: Book[] = [];

  for (const chunk of pageChunks) {
    const sortedChunk = [...chunk].sort();
    const bookId = await hashText(sortedChunk.join("|"));

    const chunkVectors = chunk.map((id) => {
      const idx = pageIds.indexOf(id);
      return pageVectors[idx];
    });

    const medoidIdx = selectMedoidIndex(chunkVectors);
    const medoidPageId = chunk[medoidIdx];

    const book: Book = { bookId, pageIds: chunk, medoidPageId, meta: {} };
    await metadataStore.putBook(book);
    books.push(book);
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
      const idx = pageIds.indexOf(b.medoidPageId);
      return pageVectors[idx];
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
