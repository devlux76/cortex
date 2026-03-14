import type { Book, MetadataStore, VectorStore } from "../core/types";
import type { ModelProfile } from "../core/ModelProfile";
import { hashText } from "../core/crypto/hash";
import type { KeyPair } from "../core/crypto/sign";
import { EmbeddingRunner } from "../embeddings/EmbeddingRunner";
import { chunkText } from "./Chunker";
import { buildPage } from "./PageBuilder";
import { runPromotionSweep } from "../core/SalienceEngine";
import { insertSemanticNeighbors } from "./FastNeighborInsert";

export interface IngestOptions {
  modelProfile: ModelProfile;
  embeddingRunner: EmbeddingRunner;
  vectorStore: VectorStore;
  metadataStore: MetadataStore;
  keyPair: KeyPair;
  now?: number;
}

export interface IngestResult {
  pages: Array<Awaited<ReturnType<typeof buildPage>>>;
  /** The single Book representing everything ingested by this call.
   *  One ingest call = one Book, always. All pages are members.
   *  A collection of Books becomes a Volume; a collection of Volumes
   *  becomes a Shelf — those tiers are assembled by the Daydreamer. */
  book?: Book;
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return 1 - dot / denom;
}

/**
 * Selects the index of the medoid: the element that minimises total cosine
 * distance to every other element in the set.
 */
function selectMedoidIndex(vectors: Float32Array[]): number {
  if (vectors.length === 1) return 0;
  let bestIdx = 0;
  let bestTotal = Infinity;
  for (let i = 0; i < vectors.length; i++) {
    let total = 0;
    for (let j = 0; j < vectors.length; j++) {
      if (i !== j) total += cosineDistance(vectors[i], vectors[j]);
    }
    if (total < bestTotal) {
      bestTotal = total;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export async function ingestText(
  text: string,
  options: IngestOptions,
): Promise<IngestResult> {
  const {
    modelProfile,
    embeddingRunner,
    vectorStore,
    metadataStore,
    keyPair,
    now = Date.now(),
  } = options;

  const chunks = chunkText(text, modelProfile);
  if (chunks.length === 0) {
    return { pages: [], book: undefined };
  }

  const createdAt = new Date(now).toISOString();

  // Precompute page IDs (content hashes) so we can link prev/next before signing.
  const pageIds = await Promise.all(chunks.map((c) => hashText(c)));

  const embeddings = await embeddingRunner.embed(chunks);
  if (embeddings.length !== chunks.length) {
    throw new Error("Embedding provider returned unexpected number of embeddings");
  }

  const offsets: number[] = [];
  for (const embedding of embeddings) {
    const offset = await vectorStore.appendVector(embedding);
    offsets.push(offset);
  }

  const pages = await Promise.all(
    chunks.map(async (content, idx) => {
      const prevPageId = idx > 0 ? pageIds[idx - 1] : null;
      const nextPageId = idx < pageIds.length - 1 ? pageIds[idx + 1] : null;

      return buildPage({
        content,
        embedding: embeddings[idx],
        embeddingOffset: offsets[idx],
        embeddingDim: modelProfile.embeddingDimension,
        creatorPubKey: keyPair.publicKey,
        signingKey: keyPair.signingKey,
        prevPageId,
        nextPageId,
        createdAt,
      });
    }),
  );

  // Persist pages and activity records.
  for (const page of pages) {
    await metadataStore.putPage(page);
    await metadataStore.putPageActivity({
      pageId: page.pageId,
      queryHitCount: 0,
      lastQueryAt: createdAt,
    });
  }

  // Build ONE Book for the entire ingest.
  // A Book = the document we just ingested; its identity is the sorted set of
  // its pages. Its representative is the page whose embedding is the medoid
  // (minimum total cosine distance to all other pages in the document).
  const medoidIdx = selectMedoidIndex(embeddings);
  const sortedPageIds = [...pageIds].sort();
  const bookId = await hashText(sortedPageIds.join("|"));
  const book: Book = {
    bookId,
    pageIds,
    medoidPageId: pageIds[medoidIdx],
    meta: {},
  };
  await metadataStore.putBook(book);

  // Insert semantic neighbor edges for the new pages against all stored pages.
  // Volumes and Shelves are assembled by the Daydreamer from accumulated Books.
  const allPages = await metadataStore.getAllPages();
  const allPageIds = allPages.map((p) => p.pageId);
  await insertSemanticNeighbors(pageIds, allPageIds, {
    modelProfile,
    vectorStore,
    metadataStore,
  });

  // Run hotpath promotion for the newly ingested pages and book.
  await runPromotionSweep([...pageIds, bookId], metadataStore);

  return { pages, book };
}
