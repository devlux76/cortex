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
} from "../core/types";

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

const DB_VERSION = 3;

/** Object-store names used across the schema. */
const STORE = {
  pages: "pages",
  books: "books",
  volumes: "volumes",
  shelves: "shelves",
  edges: "edges_hebbian",
  neighborGraph: "neighbor_graph",
  flags: "flags",
  pageToBook: "page_to_book",
  bookToVolume: "book_to_volume",
  volumeToShelf: "volume_to_shelf",
  hotpathIndex: "hotpath_index",
  pageActivity: "page_activity",
} as const;

// ---------------------------------------------------------------------------
// Low-level IDB helpers
// ---------------------------------------------------------------------------

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException("Transaction aborted", "AbortError"));
  });
}

// ---------------------------------------------------------------------------
// Schema upgrade
// ---------------------------------------------------------------------------

function applyUpgrade(db: IDBDatabase): void {
  // v1 stores
  if (!db.objectStoreNames.contains(STORE.pages)) {
    db.createObjectStore(STORE.pages, { keyPath: "pageId" });
  }
  if (!db.objectStoreNames.contains(STORE.books)) {
    db.createObjectStore(STORE.books, { keyPath: "bookId" });
  }
  if (!db.objectStoreNames.contains(STORE.volumes)) {
    db.createObjectStore(STORE.volumes, { keyPath: "volumeId" });
  }
  if (!db.objectStoreNames.contains(STORE.shelves)) {
    db.createObjectStore(STORE.shelves, { keyPath: "shelfId" });
  }

  if (!db.objectStoreNames.contains(STORE.edges)) {
    const edgeStore = db.createObjectStore(STORE.edges, {
      keyPath: ["fromPageId", "toPageId"],
    });
    edgeStore.createIndex("by-from", "fromPageId");
  }


  if (!db.objectStoreNames.contains(STORE.flags)) {
    db.createObjectStore(STORE.flags, { keyPath: "volumeId" });
  }

  if (!db.objectStoreNames.contains(STORE.pageToBook)) {
    db.createObjectStore(STORE.pageToBook, { keyPath: "pageId" });
  }
  if (!db.objectStoreNames.contains(STORE.bookToVolume)) {
    db.createObjectStore(STORE.bookToVolume, { keyPath: "bookId" });
  }
  if (!db.objectStoreNames.contains(STORE.volumeToShelf)) {
    db.createObjectStore(STORE.volumeToShelf, { keyPath: "volumeId" });
  }

  // v2 stores — hotpath index + page activity
  if (!db.objectStoreNames.contains(STORE.hotpathIndex)) {
    const hp = db.createObjectStore(STORE.hotpathIndex, { keyPath: "entityId" });
    hp.createIndex("by-tier", "tier");
  }
  if (!db.objectStoreNames.contains(STORE.pageActivity)) {
    db.createObjectStore(STORE.pageActivity, { keyPath: "pageId" });
  }

  // v3 stores — neighbor_graph (replaces the old metroid_neighbors name)
  if (!db.objectStoreNames.contains(STORE.neighborGraph)) {
    db.createObjectStore(STORE.neighborGraph, { keyPath: "pageId" });
  }
}

// ---------------------------------------------------------------------------
// IndexedDbMetadataStore
// ---------------------------------------------------------------------------

/**
 * Full MetadataStore implementation backed by IndexedDB.
 *
 * Reverse-index rows (`page_to_book`, `book_to_volume`, `volume_to_shelf`) are
 * maintained atomically inside the same transaction as the owning entity write,
 * so they are always consistent with the latest put.
 *
 * Usage:
 *   const store = await IndexedDbMetadataStore.open("cortex");
 */
export class IndexedDbMetadataStore implements MetadataStore {
  private constructor(private readonly db: IDBDatabase) {}

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  static open(dbName: string): Promise<IndexedDbMetadataStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, DB_VERSION);

      req.onupgradeneeded = (event) => {
        applyUpgrade((event.target as IDBOpenDBRequest).result);
      };

      req.onsuccess = () => resolve(new IndexedDbMetadataStore(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------------------
  // Page CRUD
  // -------------------------------------------------------------------------

  putPage(page: Page): Promise<void> {
    return this._put(STORE.pages, page);
  }

  async getPage(pageId: Hash): Promise<Page | undefined> {
    return this._get<Page>(STORE.pages, pageId);
  }

  /**
   * Returns all pages in the store. Used for warm/cold fallbacks in query.
   * TODO: Replace with a paginated or indexed scan before production use —
   * loading every page into memory is expensive for large corpora.
   */
  async getAllPages(): Promise<Page[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE.pages, "readonly");
      const req = tx.objectStore(STORE.pages).getAll();
      req.onsuccess = () => resolve(req.result as Page[]);
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------------------
  // Book CRUD + reverse index maintenance
  // -------------------------------------------------------------------------

  putBook(book: Book): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        [STORE.books, STORE.pageToBook],
        "readwrite",
      );

      // Store the book itself
      tx.objectStore(STORE.books).put(book);

      // Update page->book reverse index for every page in this book
      const idxStore = tx.objectStore(STORE.pageToBook);
      for (const pageId of book.pageIds) {
        const getReq = idxStore.get(pageId);
        getReq.onsuccess = () => {
          const existing: { pageId: Hash; bookIds: Hash[] } | undefined =
            getReq.result;
          const bookIds = existing?.bookIds ?? [];
          if (!bookIds.includes(book.bookId)) {
            bookIds.push(book.bookId);
          }
          idxStore.put({ pageId, bookIds });
        };
      }

      promisifyTransaction(tx).then(resolve).catch(reject);
    });
  }

  async getBook(bookId: Hash): Promise<Book | undefined> {
    return this._get<Book>(STORE.books, bookId);
  }

  // -------------------------------------------------------------------------
  // Volume CRUD + reverse index
  // -------------------------------------------------------------------------

  putVolume(volume: Volume): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        [STORE.volumes, STORE.bookToVolume],
        "readwrite",
      );

      tx.objectStore(STORE.volumes).put(volume);

      const idxStore = tx.objectStore(STORE.bookToVolume);
      for (const bookId of volume.bookIds) {
        const getReq = idxStore.get(bookId);
        getReq.onsuccess = () => {
          const existing: { bookId: Hash; volumeIds: Hash[] } | undefined =
            getReq.result;
          const volumeIds = existing?.volumeIds ?? [];
          if (!volumeIds.includes(volume.volumeId)) {
            volumeIds.push(volume.volumeId);
          }
          idxStore.put({ bookId, volumeIds });
        };
      }

      promisifyTransaction(tx).then(resolve).catch(reject);
    });
  }

  async getVolume(volumeId: Hash): Promise<Volume | undefined> {
    return this._get<Volume>(STORE.volumes, volumeId);
  }

  /**
   * Delete a volume and clean up its reverse-index entries:
   * - Removes the volume from the `bookToVolume` index for each of its books.
   * - Deletes the `volumeToShelf` index entry for this volume.
   * - Deletes the volume record itself.
   *
   * Callers should update or remove the volume from any shelf's `volumeIds`
   * list before calling this method.
   */
  async deleteVolume(volumeId: Hash): Promise<void> {
    const volume = await this.getVolume(volumeId);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        [STORE.volumes, STORE.bookToVolume, STORE.volumeToShelf],
        "readwrite",
      );

      // Remove from bookToVolume reverse index for each book the volume owned
      if (volume) {
        const bookToVolumeStore = tx.objectStore(STORE.bookToVolume);
        for (const bookId of volume.bookIds) {
          const getReq = bookToVolumeStore.get(bookId);
          getReq.onsuccess = () => {
            const existing: { bookId: Hash; volumeIds: Hash[] } | undefined =
              getReq.result;
            if (!existing) return;
            const updatedVolumeIds = existing.volumeIds.filter(
              (id) => id !== volumeId,
            );
            if (updatedVolumeIds.length === 0) {
              bookToVolumeStore.delete(bookId);
            } else {
              bookToVolumeStore.put({ bookId, volumeIds: updatedVolumeIds });
            }
          };
        }
      }

      // Remove volumeToShelf reverse index entry
      tx.objectStore(STORE.volumeToShelf).delete(volumeId);

      // Delete the volume record itself
      tx.objectStore(STORE.volumes).delete(volumeId);

      promisifyTransaction(tx).then(resolve).catch(reject);
    });
  }

  // -------------------------------------------------------------------------
  // Shelf CRUD + reverse index
  // -------------------------------------------------------------------------

  putShelf(shelf: Shelf): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        [STORE.shelves, STORE.volumeToShelf],
        "readwrite",
      );

      tx.objectStore(STORE.shelves).put(shelf);

      const idxStore = tx.objectStore(STORE.volumeToShelf);
      for (const volumeId of shelf.volumeIds) {
        const getReq = idxStore.get(volumeId);
        getReq.onsuccess = () => {
          const existing: { volumeId: Hash; shelfIds: Hash[] } | undefined =
            getReq.result;
          const shelfIds = existing?.shelfIds ?? [];
          if (!shelfIds.includes(shelf.shelfId)) {
            shelfIds.push(shelf.shelfId);
          }
          idxStore.put({ volumeId, shelfIds });
        };
      }

      promisifyTransaction(tx).then(resolve).catch(reject);
    });
  }

  async getShelf(shelfId: Hash): Promise<Shelf | undefined> {
    return this._get<Shelf>(STORE.shelves, shelfId);
  }

  // -------------------------------------------------------------------------
  // Hebbian edges
  // -------------------------------------------------------------------------

  putEdges(edges: Edge[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE.edges, "readwrite");
      const store = tx.objectStore(STORE.edges);
      for (const edge of edges) {
        store.put(edge);
      }
      promisifyTransaction(tx).then(resolve).catch(reject);
    });
  }

  async getNeighbors(pageId: Hash, limit?: number): Promise<Edge[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE.edges, "readonly");
      const idx = tx.objectStore(STORE.edges).index("by-from");
      const req = idx.getAll(IDBKeyRange.only(pageId));
      req.onsuccess = () => {
        let rows: Edge[] = req.result;
        rows.sort((a, b) => b.weight - a.weight);
        if (limit !== undefined) rows = rows.slice(0, limit);
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------------------
  // Reverse-index helpers
  // -------------------------------------------------------------------------

  async getBooksByPage(pageId: Hash): Promise<Book[]> {
    const row = await this._get<{ pageId: Hash; bookIds: Hash[] }>(
      STORE.pageToBook,
      pageId,
    );
    if (!row || row.bookIds.length === 0) return [];
    return this._getMany<Book>(STORE.books, row.bookIds);
  }

  async getVolumesByBook(bookId: Hash): Promise<Volume[]> {
    const row = await this._get<{ bookId: Hash; volumeIds: Hash[] }>(
      STORE.bookToVolume,
      bookId,
    );
    if (!row || row.volumeIds.length === 0) return [];
    return this._getMany<Volume>(STORE.volumes, row.volumeIds);
  }

  async getShelvesByVolume(volumeId: Hash): Promise<Shelf[]> {
    const row = await this._get<{ volumeId: Hash; shelfIds: Hash[] }>(
      STORE.volumeToShelf,
      volumeId,
    );
    if (!row || row.shelfIds.length === 0) return [];
    return this._getMany<Shelf>(STORE.shelves, row.shelfIds);
  }

  // -------------------------------------------------------------------------
  // Semantic neighbor radius index
  // -------------------------------------------------------------------------

  putSemanticNeighbors(pageId: Hash, neighbors: SemanticNeighbor[]): Promise<void> {
    return this._put(STORE.neighborGraph, { pageId, neighbors });
  }

  async getSemanticNeighbors(
    pageId: Hash,
    maxDegree?: number,
  ): Promise<SemanticNeighbor[]> {
    const row = await this._get<{ pageId: Hash; neighbors: SemanticNeighbor[] }>(
      STORE.neighborGraph,
      pageId,
    );
    if (!row) return [];
    const list = row.neighbors;
    return maxDegree !== undefined ? list.slice(0, maxDegree) : list;
  }

  async getInducedNeighborSubgraph(
    seedPageIds: Hash[],
    maxHops: number,
  ): Promise<SemanticNeighborSubgraph> {
    const visited = new Set<Hash>(seedPageIds);
    const nodeSet = new Set<Hash>(seedPageIds);
    const edgeMap = new Map<string, { from: Hash; to: Hash; distance: number }>();

    let frontier = [...seedPageIds];

    for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
      const nextFrontier: Hash[] = [];

      for (const pageId of frontier) {
        const neighbors = await this.getSemanticNeighbors(pageId);
        for (const n of neighbors) {
          const key = `${pageId}\x00${n.neighborPageId}`;
          if (!edgeMap.has(key)) {
            edgeMap.set(key, {
              from: pageId,
              to: n.neighborPageId,
              distance: n.distance,
            });
          }
          if (!visited.has(n.neighborPageId)) {
            visited.add(n.neighborPageId);
            nodeSet.add(n.neighborPageId);
            nextFrontier.push(n.neighborPageId);
          }
        }
      }

      frontier = nextFrontier;
    }

    return {
      nodes: [...nodeSet],
      edges: [...edgeMap.values()],
    };
  }

  // -------------------------------------------------------------------------
  // Dirty-recalc flags
  // -------------------------------------------------------------------------

  async needsNeighborRecalc(volumeId: Hash): Promise<boolean> {
    const row = await this._get<{ volumeId: Hash; needsRecalc: boolean }>(
      STORE.flags,
      volumeId,
    );
    return row?.needsRecalc === true;
  }

  flagVolumeForNeighborRecalc(volumeId: Hash): Promise<void> {
    return this._put(STORE.flags, { volumeId, needsRecalc: true });
  }

  clearNeighborRecalcFlag(volumeId: Hash): Promise<void> {
    return this._put(STORE.flags, { volumeId, needsRecalc: false });
  }

  // -------------------------------------------------------------------------
  // Hotpath index
  // -------------------------------------------------------------------------

  putHotpathEntry(entry: HotpathEntry): Promise<void> {
    return this._put(STORE.hotpathIndex, entry);
  }

  async getHotpathEntries(tier?: HotpathEntry["tier"]): Promise<HotpathEntry[]> {
    if (tier !== undefined) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(STORE.hotpathIndex, "readonly");
        const idx = tx.objectStore(STORE.hotpathIndex).index("by-tier");
        const req = idx.getAll(IDBKeyRange.only(tier));
        req.onsuccess = () => resolve(req.result as HotpathEntry[]);
        req.onerror = () => reject(req.error);
      });
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE.hotpathIndex, "readonly");
      const req = tx.objectStore(STORE.hotpathIndex).getAll();
      req.onsuccess = () => resolve(req.result as HotpathEntry[]);
      req.onerror = () => reject(req.error);
    });
  }

  removeHotpathEntry(entityId: Hash): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE.hotpathIndex, "readwrite");
      tx.objectStore(STORE.hotpathIndex).delete(entityId);
      promisifyTransaction(tx).then(resolve).catch(reject);
    });
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

    // Deterministic: break ties by entityId (smallest wins)
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

    await this.removeHotpathEntry(weakest.entityId);
  }

  async getResidentCount(): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE.hotpathIndex, "readonly");
      const req = tx.objectStore(STORE.hotpathIndex).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------------------
  // Page activity
  // -------------------------------------------------------------------------

  putPageActivity(activity: PageActivity): Promise<void> {
    return this._put(STORE.pageActivity, activity);
  }

  async getPageActivity(pageId: Hash): Promise<PageActivity | undefined> {
    return this._get<PageActivity>(STORE.pageActivity, pageId);
  }

  // -------------------------------------------------------------------------
  // Private generic helpers
  // -------------------------------------------------------------------------

  private _put(storeName: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      promisifyTransaction(tx).then(resolve).catch(reject);
    });
  }

  private _get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private _getMany<T>(storeName: string, keys: IDBValidKey[]): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const results: T[] = [];
      let pending = keys.length;

      if (pending === 0) {
        resolve(results);
        return;
      }

      keys.forEach((key, i) => {
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result !== undefined) results[i] = req.result as T;
          if (--pending === 0) resolve(results.filter(Boolean));
        };
        req.onerror = () => reject(req.error);
      });
    });
  }
}
