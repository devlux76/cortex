import { beforeEach, describe, expect, it } from "vitest";

import { ClusterStability } from "../../daydreamer/ClusterStability";
import type {
  Book,
  Edge,
  Hash,
  HotpathEntry,
  MetadataStore,
  SemanticNeighbor,
  SemanticNeighborSubgraph,
  Page,
  PageActivity,
  Shelf,
  Volume,
} from "../../core/types";

// ---------------------------------------------------------------------------
// In-memory MetadataStore mock
// ---------------------------------------------------------------------------

class MockMetadataStore implements MetadataStore {
  pages = new Map<Hash, Page>();
  books = new Map<Hash, Book>();
  volumes = new Map<Hash, Volume>();
  shelves = new Map<Hash, Shelf>();
  activities = new Map<Hash, PageActivity>();
  edges: Edge[] = [];
  hotpath = new Map<Hash, HotpathEntry>();

  // Pages
  async putPage(page: Page): Promise<void> { this.pages.set(page.pageId, { ...page }); }
  async getPage(id: Hash): Promise<Page | undefined> { return this.pages.get(id); }
  async getAllPages(): Promise<Page[]> { return [...this.pages.values()]; }

  // Books
  async putBook(book: Book): Promise<void> { this.books.set(book.bookId, { ...book }); }
  async getBook(id: Hash): Promise<Book | undefined> { return this.books.get(id); }

  // Volumes
  async putVolume(volume: Volume): Promise<void> { this.volumes.set(volume.volumeId, { ...volume }); }
  async getVolume(id: Hash): Promise<Volume | undefined> { return this.volumes.get(id); }
  async deleteVolume(volumeId: Hash): Promise<void> { this.volumes.delete(volumeId); }

  // Shelves
  async putShelf(shelf: Shelf): Promise<void> { this.shelves.set(shelf.shelfId, { ...shelf }); }
  async getShelf(id: Hash): Promise<Shelf | undefined> { return this.shelves.get(id); }

  // Edges
  async putEdges(edges: Edge[]): Promise<void> { this.edges.push(...edges); }
  async getNeighbors(pageId: Hash): Promise<Edge[]> {
    return this.edges.filter((e) => e.fromPageId === pageId);
  }

  // Reverse indexes
  async getBooksByPage(pageId: Hash): Promise<Book[]> {
    return [...this.books.values()].filter((b) => b.pageIds.includes(pageId));
  }
  async getVolumesByBook(bookId: Hash): Promise<Volume[]> {
    return [...this.volumes.values()].filter((v) => v.bookIds.includes(bookId));
  }
  async getShelvesByVolume(volumeId: Hash): Promise<Shelf[]> {
    return [...this.shelves.values()].filter((s) => s.volumeIds.includes(volumeId));
  }

  // Metroid / Semantic neighbor stubs
  async putSemanticNeighbors(): Promise<void> { /* stub */ }
  async getSemanticNeighbors(): Promise<SemanticNeighbor[]> { return []; }
  async getInducedNeighborSubgraph(): Promise<SemanticNeighborSubgraph> { return { nodes: [], edges: [] }; }
  async needsNeighborRecalc(): Promise<boolean> { return false; }
  async flagVolumeForNeighborRecalc(): Promise<void> { /* stub */ }
  async clearNeighborRecalcFlag(): Promise<void> { /* stub */ }

  // Hotpath
  async putHotpathEntry(entry: HotpathEntry): Promise<void> { this.hotpath.set(entry.entityId, { ...entry }); }
  async getHotpathEntries(tier?: HotpathEntry["tier"]): Promise<HotpathEntry[]> {
    const all = [...this.hotpath.values()];
    return tier !== undefined ? all.filter((e) => e.tier === tier) : all;
  }
  async removeHotpathEntry(id: Hash): Promise<void> { this.hotpath.delete(id); }
  async evictWeakest(): Promise<void> { /* stub */ }
  async getResidentCount(): Promise<number> { return this.hotpath.size; }

  // Page activity
  async putPageActivity(activity: PageActivity): Promise<void> {
    this.activities.set(activity.pageId, { ...activity });
  }
  async getPageActivity(pageId: Hash): Promise<PageActivity | undefined> {
    return this.activities.get(pageId);
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeVolume(
  id: string,
  bookIds: string[],
  variance: number,
): Volume {
  return {
    volumeId: id,
    bookIds,
    prototypeOffsets: [0],
    prototypeDim: 8,
    variance,
  };
}

function makeBook(id: string, pageIds: string[]): Book {
  return {
    bookId: id,
    pageIds,
    medoidPageId: pageIds[0] ?? id,
    meta: {},
  };
}

function makeShelf(id: string, volumeIds: string[]): Shelf {
  return {
    shelfId: id,
    volumeIds,
    routingPrototypeOffsets: [],
    routingDim: 8,
  };
}

/** Put a minimal fake page into the store so hierarchy traversal works. */
async function seedPage(store: MockMetadataStore, pageId: string): Promise<void> {
  await store.putPage({
    pageId,
    content: `fake content for ${pageId}`,
    embeddingOffset: 0,
    embeddingDim: 8,
    contentHash: pageId,
    vectorHash: pageId,
    creatorPubKey: "fake-key",
    signature: "fake-sig",
    createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClusterStability", () => {
  let store: MockMetadataStore;

  beforeEach(() => {
    store = new MockMetadataStore();
  });

  describe("no-op on stable volumes", () => {
    it("returns zero counts when there are no volumes", async () => {
      const stability = new ClusterStability();
      const result = await stability.run(store);

      expect(result.splitCount).toBe(0);
      expect(result.mergeCount).toBe(0);
      expect(result.communityUpdates).toBe(0);
      expect(result.completedAt).toBeTruthy();
    });

    it("does not split volumes below the variance threshold", async () => {
      const book1 = makeBook("book-1", ["page-1", "page-2"]);
      const book2 = makeBook("book-2", ["page-3", "page-4"]);
      const volume = makeVolume("vol-stable", ["book-1", "book-2"], 0.1);
      const shelf = makeShelf("shelf-1", ["vol-stable"]);

      await store.putBook(book1);
      await store.putBook(book2);
      await store.putVolume(volume);
      await store.putShelf(shelf);
      for (const pageId of ["page-1", "page-2", "page-3", "page-4"]) {
        await seedPage(store, pageId);
      }

      const stability = new ClusterStability({ varianceThreshold: 0.5 });
      const result = await stability.run(store);

      expect(result.splitCount).toBe(0);
    });

    it("does not merge volumes that meet the minimum book count", async () => {
      const book1 = makeBook("book-1", ["page-1"]);
      const book2 = makeBook("book-2", ["page-2"]);
      const volume = makeVolume("vol-ok", ["book-1", "book-2"], 0.1);
      const shelf = makeShelf("shelf-1", ["vol-ok"]);

      await store.putBook(book1);
      await store.putBook(book2);
      await store.putVolume(volume);
      await store.putShelf(shelf);
      for (const pageId of ["page-1", "page-2"]) {
        await seedPage(store, pageId);
      }

      const stability = new ClusterStability({ minBooksPerVolume: 2 });
      const result = await stability.run(store);

      expect(result.mergeCount).toBe(0);
    });
  });

  describe("split — high-variance volumes", () => {
    it("splits a high-variance volume with four books into two sub-volumes", async () => {
      const books = ["book-A", "book-B", "book-C", "book-D"].map((id) =>
        makeBook(id, [`${id}-page`]),
      );
      for (const book of books) await store.putBook(book);
      // Seed pages so hierarchy traversal can discover the shelf
      for (const book of books) {
        for (const pageId of book.pageIds) await seedPage(store, pageId);
      }

      const volume = makeVolume(
        "vol-high-var",
        books.map((b) => b.bookId),
        0.9,
      );
      const shelf = makeShelf("shelf-1", ["vol-high-var"]);
      await store.putVolume(volume);
      await store.putShelf(shelf);

      const stability = new ClusterStability({ varianceThreshold: 0.5 });
      const result = await stability.run(store);

      expect(result.splitCount).toBe(1);

      // The two new volumes must collectively contain all original books
      const updatedShelf = await store.getShelf("shelf-1");
      expect(updatedShelf).toBeDefined();

      const allNewBooks = new Set<string>();
      for (const volId of updatedShelf!.volumeIds) {
        const vol = await store.getVolume(volId);
        expect(vol).toBeDefined();
        vol!.bookIds.forEach((id) => allNewBooks.add(id));
      }

      for (const book of books) {
        expect(allNewBooks.has(book.bookId)).toBe(true);
      }

      // The original volume must be deleted from the store (no orphan)
      expect(await store.getVolume("vol-high-var")).toBeUndefined();
    });

    it("produces two non-empty sub-volumes when splitting", async () => {
      const books = ["b1", "b2", "b3", "b4"].map((id) =>
        makeBook(id, [`${id}-page`]),
      );
      for (const book of books) await store.putBook(book);
      for (const book of books) {
        for (const pageId of book.pageIds) await seedPage(store, pageId);
      }

      const volume = makeVolume("vol-split", books.map((b) => b.bookId), 0.8);
      const shelf = makeShelf("shelf-x", ["vol-split"]);
      await store.putVolume(volume);
      await store.putShelf(shelf);

      await new ClusterStability({ varianceThreshold: 0.5 }).run(store);

      const updatedShelf = await store.getShelf("shelf-x");
      for (const volId of updatedShelf!.volumeIds) {
        const vol = await store.getVolume(volId);
        expect(vol!.bookIds.length).toBeGreaterThan(0);
      }
    });

    it("updates community labels for pages in split volumes", async () => {
      const books = ["bA", "bB", "bC", "bD"].map((id) =>
        makeBook(id, [`${id}-page`]),
      );
      for (const book of books) await store.putBook(book);
      // Seed pages for hierarchy traversal AND page activities
      for (const book of books) {
        for (const pageId of book.pageIds) {
          await seedPage(store, pageId);
          await store.putPageActivity({
            pageId,
            queryHitCount: 0,
            lastQueryAt: new Date().toISOString(),
          });
        }
      }

      const volume = makeVolume("vol-comm", books.map((b) => b.bookId), 0.9);
      const shelf = makeShelf("shelf-comm", ["vol-comm"]);
      await store.putVolume(volume);
      await store.putShelf(shelf);

      const result = await new ClusterStability({
        varianceThreshold: 0.5,
      }).run(store);

      expect(result.communityUpdates).toBeGreaterThan(0);
    });
  });

  describe("merge — undersized volumes", () => {
    it("merges a one-book volume into the neighbouring volume", async () => {
      const book1 = makeBook("small-book", ["small-page"]);
      const book2 = makeBook("big-book-1", ["big-page-1"]);
      const book3 = makeBook("big-book-2", ["big-page-2"]);

      await store.putBook(book1);
      await store.putBook(book2);
      await store.putBook(book3);
      // Seed pages for hierarchy traversal
      for (const pageId of [
        ...book1.pageIds,
        ...book2.pageIds,
        ...book3.pageIds,
      ]) {
        await seedPage(store, pageId);
      }

      const smallVol = makeVolume("vol-small", ["small-book"], 0.1);
      const bigVol = makeVolume("vol-big", ["big-book-1", "big-book-2"], 0.1);
      const shelf = makeShelf("shelf-merge", ["vol-small", "vol-big"]);

      await store.putVolume(smallVol);
      await store.putVolume(bigVol);
      await store.putShelf(shelf);

      const stability = new ClusterStability({ minBooksPerVolume: 2 });
      const result = await stability.run(store);

      expect(result.mergeCount).toBe(1);

      // The merged volume should contain all three books
      const updatedShelf = await store.getShelf("shelf-merge");
      expect(updatedShelf).toBeDefined();

      const allBooks = new Set<string>();
      for (const volId of updatedShelf!.volumeIds) {
        const vol = await store.getVolume(volId);
        if (vol) vol.bookIds.forEach((id) => allBooks.add(id));
      }
      expect(allBooks.has("small-book")).toBe(true);

      // The consumed volumes must be deleted from the store (no orphans)
      expect(await store.getVolume("vol-small")).toBeUndefined();
      expect(await store.getVolume("vol-big")).toBeUndefined();
    });

    it("does not merge when there is only one volume in the shelf", async () => {
      const book = makeBook("lone-book", ["lone-page"]);
      await store.putBook(book);
      await seedPage(store, "lone-page");

      const volume = makeVolume("vol-lone", ["lone-book"], 0.1);
      const shelf = makeShelf("shelf-lone", ["vol-lone"]);
      await store.putVolume(volume);
      await store.putShelf(shelf);

      const stability = new ClusterStability({ minBooksPerVolume: 2 });
      const result = await stability.run(store);

      expect(result.mergeCount).toBe(0);
    });
  });

  describe("completedAt", () => {
    it("returns a valid ISO timestamp", async () => {
      const stability = new ClusterStability();
      const result = await stability.run(store);
      expect(() => new Date(result.completedAt)).not.toThrow();
      expect(Number.isFinite(new Date(result.completedAt).getTime())).toBe(true);
    });
  });
});
