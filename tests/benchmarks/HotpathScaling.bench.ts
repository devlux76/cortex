/**
 * P3-D4: Hotpath scaling benchmarks.
 *
 * Measures salience promotion/eviction throughput and validates that:
 *  - Resident set size never exceeds H(t)
 *  - H(t) grows sublinearly (H(t)/t shrinks as t grows)
 *
 * Uses synthetic in-memory graphs at several scale points.
 * No real embeddings or I/O — pure salience policy arithmetic.
 */
import { bench, describe, expect } from "vitest";

import {
  computeCapacity,
  DEFAULT_HOTPATH_POLICY,
} from "../../core/HotpathPolicy";
import {
  bootstrapHotpath,
  runPromotionSweep,
} from "../../core/SalienceEngine";
import type {
  Edge,
  Hash,
  HotpathEntry,
  MetadataStore,
  MetroidSubgraph,
  Page,
  PageActivity,
  Book,
  Volume,
  Shelf,
} from "../../core/types";
import type { MetroidNeighbor } from "../../core/types";

// ---------------------------------------------------------------------------
// In-memory MetadataStore for benchmark (no IDB overhead)
// ---------------------------------------------------------------------------

class BenchMetadataStore implements MetadataStore {
  private pages = new Map<Hash, Page>();
  private edges: Edge[] = [];
  private activities = new Map<Hash, PageActivity>();
  private hotpath = new Map<Hash, HotpathEntry>();

  seedPages(count: number): void {
    for (let i = 0; i < count; i++) {
      const pageId = `page-${i.toString().padStart(8, "0")}`;
      this.pages.set(pageId, {
        pageId,
        content: `synthetic page ${i}`,
        embeddingOffset: i * 64 * 4,
        embeddingDim: 64,
        contentHash: pageId,
        vectorHash: pageId,
        creatorPubKey: "bench-key",
        signature: "bench-sig",
        createdAt: new Date(i).toISOString(),
      });
      this.activities.set(pageId, {
        pageId,
        queryHitCount: i % 10,
        lastQueryAt: new Date(i).toISOString(),
        communityId: `community-${i % 5}`,
      });
    }
  }

  async getAllPages(): Promise<Page[]> { return [...this.pages.values()]; }
  async getPage(id: Hash): Promise<Page | undefined> { return this.pages.get(id); }
  async putPage(page: Page): Promise<void> { this.pages.set(page.pageId, page); }

  async putEdges(edges: Edge[]): Promise<void> { this.edges.push(...edges); }
  async getNeighbors(pageId: Hash): Promise<Edge[]> {
    return this.edges.filter((e) => e.fromPageId === pageId);
  }

  async putPageActivity(activity: PageActivity): Promise<void> {
    this.activities.set(activity.pageId, activity);
  }
  async getPageActivity(pageId: Hash): Promise<PageActivity | undefined> {
    return this.activities.get(pageId);
  }

  async putHotpathEntry(entry: HotpathEntry): Promise<void> {
    this.hotpath.set(entry.entityId, entry);
  }
  async getHotpathEntries(tier?: HotpathEntry["tier"]): Promise<HotpathEntry[]> {
    const all = [...this.hotpath.values()];
    return tier !== undefined ? all.filter((e) => e.tier === tier) : all;
  }
  async removeHotpathEntry(id: Hash): Promise<void> { this.hotpath.delete(id); }
  async evictWeakest(tier: HotpathEntry["tier"]): Promise<void> {
    const entries = (await this.getHotpathEntries(tier)).sort(
      (a, b) => a.salience - b.salience,
    );
    if (entries.length > 0) this.hotpath.delete(entries[0].entityId);
  }
  async getResidentCount(): Promise<number> { return this.hotpath.size; }

  // Stubs
  async putBook(): Promise<void> { /* stub */ }
  async getBook(): Promise<undefined> { return undefined; }
  async putVolume(): Promise<void> { /* stub */ }
  async getVolume(): Promise<undefined> { return undefined; }
  async putShelf(): Promise<void> { /* stub */ }
  async getShelf(): Promise<undefined> { return undefined; }
  async getBooksByPage(): Promise<Book[]> { return []; }
  async getVolumesByBook(): Promise<Volume[]> { return []; }
  async getShelvesByVolume(): Promise<Shelf[]> { return []; }
  async putMetroidNeighbors(): Promise<void> { /* stub */ }
  async getMetroidNeighbors(): Promise<MetroidNeighbor[]> { return []; }
  async getInducedMetroidSubgraph(): Promise<MetroidSubgraph> { return { nodes: [], edges: [] }; }
  async needsMetroidRecalc(): Promise<boolean> { return false; }
  async flagVolumeForMetroidRecalc(): Promise<void> { /* stub */ }
  async clearMetroidRecalcFlag(): Promise<void> { /* stub */ }
}

// ---------------------------------------------------------------------------
// Williams Bound assertion helper
// ---------------------------------------------------------------------------

async function assertWilliamsBound(
  store: BenchMetadataStore,
  graphMass: number,
): Promise<void> {
  const capacity = computeCapacity(graphMass, DEFAULT_HOTPATH_POLICY.c);
  const residentCount = await store.getResidentCount();
  expect(residentCount).toBeLessThanOrEqual(capacity);
}

// ---------------------------------------------------------------------------
// Benchmark suites
// ---------------------------------------------------------------------------

describe("Hotpath Scaling — 1K nodes", async () => {
  const SCALE = 1_000;
  const store = new BenchMetadataStore();
  store.seedPages(SCALE);
  const allPages = await store.getAllPages();

  await bootstrapHotpath(store, DEFAULT_HOTPATH_POLICY, allPages.map((p) => p.pageId));
  await assertWilliamsBound(store, SCALE);

  bench("promotion sweep — 1K node graph", async () => {
    const sample = allPages.slice(0, 20).map((p) => p.pageId);
    await runPromotionSweep(sample, store);
  });
});

describe("Hotpath Scaling — 5K nodes", async () => {
  const SCALE = 5_000;
  const store = new BenchMetadataStore();
  store.seedPages(SCALE);
  const allPages = await store.getAllPages();

  await bootstrapHotpath(store, DEFAULT_HOTPATH_POLICY, allPages.map((p) => p.pageId));
  await assertWilliamsBound(store, SCALE);

  bench("promotion sweep — 5K node graph", async () => {
    const sample = allPages.slice(0, 20).map((p) => p.pageId);
    await runPromotionSweep(sample, store);
  });
});

describe("Williams Bound — sublinear growth invariant", () => {
  bench("H(t) values at scale checkpoints", () => {
    const checkpoints = [1_000, 10_000, 100_000, 1_000_000];
    let prevRatio = Infinity;

    for (const t of checkpoints) {
      const ht = computeCapacity(t, DEFAULT_HOTPATH_POLICY.c);
      const ratio = ht / t;
      expect(ratio).toBeLessThan(prevRatio);
      prevRatio = ratio;
    }
  });
});
