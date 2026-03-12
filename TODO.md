# CORTEX TODO — Path to v1.0

**Last Updated:** 2026-03-12

This document contains a prioritized, actionable list of specific tasks required to ship CORTEX v1.0. Items are ordered by dependency: highest-priority items are those blocking other work.

---

## 🚨 Critical Path — Ship v0.1 (Minimal Viable)

These items **must** be completed to have a usable system. Without them, users cannot ingest or query memories.

### P0-A: Crypto Helpers (BLOCKS: all signed entity creation) ✅ COMPLETE

**Why:** Pages require `contentHash`, `vectorHash`, and `signature`. Cannot create valid pages without crypto.

- [x] **P0-A1:** Implement `core/crypto/hash.ts`
  - SHA-256 for text content
  - SHA-256 for binary vector data
  - Test with known vectors

- [x] **P0-A2:** Implement `core/crypto/sign.ts`
  - Ed25519 key pair generation
  - Sign canonical page representation
  - Test with example pages

- [x] **P0-A3:** Implement `core/crypto/verify.ts`
  - Verify signature against public key
  - Test reject invalid signatures

- [x] **P0-A4:** Add crypto test coverage
  - `tests/crypto/hash.test.ts`
  - `tests/crypto/sign.test.ts`
  - `tests/crypto/verify.test.ts`

**Exit Criteria:** Can hash content, sign pages, verify signatures. ✅ Met — 26 tests passing.

---

### P0-B: Text Chunking (BLOCKS: ingest orchestration)

**Why:** Must split text into page-sized chunks respecting ModelProfile token limits.

- [ ] **P0-B1:** Implement `hippocampus/Chunker.ts`
  - Token-aware splitting (use ModelProfile `maxContextLength`)
  - Respect sentence boundaries where possible
  - Handle edge cases (empty input, single-token input, huge paragraphs)

- [ ] **P0-B2:** Add chunker test coverage
  - `tests/hippocampus/Chunker.test.ts`
  - Test various text lengths (short, medium, long, huge)
  - Test boundary conditions

**Exit Criteria:** Can reliably split arbitrary text into page chunks.

---

### P0-C: Hippocampus Ingest (Minimal) (BLOCKS: user workflow)

**Why:** Users need to add memories to the system.

- [ ] **P0-C1:** Implement `hippocampus/PageBuilder.ts`
  - Create `Page` entities from text chunks
  - Generate `pageId`, `contentHash`, `vectorHash`
  - Sign with provided key pair
  - Link pages via `prevPageId`/`nextPageId`

- [ ] **P0-C2:** Implement `hippocampus/Ingest.ts` (minimal version)
  - Entry point: `ingestText(text, modelProfile, vectorStore, metadataStore, keyPair)`
  - Chunk text via `Chunker`
  - Batch embed chunks via `EmbeddingRunner`
  - Persist vectors to `VectorStore`
  - Build pages via `PageBuilder`
  - Persist pages to `MetadataStore`
  - Build single `Book` containing all pages (medoid = first page for now)
  - **Defer:** Volume/Shelf hierarchy, fast neighbor insert

- [ ] **P0-C3:** Add ingest test coverage
  - `tests/hippocampus/Ingest.test.ts`
  - Test happy path (text → pages → book)
  - Test persistence (can retrieve pages after ingest)

**Exit Criteria:** User can call `ingestText(...)` and pages are persisted.

---

### P0-D: Cortex Query (Minimal) (BLOCKS: user workflow)

**Why:** Users need to retrieve relevant memories.

- [ ] **P0-D1:** Implement `cortex/Query.ts` (minimal version)
  - Entry point: `query(queryText, modelProfile, vectorStore, metadataStore, topK)`
  - Embed query via `EmbeddingRunner`
  - Load all page embeddings (flat search for now)
  - Compute similarities via `VectorBackend`
  - Select top-K pages
  - Return `QueryResult` with page IDs and scores
  - **Defer:** Hierarchical ranking, subgraph expansion, TSP coherence

- [ ] **P0-D2:** Implement `cortex/QueryResult.ts`
  - DTO with `pages: Page[]`, `scores: number[]`, `metadata: object`

- [ ] **P0-D3:** Add query test coverage
  - `tests/cortex/Query.test.ts`
  - Test happy path (query → top-K pages)
  - Test empty corpus (no results)
  - Test relevance (query for known content returns expected pages)

**Exit Criteria:** User can call `query(...)` and get ranked pages.

---

### P0-E: End-to-End Integration (VALIDATES: v0.1 completeness)

**Why:** Prove the system works soup-to-nuts.

- [ ] **P0-E1:** Implement `tests/integration/IngestQuery.test.ts`
  - Ingest sample text corpus (e.g., Wikipedia articles)
  - Query for specific topics
  - Verify expected pages returned
  - Verify persistence (restart session, query again)

- [ ] **P0-E2:** Run integration test in browser harness
  - Ensure real IndexedDB and OPFS work correctly
  - Verify WebGPU/WebGL/WASM backends function

**Exit Criteria:** Integration test passes; system is minimally usable.

---

## 🟡 High Priority — Ship v0.5 (Hierarchical + Coherent)

These items add hierarchical routing and coherent path ordering. They transform CORTEX from a flat vector search into a biologically-inspired memory system.

### P1-A: Hierarchy Builder (UNBLOCKS: hierarchical routing)

**Why:** Need Volume and Shelf structures for efficient coarse-to-fine routing.

- [ ] **P1-A1:** Implement `hippocampus/HierarchyBuilder.ts`
  - Cluster pages into Books (K-means or similar; select medoid)
  - Cluster books into Volumes (compute prototype vectors)
  - Cluster volumes into Shelves (coarse routing prototypes)
  - Persist prototypes to `VectorStore`
  - Update metadata in `MetadataStore`

- [ ] **P1-A2:** Upgrade `hippocampus/Ingest.ts`
  - After persisting pages, call `HierarchyBuilder`
  - Maintain hierarchy incrementally (append to existing structures)

- [ ] **P1-A3:** Add hierarchy test coverage
  - `tests/hippocampus/HierarchyBuilder.test.ts`
  - Test clustering produces valid Books/Volumes/Shelves
  - Test prototypes are valid vectors

**Exit Criteria:** Ingestion produces full Page → Book → Volume → Shelf hierarchy.

---

### P1-B: Ranking Pipeline (UNBLOCKS: efficient queries)

**Why:** Hierarchical ranking avoids scanning all pages; reduces query latency.

- [ ] **P1-B1:** Implement `cortex/Ranking.ts`
  - `rankShelves(queryEmbedding, shelves, topK)`
  - `rankVolumes(queryEmbedding, volumes, topK)`
  - `rankBooks(queryEmbedding, books, topK)`
  - `rankPages(queryEmbedding, pages, topK)`
  - Each step narrows search space via prototype similarity

- [ ] **P1-B2:** Upgrade `cortex/Query.ts`
  - Replace flat search with hierarchical ranking cascade
  - Shelf → Volume → Book → Page

- [ ] **P1-B3:** Add ranking test coverage
  - `tests/cortex/Ranking.test.ts`
  - Test each ranking function independently
  - Test full cascade produces correct top pages

**Exit Criteria:** Queries use hierarchical routing; latency reduced.

---

### P1-C: Fast Metroid Neighbor Insert (UNBLOCKS: graph coherence)

**Why:** Need sparse NN graph for coherent path tracing.

- [ ] **P1-C1:** Implement `hippocampus/FastMetroidInsert.ts`
  - For each new page, compute similarity to existing pages
  - Select K-nearest neighbors (bounded degree)
  - Insert forward edges (page → neighbors)
  - Insert reverse edges (neighbors → page), respecting max degree
  - Mark affected volumes as dirty for full recalc

- [ ] **P1-C2:** Upgrade `hippocampus/Ingest.ts`
  - After persisting pages, call `FastMetroidInsert`

- [ ] **P1-C3:** Add Metroid insert test coverage
  - `tests/hippocampus/FastMetroidInsert.test.ts`
  - Test neighbor lists are bounded
  - Test symmetry (if A→B, then B→A)

**Exit Criteria:** Metroid neighbor graph is maintained during ingest.

---

### P1-D: Open TSP Solver (UNBLOCKS: coherent path ordering)

**Why:** Need to trace coherent path through induced subgraph, not just ranked list.

- [ ] **P1-D1:** Implement `cortex/OpenTSPSolver.ts`
  - Dummy-node open-path heuristic (greedy nearest-neighbor)
  - Input: `MetroidSubgraph` (nodes + edges with distances)
  - Output: ordered path through all nodes
  - Deterministic for same input

- [ ] **P1-D2:** Add TSP solver test coverage
  - `tests/cortex/OpenTSPSolver.test.ts`
  - Test on synthetic small graphs (3-10 nodes)
  - Test determinism (same input → same output)
  - Test path validity (all nodes visited exactly once)

**Exit Criteria:** Can compute coherent open path through subgraph.

---

### P1-E: Full Query Orchestrator (DELIVERS: coherent retrieval)

**Why:** This is the "aha" moment — return memories in natural narrative order.

- [ ] **P1-E1:** Upgrade `cortex/Query.ts` (full version)
  - Use hierarchical ranking to select seed pages
  - Call `MetadataStore.getInducedMetroidSubgraph(seedPages, maxHops)`
  - Call `OpenTSPSolver.solve(subgraph)`
  - Return ordered page list via coherent path
  - Include provenance metadata (hop count, edge weights)

- [ ] **P1-E2:** Upgrade `cortex/QueryResult.ts`
  - Add `coherencePath: Hash[]` (ordered page IDs)
  - Add `provenance: { subgraphSize, hopCount, edgeWeights }`

- [ ] **P1-E3:** Add full query test coverage
  - `tests/cortex/Query.test.ts` (upgrade)
  - Test subgraph expansion
  - Test TSP ordering
  - Test provenance metadata

**Exit Criteria:** Queries return coherent ordered context chains, not just ranked pages.

---

### P1-F: Integration Test (Hierarchical + Coherent)

**Why:** Validate v0.5 completeness.

- [ ] **P1-F1:** Upgrade `tests/integration/IngestQuery.test.ts`
  - Verify hierarchical structures exist after ingest
  - Verify queries return coherent paths
  - Compare coherent path vs flat ranking (show narrative flow improvement)

**Exit Criteria:** Integration test demonstrates coherent retrieval.

---

## 🟢 Medium Priority — Ship v1.0 (Background Consolidation)

These items add idle background maintenance. System self-improves over time without user intervention.

### P2-A: Idle Scheduler (UNBLOCKS: Daydreamer operations)

**Why:** Need cooperative background loop that doesn't block foreground.

- [ ] **P2-A1:** Implement `daydreamer/IdleScheduler.ts`
  - Loop via `requestIdleCallback` (browser) or `setImmediate` (Node)
  - Interruptible (yield after N ms of work)
  - CPU budget awareness (pause if main thread busy)
  - Task queue (prioritize high-value work)

- [ ] **P2-A2:** Add scheduler test coverage
  - `tests/daydreamer/IdleScheduler.test.ts`
  - Test cooperative yielding
  - Test interruption doesn't corrupt state

**Exit Criteria:** Background loop runs without blocking UI.

---

### P2-B: Hebbian Updater (DELIVERS: connection plasticity)

**Why:** Strengthen useful connections, decay unused ones.

- [ ] **P2-B1:** Implement `daydreamer/HebbianUpdater.ts`
  - LTP: strengthen edges traversed during successful queries
  - LTD: decay all edges by small factor each pass
  - Prune: remove edges below threshold
  - Update `MetadataStore.putEdges`

- [ ] **P2-B2:** Add Hebbian test coverage
  - `tests/daydreamer/HebbianUpdater.test.ts`
  - Test strengthen increases weight
  - Test decay decreases weight
  - Test pruning removes weak edges

**Exit Criteria:** Edge weights adapt based on usage.

---

### P2-C: Full Metroid Recalc (DELIVERS: graph maintenance)

**Why:** Incremental fast insert is approximate; need periodic full recalc.

- [ ] **P2-C1:** Implement `daydreamer/FullMetroidRecalc.ts`
  - Query `MetadataStore.needsMetroidRecalc(volumeId)` for dirty volumes
  - Load all pages in volume
  - Compute all pairwise similarities
  - Select K-nearest for each page (bounded degree)
  - Update `MetadataStore.putMetroidNeighbors`
  - Clear dirty flag via `MetadataStore.clearMetroidRecalcFlag`

- [ ] **P2-C2:** Add Metroid recalc test coverage
  - `tests/daydreamer/FullMetroidRecalc.test.ts`
  - Test dirty flag cleared after recalc
  - Test neighbor quality improved vs fast insert

**Exit Criteria:** Dirty volumes are recalculated in background.

---

### P2-D: Prototype Recomputer (DELIVERS: prototype quality)

**Why:** Keep volume/shelf prototypes accurate as pages/books change.

- [ ] **P2-D1:** Implement `daydreamer/PrototypeRecomputer.ts`
  - Recompute volume medoids (select medoid page per volume)
  - Recompute volume centroids (average of book embeddings)
  - Recompute shelf routing prototypes
  - Update vectors in `VectorStore` (append new, update offsets)

- [ ] **P2-D2:** Add prototype recomputer test coverage
  - `tests/daydreamer/PrototypeRecomputer.test.ts`
  - Test medoid selection algorithm
  - Test centroid computation

**Exit Criteria:** Prototypes stay accurate over time.

---

### P2-E: Integration Test (Background Consolidation)

**Why:** Validate Daydreamer improves system health.

- [ ] **P2-E1:** Implement `tests/integration/Daydreamer.test.ts`
  - Ingest corpus
  - Run queries (generate edge traversals)
  - Run Daydreamer for N passes
  - Verify edge weights updated
  - Verify dirty volumes recalculated
  - Verify prototypes updated

**Exit Criteria:** Daydreamer demonstrably maintains system health.

---

## 🔵 Lower Priority — Polish & Ship

These items improve quality, performance, and developer experience. Not blockers for v1.0 launch.

### P3-A: WebGL Embedding Provider

**Why:** Explicit `webgl` fallback for systems without WebGPU/WebNN.

- [ ] **P3-A1:** Implement `embeddings/OrtWebglEmbeddingBackend.ts`
  - Use ONNX Runtime Web with explicit `webgl` execution provider
  - Implement `EmbeddingBackend` interface
  - Add to `ProviderResolver` candidate sets

- [ ] **P3-A2:** Add WebGL provider test coverage
  - `tests/embeddings/OrtWebglEmbeddingBackend.test.ts`

**Exit Criteria:** `webgl` backend available for systems without WebGPU.

---

### P3-B: Experience Replay

**Why:** Simulate queries during idle time to reinforce connection patterns.

- [ ] **P3-B1:** Implement `daydreamer/ExperienceReplay.ts`
  - Sample random or recent queries
  - Execute query (triggers edge traversals)
  - Mark traversed edges for LTP strengthening

- [ ] **P3-B2:** Add experience replay test coverage
  - `tests/daydreamer/ExperienceReplay.test.ts`

**Exit Criteria:** Daydreamer reinforces memory patterns.

---

### P3-C: Cluster Stability

**Why:** Detect and fix unstable clusters (split oversized, merge undersized).

- [ ] **P3-C1:** Implement `daydreamer/ClusterStability.ts`
  - Detect high-variance volumes
  - Trigger split (K-means with K=2)
  - Detect low-count volumes
  - Trigger merge with nearest neighbor volume

- [ ] **P3-C2:** Add cluster stability test coverage
  - `tests/daydreamer/ClusterStability.test.ts`

**Exit Criteria:** Clusters stay balanced over time.

---

### P3-D: Benchmark Suite

**Why:** Measure performance and track regressions.

- [ ] **P3-D1:** Implement real-provider benchmarks
  - `tests/benchmarks/TransformersJsEmbedding.bench.ts`
  - Throughput (embeddings/sec) for various batch sizes

- [ ] **P3-D2:** Implement query latency benchmarks
  - `tests/benchmarks/QueryLatency.bench.ts`
  - Latency vs corpus size (100 pages, 1K pages, 10K pages)

- [ ] **P3-D3:** Implement storage overhead benchmarks
  - `tests/benchmarks/StorageOverhead.bench.ts`
  - Disk usage vs page count

- [ ] **P3-D4:** Record baseline measurements
  - Add `benchmarks/BASELINES.md` with results

**Exit Criteria:** Benchmark suite exists; baselines recorded.

---

### P3-E: CI Hardening

**Why:** Ensure tests run reliably in CI.

- [ ] **P3-E1:** Add GitHub Actions workflow
  - `.github/workflows/ci.yml`
  - Run `npm run build`, `npm run lint`, `npm run test:unit`, `npm run guard:model-derived`

- [ ] **P3-E2:** Define Electron runtime gate policy
  - Document GPU/graphics requirements
  - Decide CI runner capabilities (software vs hardware rendering)
  - Update `scripts/run-electron-runtime-tests.mjs` gate logic

**Exit Criteria:** CI runs on every PR; merge blocked if tests fail.

---

### P3-F: Documentation

**Why:** Users need to know how to integrate CORTEX.

- [ ] **P3-F1:** Update `docs/api.md`
  - Document `ingestText(...)` API
  - Document `query(...)` API
  - Document `QueryResult` structure

- [ ] **P3-F2:** Update `docs/development.md`
  - Add troubleshooting section
  - Add performance tuning guide

- [ ] **P3-F3:** Add architecture diagrams
  - Data flow: ingest path
  - Data flow: query path
  - Module dependency graph

**Exit Criteria:** API docs complete; developer guide useful.

---

## 📋 Summary by Phase

| Phase | Items | Status | Blocking |
|-------|-------|--------|----------|
| v0.1 (Minimal Viable) | 17 tasks (P0-A through P0-E) | 🟡 In Progress (P0-A complete) | User cannot use system |
| v0.5 (Hierarchical + Coherent) | 13 tasks (P1-A through P1-F) | ❌ Not started | Blocked by v0.1 |
| v1.0 (Background Consolidation) | 11 tasks (P2-A through P2-E) | ❌ Not started | Blocked by v0.5 |
| Polish & Ship | 14 tasks (P3-A through P3-F) | ❌ Not started | Not blocking v1.0 |

**Total:** 55 actionable tasks

---

## Quick Reference: Next 5 Tasks to Unblock Everything

If you're reading this and want to know "what do I work on right now?", here's the answer:

1. **P0-B1:** Implement `hippocampus/Chunker.ts`
2. **P0-C1:** Implement `hippocampus/PageBuilder.ts`
3. **P0-C2:** Implement `hippocampus/Ingest.ts`
4. **P0-D1:** Implement `cortex/Query.ts`
5. **P0-E1:** Implement `tests/integration/IngestQuery.test.ts`

---

## Notes

- **Dependencies:** Items are ordered so that completing tasks in sequence minimizes blocked work.
- **Estimates:** Each P0/P1/P2 task is roughly 1-4 hours for an experienced developer familiar with the codebase.
- **Testing:** Every implementation task should be accompanied by test coverage (explicitly called out).
- **TDD Approach:** Write failing tests first, then implement to green.
- **Documentation Sync:** Update PLAN.md module status as tasks complete.
