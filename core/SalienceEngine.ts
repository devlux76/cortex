// ---------------------------------------------------------------------------
// SalienceEngine — Decision-making layer for hotpath admission
// ---------------------------------------------------------------------------
//
// Provides per-node salience computation, promotion/eviction lifecycle
// helpers, and community-aware admission logic.
// ---------------------------------------------------------------------------

import type { Hash, HotpathEntry, MetadataStore } from "./types";
import {
  computeCapacity,
  computeSalience,
  DEFAULT_HOTPATH_POLICY,
  deriveCommunityQuotas,
  deriveTierQuotas,
  type HotpathPolicy,
} from "./HotpathPolicy";

// ---------------------------------------------------------------------------
// Recency helper
// ---------------------------------------------------------------------------

/**
 * Compute recency score R(v) as exponential decay from the most recent
 * activity timestamp. Returns a value in [0, 1].
 *
 * Uses a half-life of 7 days — after 7 days of inactivity the recency
 * score drops to ~0.5; after 30 days it drops to ~0.05.
 */
function recencyScore(isoTimestamp: string | undefined, now: number): number {
  if (!isoTimestamp) return 0;
  const ts = Date.parse(isoTimestamp);
  if (!Number.isFinite(ts)) return 0;
  const ageMs = Math.max(0, now - ts);
  const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  return Math.exp((-Math.LN2 * ageMs) / HALF_LIFE_MS);
}

// ---------------------------------------------------------------------------
// P0-G1: Core salience computation
// ---------------------------------------------------------------------------

/**
 * Fetch PageActivity and incident Hebbian edges for a single page,
 * then compute salience via HotpathPolicy.
 */
export async function computeNodeSalience(
  pageId: Hash,
  metadataStore: MetadataStore,
  policy: HotpathPolicy = DEFAULT_HOTPATH_POLICY,
  now: number = Date.now(),
): Promise<number> {
  const [activity, neighbors] = await Promise.all([
    metadataStore.getPageActivity(pageId),
    metadataStore.getNeighbors(pageId),
  ]);

  const hebbianIn = neighbors.reduce((sum, e) => sum + e.weight, 0);

  const recency = recencyScore(
    activity?.lastQueryAt,
    now,
  );

  const queryHits = activity?.queryHitCount ?? 0;

  return computeSalience(hebbianIn, recency, queryHits, policy.salienceWeights);
}

/**
 * Efficient batch version of `computeNodeSalience`.
 */
export async function batchComputeSalience(
  pageIds: Hash[],
  metadataStore: MetadataStore,
  policy: HotpathPolicy = DEFAULT_HOTPATH_POLICY,
  now: number = Date.now(),
): Promise<Map<Hash, number>> {
  const results = new Map<Hash, number>();

  // Parallelize I/O across all pages
  const entries = await Promise.all(
    pageIds.map(async (id) => {
      const salience = await computeNodeSalience(id, metadataStore, policy, now);
      return [id, salience] as const;
    }),
  );

  for (const [id, salience] of entries) {
    results.set(id, salience);
  }

  return results;
}

/**
 * Admission gating: should a candidate be promoted into the hotpath?
 *
 * - During bootstrap (capacity remaining > 0): always admit.
 * - During steady-state: admit only if candidate salience exceeds
 *   the weakest resident salience.
 */
export function shouldPromote(
  candidateSalience: number,
  weakestResidentSalience: number,
  capacityRemaining: number,
): boolean {
  if (capacityRemaining > 0) return true;
  return candidateSalience > weakestResidentSalience;
}

/**
 * Find the weakest resident in a given tier/community bucket.
 *
 * Returns the entityId of the weakest entry, or undefined if the
 * tier/community bucket is empty.
 */
export async function selectEvictionTarget(
  tier: HotpathEntry["tier"],
  communityId: string | undefined,
  metadataStore: MetadataStore,
): Promise<Hash | undefined> {
  const entries = await metadataStore.getHotpathEntries(tier);

  const filtered = communityId !== undefined
    ? entries.filter((e) => e.communityId === communityId)
    : entries;

  if (filtered.length === 0) return undefined;

  // Find the entry with the lowest salience (deterministic: stable sort by entityId on tie)
  let weakest = filtered[0];
  for (let i = 1; i < filtered.length; i++) {
    const e = filtered[i];
    if (
      e.salience < weakest.salience ||
      (e.salience === weakest.salience && e.entityId < weakest.entityId)
    ) {
      weakest = e;
    }
  }

  return weakest.entityId;
}

// ---------------------------------------------------------------------------
// P0-G2: Promotion / eviction lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Bootstrap phase: fill hotpath greedily by salience while
 * resident count < H(t).
 *
 * Computes salience for all candidate pages, then admits in
 * descending salience order until the capacity is reached,
 * respecting tier quotas.
 */
export async function bootstrapHotpath(
  metadataStore: MetadataStore,
  policy: HotpathPolicy = DEFAULT_HOTPATH_POLICY,
  candidatePageIds: Hash[] = [],
  now: number = Date.now(),
): Promise<void> {
  if (candidatePageIds.length === 0) return;

  // Compute salience for all candidates
  const salienceMap = await batchComputeSalience(
    candidatePageIds,
    metadataStore,
    policy,
    now,
  );

  // Fetch page activities for community info
  const activities = await Promise.all(
    candidatePageIds.map((id) => metadataStore.getPageActivity(id)),
  );
  const communityMap = new Map<Hash, string | undefined>();
  for (let i = 0; i < candidatePageIds.length; i++) {
    communityMap.set(candidatePageIds[i], activities[i]?.communityId);
  }

  // Sort candidates by salience descending; break ties by entityId for determinism
  const sorted = [...candidatePageIds].sort((a, b) => {
    const diff = (salienceMap.get(b) ?? 0) - (salienceMap.get(a) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  // Determine current graph mass for capacity calculation
  const currentEntries = await metadataStore.getHotpathEntries();
  const currentCount = currentEntries.length;

  // Estimate graph mass: existing residents + candidates gives a lower bound
  // For bootstrap, use total candidate count as graph mass estimate
  const graphMass = currentCount + candidatePageIds.length;
  const capacity = computeCapacity(graphMass, policy.c);
  const tierQuotas = deriveTierQuotas(capacity, policy.tierQuotaRatios);

  // Track how many are already in each tier
  const tierCounts: Record<string, number> = { shelf: 0, volume: 0, book: 0, page: 0 };
  for (const entry of currentEntries) {
    tierCounts[entry.tier] = (tierCounts[entry.tier] ?? 0) + 1;
  }

  let totalResident = currentCount;

  for (const candidateId of sorted) {
    if (totalResident >= capacity) break;

    const tier: HotpathEntry["tier"] = "page"; // bootstrap admits at page tier
    if (tierCounts[tier] >= tierQuotas[tier]) continue;

    const salience = salienceMap.get(candidateId) ?? 0;
    const entry: HotpathEntry = {
      entityId: candidateId,
      tier,
      salience,
      communityId: communityMap.get(candidateId),
    };

    await metadataStore.putHotpathEntry(entry);
    tierCounts[tier]++;
    totalResident++;
  }
}

/**
 * Steady-state promotion sweep: for each candidate, promote if its
 * salience exceeds the weakest resident in the same tier/community
 * bucket. On promotion, evict the weakest.
 *
 * Tier quotas and community quotas are enforced regardless of whether
 * overall capacity is full, preventing any single tier or community
 * from monopolizing the hotpath during ramp-up.
 */
export async function runPromotionSweep(
  candidateIds: Hash[],
  metadataStore: MetadataStore,
  policy: HotpathPolicy = DEFAULT_HOTPATH_POLICY,
  now: number = Date.now(),
): Promise<void> {
  if (candidateIds.length === 0) return;

  // Compute salience for all candidates
  const salienceMap = await batchComputeSalience(
    candidateIds,
    metadataStore,
    policy,
    now,
  );

  // Fetch page activities for community info
  const activities = await Promise.all(
    candidateIds.map((id) => metadataStore.getPageActivity(id)),
  );
  const communityMap = new Map<Hash, string | undefined>();
  for (let i = 0; i < candidateIds.length; i++) {
    communityMap.set(candidateIds[i], activities[i]?.communityId);
  }

  // Sort candidates by salience descending for deterministic processing
  const sorted = [...candidateIds].sort((a, b) => {
    const diff = (salienceMap.get(b) ?? 0) - (salienceMap.get(a) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  // Load initial state into an in-memory cache to avoid repeated store reads
  let cachedEntries = await metadataStore.getHotpathEntries();

  for (const candidateId of sorted) {
    const candidateSalience = salienceMap.get(candidateId) ?? 0;
    const communityId = communityMap.get(candidateId);
    const tier: HotpathEntry["tier"] = "page";

    // Derive capacity and quotas from current state
    const currentCount = cachedEntries.length;
    const graphMass = currentCount + candidateIds.length;
    const capacity = computeCapacity(graphMass, policy.c);
    const capacityRemaining = capacity - currentCount;
    const tierQuotas = deriveTierQuotas(capacity, policy.tierQuotaRatios);
    const tierEntries = cachedEntries.filter((e) => e.tier === tier);
    const tierFull = tierEntries.length >= tierQuotas[tier];

    // --- Community quota check (enforced regardless of capacityRemaining) ---
    if (communityId !== undefined && tierFull) {
      const communitySizes = getCommunityDistribution(tierEntries, communityId);
      const communityQuotas = deriveCommunityQuotas(
        tierQuotas[tier],
        communitySizes.sizes,
      );
      const communityIdx = communitySizes.communityIndex;
      const communityBudget = communityIdx < communityQuotas.length
        ? communityQuotas[communityIdx]
        : 0;
      const communityCount = communitySizes.candidateCommunityCount;

      if (communityCount >= communityBudget && communityCount > 0) {
        // Community is at quota — only promote if candidate beats weakest in community
        const weakestId = findWeakestIn(tierEntries, communityId);
        if (weakestId === undefined) continue;

        const weakestSalience = tierEntries.find((e) => e.entityId === weakestId)?.salience ?? 0;

        if (candidateSalience > weakestSalience) {
          await metadataStore.removeHotpathEntry(weakestId);
          const newEntry: HotpathEntry = {
            entityId: candidateId,
            tier,
            salience: candidateSalience,
            communityId,
          };
          await metadataStore.putHotpathEntry(newEntry);
          cachedEntries = cachedEntries.filter((e) => e.entityId !== weakestId);
          cachedEntries.push(newEntry);
        }
        continue;
      }
    }

    // --- Tier quota check (enforced regardless of capacityRemaining) ---
    if (tierFull) {
      // Tier is at quota — evict the weakest in the entire tier (not scoped
      // to candidate's community, so new communities can displace weak entries)
      const weakestId = findWeakestIn(tierEntries, undefined);
      if (weakestId === undefined) continue;

      const weakestSalience = tierEntries.find((e) => e.entityId === weakestId)?.salience ?? 0;

      if (candidateSalience <= weakestSalience) continue;

      await metadataStore.removeHotpathEntry(weakestId);
      const newEntry: HotpathEntry = {
        entityId: candidateId,
        tier,
        salience: candidateSalience,
        communityId,
      };
      await metadataStore.putHotpathEntry(newEntry);
      cachedEntries = cachedEntries.filter((e) => e.entityId !== weakestId);
      cachedEntries.push(newEntry);
    } else if (capacityRemaining > 0) {
      // Both tier and overall capacity available — admit directly
      const newEntry: HotpathEntry = {
        entityId: candidateId,
        tier,
        salience: candidateSalience,
        communityId,
      };
      await metadataStore.putHotpathEntry(newEntry);
      cachedEntries.push(newEntry);
    }
    // else: tier has room but overall capacity is full — skip
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute community distribution within a set of tier entries,
 * including the candidate's community.
 *
 * The candidate's community is counted as having at least size 1 for
 * quota derivation, so that a brand-new community can receive its
 * first slot via the largest-remainder method.
 */
function getCommunityDistribution(
  tierEntries: HotpathEntry[],
  candidateCommunityId: string,
): {
  sizes: number[];
  communityIndex: number;
  candidateCommunityCount: number;
} {
  const communityCountMap = new Map<string, number>();

  for (const e of tierEntries) {
    const cid = e.communityId ?? "__none__";
    communityCountMap.set(cid, (communityCountMap.get(cid) ?? 0) + 1);
  }

  // Ensure candidate's community is represented with at least size 1
  // so that deriveCommunityQuotas can allocate it a slot
  const actualCount = communityCountMap.get(candidateCommunityId) ?? 0;
  communityCountMap.set(candidateCommunityId, Math.max(1, actualCount));

  const communities = [...communityCountMap.keys()].sort();
  const sizes = communities.map((c) => communityCountMap.get(c) ?? 0);
  const communityIndex = communities.indexOf(candidateCommunityId);

  return { sizes, communityIndex, candidateCommunityCount: actualCount };
}

/**
 * Find the weakest entry in a list, optionally filtered by communityId.
 * Deterministic: breaks ties by entityId (smallest wins).
 */
function findWeakestIn(
  entries: HotpathEntry[],
  communityId: string | undefined,
): Hash | undefined {
  const filtered = communityId !== undefined
    ? entries.filter((e) => e.communityId === communityId)
    : entries;

  if (filtered.length === 0) return undefined;

  let weakest = filtered[0];
  for (let i = 1; i < filtered.length; i++) {
    const e = filtered[i];
    if (
      e.salience < weakest.salience ||
      (e.salience === weakest.salience && e.entityId < weakest.entityId)
    ) {
      weakest = e;
    }
  }
  return weakest.entityId;
}
