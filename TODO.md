# CORTEX TODO — Path to v1.0

**Last Updated:** 2026-03-13

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

### P0-F: Williams Bound Policy Foundation (BLOCKS: all hotpath-aware modules) ✅ COMPLETE

**Why:** The HotpathPolicy and SalienceEngine are the central source of truth for the Williams Bound architecture. Every subsequent module (ingest, query, hierarchy, Daydreamer) depends on them. Implementing these first ensures the bound is enforced from day one rather than retrofitted.

- [x] **P0-F1:** Implement `core/HotpathPolicy.ts`
  - `computeCapacity(graphMass: number): number` — H(t) = ⌈c · √(t · log₂(1+t))⌉
  - `computeSalience(hebbianIn: number, recency: number, queryHits: number, weights?: SalienceWeights): number` — σ = α·H_in + β·R + γ·Q
  - `deriveTierQuotas(capacity: number, quotaRatios?: TierQuotaRatios): TierQuotas` — allocate H(t) across shelf/volume/book/page tiers
  - `deriveCommunityQuotas(tierBudget: number, communitySizes: number[]): number[]` — proportional with min(1) guarantee
  - Export a frozen `DEFAULT_HOTPATH_POLICY` object containing all constants: `c = 0.5`, `α = 0.5`, `β = 0.3`, `γ = 0.2`, `q_s = 0.10`, `q_v = 0.20`, `q_b = 0.20`, `q_p = 0.50`
  - Keep strictly separate from `core/ModelDefaults.ts` (policy-derived ≠ model-derived)

- [x] **P0-F2:** Add HotpathPolicy test coverage (`tests/HotpathPolicy.test.ts`)
  - H(t) grows sublinearly: verify `H(10_000) / 10_000 < H(1_000) / 1_000`
  - H(t) is monotonically non-decreasing over a representative range: verify `H(t+1) >= H(t)` for each `t` in `[0, 1, 2, 10, 100, 1_000, 10_000, 100_000]`
  - H(t) is a finite integer ≥ 1 for edge inputs: `t = 0`, `t = 1`, `t = Number.MAX_SAFE_INTEGER`; result must never be `NaN`, `Infinity`, or `< 1`
  - Derived tier-quota *counts* sum exactly to capacity: `deriveTierQuotas(cap).shelf + .volume + .book + .page === cap` for `cap` in `[1, 10, 100, 1_000]`
  - Community quota counts sum exactly to `tier_budget`: `sum(deriveCommunityQuotas(budget, sizes)) === budget` for representative `(budget, sizes)` inputs including edge cases (`budget = 0`, empty `sizes` array, `budget < sizes.length`)
  - Community quotas never produce `NaN`, `Infinity`, or negative values for any valid input, including `sizes` with a single community or all equal sizes
  - Salience is deterministic for same inputs
  - Salience clamps output to a finite number: never `NaN` or `Infinity` for extreme weight or hit-count values

- [x] **P0-F3:** Extend `core/types.ts`
  - Add `PageActivity` interface: `{ pageId: Hash; queryHitCount: number; lastQueryAt: string; communityId?: string }`
  - Add `HotpathEntry` interface: `{ entityId: Hash; tier: 'shelf' | 'volume' | 'book' | 'page'; salience: number; communityId?: string }`
  - Add `TierQuotas` type: `{ shelf: number; volume: number; book: number; page: number }`
  - Add hotpath method signatures to `MetadataStore` interface:
    - `putHotpathEntry(entry: HotpathEntry): Promise<void>`
    - `getHotpathEntries(tier?: HotpathEntry['tier']): Promise<HotpathEntry[]>`
    - `evictWeakest(tier: HotpathEntry['tier'], communityId?: string): Promise<void>`
    - `getResidentCount(): Promise<number>`
    - `putPageActivity(activity: PageActivity): Promise<void>`
    - `getPageActivity(pageId: Hash): Promise<PageActivity | undefined>`

- [x] **P0-F4:** Extend `storage/IndexedDbMetadataStore.ts`
  - Add `hotpath_index` object store keyed by `entityId`; secondary index by `tier`
  - Add `page_activity` object store keyed by `pageId`
  - Implement all six new `MetadataStore` hotpath methods
  - Extend `tests/Persistence.test.ts` with hotpath store tests:
    - put/get/evict cycle for `HotpathEntry`
    - put/get for `PageActivity`
    - `getResidentCount` returns correct value after multiple puts

**Exit Criteria:** `HotpathPolicy` module passes all tests; `types.ts` has hotpath interfaces; IndexedDB hotpath stores are implemented and tested. ✅ Met — tests passing.

---

### P0-G: Salience Engine (BLOCKS: hotpath promotion in ingest and Daydreamer) ✅ COMPLETE

**Why:** The SalienceEngine is the decision-making layer for hotpath admission. It is needed by ingest (new page admission), query (hit-count update), and Daydreamer (post-LTP/LTD sweeps). Implementing it before ingest ensures promotion logic is correct from the first page written.

- [x] **P0-G1:** Implement `core/SalienceEngine.ts`
  - `computeNodeSalience(pageId: Hash, metadataStore: MetadataStore): Promise<number>` — fetch PageActivity and incident Hebbian edges; apply σ formula via HotpathPolicy
  - `batchComputeSalience(pageIds: Hash[], metadataStore: MetadataStore): Promise<Map<Hash, number>>` — efficient batch version
  - `shouldPromote(candidateSalience: number, weakestResidentSalience: number, capacityRemaining: number): boolean` — admission gating
  - `selectEvictionTarget(tier: HotpathEntry['tier'], communityId: string | undefined, metadataStore: MetadataStore): Promise<Hash | undefined>` — find weakest resident in tier/community bucket

- [x] **P0-G2:** Implement promotion/eviction lifecycle helpers in `core/SalienceEngine.ts`
  - `bootstrapHotpath(metadataStore: MetadataStore, policy: HotpathPolicy): Promise<void>` — fill hotpath greedily by salience while resident count < H(t)
  - `runPromotionSweep(candidateIds: Hash[], metadataStore: MetadataStore, policy: HotpathPolicy): Promise<void>` — steady-state: promote if salience > weakest in same tier/community bucket; evict weakest on promotion

- [x] **P0-G3:** Add SalienceEngine test coverage (`tests/SalienceEngine.test.ts`)
  - Bootstrap fills hotpath to exactly H(t) given enough candidates
  - Steady-state promotes only when candidate beats the weakest resident
  - Steady-state evicts exactly the weakest resident (not a random entry)
  - Community quotas prevent a single community from consuming all page-tier slots
  - Tier quotas prevent one hierarchy level from dominating
  - Eviction is deterministic under the same state

**Exit Criteria:** `SalienceEngine` module passes all tests; promotion/eviction lifecycle is correct and deterministic. ✅ Met — tests passing.

---

### P0-B: Text Chunking (BLOCKS: ingest orchestration)

**Why:** Must split text into page-sized chunks respecting ModelProfile token limits.

- [x] **P0-B1:** Implement `hippocampus/Chunker.ts`
  - Token-aware splitting (use ModelProfile `maxContextLength`)
  - Respect sentence boundaries where possible
  - Handle edge cases (empty input, single-token input, huge paragraphs)

- [x] **P0-B2:** Add chunker test coverage
  - `tests/hippocampus/Chunker.test.ts`
  - Test various text lengths (short, medium, long, huge)
  - Test boundary conditions

**Exit Criteria:** Can reliably split arbitrary text into page chunks.

---

### P0-C: Hippocampus Ingest (Minimal) (BLOCKS: user workflow)

**Why:** Users need to add memories to the system.

- [x] **P0-C1:** Implement `hippocampus/PageBuilder.ts`
  - Create `Page` entities from text chunks
  - Generate `pageId`, `contentHash`, `vectorHash`
  - Sign with provided key pair
  - Link pages via `prevPageId`/`nextPageId`
  - Initialise `PageActivity` records with zero counts

- [x] **P0-C2:** Implement `hippocampus/Ingest.ts` (minimal version)
  - Entry point: `ingestText(text, { modelProfile, embeddingRunner, vectorStore, metadataStore, keyPair, ... })`
  - Chunk text via `Chunker`
  - Batch embed chunks via `EmbeddingRunner`
  - Persist vectors to `VectorStore`
  - Build pages via `PageBuilder`; persist pages and `PageActivity` to `MetadataStore`
  - Build single `Book` containing all pages (medoid = first page for now)
  - After persisting pages, check each new page for hotpath admission via `SalienceEngine.runPromotionSweep`
  - **Defer:** Volume/Shelf hierarchy, fast neighbor insert

- [ ] **P0-C3:** Add ingest test coverage
  - `tests/hippocampus/Ingest.test.ts`
  - Test happy path (text → pages → book)
  - Test persistence (can retrieve pages after ingest)
  - Test that new pages are considered for hotpath admission after ingest

**Exit Criteria:** User can call `ingestText(...)` and pages are persisted; PageActivity records exist; hotpath admission runs.

---

### P0-D: Cortex Query (Minimal) (BLOCKS: user workflow)

**Why:** Users need to retrieve relevant memories.

- [x] **P0-D1:** Implement `cortex/Query.ts` (minimal version)
  - Entry point: `query(queryText, modelProfile, vectorStore, metadataStore, topK)`
  - Embed query via `EmbeddingRunner`
  - Score resident hotpath entries first (HOT pages); fall back to full scan for WARM/COLD
  - Compute similarities via `VectorBackend`
  - Select top-K pages; increment `queryHitCount` in `PageActivity`; recompute salience; run promotion sweep
  - Return `QueryResult` with page IDs and scores
  - **Defer:** Full hierarchical ranking, subgraph expansion, TSP coherence, query cost meter

- [x] **P0-D2:** Implement `cortex/QueryResult.ts`
  - DTO with `pages: Page[]`, `scores: number[]`, `metadata: object`

- [x] **P0-D3:** Add query test coverage
  - `tests/cortex/Query.test.ts`
  - Test happy path (query → top-K pages)
  - Test empty corpus (no results)
  - Test relevance (query for known content returns expected pages)
  - Test `PageActivity.queryHitCount` incremented after query hit

**Exit Criteria:** User can call `query(...)` and get ranked pages; query hits update PageActivity and trigger salience recomputation.

---

### P0-E: End-to-End Integration (VALIDATES: v0.1 completeness)

**Why:** Prove the system works soup-to-nuts.

- [x] **P0-E1:** Implement `tests/integration/IngestQuery.test.ts`
  - Ingest sample text corpus (e.g., Wikipedia articles)
  - Query for specific topics
  - Verify expected pages returned
  - Verify persistence (restart session, query again)

- [x] **P0-E2:** Run integration test in browser harness
  - Ensure real IndexedDB and OPFS work correctly
  - Verify WebGPU/WebGL/WASM backends function

**Exit Criteria:** Integration test passes; system is minimally usable.

---

### P0-X: Fix Architectural Naming Drift (BLOCKS: correct design implementation)

**Why:** The codebase uses the term "Metroid" to name the sparse proximity/neighbor graph (`MetroidNeighbor`, `MetroidSubgraph`, `metroid_neighbors`, `getInducedMetroidSubgraph`, `FastMetroidInsert`, `FullMetroidRecalc`). This is architecturally incorrect. In CORTEX, a **Metroid** is a structured dialectical search probe `{ m1, m2, c }` — a concept that does not yet exist in the codebase at all. The proximity graph has nothing to do with Metroids. This naming collision will cause permanent confusion and make the MetroidBuilder impossible to implement cleanly without a rename.

- [x] **P0-X1:** Rename `MetroidNeighbor` → `SemanticNeighbor` in `core/types.ts`
  - Update all references in `storage/IndexedDbMetadataStore.ts`
  - Update all references in test files
  - Update JSDoc and inline comments

- [x] **P0-X2:** Rename `MetroidSubgraph` → `SemanticNeighborSubgraph` in `core/types.ts`
  - Update all references in `storage/IndexedDbMetadataStore.ts`
  - Update all references in `cortex/Query.ts`
  - Update JSDoc and inline comments

- [x] **P0-X3:** Rename `MetadataStore` proximity graph methods:
  - `putMetroidNeighbors` → `putSemanticNeighbors`
  - `getMetroidNeighbors` → `getSemanticNeighbors`
  - `getInducedMetroidSubgraph` → `getInducedNeighborSubgraph`
  - `needsMetroidRecalc` → `needsNeighborRecalc`
  - `flagVolumeForMetroidRecalc` → `flagVolumeForNeighborRecalc`
  - `clearMetroidRecalcFlag` → `clearNeighborRecalcFlag`
  - Update all callers in `storage/IndexedDbMetadataStore.ts`, `cortex/Query.ts`, and test files

- [x] **P0-X4:** Rename planned Hippocampus file `hippocampus/FastMetroidInsert.ts` → `hippocampus/FastNeighborInsert.ts`
  - Rename class/function to `FastNeighborInsert`/`insertSemanticNeighbors`

- [x] **P0-X5:** Rename planned Daydreamer file `daydreamer/FullMetroidRecalc.ts` → `daydreamer/FullNeighborRecalc.ts`
  - Rename class/function to `FullNeighborRecalc`/`runNeighborRecalc`

- [x] **P0-X6:** Rename IndexedDB object store from `metroid_neighbors` → `neighbor_graph`

- [x] **P0-X7:** Update all documentation strings and JSDoc that use "Metroid neighbor" to use "semantic neighbor"

**Exit Criteria:** No source file uses "Metroid" to refer to the proximity graph. The term "Metroid" is reserved exclusively for the `{ m1, m2, c }` dialectical probe type implemented in `cortex/MetroidBuilder.ts`.

---

## 🟡 High Priority — Ship v0.5 (Hierarchical + Coherent)

These items add hierarchical routing and coherent path ordering. They transform CORTEX from a flat vector search into a biologically-inspired memory system.

### P1-A: Hierarchy Builder (UNBLOCKS: hierarchical routing)

**Why:** Need Volume and Shelf structures for efficient coarse-to-fine routing. Tier-quota hotpath admission must be integrated so hierarchy prototypes enter the resident index from the moment they are created.

- [ ] **P1-A1:** Implement `hippocampus/HierarchyBuilder.ts`
  - Cluster pages into Books (K-means or similar; select medoid)
  - Cluster books into Volumes (compute prototype vectors)
  - Cluster volumes into Shelves (coarse routing prototypes)
  - Persist prototypes to `VectorStore`; update metadata in `MetadataStore`
  - After each level: attempt hotpath admission via `SalienceEngine.runPromotionSweep`:
    - Book medoid → page-tier quota
    - Volume prototypes → volume-tier quota
    - Shelf routing prototypes → shelf-tier quota
  - Enforce Williams-derived fanout bounds (see `HotpathPolicy`); when exceeded, trigger split via `ClusterStability`

- [ ] **P1-A2:** Upgrade `hippocampus/Ingest.ts`
  - After persisting pages, call `HierarchyBuilder`
  - Maintain hierarchy incrementally (append to existing structures)

- [ ] **P1-A3:** Add hierarchy test coverage
  - `tests/hippocampus/HierarchyBuilder.test.ts`
  - Test clustering produces valid Books/Volumes/Shelves
  - Test prototypes are valid vectors
  - Test that hierarchy medoids/prototypes are admitted to correct tier quota
  - Test fanout bounds respected; split triggered when exceeded

**Exit Criteria:** Ingestion produces full Page → Book → Volume → Shelf hierarchy with tier-quota hotpath admission at every level.

---

### P1-B: Ranking Pipeline (UNBLOCKS: efficient queries)

**Why:** Hierarchical ranking avoids scanning all pages; reduces query latency. The resident hotpath is the primary lookup target — WARM/COLD spill happens only when the hot set provides insufficient coverage.

- [ ] **P1-B1:** Implement `cortex/Ranking.ts`
  - `rankShelves(queryEmbedding, residentShelves, topK)` — score HOT shelf prototypes first
  - `rankVolumes(queryEmbedding, residentVolumes, topK)` — score HOT volume prototypes within top shelves
  - `rankBooks(queryEmbedding, residentBooks, topK)` — score HOT book medoids within top volumes
  - `rankPages(queryEmbedding, residentPages, topK)` — score HOT page representatives within top books
  - `spillToWarm(tier, queryEmbedding, metadataStore, topK)` — spill to IndexedDB lookup when resident set insufficient
  - Each step narrows the search space; H(t) is the primary latency lever

- [ ] **P1-B2:** Upgrade `cortex/Query.ts`
  - Replace flat search with resident-first hierarchical ranking cascade
  - HOT shelves → HOT volumes → HOT books → HOT pages → WARM/COLD spill

- [ ] **P1-B3:** Add ranking test coverage
  - `tests/cortex/Ranking.test.ts`
  - Test each ranking function independently
  - Test full cascade produces correct top pages
  - Test that resident entries are scored before non-resident entries

**Exit Criteria:** Queries use resident-first hierarchical routing; latency scales with H(t), not corpus size.

---

### P1-C: Fast Semantic Neighbor Insert (UNBLOCKS: graph coherence)

**Why:** Need a sparse semantic neighbor graph for coherent path tracing. This graph connects pages with high cosine similarity and is used for BFS subgraph expansion during retrieval. Degree must be bounded by `HotpathPolicy` to prevent unbounded graph mass growth. **This is not related to Metroid construction** — the semantic neighbor graph is a proximity concept, not a dialectical probe concept.

- [ ] **P1-C1:** Implement `hippocampus/FastNeighborInsert.ts`
  - For each new page, find cosine-nearest neighbors within Williams-cutoff **distance** (not a fixed K); derive the cutoff radius from `HotpathPolicy` rather than a hardcoded constant
  - Insert forward edges (page → neighbors) as `SemanticNeighbor` records, respecting max degree
  - Insert reverse edges (neighbors → page), respecting max degree per direction
  - If a page is already at max degree, evict the neighbor with the lowest cosine similarity
  - Insert only initial edges at ingest time; do not attempt full cross-edge reconnection — Daydreamer walks the graph during idle passes to build additional edges (avoids full graph recalc on every insert)
  - **Edge role invariant:** `SemanticNeighbor.cosineSimilarity` is used for neighbor discovery and Bayesian belief updates. Hebbian edge weights (in `edges_hebbian`) are used for TSP tour traversal. These are separate edge types with separate roles; do not mix them.
  - Mark affected volumes as dirty for full Daydreamer recalc
  - After insertion, check new page for hotpath admission via `SalienceEngine`

- [ ] **P1-C2:** Upgrade `hippocampus/Ingest.ts`
  - After persisting pages, call `FastNeighborInsert`

- [ ] **P1-C3:** Add semantic neighbor insert test coverage
  - `tests/hippocampus/FastNeighborInsert.test.ts`
  - Test neighbor lists are bounded by Williams-cutoff distance (not a fixed K)
  - Test symmetry (if A→B, then B→A)
  - Test that degree overflow evicts lowest-cosine-similarity neighbor, not a random one
  - Test that new page is considered for hotpath admission after insertion
  - Test that `edges_hebbian` records are NOT created by FastNeighborInsert (Hebbian is Daydreamer's concern)

**Exit Criteria:** Semantic neighbor graph is maintained during ingest with policy-bounded degree.

---

### P1-D: Open TSP Solver (UNBLOCKS: coherent path ordering)

**Why:** Need to trace coherent path through induced subgraph, not just ranked list.

- [ ] **P1-D1:** Implement `cortex/OpenTSPSolver.ts`
  - Dummy-node open-path heuristic (greedy nearest-neighbor)
  - Input: `SemanticNeighborSubgraph` (nodes + edges with distances; after P0-X2 rename)
  - Output: ordered path through all nodes
  - Deterministic for same input

- [ ] **P1-D2:** Add TSP solver test coverage
  - `tests/cortex/OpenTSPSolver.test.ts`
  - Test on synthetic small graphs (3-10 nodes)
  - Test determinism (same input → same output)
  - Test path validity (all nodes visited exactly once)

**Exit Criteria:** Can compute coherent open path through subgraph.

---

### P1-M: MetroidBuilder (DELIVERS: dialectical epistemology)

**Why:** MetroidBuilder is the core of what makes CORTEX an _epistemic_ system rather than a vector search engine. Without it, the system merely returns nearest neighbors and cannot explore opposing perspectives, detect knowledge gaps, or trigger P2P curiosity requests. The Metroid loop converts conceptual opposition into navigable exploration steps.

- [ ] **P1-M1:** Implement `cortex/MetroidBuilder.ts`
  - Accept a query embedding `q` and a list of resident medoids (shelf/volume/book representatives)
  - **Thesis (select m1):** Find `m1` via medoid search — the medoid minimizing distance to `q`. A
    medoid (not a centroid) is always an existing memory node; it ensures the search anchor is an
    actual data point rather than an averaged phantom position. This keeps the search on the
    correct conceptual road.
  - Read `matryoshkaProtectedDim` from `ModelProfile` (e.g. 128 for embeddinggemma-300m, 64 for
    nomic-embed-text-v1.5). If `undefined` on the current model (non-Matryoshka), return
    `{ m1, m2: null, c: null, knowledgeGap: true }` immediately.
  - **Freeze:** Lock all dimensions with index < `matryoshkaProtectedDim`.
  - **Antithesis (find m2):** In the unfrozen upper dimensions (index >= `matryoshkaProtectedDim`):
    1. Score every candidate medoid as `-cosine_similarity(candidate_free_dims, m1_free_dims)`.
       The highest-scoring candidates are farthest from m1 in the free dimensions — maximal
       conceptual divergence.
    2. Find the **medoid of that cosine-opposite set** (the top-scoring candidates). This is `m2`.
    3. `m2` must be an existing memory node (not a computed position). The medoid operation
       ensures this. This is distinct from simply finding the node with the lowest cosine
       similarity to m1.
  - **Synthesis (freeze centroid):** Compute `c` once and freeze it:
    - Protected dims (< `matryoshkaProtectedDim`): copy from m1 (domain invariant).
    - Free dims (>= `matryoshkaProtectedDim`): `c[i] = (m1[i] + m2[i]) / 2`.
    - This frozen `c` is never recalculated. All future candidates in the Matryoshka unwind are
      evaluated relative to this frozen platform.
  - Return `Metroid { m1, m2, c }`; if no valid m2 found, return
    `{ m1, m2: null, c: null, knowledgeGap: true }`

- [ ] **P1-M2:** Implement Matryoshka dimensional unwinding in `cortex/MetroidBuilder.ts`
  - After the initial Metroid construction, progressively expand the antithesis search into deeper
    embedding layers by shifting the protected dimension boundary outward one Matryoshka tier at a
    time.
  - At each new tier, find a new `m2` candidate via cosine-opposite medoid search in the expanded
    free dimensions.
  - Evaluate each candidate against the **frozen** `c` (not a recomputed centroid). If close
    enough to `c`, accept and freeze this step; take the next conceptual leap. If not,
    continue unwinding.
  - Stop when the protected dimension floor is reached or a satisfactory `m2` is accepted.
  - If no satisfactory `m2` is found at any layer, return `knowledgeGap: true`.

- [ ] **P1-M3:** Add MetroidBuilder test coverage
  - `tests/cortex/MetroidBuilder.test.ts`
  - Test m1 selection: the medoid minimising distance to q is chosen (not the centroid)
  - Test m2 selection: medoid of cosine-opposite set — not merely nearest semantically-opposing node
  - Test centroid computation: protected dims copied from m1; free dims averaged element-wise
  - Test centroid is frozen: subsequent unwinding steps do not recompute c
  - Test dimensional unwinding: search expands progressively through Matryoshka layers
  - Test knowledge gap: when no valid m2 exists in any layer, returns `knowledgeGap: true`
  - Test protected dimensions are never searched for antithesis
  - Test determinism: same inputs always produce same Metroid

**Exit Criteria:** MetroidBuilder constructs valid Metroids (m1 via medoid search, m2 via
cosine-opposite medoid of the top-scoring candidates, c computed once and never recomputed during
Matryoshka unwinding) and correctly detects knowledge gaps.

---

### P1-N: Knowledge Gap Detection & Curiosity Probe (DELIVERS: epistemic honesty)

**Why:** When MetroidBuilder cannot find m2, the system must acknowledge its knowledge boundary rather than hallucinating. The curiosity probe mechanism enables distributed learning by broadcasting the gap to peers.

- [ ] **P1-N1:** Implement `cortex/KnowledgeGapDetector.ts`
  - Accept MetroidBuilder result; if `knowledgeGap: true`, emit a `KnowledgeGap` DTO
  - `KnowledgeGap { topicMedoidId: Hash, queryEmbedding: Float32Array, dimensionalBoundary: number, timestamp: string }`
  - This DTO is returned to the caller as part of `QueryResult`

- [ ] **P1-N2:** Implement curiosity probe construction in `cortex/KnowledgeGapDetector.ts`
  - Build `CuriosityProbe { m1, partialMetroid, queryContext, knowledgeBoundary, mimeType, modelUrn }`
    - `mimeType`: MIME type of embedded content (e.g. `text/plain`). Enables receiving peers to validate content-type compatibility before comparing graph sections.
    - `modelUrn`: URN of the embedding model (e.g. `urn:model:onnx-community/embeddinggemma-300m-ONNX:v1`) sourced from the active `ModelProfile.modelId`. Peers **must** reject probes whose `modelUrn` does not match a model they support — accepting fragments from a different embedding model would produce incommensurable similarity scores at Matryoshka layer boundaries.
  - Store probe locally for broadcast via P2P layer (see P2-G)
  - Do not broadcast immediately — queue for the P2P sharing layer

- [ ] **P1-N3:** Upgrade `cortex/QueryResult.ts`
  - Add `knowledgeGap?: KnowledgeGap` field — present when MetroidBuilder failed to find m2
  - Document that callers must check this field before treating results as epistemically complete

- [ ] **P1-N4:** Add knowledge gap test coverage
  - `tests/cortex/KnowledgeGapDetector.test.ts`
  - Test that a KnowledgeGap DTO is produced when MetroidBuilder returns `knowledgeGap: true`
  - Test that a CuriosityProbe is constructed with correct fields including `mimeType` and `modelUrn`
  - Test that `modelUrn` is derived from `ModelProfile.modelId` (not hardcoded)
  - Test that QueryResult includes the KnowledgeGap when present
  - Test that queries against a rich corpus do NOT produce false-positive knowledge gaps

**Exit Criteria:** System correctly signals knowledge boundaries; callers can distinguish epistemically complete from incomplete results.

---

### P1-E: Full Query Orchestrator (DELIVERS: dialectical retrieval)

**Why:** This is the "aha" moment — return memories in natural narrative order through the resident hotpath via dialectical Metroid exploration, with dynamic, sublinear expansion bounds.

> **Note on scope:** The existing `cortex/Query.ts` is a flat top-K scorer that does not use MetroidBuilder, Hebbian edge traversal, or cosine-similarity-bounded subgraph expansion. It must be **substantially reworked** — not merely extended — to implement the dialectical pipeline described below. The same applies to `cortex/QueryResult.ts`. Do not attempt to preserve the flat-scoring code path; it is superseded entirely.

- [ ] **P1-E1:** Rewrite `cortex/Query.ts` (full dialectical version)
  - Use resident-first hierarchical ranking to select topic medoid (m1)
  - Call `MetroidBuilder` to construct `{ m1, m2, c }`
  - If knowledge gap detected, include in result and continue with partial Metroid (m1 only)
  - Use centroid `c` as the primary scoring anchor for page selection
  - Derive dynamic subgraph bounds from `HotpathPolicy` (`maxSubgraphSize`, `maxHops`, `perHopBranching`)
  - Call `MetadataStore.getInducedNeighborSubgraph(seedPages, maxHops)` using dynamic `maxHops`; traverse edges using Hebbian weights for tour distance (not cosine similarity)
  - Call `OpenTSPSolver.solve(subgraph)`
  - Return ordered page list via coherent path
  - **Query cost meter:** count vector operations; early-stop and return best-so-far if cost exceeds Williams-derived budget
  - Include provenance metadata (hop count, edge weights, subgraph size, cost, Metroid details)

- [ ] **P1-E2:** Rewrite `cortex/QueryResult.ts`
  - Add `coherencePath: Hash[]` (ordered page IDs)
  - Add `metroid?: { m1: Hash; m2: Hash | null; centroid: Float32Array | null }` (Metroid used for this query)
  - Add `knowledgeGap?: KnowledgeGap` (if antithesis discovery failed)
  - Add `provenance: { subgraphSize: number; hopCount: number; edgeWeights: number[]; vectorOpCost: number; earlyStop: boolean }`

- [ ] **P1-E3:** Add full query test coverage
  - `tests/cortex/Query.test.ts` (upgrade)
  - Test subgraph expansion stays within `maxSubgraphSize`
  - Test TSP ordering
  - Test Metroid is built and included in provenance
  - Test knowledge gap is returned when antithesis not found
  - Test provenance metadata
  - Test early-stop fires when cost budget exceeded

**Exit Criteria:** Queries return dialectically balanced, coherent context chains through the resident hotpath; MetroidBuilder active; knowledge gaps surfaced.

---

### P1-F: Integration Test (Hierarchical + Dialectical)

**Why:** Validate v0.5 completeness including resident-first routing, MetroidBuilder, and dialectical subgraph bounds.

- [ ] **P1-F1:** Upgrade `tests/integration/IngestQuery.test.ts`
  - Verify hierarchical structures exist after ingest
  - Verify hotpath entries exist for hierarchy prototypes after ingest
  - Verify queries build a valid Metroid `{ m1, m2, c }`
  - Verify queries return coherent paths through resident hotpath
  - Verify dynamic subgraph bounds honoured (no expansion beyond `maxSubgraphSize`)
  - Verify knowledge gap is correctly signalled when corpus is sparse
  - Compare dialectical retrieval vs flat ranking (show epistemic breadth improvement)

**Exit Criteria:** Integration test demonstrates dialectically balanced retrieval with resident-first routing and knowledge gap detection.

---

## 🟢 Medium Priority — Ship v1.0 (Background Consolidation + Smart Sharing)

These items add idle background maintenance and privacy-safe interest sharing. Together they deliver v1.0's discovery value.

### P2-A: Idle Scheduler (UNBLOCKS: Daydreamer operations)

**Why:** Need cooperative background loop that doesn't block foreground.

- [x] **P2-A1:** Implement `daydreamer/IdleScheduler.ts`
  - Loop via `requestIdleCallback` (browser) or `setImmediate` (Node)
  - Interruptible (yield after N ms of work)
  - CPU budget awareness (pause if main thread busy)
  - Task queue (prioritize high-value work)

- [x] **P2-A2:** Add scheduler test coverage
  - `tests/daydreamer/IdleScheduler.test.ts`
  - Test cooperative yielding
  - Test interruption doesn't corrupt state

**Exit Criteria:** Background loop runs without blocking UI.

---

### P2-B: Hebbian Updater (DELIVERS: connection plasticity)

**Why:** Strengthen useful connections, decay unused ones. Edge changes alter σ(v) values and can trigger hotpath promotions or evictions.

- [x] **P2-B1:** Implement `daydreamer/HebbianUpdater.ts`
  - LTP: strengthen edges traversed during successful queries
  - LTD: decay all edges by small factor each pass
  - Prune: remove edges below threshold; keep Metroid degree within `HotpathPolicy`-derived bounds
  - After LTP/LTD: recompute σ(v) for all nodes whose incident edges changed (via `SalienceEngine.batchComputeSalience`)
  - Run promotion/eviction sweep for changed nodes via `SalienceEngine.runPromotionSweep`
  - Update `MetadataStore.putEdges`

- [x] **P2-B2:** Add Hebbian test coverage
  - `tests/daydreamer/HebbianUpdater.test.ts`
  - Test strengthen increases weight
  - Test decay decreases weight
  - Test pruning removes weak edges and keeps degree within bounds
  - Test that salience is recomputed for changed nodes
  - Test that promotion sweep runs after LTP increases salience above weakest resident

**Exit Criteria:** Edge weights adapt based on usage; salience and hotpath updated accordingly.

---

### P2-C: Full Neighbor Graph Recalc (DELIVERS: graph maintenance)

**Why:** Incremental fast semantic neighbor insert is approximate; need periodic full recalc. Recalc batch size must be bounded by H(t)-derived maintenance budget to avoid blocking the idle loop.

- [x] **P2-C1:** Implement `daydreamer/FullNeighborRecalc.ts`
  - Query `MetadataStore.needsNeighborRecalc(volumeId)` for dirty volumes; prioritise dirtiest first
  - Load all pages in volume; compute pairwise similarities
  - Bound batch: process at most `HotpathPolicy.computeCapacity(graphMass)` pairwise comparisons per idle cycle (O(√(t log t)))
  - Select policy-derived max neighbors for each page; update `MetadataStore.putSemanticNeighbors`
  - Clear dirty flag via `MetadataStore.clearNeighborRecalcFlag`
  - Recompute σ(v) for affected nodes via `SalienceEngine.batchComputeSalience`; run promotion sweep

- [x] **P2-C2:** Add neighbor graph recalc test coverage
  - `tests/daydreamer/FullNeighborRecalc.test.ts`
  - Test dirty flag cleared after recalc
  - Test neighbor quality improved vs fast insert
  - Test batch size respects O(√(t log t)) limit per cycle
  - Test salience recomputed and promotion sweep runs after recalc

**Exit Criteria:** Dirty volumes are recalculated in background within bounded compute budget; salience updated.

---

### P2-D: Prototype Recomputer (DELIVERS: prototype quality)

**Why:** Keep volume/shelf prototypes accurate as pages/books change. Prototype updates change which entries should occupy the volume and shelf tier quotas.

- [x] **P2-D1:** Implement `daydreamer/PrototypeRecomputer.ts`
  - Recompute volume medoids (select medoid page per volume)
  - Recompute volume centroids (average of book embeddings)
  - Recompute shelf routing prototypes
  - Update vectors in `VectorStore` (append new, update offsets)
  - After recomputing each level: recompute salience for affected representative entries via `SalienceEngine`; run tier-quota promotion/eviction for that tier

- [x] **P2-D2:** Add prototype recomputer test coverage
  - `tests/daydreamer/PrototypeRecomputer.test.ts`
  - Test medoid selection algorithm
  - Test centroid computation
  - Test that tier-quota hotpath entries are updated after prototype recomputation

**Exit Criteria:** Prototypes stay accurate over time; tier quota entries reflect current prototypes.

---

### P2-E: Integration Test (Background Consolidation)

**Why:** Validate Daydreamer improves system health and hotpath stays consistent.

- [x] **P2-E1:** Implement `tests/integration/Daydreamer.test.ts`
  - Ingest corpus
  - Run queries (generate edge traversals and PageActivity updates)
  - Run Daydreamer for N passes
  - Verify edge weights updated
  - Verify dirty volumes recalculated
  - Verify prototypes updated
  - Verify resident count never exceeds H(t) after any Daydreamer pass

**Exit Criteria:** Daydreamer demonstrably maintains system health; Williams Bound invariant holds.

---

### P2-F: Community Detection & Graph Coverage Quotas (DELIVERS: topic-diverse hotpath)

**Why:** Without community detection, a single dense topic can fill the entire page-tier quota, crowding out unrelated memories. Community quotas ensure the hotpath is both hot (high salience) and diverse (topic-representative).

- [x] **P2-F1:** Add community detection to `daydreamer/ClusterStability.ts`
  - Implement lightweight label propagation on the semantic neighbor graph
  - Run during idle passes when dirty-volume flags indicate meaningful structural change
  - Store community labels in `PageActivity.communityId` via `MetadataStore.putPageActivity`
  - Rerun when graph topology changes significantly (post-split, post-merge, post-full-recalc)

- [x] **P2-F2:** Wire community labels into `SalienceEngine` promotion/eviction
  - `selectEvictionTarget` uses `communityId` to find weakest resident in the community bucket
  - Promotion checks community quota remaining before admitting
  - If community quota is full: candidate must beat weakest resident in that community
  - If community is unknown (`communityId` not yet set): place node in temporary pending pool borrowing from page-tier budget
  - Empty communities release their slots back to the page-tier budget

- [x] **P2-F3:** Add community-aware eviction tests
  - `tests/daydreamer/ClusterStability.test.ts`
  - Test that a single dense community cannot consume all page-tier hotpath slots
  - Test that a new community (previously unknown) receives at least one slot
  - Test that an empty community releases its slots correctly
  - Test that label propagation converges and produces stable community assignments

**Exit Criteria:** Community-aware hotpath quotas active; topic diversity enforced; label propagation stable.

---

### P2-G: Curiosity Broadcasting & Smart Interest Sharing (DELIVERS: distributed learning without hallucination)

**Why:** When knowledge gaps are detected, CORTEX must be able to broadcast the incomplete Metroid as a curiosity probe to connected peers. Peers respond with relevant fragments, enabling collaborative learning. Additionally, interest sharing is a core product value for both app and library surfaces. v1 must share public-interest graph sections while preventing personal data leakage.

- [x] **P2-G0:** Implement `sharing/CuriosityBroadcaster.ts`
  - Consume pending `CuriosityProbe` objects queued by `KnowledgeGapDetector`
  - Serialize and broadcast to connected peers via P2P transport
  - Handle responses: deserialize incoming graph fragments; pass to `SubgraphImporter` for integration
  - Rate-limit broadcasts to prevent spam
  - Include `knowledgeBoundary` field in probe so peers can target search precisely

- [x] **P2-G1:** Implement `sharing/EligibilityClassifier.ts`
  - Classify candidate nodes as share-eligible vs blocked before export
  - Detect identity/PII-bearing content (person-specific identifiers, credentials, financial/health traces)
  - Emit deterministic eligibility decisions with reason codes for auditability

- [x] **P2-G2:** Implement `sharing/SubgraphExporter.ts`
  - Build topic-scoped graph slices from eligible nodes only
  - For curiosity responses: select graph fragment relevant to the received probe's `knowledgeBoundary`
  - Preserve node/edge signatures and provenance
  - Strip or coarsen personal metadata fields that are not needed for discovery

- [x] **P2-G3:** Implement `sharing/PeerExchange.ts` and `sharing/SubgraphImporter.ts`
  - Opt-in peer exchange over P2P transport
  - Verify signatures and schema on import; reject invalid or tampered payloads
  - Merge imported slices into discovery pathways without exposing sender identity metadata
  - After import, retry MetroidBuilder for any pending knowledge gaps that may be resolved by new data

- [x] **P2-G4:** Add sharing safety and discovery tests
  - `tests/sharing/EligibilityClassifier.test.ts`
  - `tests/sharing/CuriosityBroadcaster.test.ts`
  - `tests/sharing/SubgraphExchange.test.ts`
  - Assert blocked nodes are never exported; assert imported fragments are discoverable via query
  - Assert that after receiving a response to a curiosity probe, MetroidBuilder can now construct m2 for the previously-gapped topic

**Exit Criteria:** v1 can broadcast curiosity probes for knowledge gaps, receive graph fragments from peers, retry MetroidBuilder with new data, and exchange signed public-interest slices with PII blocking.

---

### P3-H: GitHub sync smoke test (VALIDATES: automation pipeline)

**Why:** Ensure the `TODO.md` → GitHub issue sync path works end-to-end (milestones/labels/issues created by `scripts/sync-github-project.mjs`).

- [ ] **P3-H1:** Push this change to `main` so the sync workflow runs
- [ ] **P3-H2:** Verify a new issue is created automatically from this task group
- [ ] **P3-H3:** Mark this task complete once the issue exists and the workflow succeeded

**Exit Criteria:** A GitHub issue was created from this task group after pushing to `main`, and the sync workflow succeeded.

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

### P3-C: Cluster Stability (full implementation)

**Why:** Detect and fix unstable clusters (split oversized, merge undersized). The community detection added in P2-F is a subset of this module; here we add the full split/merge machinery.

- [ ] **P3-C1:** Complete `daydreamer/ClusterStability.ts`
  - Detect high-variance volumes (unstable)
  - Trigger split (K-means with K=2)
  - Detect low-count volumes
  - Trigger merge with nearest neighbor volume
  - Re-run community detection and update PageActivity after split/merge

- [ ] **P3-C2:** Add cluster stability test coverage
  - `tests/daydreamer/ClusterStability.test.ts` (extend from P2-F)
  - Test split produces two balanced volumes
  - Test merge produces one combined volume
  - Test community labels updated after structural change

**Exit Criteria:** Clusters stay balanced over time; community labels stay current.

---

### P3-D: Benchmark Suite

**Why:** Measure performance, validate Williams Bound invariants, and track regressions.

- [ ] **P3-D1:** Implement real-provider benchmarks
  - `tests/benchmarks/TransformersJsEmbedding.bench.ts`
  - Throughput (embeddings/sec) for various batch sizes

- [ ] **P3-D2:** Implement query latency benchmarks
  - `tests/benchmarks/QueryLatency.bench.ts`
  - Latency vs corpus size (100 pages, 1K pages, 10K pages)

- [ ] **P3-D3:** Implement storage overhead benchmarks
  - `tests/benchmarks/StorageOverhead.bench.ts`
  - Disk usage vs page count

- [ ] **P3-D4:** Implement hotpath scaling benchmarks
  - `tests/benchmarks/HotpathScaling.bench.ts`
  - Synthetic graphs at 1K, 10K, 100K, 1M nodes+edges
  - Measure: resident set size vs H(t), query latency vs corpus size, promotion/eviction throughput
  - **Assert:** resident count never exceeds H(t); query cost scales sublinearly with corpus size
  - Assert: H(t) values match expected sublinear curve at each scale point

- [ ] **P3-D5:** Record baseline measurements
  - Add `benchmarks/BASELINES.md` with results from all benchmarks
  - Include H(t) curve data at 1K/10K/100K/1M

**Exit Criteria:** Benchmark suite exists; baselines recorded; Williams Bound invariants asserted.

---

### P3-E: CI Hardening

**Why:** Ensure tests run reliably in CI; enforce both model-derived and policy-derived numeric guards.

- [ ] **P3-E1:** Add GitHub Actions workflow
  - `.github/workflows/ci.yml`
  - Run `npm run build`, `npm run lint`, `npm run test:unit`, `npm run guard:model-derived`

- [ ] **P3-E2:** Define Electron runtime gate policy
  - Document GPU/graphics requirements
  - Decide CI runner capabilities (software vs hardware rendering)
  - Update `scripts/run-electron-runtime-tests.mjs` gate logic

- [ ] **P3-E3:** Add hotpath policy constants guard
  - Extend `scripts/guard-model-derived.mjs` or add `scripts/guard-hotpath-policy.mjs`
  - Scan for numeric literals assigned to hotpath policy fields outside `core/HotpathPolicy.ts`
  - Add as required CI gate alongside `guard:model-derived`
  - Add `npm run guard:hotpath-policy` script to `package.json`

**Exit Criteria:** CI runs on every PR; merge blocked if tests or guards fail; both model-derived and policy-derived constants are enforced.

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

### P3-G: Product Surface UX Contract

**Why:** v1.0 needs an explicit UX contract for the standalone app while keeping the library surface headless and integration-first.

- [ ] **P3-G1:** Add `docs/product-surfaces.md`
  - Define app-vs-library scope, boundaries, and non-goals
  - Define standalone extension user journey: passive capture -> search -> revisit
  - Define what remains local-only and private in the app shell

- [ ] **P3-G2:** Add standalone search UX checklist to `docs/product-surfaces.md`
  - Search-first information architecture (query bar, results, lightweight metrics)
  - Result-card contract (title, URL, snippet/thumbnail, visit recency, relevance signal)
  - UX states: empty index, no matches, loading/indexing, error recovery

- [ ] **P3-G3:** Add model-mode UX contract to `docs/product-surfaces.md`
  - Nomic mode: multimodal recall (text + images in shared latent space)
  - Gemma mode: fine-grained text recall (no image embedding)
  - UI copy rules that make image-recall availability explicit by mode

- [ ] **P3-G4:** Add rabbit-hole recall acceptance checklist
  - Vague text recollection scenario recovers a previously visited page path
  - Vague visual recollection scenario recovers a previously seen image when Nomic mode is enabled
  - Add manual validation steps for model toggle behavior and capability messaging

**Exit Criteria:** Standalone app UX contract and model-mode behavior are documented; library boundary remains explicit and implementation-ready.

---

## 📋 Summary by Phase

| Phase | Items | Status | Blocking |
|-------|-------|--------|----------|
| v0.1 (Minimal Viable) | 30 tasks (P0-A through P0-G + P0-E + P0-X) | 🟡 In Progress (P0-A, P0-F, P0-G complete; P0-X architectural rename pending) | User cannot use system correctly; P0-X blocks MetroidBuilder |
| v0.5 (Hierarchical + Dialectical) | 20 tasks (P1-A through P1-F + P1-M + P1-N) | ❌ Not started | Blocked by v0.1 |
| v1.0 (Background Consolidation + Smart Sharing) | 20 tasks (P2-A through P2-G) | ❌ Not started | Blocked by v0.5 |
| Polish & Ship | 21 tasks (P3-A through P3-G) | ❌ Not started | Not blocking v1.0 |

**Total:** ~91 actionable tasks

---

## Quick Reference: Next Tasks to Unblock Everything

If you're reading this and want to know "what do I work on right now?", here's the answer:

**Immediate (unblock MetroidBuilder):**
1. ~~**P0-X1–X7:** Fix architectural naming drift (`MetroidNeighbor` → `SemanticNeighbor` and related renames)~~ ✅ DONE

**After P0-X (complete v0.1):**
2. **P0-B1:** Implement `hippocampus/Chunker.ts`
3. **P0-C1/C2:** Implement `hippocampus/PageBuilder.ts` and `hippocampus/Ingest.ts`
4. **P0-D1:** Implement `cortex/Query.ts` (minimal)

**After v0.1 (start v0.5):**
5. **P1-A1:** Implement `hippocampus/HierarchyBuilder.ts`
6. **P1-C1:** Implement `hippocampus/FastNeighborInsert.ts`
7. **P1-M1/M2:** Implement `cortex/MetroidBuilder.ts` with Matryoshka unwinding
8. **P1-N1/N2:** Implement `cortex/KnowledgeGapDetector.ts`
9. **P1-D1:** Implement `cortex/OpenTSPSolver.ts`
10. **P1-E1:** Rewrite `cortex/Query.ts` to full dialectical orchestrator (substantial rework; not backward-compatible with flat top-K version)

---

## Notes

- **Dependencies:** Items are ordered so that completing tasks in sequence minimises blocked work. P0-X (naming drift fix) must precede MetroidBuilder. P0-F and P0-G (Williams Bound foundation) must precede all hotpath-aware modules.
- **Estimates:** Each P0/P1/P2 task is roughly 1-4 hours for an experienced developer familiar with the codebase.
- **Testing:** Every implementation task should be accompanied by test coverage (explicitly called out).
- **TDD Approach:** Write failing tests first, then implement to green.
- **Documentation Sync:** Update PLAN.md module status as tasks complete.
- **Williams Bound Invariant:** The resident count must never exceed H(t). Every test that touches the hotpath should assert this.
- **Policy constants:** Never hardcode hotpath constants outside `core/HotpathPolicy.ts`. P3-E3 will add a guard to enforce this automatically; until then, enforce by convention.
- **Metroid vs medoid vs semantic neighbor graph:** These are three distinct concepts. `Metroid` = dialectical probe `{ m1, m2, c }` (ephemeral, query-time). `medoid` = cluster representative node. Semantic neighbor graph = sparse proximity edges used for BFS subgraph expansion. Do not conflate them. See P0-X for the code rename tasks that fix the current conflation.
