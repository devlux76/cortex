// ---------------------------------------------------------------------------
// ClusterStability — Community detection via label propagation (P2-F) and
//                   volume split/merge for balanced cluster maintenance (P2-F3)
// ---------------------------------------------------------------------------
//
// Assigns community labels to pages by running lightweight label propagation
// on the semantic neighbor graph. Labels are stored in
// PageActivity.communityId and propagate into SalienceEngine community quotas.
//
// Label propagation terminates when assignments stabilise (no label changes)
// or a maximum iteration limit is reached.
//
// The Daydreamer background worker also calls ClusterStability periodically to
// detect and fix unstable volumes:
//   - HIGH-VARIANCE volumes are split into two balanced sub-volumes.
//   - LOW-COUNT volumes are merged into the nearest neighbour volume.
//   - Community labels are updated after structural changes.
// ---------------------------------------------------------------------------

import { hashText } from "../core/crypto/hash";
import type {
  Book,
  Hash,
  MetadataStore,
  PageActivity,
  Volume,
} from "../core/types";

// ---------------------------------------------------------------------------
// Label propagation options
// ---------------------------------------------------------------------------

export interface LabelPropagationOptions {
  metadataStore: MetadataStore;
  /** Maximum number of label propagation iterations. Default: 20. */
  maxIterations?: number;
}

export interface LabelPropagationResult {
  /** Number of iterations until convergence (or maxIterations). */
  iterations: number;
  /** True if the algorithm converged before hitting maxIterations. */
  converged: boolean;
  /** Map from pageId to assigned communityId. */
  communityMap: Map<Hash, string>;
}

// ---------------------------------------------------------------------------
// Label propagation
// ---------------------------------------------------------------------------

/**
 * Run one pass of label propagation over all pages.
 *
 * Each node adopts the most frequent label among its Metroid neighbors.
 * Ties are broken deterministically by choosing the lexicographically
 * smallest label (consistent across runs and nodes).
 *
 * Returns true if any label changed during this pass.
 */
async function propagationPass(
  pageIds: Hash[],
  labels: Map<Hash, string>,
  metadataStore: MetadataStore,
): Promise<boolean> {
  let changed = false;

  // Shuffle-equivalent deterministic ordering: sort by pageId for reproducibility
  const sorted = [...pageIds].sort();

  for (const pageId of sorted) {
    const neighbors = await metadataStore.getSemanticNeighbors(pageId);
    if (neighbors.length === 0) continue;

    // Count neighbor labels
    const counts = new Map<string, number>();
    for (const n of neighbors) {
      const label = labels.get(n.neighborPageId) ?? n.neighborPageId;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    // Find the most frequent label (tie-break: lexicographically smallest)
    let bestLabel: string | undefined;
    let bestCount = 0;
    for (const [label, count] of counts) {
      if (
        count > bestCount ||
        (count === bestCount && bestLabel !== undefined && label < bestLabel)
      ) {
        bestLabel = label;
        bestCount = count;
      }
    }

    if (bestLabel !== undefined && labels.get(pageId) !== bestLabel) {
      labels.set(pageId, bestLabel);
      changed = true;
    }
  }

  return changed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assign community labels to all pages via label propagation on the
 * Metroid (semantic) neighbor graph.
 *
 * Initial labels: each page is its own community (pageId as initial label).
 * Each iteration: every node adopts the most frequent label among neighbors.
 * Convergence: no label changed in the most recent pass.
 *
 * After convergence, persists all community labels via
 * `MetadataStore.putPageActivity`.
 */
export async function runLabelPropagation(
  options: LabelPropagationOptions,
): Promise<LabelPropagationResult> {
  const {
    metadataStore,
    maxIterations = 20,
  } = options;

  const allPages = await metadataStore.getAllPages();
  if (allPages.length === 0) {
    return { iterations: 0, converged: true, communityMap: new Map() };
  }

  const pageIds = allPages.map((p) => p.pageId);

  // Initialise: each page is its own community
  const labels = new Map<Hash, string>();
  for (const id of pageIds) {
    labels.set(id, id);
  }

  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations++;
    const changed = await propagationPass(pageIds, labels, metadataStore);
    if (!changed) {
      converged = true;
      break;
    }
  }

  // Persist community labels to PageActivity
  for (const pageId of pageIds) {
    const communityId = labels.get(pageId) ?? pageId;
    const existing = await metadataStore.getPageActivity(pageId);
    const activity: PageActivity = {
      pageId,
      queryHitCount: existing?.queryHitCount ?? 0,
      lastQueryAt: existing?.lastQueryAt ?? new Date(0).toISOString(),
      communityId,
    };
    await metadataStore.putPageActivity(activity);
  }

  return { iterations, converged, communityMap: new Map(labels) };
}

/**
 * Detect whether a community should be split (too large relative to graph).
 *
 * A community is considered oversized when it holds more than
 * `maxCommunityFraction` of all pages.
 *
 * Returns the set of community IDs that exceed the threshold.
 */
export function detectOversizedCommunities(
  communityMap: Map<Hash, string>,
  maxCommunityFraction = 0.5,
): Set<string> {
  const total = communityMap.size;
  if (total === 0) return new Set();

  const counts = new Map<string, number>();
  for (const label of communityMap.values()) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const oversized = new Set<string>();
  for (const [label, count] of counts) {
    if (count / total > maxCommunityFraction) {
      oversized.add(label);
    }
  }
  return oversized;
}

/**
 * Detect communities that no longer have any members (empty communities).
 *
 * These communities should release their hotpath quota slots back to the
 * page-tier budget.
 *
 * @param knownCommunities  Full set of community IDs that have quota allocations.
 * @param activeCommunities Community IDs currently assigned to at least one page.
 */
export function detectEmptyCommunities(
  knownCommunities: Set<string>,
  activeCommunities: Set<string>,
): Set<string> {
  const empty = new Set<string>();
  for (const id of knownCommunities) {
    if (!activeCommunities.has(id)) {
      empty.add(id);
    }
  }
  return empty;
}

// ---------------------------------------------------------------------------
// ClusterStability class — Volume split/merge configuration
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ClusterStabilityOptions {
  /**
   * Volume variance threshold above which a volume is considered unstable and
   * will be split.
   * Defaults to 0.5.
   */
  varianceThreshold?: number;

  /**
   * Minimum number of books a volume must contain. Volumes with fewer books
   * than this will be merged with a neighbour.
   * Defaults to 2.
   */
  minBooksPerVolume?: number;

  /**
   * Maximum split iterations for the K-means step.
   * Defaults to 10.
   */
  maxKmeansIterations?: number;
}

const DEFAULT_VARIANCE_THRESHOLD = 0.5;
const DEFAULT_MIN_BOOKS_PER_VOLUME = 2;
const DEFAULT_MAX_KMEANS_ITERATIONS = 10;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ClusterStabilityResult {
  /** Number of volumes split into two sub-volumes. */
  splitCount: number;

  /** Number of volumes merged into a neighbour. */
  mergeCount: number;

  /** Number of PageActivity community-label updates written. */
  communityUpdates: number;

  /** ISO timestamp when the stability run completed. */
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ClusterStability
// ---------------------------------------------------------------------------

export class ClusterStability {
  private readonly varianceThreshold: number;
  private readonly minBooksPerVolume: number;
  private readonly maxKmeansIterations: number;

  constructor(options: ClusterStabilityOptions = {}) {
    this.varianceThreshold =
      options.varianceThreshold ?? DEFAULT_VARIANCE_THRESHOLD;
    this.minBooksPerVolume =
      options.minBooksPerVolume ?? DEFAULT_MIN_BOOKS_PER_VOLUME;
    this.maxKmeansIterations =
      options.maxKmeansIterations ?? DEFAULT_MAX_KMEANS_ITERATIONS;
  }

  /**
   * Run one stability pass over all volumes in the metadata store.
   *
   * Scans for unstable (high-variance) volumes and undersized volumes, then
   * applies the appropriate structural fix and updates community labels.
   */
  async run(metadataStore: MetadataStore): Promise<ClusterStabilityResult> {
    // Collect all volumes (we scan through shelves)
    const shelves = await this.collectAllShelves(metadataStore);
    const allVolumeIds = shelves.flatMap((s) => s.volumeIds);

    const volumes = (
      await Promise.all(allVolumeIds.map((id) => metadataStore.getVolume(id)))
    ).filter((v): v is Volume => v !== undefined);

    let splitCount = 0;
    let mergeCount = 0;
    let communityUpdates = 0;

    // --- Pass 1: split high-variance volumes ---
    for (const volume of volumes) {
      if (
        volume.variance > this.varianceThreshold &&
        volume.bookIds.length >= 2
      ) {
        const splits = await this.splitVolume(volume, metadataStore);
        if (splits !== null) {
          splitCount++;
          communityUpdates += await this.updateCommunityLabels(
            splits,
            metadataStore,
          );
          // Replace the old volume in shelves with the two new sub-volumes,
          // then delete the orphan volume record and its reverse-index entries.
          await this.replaceVolumeInShelves(
            volume.volumeId,
            splits,
            metadataStore,
          );
          await metadataStore.deleteVolume(volume.volumeId);
        }
      }
    }

    // --- Pass 2: merge undersized volumes ---
    // Re-read volumes after splits to pick up any IDs that may have changed.
    // Also include newly created split volumes from Pass 1 via a fresh shelf scan.
    const allShelves2 = await this.collectAllShelves(metadataStore);
    const allVolumeIds2 = allShelves2.flatMap((s) => s.volumeIds);
    const allVolumesNow = (
      await Promise.all(allVolumeIds2.map((id) => metadataStore.getVolume(id)))
    ).filter((v): v is Volume => v !== undefined);

    // Filter to undersized volumes (skip volumes we just created by splitting)
    const undersized = allVolumesNow.filter(
      (v) => v.bookIds.length < this.minBooksPerVolume,
    );

    const merged = new Set<Hash>();

    for (const small of undersized) {
      if (merged.has(small.volumeId)) continue;

      const neighbour = this.findNearestNeighbour(
        small,
        allVolumesNow.filter(
          (v) =>
            v.volumeId !== small.volumeId && !merged.has(v.volumeId),
        ),
      );

      if (neighbour === null) continue;

      const mergedVolume = await this.mergeVolumes(
        small,
        neighbour,
        metadataStore,
      );

      merged.add(small.volumeId);
      merged.add(neighbour.volumeId);
      mergeCount++;
      communityUpdates += await this.updateCommunityLabels(
        [mergedVolume],
        metadataStore,
      );
      // Replace the consumed volumes in shelves with the merged volume,
      // then delete their orphan records and reverse-index entries.
      await this.replaceVolumeInShelves(
        small.volumeId,
        [mergedVolume],
        metadataStore,
      );
      await this.replaceVolumeInShelves(
        neighbour.volumeId,
        [],
        metadataStore,
      );
      await metadataStore.deleteVolume(small.volumeId);
      await metadataStore.deleteVolume(neighbour.volumeId);
    }

    return {
      splitCount,
      mergeCount,
      communityUpdates,
      completedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Split logic
  // ---------------------------------------------------------------------------

  /**
   * Split a high-variance volume into two sub-volumes using K-means (K=2).
   *
   * Returns the two new volumes, or `null` if the split cannot be performed
   * (e.g. insufficient books with resolvable vectors).
   */
  private async splitVolume(
    volume: Volume,
    metadataStore: MetadataStore,
  ): Promise<[Volume, Volume] | null> {
    const books = (
      await Promise.all(volume.bookIds.map((id) => metadataStore.getBook(id)))
    ).filter((b): b is Book => b !== undefined);

    if (books.length < 2) return null;

    // Use only the medoid page vector as representative for each book.
    // For simplicity we use the first prototype offset of the parent volume
    // and the book's position (index) as a deterministic pseudo-distance.
    // A full implementation would read actual medoid embeddings via VectorStore.
    const assignments = this.kmeansAssign(books);
    if (assignments === null) return null;

    const [groupA, groupB] = assignments;

    const volumeA = await this.buildSubVolume(groupA, volume);
    const volumeB = await this.buildSubVolume(groupB, volume);

    await metadataStore.putVolume(volumeA);
    await metadataStore.putVolume(volumeB);

    return [volumeA, volumeB];
  }

  /**
   * Assign books to two clusters using a simple K-means initialisation:
   * centroid A = first half by index, centroid B = second half.
   *
   * Returns `null` when it is not possible to form two non-empty clusters.
   *
   * The "distance" used here is the index difference (as a stable proxy when
   * real vectors are not loaded), which produces a balanced split without
   * requiring a live VectorStore.  A production pass would replace this with
   * actual cosine distances between medoid embeddings.
   *
   * Precomputes a `bookId → index` map so each iteration is O(n) rather than
   * O(n²) (avoids repeated Array.indexOf calls inside the inner loop).
   */
  private kmeansAssign(books: Book[]): [Book[], Book[]] | null {
    if (books.length < 2) return null;

    const n = books.length;
    // Precompute index map to avoid O(n²) indexOf calls
    const indexMap = new Map<string, number>(
      books.map((b, i) => [b.bookId, i]),
    );

    // Centroid A = first half, centroid B = second half (index-based split)
    const splitPoint = Math.ceil(n / 2);

    let groupA = books.slice(0, splitPoint);
    let groupB = books.slice(splitPoint);

    if (groupA.length === 0 || groupB.length === 0) return null;

    // Run up to maxKmeansIterations assignment cycles using index centroids
    for (let iter = 0; iter < this.maxKmeansIterations; iter++) {
      const centroidA = this.indexCentroid(groupA, indexMap);
      const centroidB = this.indexCentroid(groupB, indexMap);

      const newA: Book[] = [];
      const newB: Book[] = [];

      for (const book of books) {
        const idx = indexMap.get(book.bookId) ?? 0;
        const distA = Math.abs(idx - centroidA);
        const distB = Math.abs(idx - centroidB);
        if (distA <= distB) {
          newA.push(book);
        } else {
          newB.push(book);
        }
      }

      // Ensure neither cluster becomes empty
      if (newA.length === 0) {
        newA.push(newB.splice(0, 1)[0]);
      }
      if (newB.length === 0) {
        newB.push(newA.splice(newA.length - 1, 1)[0]);
      }

      const converged =
        newA.length === groupA.length &&
        newA.every((b, i) => b.bookId === groupA[i]?.bookId);

      groupA = newA;
      groupB = newB;

      if (converged) break;
    }

    return [groupA, groupB];
  }

  /** Compute the mean index of a group using the precomputed index map. */
  private indexCentroid(
    group: Book[],
    indexMap: Map<string, number>,
  ): number {
    const sum = group.reduce(
      (acc, b) => acc + (indexMap.get(b.bookId) ?? 0),
      0,
    );
    return sum / group.length;
  }

  private async buildSubVolume(
    books: Book[],
    parent: Volume,
  ): Promise<Volume> {
    const bookIds = books.map((b) => b.bookId);
    const seed = `split:${parent.volumeId}:${bookIds.join(",")}`;
    const volumeId = await hashText(seed);

    // Variance is approximated as half the parent's variance for each child.
    // A production pass would recompute from actual embeddings.
    const variance = parent.variance / 2;

    return {
      volumeId,
      bookIds,
      prototypeOffsets: [...parent.prototypeOffsets],
      prototypeDim: parent.prototypeDim,
      variance,
    };
  }

  // ---------------------------------------------------------------------------
  // Merge logic
  // ---------------------------------------------------------------------------

  private findNearestNeighbour(
    target: Volume,
    candidates: Volume[],
  ): Volume | null {
    if (candidates.length === 0) return null;

    // Use the count of shared books as a similarity proxy.
    // A production pass would compare medoid embeddings.
    let best = candidates[0];
    let bestShared = this.sharedBookCount(target, best);

    for (let i = 1; i < candidates.length; i++) {
      const shared = this.sharedBookCount(target, candidates[i]);
      if (shared > bestShared) {
        best = candidates[i];
        bestShared = shared;
      }
    }

    return best;
  }

  private sharedBookCount(a: Volume, b: Volume): number {
    const setA = new Set(a.bookIds);
    return b.bookIds.filter((id) => setA.has(id)).length;
  }

  private async mergeVolumes(
    a: Volume,
    b: Volume,
    metadataStore: MetadataStore,
  ): Promise<Volume> {
    const bookIds = [...new Set([...a.bookIds, ...b.bookIds])];
    const seed = `merge:${a.volumeId}:${b.volumeId}`;
    const volumeId = await hashText(seed);

    // Average the variance of the two merged volumes
    const variance = (a.variance + b.variance) / 2;

    const merged: Volume = {
      volumeId,
      bookIds,
      prototypeOffsets: [...a.prototypeOffsets, ...b.prototypeOffsets],
      prototypeDim: a.prototypeDim,
      variance,
    };

    await metadataStore.putVolume(merged);
    return merged;
  }

  // ---------------------------------------------------------------------------
  // Community label updates
  // ---------------------------------------------------------------------------

  /**
   * After a structural change (split or merge), update the `communityId` field
   * on each affected page's `PageActivity` record.
   *
   * The community ID is set to the new volume's `volumeId` so that the
   * SalienceEngine can bucket promotions correctly.
   *
   * @returns The number of PageActivity records updated.
   */
  private async updateCommunityLabels(
    volumes: Volume[],
    metadataStore: MetadataStore,
  ): Promise<number> {
    let updates = 0;

    for (const volume of volumes) {
      const books = (
        await Promise.all(
          volume.bookIds.map((id) => metadataStore.getBook(id)),
        )
      ).filter((b): b is Book => b !== undefined);

      for (const book of books) {
        for (const pageId of book.pageIds) {
          const activity = await metadataStore.getPageActivity(pageId);
          const updated: PageActivity = {
            pageId,
            queryHitCount: activity?.queryHitCount ?? 0,
            lastQueryAt:
              activity?.lastQueryAt ?? new Date().toISOString(),
            communityId: volume.volumeId,
          };
          await metadataStore.putPageActivity(updated);
          updates++;
        }
      }
    }

    return updates;
  }

  // ---------------------------------------------------------------------------
  // Shelf update helpers
  // ---------------------------------------------------------------------------

  /**
   * Replace `oldVolumeId` in every shelf that references it with the IDs of
   * `replacements`. Passing an empty `replacements` array removes the old
   * volume from the shelf without adding a substitute.
   */
  private async replaceVolumeInShelves(
    oldVolumeId: Hash,
    replacements: Volume[],
    metadataStore: MetadataStore,
  ): Promise<void> {
    const shelves = await this.collectAllShelves(metadataStore);

    for (const shelf of shelves) {
      if (!shelf.volumeIds.includes(oldVolumeId)) continue;

      const newVolumeIds = shelf.volumeIds
        .filter((id) => id !== oldVolumeId)
        .concat(replacements.map((v) => v.volumeId));

      await metadataStore.putShelf({
        ...shelf,
        volumeIds: newVolumeIds,
      });
    }
  }

  private async collectAllShelves(
    metadataStore: MetadataStore,
  ) {
    return metadataStore.getAllShelves();
  }
}
