/**
 * SalienceEngine test coverage (P0-G3).
 *
 * Uses an in-memory mock of MetadataStore (with hotpath/activity support)
 * to validate salience computation, promotion/eviction lifecycle,
 * community quotas, and deterministic eviction.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type {
  Edge,
  Hash,
  HotpathEntry,
  MetadataStore,
  PageActivity,
} from "../core/types";
import {
  computeCapacity,
  computeSalience,
  DEFAULT_HOTPATH_POLICY,
  deriveCommunityQuotas,
  deriveTierQuotas,
  type HotpathPolicy,
} from "../core/HotpathPolicy";
import {
  batchComputeSalience,
  bootstrapHotpath,
  computeNodeSalience,
  runPromotionSweep,
  selectEvictionTarget,
  shouldPromote,
} from "../core/SalienceEngine";

// ---------------------------------------------------------------------------
// In-memory MetadataStore mock (minimal, only hotpath-relevant methods)
// ---------------------------------------------------------------------------

class MockMetadataStore implements MetadataStore {
  private edges: Edge[] = [];
  private activities = new Map<Hash, PageActivity>();
  private hotpath = new Map<Hash, HotpathEntry>();

  // --- Hebbian edges ---
  async putEdges(edges: Edge[]): Promise<void> {
    for (const e of edges) this.edges.push(e);
  }

  async getNeighbors(pageId: Hash): Promise<Edge[]> {
    return this.edges
      .filter((e) => e.fromPageId === pageId)
      .sort((a, b) => b.weight - a.weight);
  }

  // --- Hotpath index ---
  async putHotpathEntry(entry: HotpathEntry): Promise<void> {
    this.hotpath.set(entry.entityId, { ...entry });
  }

  async getHotpathEntries(tier?: HotpathEntry["tier"]): Promise<HotpathEntry[]> {
    const all = [...this.hotpath.values()];
    return tier !== undefined ? all.filter((e) => e.tier === tier) : all;
  }

  async removeHotpathEntry(entityId: Hash): Promise<void> {
    this.hotpath.delete(entityId);
  }

  async evictWeakest(
    tier: HotpathEntry["tier"],
    communityId?: string,
  ): Promise<void> {
    const entries = await this.getHotpathEntries(tier);
    const filtered = communityId !== undefined
      ? entries.filter((e) => e.communityId === communityId)
      : entries;
    if (filtered.length === 0) return;

    let weakest = filtered[0];
    for (let i = 1; i < filtered.length; i++) {
      if (
        filtered[i].salience < weakest.salience ||
        (filtered[i].salience === weakest.salience &&
          filtered[i].entityId < weakest.entityId)
      ) {
        weakest = filtered[i];
      }
    }
    this.hotpath.delete(weakest.entityId);
  }

  async getResidentCount(): Promise<number> {
    return this.hotpath.size;
  }

  // --- Page activity ---
  async putPageActivity(activity: PageActivity): Promise<void> {
    this.activities.set(activity.pageId, { ...activity });
  }

  async getPageActivity(pageId: Hash): Promise<PageActivity | undefined> {
    return this.activities.get(pageId);
  }

  // --- Stubs for unused MetadataStore methods ---
  async putPage(): Promise<void> { /* stub */ }
  async getPage(): Promise<undefined> { return undefined; }  async getAllPages(): Promise<any[]> { return []; }  async putBook(): Promise<void> { /* stub */ }
  async getBook(): Promise<undefined> { return undefined; }
  async putVolume(): Promise<void> { /* stub */ }
  async getVolume(): Promise<undefined> { return undefined; }
  async putShelf(): Promise<void> { /* stub */ }
  async getShelf(): Promise<undefined> { return undefined; }
  async getBooksByPage(): Promise<never[]> { return []; }
  async getVolumesByBook(): Promise<never[]> { return []; }
  async getShelvesByVolume(): Promise<never[]> { return []; }
  async putMetroidNeighbors(): Promise<void> { /* stub */ }
  async getMetroidNeighbors(): Promise<never[]> { return []; }
  async getInducedMetroidSubgraph() { return { nodes: [], edges: [] }; }
  async needsMetroidRecalc(): Promise<boolean> { return false; }
  async flagVolumeForMetroidRecalc(): Promise<void> { /* stub */ }
  async clearMetroidRecalcFlag(): Promise<void> { /* stub */ }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Fixed timestamp for deterministic tests. */
const NOW = Date.parse("2026-03-13T00:00:00.000Z");

function makeEdges(fromId: Hash, targets: { toId: Hash; weight: number }[]): Edge[] {
  return targets.map(({ toId, weight }) => ({
    fromPageId: fromId,
    toPageId: toId,
    weight,
    lastUpdatedAt: new Date(NOW).toISOString(),
  }));
}

function makeActivity(
  pageId: Hash,
  queryHitCount: number,
  lastQueryAt: string,
  communityId?: string,
): PageActivity {
  return { pageId, queryHitCount, lastQueryAt, communityId };
}

// ---------------------------------------------------------------------------
// HotpathPolicy unit tests
// ---------------------------------------------------------------------------

describe("HotpathPolicy", () => {
  describe("computeCapacity (H(t))", () => {
    it("returns 1 for t=0", () => {
      expect(computeCapacity(0)).toBe(1);
    });

    it("returns 1 for t=1", () => {
      expect(computeCapacity(1)).toBe(1);
    });

    it("H(t) grows sublinearly: H(10000)/10000 < H(1000)/1000", () => {
      const ratio1000 = computeCapacity(1000) / 1000;
      const ratio10000 = computeCapacity(10000) / 10000;
      expect(ratio10000).toBeLessThan(ratio1000);
    });

    it("H(t) is monotonically non-decreasing", () => {
      const points = [0, 1, 2, 10, 100, 1_000, 10_000, 100_000];
      for (let i = 1; i < points.length; i++) {
        expect(computeCapacity(points[i])).toBeGreaterThanOrEqual(
          computeCapacity(points[i - 1]),
        );
      }
    });

    it("H(t) is a finite integer >= 1 for edge inputs", () => {
      for (const t of [0, 1, Number.MAX_SAFE_INTEGER]) {
        const h = computeCapacity(t);
        expect(Number.isFinite(h)).toBe(true);
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("computeSalience", () => {
    it("returns weighted sum with default weights", () => {
      const sigma = computeSalience(2.0, 0.5, 3);
      // 0.5*2.0 + 0.3*0.5 + 0.2*3 = 1.0 + 0.15 + 0.6 = 1.75
      expect(sigma).toBeCloseTo(1.75, 6);
    });

    it("returns 0 when all inputs are 0", () => {
      expect(computeSalience(0, 0, 0)).toBe(0);
    });

    it("uses custom weights when provided", () => {
      const sigma = computeSalience(1, 1, 1, { alpha: 0.3, beta: 0.3, gamma: 0.4 });
      expect(sigma).toBeCloseTo(1.0, 6);
    });
  });

  describe("deriveTierQuotas", () => {
    it("quotas sum to capacity", () => {
      const cap = 100;
      const q = deriveTierQuotas(cap);
      expect(q.shelf + q.volume + q.book + q.page).toBe(cap);
    });

    it("distributes 10 correctly", () => {
      const q = deriveTierQuotas(10);
      expect(q.shelf).toBe(1);
      expect(q.volume).toBe(2);
      expect(q.book).toBe(2);
      expect(q.page).toBe(5);
    });

    it("handles capacity of 1", () => {
      const q = deriveTierQuotas(1);
      expect(q.shelf + q.volume + q.book + q.page).toBe(1);
    });
  });

  describe("deriveCommunityQuotas", () => {
    it("quotas sum to tier budget", () => {
      const quotas = deriveCommunityQuotas(10, [50, 30, 20]);
      expect(quotas.reduce((a, b) => a + b, 0)).toBe(10);
    });

    it("returns zero array for empty sizes", () => {
      expect(deriveCommunityQuotas(10, [])).toEqual([]);
    });

    it("proportional to community sizes", () => {
      const quotas = deriveCommunityQuotas(100, [70, 30]);
      expect(quotas[0]).toBe(70);
      expect(quotas[1]).toBe(30);
    });
  });
});

// ---------------------------------------------------------------------------
// SalienceEngine unit tests (P0-G1)
// ---------------------------------------------------------------------------

describe("SalienceEngine", () => {
  let store: MockMetadataStore;

  beforeEach(() => {
    store = new MockMetadataStore();
  });

  describe("computeNodeSalience", () => {
    it("returns 0 for a page with no edges and no activity", async () => {
      const salience = await computeNodeSalience("page-1", store, DEFAULT_HOTPATH_POLICY, NOW);
      expect(salience).toBe(0);
    });

    it("incorporates Hebbian edge weights", async () => {
      await store.putEdges(makeEdges("page-1", [
        { toId: "page-2", weight: 0.8 },
        { toId: "page-3", weight: 0.6 },
      ]));

      const salience = await computeNodeSalience("page-1", store, DEFAULT_HOTPATH_POLICY, NOW);
      // hebbianIn = 0.8 + 0.6 = 1.4; alpha=0.5 -> contribution = 0.7
      // No activity -> recency=0, queryHits=0
      expect(salience).toBeCloseTo(0.7, 6);
    });

    it("incorporates query hit count", async () => {
      await store.putPageActivity(makeActivity("page-1", 5, new Date(NOW).toISOString()));

      const salience = await computeNodeSalience("page-1", store, DEFAULT_HOTPATH_POLICY, NOW);
      // hebbianIn=0, recency~=1 (just now), queryHits=5
      // 0 + 0.3*1 + 0.2*5 = 0.3 + 1.0 = 1.3
      expect(salience).toBeCloseTo(1.3, 1);
    });

    it("recency decays over time", async () => {
      const oneWeekAgo = new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString();
      await store.putPageActivity(makeActivity("page-1", 0, oneWeekAgo));

      const salience = await computeNodeSalience("page-1", store, DEFAULT_HOTPATH_POLICY, NOW);
      // After 7 days (half-life), recency ~= 0.5; beta=0.3 -> contribution ~= 0.15
      expect(salience).toBeCloseTo(0.15, 1);
    });
  });

  describe("batchComputeSalience", () => {
    it("returns a map with salience for all given pages", async () => {
      await store.putEdges(makeEdges("page-1", [{ toId: "page-2", weight: 1.0 }]));
      await store.putPageActivity(makeActivity("page-2", 3, new Date(NOW).toISOString()));

      const map = await batchComputeSalience(
        ["page-1", "page-2"],
        store,
        DEFAULT_HOTPATH_POLICY,
        NOW,
      );

      expect(map.size).toBe(2);
      expect(map.get("page-1")).toBeGreaterThan(0);
      expect(map.get("page-2")).toBeGreaterThan(0);
    });

    it("returns empty map for empty input", async () => {
      const map = await batchComputeSalience([], store);
      expect(map.size).toBe(0);
    });
  });

  describe("shouldPromote", () => {
    it("returns true during bootstrap (capacity remaining > 0)", () => {
      expect(shouldPromote(0.1, 0.5, 10)).toBe(true);
    });

    it("returns true when candidate beats weakest at steady state", () => {
      expect(shouldPromote(0.8, 0.3, 0)).toBe(true);
    });

    it("returns false when candidate does not beat weakest", () => {
      expect(shouldPromote(0.3, 0.8, 0)).toBe(false);
    });

    it("returns false when candidate equals weakest (strict >)", () => {
      expect(shouldPromote(0.5, 0.5, 0)).toBe(false);
    });
  });

  describe("selectEvictionTarget", () => {
    it("returns the weakest resident in a tier", async () => {
      await store.putHotpathEntry({ entityId: "p1", tier: "page", salience: 0.9 });
      await store.putHotpathEntry({ entityId: "p2", tier: "page", salience: 0.3 });
      await store.putHotpathEntry({ entityId: "p3", tier: "page", salience: 0.6 });

      const target = await selectEvictionTarget("page", undefined, store);
      expect(target).toBe("p2");
    });

    it("returns undefined for empty tier", async () => {
      const target = await selectEvictionTarget("shelf", undefined, store);
      expect(target).toBeUndefined();
    });

    it("filters by communityId when provided", async () => {
      await store.putHotpathEntry({ entityId: "p1", tier: "page", salience: 0.9, communityId: "c1" });
      await store.putHotpathEntry({ entityId: "p2", tier: "page", salience: 0.1, communityId: "c2" });
      await store.putHotpathEntry({ entityId: "p3", tier: "page", salience: 0.5, communityId: "c1" });

      const target = await selectEvictionTarget("page", "c1", store);
      expect(target).toBe("p3"); // weakest in c1
    });

    it("breaks ties deterministically by entityId", async () => {
      await store.putHotpathEntry({ entityId: "z-page", tier: "page", salience: 0.5 });
      await store.putHotpathEntry({ entityId: "a-page", tier: "page", salience: 0.5 });
      await store.putHotpathEntry({ entityId: "m-page", tier: "page", salience: 0.5 });

      const target = await selectEvictionTarget("page", undefined, store);
      // Smallest entityId wins when salience is tied
      expect(target).toBe("a-page");
    });
  });
});

// ---------------------------------------------------------------------------
// P0-G2: Promotion / eviction lifecycle
// ---------------------------------------------------------------------------

describe("SalienceEngine lifecycle", () => {
  let store: MockMetadataStore;

  beforeEach(() => {
    store = new MockMetadataStore();
  });

  describe("bootstrapHotpath", () => {
    it("fills hotpath to exactly H(t) given enough candidates", async () => {
      // Create many candidates with varying salience
      const candidateIds: Hash[] = [];
      for (let i = 0; i < 50; i++) {
        const id = `page-${String(i).padStart(3, "0")}`;
        candidateIds.push(id);
        await store.putEdges(makeEdges(id, [
          { toId: `neighbor-${i}`, weight: (50 - i) * 0.1 },
        ]));
        await store.putPageActivity(
          makeActivity(id, i, new Date(NOW).toISOString()),
        );
      }

      await bootstrapHotpath(store, DEFAULT_HOTPATH_POLICY, candidateIds, NOW);

      const count = await store.getResidentCount();
      const graphMass = 50; // candidate count
      const expectedCapacity = computeCapacity(graphMass, DEFAULT_HOTPATH_POLICY.c);
      const tierQuotas = deriveTierQuotas(expectedCapacity, DEFAULT_HOTPATH_POLICY.tierQuotaRatios);

      // Bootstrap admits at page tier; should fill to min(page quota, total capacity)
      expect(count).toBeLessThanOrEqual(expectedCapacity);
      expect(count).toBeLessThanOrEqual(tierQuotas.page);
      // And we should have filled as much as possible
      expect(count).toBe(Math.min(tierQuotas.page, expectedCapacity));
    });

    it("does nothing with empty candidate list", async () => {
      await bootstrapHotpath(store, DEFAULT_HOTPATH_POLICY, [], NOW);
      expect(await store.getResidentCount()).toBe(0);
    });

    it("admits highest-salience candidates first", async () => {
      // 3 candidates, but capacity for only some
      const ids = ["page-lo", "page-hi", "page-mid"];
      await store.putEdges(makeEdges("page-lo", [{ toId: "x", weight: 0.1 }]));
      await store.putEdges(makeEdges("page-hi", [{ toId: "x", weight: 5.0 }]));
      await store.putEdges(makeEdges("page-mid", [{ toId: "x", weight: 1.0 }]));

      await bootstrapHotpath(store, DEFAULT_HOTPATH_POLICY, ids, NOW);

      const entries = await store.getHotpathEntries("page");
      // page-hi should have highest salience and be admitted
      const admittedIds = entries.map((e) => e.entityId);
      expect(admittedIds).toContain("page-hi");

      // If any was excluded, it should be the lowest
      if (admittedIds.length < 3) {
        expect(admittedIds).not.toContain("page-lo");
      }
    });
  });

  describe("runPromotionSweep", () => {
    it("promotes candidate when it beats weakest resident", async () => {
      // Pre-fill hotpath with a weak resident
      await store.putHotpathEntry({
        entityId: "weak-resident",
        tier: "page",
        salience: 0.01,
      });

      // Strong candidate
      await store.putEdges(makeEdges("strong-candidate", [
        { toId: "x", weight: 10.0 },
      ]));
      await store.putPageActivity(
        makeActivity("strong-candidate", 100, new Date(NOW).toISOString()),
      );

      // Use a policy with c that gives capacity exactly matching resident count
      // to test steady-state behavior
      const policy: HotpathPolicy = {
        ...DEFAULT_HOTPATH_POLICY,
        c: 0.01, // very small -> capacity will be small
      };

      // With c=0.01 and graphMass=2, capacity will likely be 1
      // So the sweep should evict weak-resident and promote strong-candidate
      await runPromotionSweep(["strong-candidate"], store, policy, NOW);

      const entries = await store.getHotpathEntries();
      const ids = entries.map((e) => e.entityId);

      // Strong candidate should be in
      expect(ids).toContain("strong-candidate");
    });

    it("does not promote when candidate is weaker than weakest", async () => {
      // Pre-fill with a strong resident
      await store.putHotpathEntry({
        entityId: "strong-resident",
        tier: "page",
        salience: 100.0,
      });

      // Weak candidate (no edges, no activity -> salience = 0)
      const policy: HotpathPolicy = {
        ...DEFAULT_HOTPATH_POLICY,
        c: 0.01,
      };

      await runPromotionSweep(["weak-candidate"], store, policy, NOW);

      const entries = await store.getHotpathEntries();
      const ids = entries.map((e) => e.entityId);

      expect(ids).toContain("strong-resident");
      expect(ids).not.toContain("weak-candidate");
    });

    it("evicts exactly the weakest resident, not a random entry", async () => {
      // Pre-fill with multiple residents
      await store.putHotpathEntry({ entityId: "r-strong", tier: "page", salience: 10.0 });
      await store.putHotpathEntry({ entityId: "r-medium", tier: "page", salience: 5.0 });
      await store.putHotpathEntry({ entityId: "r-weak", tier: "page", salience: 0.1 });

      // Strong candidate
      await store.putEdges(makeEdges("candidate", [{ toId: "x", weight: 20.0 }]));
      await store.putPageActivity(
        makeActivity("candidate", 50, new Date(NOW).toISOString()),
      );

      // Use c that gives capacity <= 3 so tier is full
      const policy: HotpathPolicy = {
        ...DEFAULT_HOTPATH_POLICY,
        c: 0.01,
      };

      await runPromotionSweep(["candidate"], store, policy, NOW);

      const entries = await store.getHotpathEntries();
      const ids = entries.map((e) => e.entityId);

      // r-weak should be evicted (weakest), not r-strong or r-medium
      expect(ids).not.toContain("r-weak");
      expect(ids).toContain("r-strong");
      expect(ids).toContain("r-medium");
      expect(ids).toContain("candidate");
    });

    it("does nothing with empty candidate list", async () => {
      await store.putHotpathEntry({ entityId: "r1", tier: "page", salience: 1.0 });
      await runPromotionSweep([], store, DEFAULT_HOTPATH_POLICY, NOW);
      expect(await store.getResidentCount()).toBe(1);
    });
  });

  describe("community quotas", () => {
    it("prevent a single community from consuming all page-tier slots", async () => {
      // Pre-fill 3 page entries from community "big" with low salience
      await store.putHotpathEntry({ entityId: "big-0", tier: "page", salience: 0.1, communityId: "big" });
      await store.putHotpathEntry({ entityId: "big-1", tier: "page", salience: 0.2, communityId: "big" });
      await store.putHotpathEntry({ entityId: "big-2", tier: "page", salience: 0.3, communityId: "big" });

      // A strong candidate from a brand-new community "small"
      await store.putEdges(makeEdges("small-candidate", [{ toId: "x", weight: 50.0 }]));
      await store.putPageActivity(
        makeActivity("small-candidate", 100, new Date(NOW).toISOString(), "small"),
      );

      // c=0.01 -> very small capacity, page tier is full
      const policy: HotpathPolicy = { ...DEFAULT_HOTPATH_POLICY, c: 0.01 };

      await runPromotionSweep(["small-candidate"], store, policy, NOW);

      const entries = await store.getHotpathEntries("page");
      const bigCount = entries.filter((e) => e.communityId === "big").length;
      const smallCount = entries.filter((e) => e.communityId === "small").length;

      // The new community was admitted by displacing the weakest "big" entry
      expect(smallCount).toBeGreaterThanOrEqual(1);
      // "big" lost one slot
      expect(bigCount).toBeLessThan(3);
    });

    it("enforces tier quotas even when overall capacity is not full", async () => {
      // With c=2.0 and 4 page entries + 1 candidate:
      //   graphMass = 5, capacity = 8, pageBudget = 4
      //   tierFull = true (4 >= 4), capacityRemaining = 4 > 0
      // A weak candidate should NOT be admitted despite overall capacity.
      const policy: HotpathPolicy = { ...DEFAULT_HOTPATH_POLICY, c: 2.0 };

      for (let i = 0; i < 4; i++) {
        await store.putHotpathEntry({
          entityId: `p-${i}`,
          tier: "page",
          salience: 0.5 + i * 0.1,
        });
      }

      // Weak candidate (no edges, no activity -> salience = 0)
      await runPromotionSweep(["weak-candidate"], store, policy, NOW);

      const entries = await store.getHotpathEntries("page");
      const sweepGraphMass = 4 + 1;
      const sweepCapacity = computeCapacity(sweepGraphMass, policy.c);
      const sweepPageQuota = deriveTierQuotas(sweepCapacity, policy.tierQuotaRatios).page;

      // Page tier must not exceed its quota
      expect(entries.length).toBeLessThanOrEqual(sweepPageQuota);
      // Weak candidate was not admitted
      expect(entries.map((e) => e.entityId)).not.toContain("weak-candidate");
      // Verify our capacity assumptions
      expect(sweepCapacity).toBeGreaterThan(4); // overall capacity has room
      expect(sweepPageQuota).toBe(4);            // but page tier is exactly full
    });
  });

  describe("determinism", () => {
    it("eviction is deterministic under the same state", async () => {
      // Run the same scenario twice and verify same result
      async function runScenario(): Promise<Hash[]> {
        const s = new MockMetadataStore();
        await s.putHotpathEntry({ entityId: "p1", tier: "page", salience: 0.5 });
        await s.putHotpathEntry({ entityId: "p2", tier: "page", salience: 0.3 });
        await s.putHotpathEntry({ entityId: "p3", tier: "page", salience: 0.8 });

        await s.putEdges(makeEdges("candidate", [{ toId: "x", weight: 5.0 }]));
        await s.putPageActivity(
          makeActivity("candidate", 10, new Date(NOW).toISOString()),
        );

        const policy: HotpathPolicy = {
          ...DEFAULT_HOTPATH_POLICY,
          c: 0.01,
        };

        await runPromotionSweep(["candidate"], s, policy, NOW);

        const entries = await s.getHotpathEntries();
        return entries.map((e) => e.entityId).sort();
      }

      const run1 = await runScenario();
      const run2 = await runScenario();

      expect(run1).toEqual(run2);
    });

    it("selectEvictionTarget returns same result for same state", async () => {
      await store.putHotpathEntry({ entityId: "a", tier: "page", salience: 0.5 });
      await store.putHotpathEntry({ entityId: "b", tier: "page", salience: 0.3 });
      await store.putHotpathEntry({ entityId: "c", tier: "page", salience: 0.7 });

      const t1 = await selectEvictionTarget("page", undefined, store);
      const t2 = await selectEvictionTarget("page", undefined, store);
      expect(t1).toBe(t2);
      expect(t1).toBe("b"); // weakest by salience
    });
  });

  describe("tier quotas", () => {
    it("prevent one hierarchy level from dominating", () => {
      const capacity = 100;
      const quotas = deriveTierQuotas(capacity);

      // Page tier gets 50%, shelf gets only 10%
      expect(quotas.page).toBeGreaterThan(quotas.shelf);
      expect(quotas.shelf + quotas.volume + quotas.book + quotas.page).toBe(capacity);

      // No single tier gets more than 50%
      expect(quotas.shelf).toBeLessThanOrEqual(capacity * 0.5);
      expect(quotas.volume).toBeLessThanOrEqual(capacity * 0.5);
      expect(quotas.book).toBeLessThanOrEqual(capacity * 0.5);
      expect(quotas.page).toBeLessThanOrEqual(capacity * 0.5);
    });
  });
});
