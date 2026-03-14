import type { ModelProfile } from "../core/ModelProfile";
import type { Hash, MetadataStore, Page, VectorStore } from "../core/types";
import type { EmbeddingRunner } from "../embeddings/EmbeddingRunner";
import { runPromotionSweep } from "../core/SalienceEngine";
import { computeSubgraphBounds } from "../core/HotpathPolicy";
import type { QueryResult } from "./QueryResult";
import { rankPages, rankBooks, rankVolumes, rankShelves, spillToWarm } from "./Ranking";
import { buildMetroid } from "./MetroidBuilder";
import { detectKnowledgeGap } from "./KnowledgeGapDetector";
import { solveOpenTSP } from "./OpenTSPSolver";

export interface QueryOptions {
  modelProfile: ModelProfile;
  embeddingRunner: EmbeddingRunner;
  vectorStore: VectorStore;
  metadataStore: MetadataStore;
  topK?: number;
  /**
   * Maximum BFS depth for semantic neighbor subgraph expansion.
   *
   * When omitted, a dynamic Williams-derived value is computed from the
   * corpus size via `computeSubgraphBounds(t)`.  Providing an explicit value
   * overrides the dynamic bound (useful for tests and controlled experiments).
   */
  maxHops?: number;
}

export async function query(
  queryText: string,
  options: QueryOptions,
): Promise<QueryResult> {
  const {
    modelProfile,
    embeddingRunner,
    vectorStore,
    metadataStore,
    topK = 10,
  } = options;
  const nowIso = new Date().toISOString();

  const embeddings = await embeddingRunner.embed([queryText]);
  if (embeddings.length !== 1) {
    throw new Error("Embedding provider returned unexpected number of embeddings");
  }
  const queryEmbedding = embeddings[0];

  const rankingOptions = { vectorStore, metadataStore };

  // --- Hierarchical routing: Shelf → Volume → Book → Page ---
  // When higher-tier hotpath entries exist, we route through the hierarchy
  // to narrow the candidate set before flat page scoring.
  const hotpathShelfEntries = await metadataStore.getHotpathEntries("shelf");
  const hotpathVolumeEntries = await metadataStore.getHotpathEntries("volume");
  const hotpathBookEntries = await metadataStore.getHotpathEntries("book");
  const hotpathPageEntries = await metadataStore.getHotpathEntries("page");

  // Collect candidate page IDs from hierarchical routing.
  const hierarchyPageIds = new Set<Hash>();

  // Shelf → Volume → Book → Page drill-down
  if (hotpathShelfEntries.length > 0) {
    const topShelves = await rankShelves(
      queryEmbedding,
      hotpathShelfEntries.map((e) => e.entityId),
      Math.max(2, Math.ceil(hotpathShelfEntries.length / 2)),
      rankingOptions,
    );
    for (const s of topShelves) {
      const shelf = await metadataStore.getShelf(s.id);
      if (shelf) {
        for (const vid of shelf.volumeIds) hierarchyPageIds.add(vid);
      }
    }
  }

  // Rank volumes — include both hotpath volumes and those found via shelf drill-down
  const volumeCandidateIds = new Set<Hash>([
    ...hotpathVolumeEntries.map((e) => e.entityId),
    ...hierarchyPageIds,
  ]);
  hierarchyPageIds.clear();

  if (volumeCandidateIds.size > 0) {
    const topVolumes = await rankVolumes(
      queryEmbedding,
      [...volumeCandidateIds],
      Math.max(2, Math.ceil(volumeCandidateIds.size / 2)),
      rankingOptions,
    );
    for (const v of topVolumes) {
      const volume = await metadataStore.getVolume(v.id);
      if (volume) {
        for (const bid of volume.bookIds) hierarchyPageIds.add(bid);
      }
    }
  }

  // Rank books — include both hotpath books and those found via volume drill-down
  const bookCandidateIds = new Set<Hash>([
    ...hotpathBookEntries.map((e) => e.entityId),
    ...hierarchyPageIds,
  ]);
  hierarchyPageIds.clear();

  if (bookCandidateIds.size > 0) {
    const topBooks = await rankBooks(
      queryEmbedding,
      [...bookCandidateIds],
      Math.max(2, Math.ceil(bookCandidateIds.size / 2)),
      rankingOptions,
    );
    for (const b of topBooks) {
      const book = await metadataStore.getBook(b.id);
      if (book) {
        for (const pid of book.pageIds) hierarchyPageIds.add(pid);
      }
    }
  }

  // --- HOT path: score resident pages merged with hierarchy-discovered pages ---
  const hotpathIds = hotpathPageEntries.map((e) => e.entityId);
  const combinedPageIds = new Set<Hash>([...hotpathIds, ...hierarchyPageIds]);

  const hotResults = await rankPages(queryEmbedding, [...combinedPageIds], topK, rankingOptions);
  const seenIds = new Set(hotResults.map((r) => r.id));

  // --- Warm spill: fill up to topK if hot path is insufficient ---
  let warmResults: Array<{ id: Hash; score: number }> = [];
  if (hotResults.length < topK) {
    const allWarm = await spillToWarm("page", queryEmbedding, topK, rankingOptions);
    warmResults = allWarm.filter((r) => !seenIds.has(r.id));
  }

  // Merge, deduplicate, sort, and slice to topK
  const merged = [...hotResults, ...warmResults];
  merged.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const topResults = merged.slice(0, topK);

  // Load Page objects for the top results
  const topPages = (
    await Promise.all(topResults.map((r) => metadataStore.getPage(r.id)))
  ).filter((p): p is Page => p !== undefined);

  const topScores = topResults
    .filter((r) => topPages.some((p) => p.pageId === r.id))
    .map((r) => r.score);

  // --- MetroidBuilder: build dialectical probe ---
  // Candidates: hotpath book medoid pages + top-ranked pages
  const bookCandidates = (
    await Promise.all(
      hotpathBookEntries.map(async (e) => {
        const book = await metadataStore.getBook(e.entityId);
        if (!book) return null;
        const medoidPage = await metadataStore.getPage(book.medoidPageId);
        if (!medoidPage) return null;
        return {
          pageId: medoidPage.pageId,
          embeddingOffset: medoidPage.embeddingOffset,
          embeddingDim: medoidPage.embeddingDim,
        };
      }),
    )
  ).filter((c): c is NonNullable<typeof c> => c !== null);

  const pageCandidates = topPages.map((p) => ({
    pageId: p.pageId,
    embeddingOffset: p.embeddingOffset,
    embeddingDim: p.embeddingDim,
  }));

  // Deduplicate candidates by pageId
  const candidateMap = new Map<Hash, { pageId: Hash; embeddingOffset: number; embeddingDim: number }>();
  for (const c of [...bookCandidates, ...pageCandidates]) {
    candidateMap.set(c.pageId, c);
  }
  const metroidCandidates = [...candidateMap.values()];

  const metroid = await buildMetroid(queryEmbedding, metroidCandidates, {
    modelProfile,
    vectorStore,
  });

  // --- KnowledgeGapDetector ---
  const knowledgeGap = await detectKnowledgeGap(
    queryText,
    queryEmbedding,
    metroid,
    modelProfile,
  );

  // --- Subgraph expansion ---
  // Use dynamic Williams-derived bounds unless the caller has pinned an
  // explicit maxHops value.  Prefer the hotpath resident count as an efficient
  // proxy for corpus size to avoid scanning all pages on the hot path.
  const topPageIds = topPages.map((p) => p.pageId);
  let effectiveMaxHops: number;
  if (options.maxHops !== undefined) {
    effectiveMaxHops = options.maxHops;
  } else {
    const residentCount = await metadataStore.getResidentCount();
    const graphMass = residentCount > 0 ? residentCount : combinedPageIds.size;
    effectiveMaxHops = computeSubgraphBounds(Math.max(1, graphMass)).maxHops;
  }
  const subgraph = await metadataStore.getInducedNeighborSubgraph(topPageIds, effectiveMaxHops);

  // --- TSP coherence path ---
  const coherencePath = solveOpenTSP(subgraph);

  // --- Update activity for returned pages ---
  await Promise.all(
    topPages.map(async (page) => {
      const activity = await metadataStore.getPageActivity(page.pageId);
      await metadataStore.putPageActivity({
        pageId: page.pageId,
        queryHitCount: (activity?.queryHitCount ?? 0) + 1,
        lastQueryAt: nowIso,
        communityId: activity?.communityId,
      });
    }),
  );

  // --- Promotion sweep ---
  await runPromotionSweep(topPageIds, metadataStore);

  return {
    pages: topPages,
    scores: topScores,
    coherencePath,
    metroid,
    knowledgeGap,
    metadata: {
      queryText,
      topK,
      returned: topPages.length,
      timestamp: nowIso,
      modelId: modelProfile.modelId,
    },
  };
}
