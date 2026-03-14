// ---------------------------------------------------------------------------
// ExperienceReplay — Idle-time query simulation for Hebbian reinforcement
// ---------------------------------------------------------------------------
//
// During idle periods the Daydreamer background worker samples recent or
// random pages, re-executes synthetic queries from their content, and
// marks traversed edges for Long-Term Potentiation (LTP).
//
// This reinforces connection patterns that were useful in the past and
// prevents them from decaying through disuse.
// ---------------------------------------------------------------------------

import type { EmbeddingRunner } from "../embeddings/EmbeddingRunner";
import type { ModelProfile } from "../core/ModelProfile";
import type { MetadataStore, Page, VectorStore, Edge } from "../core/types";
import { query as cortexQuery } from "../cortex/Query";
import type { QueryOptions } from "../cortex/Query";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ExperienceReplayOptions {
  /**
   * Number of synthetic queries to execute per replay cycle.
   * Defaults to 5.
   */
  queriesPerCycle?: number;

  /**
   * Maximum number of pages to consider as query sources.
   * When set, only the most recently created pages are sampled.
   * Defaults to 200 (recent-biased sampling pool).
   */
  samplePoolSize?: number;

  /**
   * LTP weight increment applied to edges traversed during replay.
   * Defaults to 0.1.
   */
  ltpIncrement?: number;

  /**
   * Maximum Hebbian edge weight. Weights are clamped to this value after LTP.
   * Defaults to 1.0.
   */
  maxEdgeWeight?: number;

  /**
   * Top-K pages to retrieve per synthetic query.
   * Defaults to 5.
   */
  topK?: number;
}

const DEFAULT_QUERIES_PER_CYCLE = 5;
const DEFAULT_SAMPLE_POOL_SIZE = 200;
const DEFAULT_LTP_INCREMENT = 0.1;
const DEFAULT_MAX_EDGE_WEIGHT = 1.0;
const DEFAULT_TOP_K = 5;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ExperienceReplayResult {
  /** Number of synthetic queries executed. */
  queriesExecuted: number;

  /** Total number of edge weight updates applied. */
  edgesStrengthened: number;

  /** ISO timestamp when the replay cycle completed. */
  completedAt: string;
}

// ---------------------------------------------------------------------------
// ExperienceReplay
// ---------------------------------------------------------------------------

export class ExperienceReplay {
  private readonly queriesPerCycle: number;
  private readonly samplePoolSize: number;
  private readonly ltpIncrement: number;
  private readonly maxEdgeWeight: number;
  private readonly topK: number;

  constructor(options: ExperienceReplayOptions = {}) {
    this.queriesPerCycle = options.queriesPerCycle ?? DEFAULT_QUERIES_PER_CYCLE;
    this.samplePoolSize = options.samplePoolSize ?? DEFAULT_SAMPLE_POOL_SIZE;
    this.ltpIncrement = options.ltpIncrement ?? DEFAULT_LTP_INCREMENT;
    this.maxEdgeWeight = options.maxEdgeWeight ?? DEFAULT_MAX_EDGE_WEIGHT;
    this.topK = options.topK ?? DEFAULT_TOP_K;
  }

  /**
   * Run one replay cycle.
   *
   * 1. Sample `queriesPerCycle` pages from the store (recent-biased).
   * 2. Execute a synthetic query for each sampled page using its content.
   * 3. Strengthen (LTP) Hebbian edges connecting query results to the source page.
   *
   * @returns Summary statistics for the cycle.
   */
  async run(
    modelProfile: ModelProfile,
    embeddingRunner: EmbeddingRunner,
    vectorStore: VectorStore,
    metadataStore: MetadataStore,
  ): Promise<ExperienceReplayResult> {
    const allPages = await metadataStore.getAllPages();
    if (allPages.length === 0) {
      return {
        queriesExecuted: 0,
        edgesStrengthened: 0,
        completedAt: new Date().toISOString(),
      };
    }

    const pool = this.buildSamplePool(allPages);
    const sources = this.sampleWithoutReplacement(pool, this.queriesPerCycle);

    const queryOptions: QueryOptions = {
      modelProfile,
      embeddingRunner,
      vectorStore,
      metadataStore,
      topK: this.topK,
    };

    let edgesStrengthened = 0;

    for (const sourcePage of sources) {
      const result = await cortexQuery(sourcePage.content, queryOptions);
      const resultPageIds = result.pages.map((p) => p.pageId);

      edgesStrengthened += await this.applyLtp(
        sourcePage.pageId,
        resultPageIds,
        metadataStore,
      );
    }

    return {
      queriesExecuted: sources.length,
      edgesStrengthened,
      completedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a sample pool from `allPages`.
   *
   * Sorts pages by `createdAt` descending (most recent first) and caps the
   * pool at `samplePoolSize` to give recent pages a higher selection probability.
   */
  private buildSamplePool(allPages: Page[]): Page[] {
    const sorted = [...allPages].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    return sorted.slice(0, this.samplePoolSize);
  }

  /**
   * Sample up to `count` pages from `pool` without replacement using a
   * Fisher-Yates partial shuffle.
   */
  private sampleWithoutReplacement(pool: Page[], count: number): Page[] {
    const arr = [...pool];
    const take = Math.min(count, arr.length);

    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(Math.random() * (arr.length - i));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr.slice(0, take);
  }

  /**
   * Apply LTP to edges between `sourcePageId` and each page in `resultPageIds`.
   *
   * Fetches existing Hebbian edges, increments their weight by `ltpIncrement`
   * (clamped to `maxEdgeWeight`), and writes them back.
   *
   * New edges are created when none exist between the source and a result page.
   *
   * @returns The number of edge weight updates written.
   */
  private async applyLtp(
    sourcePageId: string,
    resultPageIds: string[],
    metadataStore: MetadataStore,
  ): Promise<number> {
    if (resultPageIds.length === 0) return 0;

    const existingEdges = await metadataStore.getNeighbors(sourcePageId);
    const edgeMap = new Map<string, Edge>(
      existingEdges.map((e) => [e.toPageId, e]),
    );

    const now = new Date().toISOString();
    const updatedEdges: Edge[] = [];

    for (const targetId of resultPageIds) {
      if (targetId === sourcePageId) continue;

      const existing = edgeMap.get(targetId);
      const currentWeight = existing?.weight ?? 0;
      const newWeight = Math.min(
        currentWeight + this.ltpIncrement,
        this.maxEdgeWeight,
      );

      updatedEdges.push({
        fromPageId: sourcePageId,
        toPageId: targetId,
        weight: newWeight,
        lastUpdatedAt: now,
      });
    }

    if (updatedEdges.length > 0) {
      await metadataStore.putEdges(updatedEdges);
    }

    return updatedEdges.length;
  }
}
