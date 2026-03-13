import type { Book, MetadataStore, Shelf, Volume, VectorStore } from "../core/types";
import type { ModelProfile } from "../core/ModelProfile";
import { hashText } from "../core/crypto/hash";
import type { KeyPair } from "../core/crypto/sign";
import { EmbeddingRunner } from "../embeddings/EmbeddingRunner";
import { chunkText } from "./Chunker";
import { buildPage } from "./PageBuilder";
import { runPromotionSweep } from "../core/SalienceEngine";
import { buildHierarchy } from "./HierarchyBuilder";
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
  book?: Book;
  volumes?: Volume[];
  shelves?: Shelf[];
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

  // Build hierarchy (books, volumes, shelves) from the ingested pages.
  const { books, volumes, shelves } = await buildHierarchy(pageIds, {
    modelProfile,
    vectorStore,
    metadataStore,
  });

  // Use the first book from the hierarchy as the primary book for backward compatibility.
  const book = books[0];

  // Insert semantic neighbor edges for the new pages against all stored pages.
  const allPages = await metadataStore.getAllPages();
  const allPageIds = allPages.map((p) => p.pageId);
  await insertSemanticNeighbors(pageIds, allPageIds, {
    modelProfile,
    vectorStore,
    metadataStore,
  });

  // Run hotpath promotion for the newly ingested pages.
  await runPromotionSweep(pageIds, metadataStore);

  return { pages, book, volumes, shelves };
}
