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

### P0-F: Williams Bound Policy Foundation (BLOCKS: all hotpath-aware modules)

**Why:** The HotpathPolicy and SalienceEngine are the central source of truth for the Williams Bound architecture. Every subsequent module (ingest, query, hierarchy, Daydreamer) depends on them. Implementing these first ensures the bound is enforced from day one rather than retrofitted.

- [ ] **P0-F1:** Implement `core/HotpathPolicy.ts`
  - `computeCapacity(graphMass: number): number` — H(t) = ⌈c · √(t · log₂(1+t))⌉
  - `computeSalience(hebbianIn: number, recency: number, queryHits: number, weights?: SalienceWeights): number` — σ = α·H_in + β·R + γ·Q
  - `deriveTierQuotas(capacity: number, quotaRatios?: TierQuotaRatios): TierQuotas` — allocate H(t) across shelf/volume/book/page tiers
  - `deriveCommunityQuotas(tierBudget: number, communitySizes: number[]): number[]` — proportional with min(1) guarantee
  - Export a frozen `DEFAULT_HOTPATH_POLICY` object containing all constants: `c = 0.5`, `α = 0.5`, `β = 0.3`, `γ = 0.2`, `q_s = 0.10`, `q_v = 0.20`, `q_b = 0.20`, `q_p = 0.50`
  - Keep strictly separate from `core/ModelDefaults.ts` (policy-derived ≠ model-derived)

- [ ] **P0-F2:** Add HotpathPolicy test coverage (`tests/HotpathPolicy.test.ts`)
  - H(t) grows sublinearly: verify `H(10_000) / 10_000 < H(1_000) / 1_000`
  - H(t) is monotonically non-decreasing over a representative range: verify `H(t+1) >= H(t)` for each `t` in `[0, 1, 2, 10, 100, 1_000, 10_000, 100_000]`
  - H(t) is a finite integer ≥ 1 for edge inputs: `t = 0`, `t = 1`, `t = Number.MAX_SAFE_INTEGER`; result must never be `NaN`, `Infinity`, or `< 1`
  - Derived tier-quota *counts* sum exactly to capacity: `deriveTierQuotas(cap).shelf + .volume + .book + .page === cap` for `cap` in `[1, 10, 100, 1_000]`
  - Community quota counts sum exactly to `tier_budget`: `sum(deriveCommunityQuotas(budget, sizes)) === budget` for representative `(budget, sizes)` inputs including edge cases (`budget = 0`, empty `sizes` array, `budget < sizes.length`)
  - Community quotas never produce `NaN`, `Infinity`, or negative values for any valid input, including `sizes` with a single community or all equal sizes
  - Salience is deterministic for same inputs
  - Salience clamps output to a finite number: never `NaN` or `Infinity` for extreme weight or hit-count values

- [ ] **P0-F3:** Extend `core/types.ts`
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

- [ ] **P0-F4:** Extend `storage/IndexedDbMetadataStore.ts`
  - Add `hotpath_index` object store keyed by `entityId`; secondary index by `tier`
  - Add `page_activity` object store keyed by `pageId`
  - Implement all six new `MetadataStore` hotpath methods
  - Extend `tests/Persistence.test.ts` with hotpath store tests:
    - put/get/evict cycle for `HotpathEntry`
    - put/get for `PageActivity`
    - `getResidentCount` returns correct value after multiple puts

**Exit Criteria:** `HotpathPolicy` module passes all tests; `types.ts` has hotpath interfaces; IndexedDB hotpath stores are implemented and tested.

---

### P0-G: Salience Engine (BLOCKS: hotpath promotion in ingest and Daydreamer)

**Why:** The SalienceEngine is the decision-making layer for hotpath admission. It is needed by ingest (new page admission), query (hit-count update), and Daydreamer (post-LTP/LTD sweeps). Implementing it before ingest ensures promotion logic is correct from the first page written.

- [ ] **P0-G1:** Implement `core/SalienceEngine.ts`
  - `computeNodeSalience(pageId: Hash, metadataStore: MetadataStore): Promise<number>` — fetch PageActivity and incident Hebbian edges; apply σ formula via HotpathPolicy
  - `batchComputeSalience(pageIds: Hash[], metadataStore: MetadataStore): Promise<Map<Hash, number>>` — efficient batch version
  - `shouldPromote(candidateSalience: number, weakestResidentSalience: number, capacityRemaining: number): boolean` — admission gating
  - `selectEvictionTarget(tier: HotpathEntry['tier'], communityId: string | undefined, metadataStore: MetadataStore): Promise<Hash | undefined>` — find weakest resident in tier/community bucket

- [ ] **P0-G2:** Implement promotion/eviction lifecycle helpers in `core/SalienceEngine.ts`
  - `bootstrapHotpath(metadataStore: MetadataStore, policy: HotpathPolicy): Promise<void>` — fill hotpath greedily by salience while resident count < H(t)
  - `runPromotionSweep(candidateIds: Hash[], metadataStore: MetadataStore, policy: HotpathPolicy): Promise<void>` — steady-state: promote if salience > weakest in same tier/community bucket; evict weakest on promotion

- [ ] **P0-G3:** Add SalienceEngine test coverage (`tests/SalienceEngine.test.ts`)
  - Bootstrap fills hotpath to exactly H(t) given enough candidates
  - Steady-state promotes only when candidate beats the weakest resident
  - Steady-state evicts exactly the weakest resident (not a random entry)
  - Community quotas prevent a single community from consuming all page-tier slots
  - Tier quotas prevent one hierarchy level from dominating
  - Eviction is deterministic under the same state

**Exit Criteria:** `SalienceEngine` module passes all tests; promotion/eviction lifecycle is correct and deterministic.

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
  - Initialise `PageActivity` records with zero counts

- [ ] **P0-C2:** Implement `hippocampus/Ingest.ts` (minimal version)
  - Entry point: `ingestText(text, modelProfile, vectorStore, metadataStore, keyPair)`
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

- [ ] **P0-D1:** Implement `cortex/Query.ts` (minimal version)
  - Entry point: `query(queryText, modelProfile, vectorStore, metadataStore, topK)`
  - Embed query via `EmbeddingRunner`
  - Score resident hotpath entries first (HOT pages); fall back to full scan for WARM/COLD
  - Compute similarities via `VectorBackend`
  - Select top-K pages; increment `queryHitCount` in `PageActivity`; recompute salience; run promotion sweep
  - Return `QueryResult` with page IDs and scores
  - **Defer:** Full hierarchical ranking, subgraph expansion, TSP coherence, query cost meter

- [ ] **P0-D2:** Implement `cortex/QueryResult.ts`
  - DTO with `pages: Page[]`, `scores: number[]`, `metadata: object`

- [ ] **P0-D3:** Add query test coverage
  - `tests/cortex/Query.test.ts`
  - Test happy path (query → top-K pages)
  - Test empty corpus (no results)
  - Test relevance (query for known content returns expected pages)
  - Test `PageActivity.queryHitCount` incremented after query hit

**Exit Criteria:** User can call `query(...)` and get ranked pages; query hits update PageActivity and trigger salience recomputation.

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

### P1-C: Fast Metroid Neighbor Insert (UNBLOCKS: graph coherence)

**Why:** Need sparse NN graph for coherent path tracing. Degree must be bounded by `HotpathPolicy` to prevent unbounded graph mass growth.

- [ ] **P1-C1:** Implement `hippocampus/FastMetroidInsert.ts`
  - For each new page, compute similarity to existing pages
  - Derive max neighbors per page from `HotpathPolicy` constant (not hardcoded K)
  - Insert forward edges (page → neighbors)
  - Insert reverse edges (neighbors → page), respecting max degree
  - If a page is already at max degree, evict the neighbor with the lowest Hebbian edge weight
  - Mark affected volumes as dirty for full Daydreamer recalc
  - After insertion, check new page for hotpath admission via `SalienceEngine`

- [ ] **P1-C2:** Upgrade `hippocampus/Ingest.ts`
  - After persisting pages, call `FastMetroidInsert`

- [ ] **P1-C3:** Add Metroid insert test coverage
  - `tests/hippocampus/FastMetroidInsert.test.ts`
  - Test neighbor lists are bounded by the policy-derived max degree
  - Test symmetry (if A→B, then B→A)
  - Test that degree overflow evicts lowest-weight neighbor, not a random one
  - Test that new page is considered for hotpath admission after insertion

**Exit Criteria:** Metroid neighbor graph is maintained during ingest with policy-bounded degree.

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

**Why:** This is the "aha" moment — return memories in natural narrative order through the resident hotpath with dynamic, sublinear expansion bounds.

- [ ] **P1-E1:** Upgrade `cortex/Query.ts` (full version)
  - Use resident-first hierarchical ranking to select seed pages
  - Derive dynamic subgraph bounds from `HotpathPolicy` (`maxSubgraphSize`, `maxHops`, `perHopBranching`)
  - Call `MetadataStore.getInducedMetroidSubgraph(seedPages, maxHops)` using dynamic `maxHops`
  - Call `OpenTSPSolver.solve(subgraph)`
  - Return ordered page list via coherent path
  - **Query cost meter:** count vector operations; early-stop and return best-so-far if cost exceeds Williams-derived budget
  - Include provenance metadata (hop count, edge weights, subgraph size, cost)

- [ ] **P1-E2:** Upgrade `cortex/QueryResult.ts`
  - Add `coherencePath: Hash[]` (ordered page IDs)
  - Add `provenance: { subgraphSize: number; hopCount: number; edgeWeights: number[]; vectorOpCost: number; earlyStop: boolean }`

- [ ] **P1-E3:** Add full query test coverage
  - `tests/cortex/Query.test.ts` (upgrade)
  - Test subgraph expansion stays within `maxSubgraphSize`
  - Test TSP ordering
  - Test provenance metadata
  - Test early-stop fires when cost budget exceeded

**Exit Criteria:** Queries return coherent ordered context chains through the resident hotpath; dynamic bounds and cost meter active.

---

### P1-F: Integration Test (Hierarchical + Coherent)

**Why:** Validate v0.5 completeness including resident-first routing and dynamic subgraph bounds.

- [ ] **P1-F1:** Upgrade `tests/integration/IngestQuery.test.ts`
  - Verify hierarchical structures exist after ingest
  - Verify hotpath entries exist for hierarchy prototypes after ingest
  - Verify queries return coherent paths through resident hotpath
  - Verify dynamic subgraph bounds honoured (no expansion beyond `maxSubgraphSize`)
  - Compare coherent path vs flat ranking (show narrative flow improvement)

**Exit Criteria:** Integration test demonstrates coherent retrieval with resident-first routing.

---

## 🟢 Medium Priority — Ship v1.0 (Background Consolidation + Smart Sharing)

These items add idle background maintenance and privacy-safe interest sharing. Together they deliver v1.0's discovery value.

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

**Why:** Strengthen useful connections, decay unused ones. Edge changes alter σ(v) values and can trigger hotpath promotions or evictions.

- [ ] **P2-B1:** Implement `daydreamer/HebbianUpdater.ts`
  - LTP: strengthen edges traversed during successful queries
  - LTD: decay all edges by small factor each pass
  - Prune: remove edges below threshold; keep Metroid degree within `HotpathPolicy`-derived bounds
  - After LTP/LTD: recompute σ(v) for all nodes whose incident edges changed (via `SalienceEngine.batchComputeSalience`)
  - Run promotion/eviction sweep for changed nodes via `SalienceEngine.runPromotionSweep`
  - Update `MetadataStore.putEdges`

- [ ] **P2-B2:** Add Hebbian test coverage
  - `tests/daydreamer/HebbianUpdater.test.ts`
  - Test strengthen increases weight
  - Test decay decreases weight
  - Test pruning removes weak edges and keeps degree within bounds
  - Test that salience is recomputed for changed nodes
  - Test that promotion sweep runs after LTP increases salience above weakest resident

**Exit Criteria:** Edge weights adapt based on usage; salience and hotpath updated accordingly.

---

### P2-C: Full Metroid Recalc (DELIVERS: graph maintenance)

**Why:** Incremental fast insert is approximate; need periodic full recalc. Recalc batch size must be bounded by H(t)-derived maintenance budget to avoid blocking the idle loop.

- [ ] **P2-C1:** Implement `daydreamer/FullMetroidRecalc.ts`
  - Query `MetadataStore.needsMetroidRecalc(volumeId)` for dirty volumes; prioritise dirtiest first
  - Load all pages in volume; compute pairwise similarities
  - Bound batch: process at most `HotpathPolicy.computeCapacity(graphMass)` pairwise comparisons per idle cycle (O(√(t log t)))
  - Select policy-derived max neighbors for each page; update `MetadataStore.putMetroidNeighbors`
  - Clear dirty flag via `MetadataStore.clearMetroidRecalcFlag`
  - Recompute σ(v) for affected nodes via `SalienceEngine.batchComputeSalience`; run promotion sweep

- [ ] **P2-C2:** Add Metroid recalc test coverage
  - `tests/daydreamer/FullMetroidRecalc.test.ts`
  - Test dirty flag cleared after recalc
  - Test neighbor quality improved vs fast insert
  - Test batch size respects O(√(t log t)) limit per cycle
  - Test salience recomputed and promotion sweep runs after recalc

**Exit Criteria:** Dirty volumes are recalculated in background within bounded compute budget; salience updated.

---

### P2-D: Prototype Recomputer (DELIVERS: prototype quality)

**Why:** Keep volume/shelf prototypes accurate as pages/books change. Prototype updates change which entries should occupy the volume and shelf tier quotas.

- [ ] **P2-D1:** Implement `daydreamer/PrototypeRecomputer.ts`
  - Recompute volume medoids (select medoid page per volume)
  - Recompute volume centroids (average of book embeddings)
  - Recompute shelf routing prototypes
  - Update vectors in `VectorStore` (append new, update offsets)
  - After recomputing each level: recompute salience for affected representative entries via `SalienceEngine`; run tier-quota promotion/eviction for that tier

- [ ] **P2-D2:** Add prototype recomputer test coverage
  - `tests/daydreamer/PrototypeRecomputer.test.ts`
  - Test medoid selection algorithm
  - Test centroid computation
  - Test that tier-quota hotpath entries are updated after prototype recomputation

**Exit Criteria:** Prototypes stay accurate over time; tier quota entries reflect current prototypes.

---

### P2-E: Integration Test (Background Consolidation)

**Why:** Validate Daydreamer improves system health and hotpath stays consistent.

- [ ] **P2-E1:** Implement `tests/integration/Daydreamer.test.ts`
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

- [ ] **P2-F1:** Add community detection to `daydreamer/ClusterStability.ts`
  - Implement lightweight label propagation on the Metroid neighbor graph
  - Run during idle passes when dirty-volume flags indicate meaningful structural change
  - Store community labels in `PageActivity.communityId` via `MetadataStore.putPageActivity`
  - Rerun when graph topology changes significantly (post-split, post-merge, post-full-recalc)

- [ ] **P2-F2:** Wire community labels into `SalienceEngine` promotion/eviction
  - `selectEvictionTarget` uses `communityId` to find weakest resident in the community bucket
  - Promotion checks community quota remaining before admitting
  - If community quota is full: candidate must beat weakest resident in that community
  - If community is unknown (`communityId` not yet set): place node in temporary pending pool borrowing from page-tier budget
  - Empty communities release their slots back to the page-tier budget

- [ ] **P2-F3:** Add community-aware eviction tests
  - `tests/daydreamer/ClusterStability.test.ts`
  - Test that a single dense community cannot consume all page-tier hotpath slots
  - Test that a new community (previously unknown) receives at least one slot
  - Test that an empty community releases its slots correctly
  - Test that label propagation converges and produces stable community assignments

**Exit Criteria:** Community-aware hotpath quotas active; topic diversity enforced; label propagation stable.

---

### P2-G: Smart Interest Sharing & PII Guardrail (DELIVERS: discovery without identity leakage)

**Why:** Interest sharing is core product value for both app and library surfaces. v1 must share public-interest graph sections while preventing personal data leakage.

- [ ] **P2-G1:** Implement `sharing/EligibilityClassifier.ts`
  - Classify candidate nodes as share-eligible vs blocked before export
  - Detect identity/PII-bearing content (person-specific identifiers, credentials, financial/health traces)
  - Emit deterministic eligibility decisions with reason codes for auditability

- [ ] **P2-G2:** Implement `sharing/SubgraphExporter.ts`
  - Build topic-scoped graph slices from eligible nodes only
  - Preserve node/edge signatures and provenance
  - Strip or coarsen personal metadata fields that are not needed for discovery

- [ ] **P2-G3:** Implement `sharing/PeerExchange.ts` and `sharing/SubgraphImporter.ts`
  - Opt-in peer exchange over P2P transport
  - Verify signatures and schema on import; reject invalid or tampered payloads
  - Merge imported slices into discovery pathways without exposing sender identity metadata

- [ ] **P2-G4:** Add sharing safety and discovery tests
  - `tests/sharing/EligibilityClassifier.test.ts`
  - `tests/sharing/SubgraphExchange.test.ts`
  - Assert blocked nodes are never exported; assert imported AI-interest updates are discoverable via query

**Exit Criteria:** v1 can exchange signed public-interest slices over P2P, and share-blocking reliably prevents PII/identity leakage.

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
| v0.1 (Minimal Viable) | 23 tasks (P0-A through P0-G + P0-E) | 🟡 In Progress (P0-A complete) | User cannot use system |
| v0.5 (Hierarchical + Coherent) | 14 tasks (P1-A through P1-F) | ❌ Not started | Blocked by v0.1 |
| v1.0 (Background Consolidation + Smart Sharing) | 18 tasks (P2-A through P2-G) | ❌ Not started | Blocked by v0.5 |
| Polish & Ship | 21 tasks (P3-A through P3-G) | ❌ Not started | Not blocking v1.0 |

**Total:** ~76 actionable tasks

---

## Quick Reference: Next 7 Tasks to Unblock Everything

If you're reading this and want to know "what do I work on right now?", here's the answer:

1. **P0-F1:** Implement `core/HotpathPolicy.ts`
2. **P0-F3:** Extend `core/types.ts` (PageActivity, HotpathEntry, TierQuotas)
3. **P0-F4:** Extend `storage/IndexedDbMetadataStore.ts` (hotpath stores)
4. **P0-G1/G2:** Implement `core/SalienceEngine.ts`
5. **P0-B1:** Implement `hippocampus/Chunker.ts`
6. **P0-C1/C2:** Implement `hippocampus/PageBuilder.ts` and `hippocampus/Ingest.ts`
7. **P0-D1:** Implement `cortex/Query.ts`

Items 1–4 (Williams Bound foundation) should be done first — they are small, independently testable, and unlock correct behaviour in everything that follows.

---

## Notes

- **Dependencies:** Items are ordered so that completing tasks in sequence minimises blocked work. P0-F and P0-G (Williams Bound foundation) must precede all hotpath-aware modules.
- **Estimates:** Each P0/P1/P2 task is roughly 1-4 hours for an experienced developer familiar with the codebase.
- **Testing:** Every implementation task should be accompanied by test coverage (explicitly called out).
- **TDD Approach:** Write failing tests first, then implement to green.
- **Documentation Sync:** Update PLAN.md module status as tasks complete.
- **Williams Bound Invariant:** The resident count must never exceed H(t). Every test that touches the hotpath should assert this.
- **Policy constants:** Never hardcode hotpath constants outside `core/HotpathPolicy.ts`. P3-E3 will add a guard to enforce this automatically; until then, enforce by convention.
