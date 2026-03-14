import type { Book, MetadataStore, Volume, Shelf, VectorStore } from "../core/types";
import type { ModelProfile } from "../core/ModelProfile";
import { hashText } from "../core/crypto/hash";
import type { KeyPair } from "../core/crypto/sign";
import { EmbeddingRunner } from "../embeddings/EmbeddingRunner";
import { chunkText } from "./Chunker";
import { buildPage } from "./PageBuilder";
import { insertSemanticNeighbors } from "./FastNeighborInsert";
import { buildHierarchy } from "./HierarchyBuilder";

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
  /** All Books produced by this ingest call.  The hierarchy builder chunks
   *  pages into books of up to PAGES_PER_BOOK and computes a medoid for each. */
  books: Book[];
  /** Convenience alias for `books[0]` — undefined when no pages were ingested. */
  book?: Book;
  /** Volumes produced by grouping books during hierarchy construction. */
  volumes: Volume[];
  /** Shelves produced by grouping volumes during hierarchy construction. */
  shelves: Shelf[];
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
    return { pages: [], books: [], book: undefined, volumes: [], shelves: [] };
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

  // Build the full hierarchy: Pages → Books → Volumes → Shelves.
  // buildHierarchy handles medoid selection, adjacency edges, prototype
  // computation, Williams fanout enforcement, and promotion sweeps.
  // This must run BEFORE insertSemanticNeighbors so that reverse indexes
  // (page→book→volume) exist when the neighbor inserter flags dirty volumes.
  const hierarchy = await buildHierarchy(pageIds, {
    modelProfile,
    vectorStore,
    metadataStore,
  });

  // Insert semantic neighbor edges for the new pages against all stored pages.
  // Runs after hierarchy building so that flagVolumeForNeighborRecalc() can
  // traverse the page→book→volume reverse indexes created above.
  const allPages = await metadataStore.getAllPages();
  const allPageIds = allPages.map((p) => p.pageId);
  await insertSemanticNeighbors(pageIds, allPageIds, {
    modelProfile,
    vectorStore,
    metadataStore,
  });

  return {
    pages,
    books: hierarchy.books,
    book: hierarchy.books[0],
    volumes: hierarchy.volumes,
    shelves: hierarchy.shelves,
  };
}
