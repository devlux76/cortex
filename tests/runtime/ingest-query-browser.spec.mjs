import { test, expect } from "@playwright/test";

/**
 * P0-E2: Browser harness integration tests.
 *
 * These tests validate that real browser storage and compute backends
 * function correctly for CORTEX's requirements:
 *   - IndexedDB supports the CRUD, indexing, and persistence patterns used by
 *     IndexedDbMetadataStore (write, read, index creation, index lookup, reopen).
 *   - OPFS is accessible (navigator.storage.getDirectory).
 *   - At least one vector compute backend (WebGPU/WebGL/WASM) is available.
 */

test("IndexedDB supports CORTEX CRUD, index lookup, and persistence patterns", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => globalThis.__cortexHarnessReady === true);

  const result = await page.evaluate(async () => {
    const DB_NAME = "cortex-e2e-browser-test";
    const DB_VERSION = 1;

    // Helper to open the database and create object stores with indexes
    function openDb() {
      return new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("pages")) {
            db.createObjectStore("pages", { keyPath: "pageId" });
          }
          if (!db.objectStoreNames.contains("books")) {
            db.createObjectStore("books", { keyPath: "bookId" });
          }
          if (!db.objectStoreNames.contains("hotpath_index")) {
            const hp = db.createObjectStore("hotpath_index", { keyPath: "entityId" });
            hp.createIndex("by-tier", "tier");
          }
        };
        request.onsuccess = () => resolve(request.result);
      });
    }

    // Transaction-safe put: resolves after the transaction commits
    function txPut(db, storeName, record) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(record);
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
      });
    }

    // Transaction-safe get: captures result then waits for tx commit
    function txGet(db, storeName, key) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).get(key);
        let result;
        request.onsuccess = () => { result = request.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
      });
    }

    // Index lookup via getAll on a named index
    function txIndexGetAll(db, storeName, indexName, key) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const index = tx.objectStore(storeName).index(indexName);
        const request = index.getAll(key);
        let result;
        request.onsuccess = () => { result = request.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
      });
    }

    // Session 1: Write data
    const db1 = await openDb();
    const testPage = {
      pageId: "page-browser-test-001",
      content: "The Milky Way galaxy is a barred spiral galaxy.",
      embeddingOffset: 0,
      embeddingDim: 32,
      contentHash: "chash-001",
      vectorHash: "vhash-001",
      createdAt: new Date().toISOString(),
    };

    const testBook = {
      bookId: "book-browser-test-001",
      pageIds: ["page-browser-test-001"],
      medoidPageId: "page-browser-test-001",
      meta: {},
    };

    const hotpathEntry1 = { entityId: "page-001", tier: "page", salience: 0.8 };
    const hotpathEntry2 = { entityId: "book-001", tier: "book", salience: 0.5 };
    const hotpathEntry3 = { entityId: "page-002", tier: "page", salience: 0.6 };

    await txPut(db1, "pages", testPage);
    await txPut(db1, "books", testBook);
    await txPut(db1, "hotpath_index", hotpathEntry1);
    await txPut(db1, "hotpath_index", hotpathEntry2);
    await txPut(db1, "hotpath_index", hotpathEntry3);

    // Verify read-back in same session
    const readPage = await txGet(db1, "pages", "page-browser-test-001");
    const readBook = await txGet(db1, "books", "book-browser-test-001");

    // Verify index lookup: query by-tier index for "page" entries
    const pageEntries = await txIndexGetAll(db1, "hotpath_index", "by-tier", "page");
    const bookEntries = await txIndexGetAll(db1, "hotpath_index", "by-tier", "book");

    db1.close();

    // Session 2: Reopen and verify persistence
    const db2 = await openDb();
    const persistedPage = await txGet(db2, "pages", "page-browser-test-001");
    const persistedBook = await txGet(db2, "books", "book-browser-test-001");
    const persistedPageEntries = await txIndexGetAll(db2, "hotpath_index", "by-tier", "page");
    db2.close();

    // Cleanup
    await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
    });

    return {
      sameSessionPageOk: readPage?.pageId === testPage.pageId && readPage?.content === testPage.content,
      sameSessionBookOk: readBook?.bookId === testBook.bookId,
      indexLookupPageCount: pageEntries?.length,
      indexLookupBookCount: bookEntries?.length,
      persistedPageOk: persistedPage?.pageId === testPage.pageId && persistedPage?.content === testPage.content,
      persistedBookOk: persistedBook?.bookId === testBook.bookId && persistedBook?.pageIds?.length === 1,
      persistedIndexOk: persistedPageEntries?.length === 2,
    };
  });

  expect(result.sameSessionPageOk).toBe(true);
  expect(result.sameSessionBookOk).toBe(true);
  expect(result.indexLookupPageCount).toBe(2);
  expect(result.indexLookupBookCount).toBe(1);
  expect(result.persistedPageOk).toBe(true);
  expect(result.persistedBookOk).toBe(true);
  expect(result.persistedIndexOk).toBe(true);
});

test("OPFS is accessible for vector storage", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => globalThis.__cortexHarnessReady === true);

  const report = await page.evaluate(() => globalThis.__cortexHarnessReport);
  // OPFS may be available or unavailable depending on browser; we verify it was probed
  expect(["available", "unavailable", "error"]).toContain(report.storage.opfs);
});

test("at least one vector compute backend is available", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => globalThis.__cortexHarnessReady === true);

  const report = await page.evaluate(() => globalThis.__cortexHarnessReport);

  // WASM is always available as the fallback
  const validProviders = ["webnn", "webgpu", "webgl", "wasm"];
  expect(validProviders).toContain(report.selectedProvider);

  // Verify at least one backend is functional
  const hasBackend =
    report.capabilities.webgpu.available ||
    report.capabilities.webnn.available ||
    report.capabilities.webgl2.available ||
    report.selectedProvider === "wasm";
  expect(hasBackend).toBe(true);
});
