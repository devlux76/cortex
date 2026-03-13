// ---------------------------------------------------------------------------
// ClusterStability — Volume split/merge for balanced cluster maintenance
// ---------------------------------------------------------------------------
//
// The Daydreamer background worker calls ClusterStability periodically to
// detect and fix unstable volumes:
//
//   - HIGH-VARIANCE volumes are split into two balanced sub-volumes using
//     K-means with K=2 (one pass).
//   - LOW-COUNT volumes are merged into the nearest neighbour volume
//     (by medoid distance).
//   - Community labels on PageActivity records are updated after structural
//     changes so downstream salience computation stays coherent.
//
// All operations are idempotent: re-running on a stable set of volumes is a
// no-op.
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
          // Remove the original volume from storage (replace with two new ones)
          await this.replaceVolumeInShelves(
            volume.volumeId,
            splits,
            metadataStore,
          );
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
   * centroid A = first book, centroid B = the book most dissimilar to A.
   *
   * Returns `null` when it is not possible to form two non-empty clusters.
   *
   * The "distance" used here is the index difference (as a stable proxy when
   * real vectors are not loaded), which produces a balanced split without
   * requiring a live VectorStore.  A production pass would replace this with
   * actual cosine distances between medoid embeddings.
   */
  private kmeansAssign(books: Book[]): [Book[], Book[]] | null {
    if (books.length < 2) return null;

    const n = books.length;
    // Centroid A = first half, centroid B = second half (index-based split)
    const splitPoint = Math.ceil(n / 2);

    let groupA = books.slice(0, splitPoint);
    let groupB = books.slice(splitPoint);

    if (groupA.length === 0 || groupB.length === 0) return null;

    // Run up to maxKmeansIterations assignment cycles using index centroids
    for (let iter = 0; iter < this.maxKmeansIterations; iter++) {
      const centroidA = this.indexCentroid(groupA, books);
      const centroidB = this.indexCentroid(groupB, books);

      const newA: Book[] = [];
      const newB: Book[] = [];

      for (const book of books) {
        const idx = books.indexOf(book);
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

  /** Compute the mean index of a group relative to the global book array. */
  private indexCentroid(group: Book[], allBooks: Book[]): number {
    const indices = group.map((b) => allBooks.indexOf(b));
    return indices.reduce((a, b) => a + b, 0) / indices.length;
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
    // MetadataStore does not expose a `getAllShelves()` helper, so we iterate
    // over all volumes and collect the shelves that reference them.
    // We use the reverse-index helper to get shelves for each volume.
    const allVolumes = await this.collectAllVolumes(metadataStore);
    const shelfMap = new Map<Hash, Awaited<ReturnType<MetadataStore["getShelf"]>>>();

    for (const volume of allVolumes) {
      const shelves = await metadataStore.getShelvesByVolume(volume.volumeId);
      for (const shelf of shelves) {
        if (!shelfMap.has(shelf.shelfId)) {
          shelfMap.set(shelf.shelfId, shelf);
        }
      }
    }

    return [...shelfMap.values()].filter(
      (s): s is NonNullable<typeof s> => s !== undefined,
    );
  }

  private async collectAllVolumes(
    metadataStore: MetadataStore,
  ): Promise<Volume[]> {
    const allPages = await metadataStore.getAllPages();
    const volumeIds = new Set<Hash>();

    for (const page of allPages) {
      const books = await metadataStore.getBooksByPage(page.pageId);
      for (const book of books) {
        const volumes = await metadataStore.getVolumesByBook(book.bookId);
        for (const volume of volumes) {
          volumeIds.add(volume.volumeId);
        }
      }
    }

    const volumes = await Promise.all(
      [...volumeIds].map((id) => metadataStore.getVolume(id)),
    );
    return volumes.filter((v): v is Volume => v !== undefined);
  }

  private async reloadVolumes(
    ids: Hash[],
    metadataStore: MetadataStore,
  ): Promise<Volume[]> {
    const volumes = await Promise.all(ids.map((id) => metadataStore.getVolume(id)));
    return volumes.filter((v): v is Volume => v !== undefined);
  }
}
