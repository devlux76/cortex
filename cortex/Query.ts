import type { ModelProfile } from "../core/ModelProfile";
import type { Hash, MetadataStore, Page, VectorStore } from "../core/types";
import type { EmbeddingRunner } from "../embeddings/EmbeddingRunner";
import { runPromotionSweep } from "../core/SalienceEngine";
import { computeSubgraphBounds } from "../core/HotpathPolicy";
import type { QueryResult } from "./QueryResult";
import { rankPages, spillToWarm } from "./Ranking";
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

  // --- HOT path: score resident pages ---
  const hotpathEntries = await metadataStore.getHotpathEntries("page");
  const hotpathIds = hotpathEntries.map((e) => e.entityId);

  const hotResults = await rankPages(queryEmbedding, hotpathIds, topK, rankingOptions);
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
  // Candidates: hotpath book medoid pages + hotpath pages themselves
  const hotpathBookEntries = await metadataStore.getHotpathEntries("book");
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
  // explicit maxHops value.  Only load all pages when we actually need to
  // compute bounds — skip the full-page scan on the hot path when maxHops is
  // already known.
  const topPageIds = topPages.map((p) => p.pageId);
  let effectiveMaxHops: number;
  if (options.maxHops !== undefined) {
    effectiveMaxHops = options.maxHops;
  } else {
    const allPages = await metadataStore.getAllPages();
    effectiveMaxHops = computeSubgraphBounds(allPages.length).maxHops;
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
