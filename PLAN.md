# CORTEX Implementation Plan

**Version:** 2.0
**Last Updated:** 2026-03-14

This document tracks the implementation status of each major module in CORTEX. It shows what's been built, what's in progress, and what remains.

## Status Legend

- ✅ **Complete** — Fully implemented with test coverage
- 🟡 **Partial** — Core implementation exists but incomplete or lacking tests
- ❌ **Missing** — Not yet implemented
- 🔄 **In Progress** — Currently being developed

---

## Module Status

### Foundation Layer

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Core Types | ✅ Complete | `core/types.ts` | All entity interfaces defined; includes `PageActivity`, `HotpathEntry`, `TierQuotas`, and `MetadataStore` hotpath method signatures |
| Model Profiles | ✅ Complete | `core/ModelProfile.ts`, `core/ModelDefaults.ts`, `core/ModelProfileResolver.ts`, `core/BuiltInModelProfiles.ts` | Source-of-truth for model-derived numerics; guard script enforces compliance |
| Numeric Constants | ✅ Complete | `core/NumericConstants.ts` | Runtime constants (byte sizes, workgroup limits) centralized |
| Crypto Helpers | ✅ Complete | `core/crypto/hash.ts`, `core/crypto/sign.ts`, `core/crypto/verify.ts` | SHA-256 hashing; Ed25519 sign/verify; 26 tests passing |
| Hotpath Policy | ✅ Complete | `core/HotpathPolicy.ts` | Williams Bound policy implementation; covered by `tests/HotpathPolicy.test.ts` |
| Salience Engine | ✅ Complete | `core/SalienceEngine.ts` | Per-node salience computation, promotion/eviction lifecycle helpers, community-aware admission logic; covered by `tests/SalienceEngine.test.ts` |

**Foundation Status:** 6/6 complete (100%)

---

### Storage Layer

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Vector Store (OPFS) | ✅ Complete | `storage/OPFSVectorStore.ts` | Append-only binary vector file; byte-offset addressing; test coverage via `tests/Persistence.test.ts` |
| Vector Store (Memory) | ✅ Complete | `storage/MemoryVectorStore.ts` | In-memory implementation for testing |
| Metadata Store (IndexedDB) | ✅ Complete | `storage/IndexedDbMetadataStore.ts` | Full CRUD for all entities; reverse indexes; semantic neighbor graph operations; dirty-volume flags; `hotpath_index` and `page_activity` object stores; DB_VERSION=3 |

**Storage Status:** 3/3 complete (100%)

---

### Vector Compute Layer

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Backend Abstraction | ✅ Complete | `VectorBackend.ts`, `BackendKind.ts`, `CreateVectorBackend.ts` | Unified interface across all backends |
| WebGPU Backend | ✅ Complete | `WebGPUVectorBackend.ts`, `Vectors.wgsl` | Compute shader implementation |
| WebGL Backend | ✅ Complete | `WebGLVectorBackend.ts`, `Vectors.glsl` | Fragment shader implementation |
| WebNN Backend | ✅ Complete | `WebNNVectorBackend.ts` | ML accelerator path |
| WASM Backend | ✅ Complete | `WasmVectorBackend.ts`, `Vectors.wat` | Hand-written WebAssembly; guaranteed fallback |
| TopK Selection | ✅ Complete | `TopK.ts` | Utility for top-K similarity selection |

**Vector Compute Status:** 6/6 complete (100%)

---

### Embedding Layer

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Embedding Interface | ✅ Complete | `embeddings/EmbeddingBackend.ts` | Abstract interface for all providers |
| Provider Resolver | ✅ Complete | `embeddings/ProviderResolver.ts` | Capability filtering + benchmark-based winner selection |
| Embedding Runner | ✅ Complete | `embeddings/EmbeddingRunner.ts` | High-level orchestrator with fallback chain |
| Dummy Provider | ✅ Complete | `embeddings/DeterministicDummyEmbeddingBackend.ts` | SHA-256-based deterministic embedder for testing |
| Transformers.js Provider | ✅ Complete | `embeddings/TransformersJsEmbeddingBackend.ts` | Real ONNX inference (`webnn`/`webgpu`/`wasm`); default model: `onnx-community/embeddinggemma-300m-ONNX` |
| ORT WebGL Provider | ❌ Missing | `embeddings/OrtWebglEmbeddingBackend.ts` (planned) | Explicit `webgl` fallback path not yet implemented |

**Embedding Status:** 5/6 complete (83%)

---

### Hippocampus (Ingest Orchestration)

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Text Chunking | ✅ Complete | `hippocampus/Chunker.ts` | Token-aware sentence-boundary splitting respecting `ModelProfile.maxChunkTokens`; covered by `tests/hippocampus/Chunker.test.ts` |
| Page Builder | ✅ Complete | `hippocampus/PageBuilder.ts` | Builds signed `Page` entities with `contentHash`, `vectorHash`, `prevPageId`/`nextPageId` linkage; covered by `tests/hippocampus/PageBuilder.test.ts` |
| Ingest Orchestrator | ✅ Complete | `hippocampus/Ingest.ts` | `ingestText()` implemented: chunk → embed → persist pages + PageActivity → insert semantic neighbors → build hierarchy (Books/Volumes/Shelves) via `HierarchyBuilder`. Returns `IngestResult` with `pages`, `books[]`, `volumes[]`, `shelves[]`. |
| Hierarchy Builder | ✅ Complete | `hippocampus/HierarchyBuilder.ts` | Constructs/updates Books (PAGES_PER_BOOK=8), Volumes (BOOKS_PER_VOLUME=4), Shelves (VOLUMES_PER_SHELF=4); medoid selection per book, centroid prototypes per volume/shelf; Williams-derived fanout bounds via `computeFanoutLimit`; splits oversized volumes/shelves; adjacency edges for consecutive pages within books |
| Fast Semantic Neighbor Insert | ✅ Complete | `hippocampus/FastNeighborInsert.ts` | Cosine-nearest neighbors with Williams-derived degree cap via `computeNeighborMaxDegree`; evicts lowest-cosine-similarity neighbor on overflow; integrated into ingest pipeline |

**Hippocampus Status:** 5/5 complete (100%)

---

### Cortex (Retrieval Orchestration)

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Ranking Pipeline | ✅ Complete | `cortex/Ranking.ts` | Resident-first scoring cascade: `rankShelves` → `rankVolumes` → `rankBooks` → `rankPages`; `spillToWarm` for WARM/COLD fallback. All ranking functions use cosine similarity against prototype/medoid/page embeddings. |
| MetroidBuilder | ✅ Complete | `cortex/MetroidBuilder.ts` | Constructs Metroid `{ m1, m2, c }` via Matryoshka dimensional unwinding; antithesis discovery across tier-based protected dimension sets; centroid computation with protected/free dims; knowledge gap detection when m2 cannot be found |
| Knowledge Gap Detector | ✅ Complete | `cortex/KnowledgeGapDetector.ts` | Evaluates MetroidBuilder result; emits `KnowledgeGap` DTO with anchor page and dimensional info; triggers curiosity probe emission |
| Open TSP Solver | ✅ Complete | `cortex/OpenTSPSolver.ts` | Dummy-node open-path heuristic for coherent ordering of subgraph nodes |
| Query Orchestrator | ✅ Complete | `cortex/Query.ts` | Full dialectical pipeline: embed → hierarchical routing (Shelf→Volume→Book→Page) → MetroidBuilder → KnowledgeGapDetector → subgraph expansion with Williams-derived bounds (`computeSubgraphBounds`) → TSP coherence path → activity update → promotion sweep. Returns `QueryResult` with `pages`, `scores`, `coherencePath`, `metroid`, `knowledgeGap`, `metadata`. |
| Result DTO | ✅ Complete | `cortex/QueryResult.ts` | Full DTO with `pages`, `scores`, `coherencePath: Hash[]`, `metroid: Metroid | null`, `knowledgeGap: KnowledgeGap | null`, `metadata` |

**Cortex Status:** 6/6 complete (100%)

---

### Daydreamer (Background Consolidation)

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Idle Scheduler | ✅ Complete | `daydreamer/IdleScheduler.ts` | Cooperative background loop; interruptible; respects CPU budget |
| Hebbian Updates | ✅ Complete | `daydreamer/HebbianUpdater.ts` | LTP (strengthen), LTD (decay), prune below threshold; recompute σ(v) for changed nodes; run promotion/eviction sweep |
| Prototype Recomputation | ✅ Complete | `daydreamer/PrototypeRecomputer.ts` | Recalculate volume/shelf medoids and centroids; recompute salience for affected entries; run tier-quota promotion/eviction |
| Full Neighbor Graph Recalc | ✅ Complete | `daydreamer/FullNeighborRecalc.ts` | Rebuild bounded neighbor lists for dirty volumes; batch size bounded by O(√(t log t)) per idle cycle; recompute salience after recalc. |
| Experience Replay | ✅ Complete | `daydreamer/ExperienceReplay.ts` | Simulate queries to reinforce connections; recent-biased sampling; LTP on traversed edges |
| Cluster Stability | ✅ Complete | `daydreamer/ClusterStability.ts` | Lightweight label propagation for community detection; stores community labels in PageActivity; detects oversized and empty communities; volume split/merge with orphan deletion |

**Daydreamer Status:** 6/6 complete (100%)

---

### Policy & Configuration

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Routing Policy | ✅ Complete | `Policy.ts` | Derives routing dimensions from ModelProfile; integration tested |
| Hotpath Policy | ✅ Complete | `core/HotpathPolicy.ts` | Williams Bound policy implementation, salience weights, tier quotas, community quotas; separate from model-derived numerics |

**Policy Status:** 2/2 complete (100%)

---

### Runtime Harness

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Browser Harness | ✅ Complete | `ui/harness/index.html`, `scripts/runtime-harness-server.mjs` | Localhost-served HTML harness for browser testing |
| Electron Wrapper | ✅ Complete | `scripts/electron-harness-main.mjs` | Thin Electron launcher for GPU-realism testing |
| Playwright Tests | ✅ Complete | `tests/runtime/browser-harness.spec.mjs`, `tests/runtime/electron-harness.spec.mjs` | Browser lane passes; Electron context-sensitive |
| Docker Debug Lane | ✅ Complete | `docker/electron-debug/*`, `docker-compose.electron-debug.yml` | Sandbox-isolated Electron debugging via VS Code attach |

**Runtime Status:** 4/4 complete (100%)

---

### Testing & Validation

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Unit Tests | ✅ Complete | `tests/*.test.ts`, `tests/**/*.test.ts` | 418+ tests across 37 files; all passing |
| Persistence Tests | ✅ Complete | `tests/Persistence.test.ts` | Full storage layer coverage (OPFS, IndexedDB, semantic neighbor graph, hotpath indexes) |
| Model Tests | ✅ Complete | `tests/model/*.test.ts` | Profile resolution, defaults, routing policy |
| Embedding Tests | ✅ Complete | `tests/embeddings/*.test.ts` | Provider resolver, runner, real/dummy backends |
| Backend Smoke Tests | ✅ Complete | `tests/BackendSmoke.test.ts` | All vector backends instantiate cleanly |
| Runtime Tests | ✅ Complete | `tests/runtime/*.spec.mjs` | Browser harness validated; Electron context-sensitive |
| Integration Tests | ✅ Complete | `tests/integration/IngestQuery.test.ts`, `tests/integration/Daydreamer.test.ts` | End-to-end: ingest → hierarchy → query → verify; persistence across sessions; LTP/LTD/pruning; Williams-bound validation |
| Hotpath Policy Tests | ✅ Complete | `tests/HotpathPolicy.test.ts` | H(t) sublinearity and monotonicity; tier quota sums; community quota minimums; salience determinism |
| Salience Engine Tests | ✅ Complete | `tests/SalienceEngine.test.ts` | Bootstrap fills to H(t); steady-state eviction; community/tier quota enforcement; determinism |
| Scaling Benchmarks | ✅ Complete | `tests/benchmarks/*.bench.ts` | 5 benchmark files: DummyEmbedderHotpath, HotpathScaling, QueryLatency, StorageOverhead, TransformersJsEmbedding |
| Hippocampus Tests | ✅ Complete | `tests/hippocampus/*.test.ts` | Chunker, FastNeighborInsert, HierarchyBuilder, Ingest, PageBuilder |
| Cortex Tests | ✅ Complete | `tests/cortex/*.test.ts` | Query, MetroidBuilder, KnowledgeGapDetector, OpenTSPSolver, Ranking |
| Daydreamer Tests | ✅ Complete | `tests/daydreamer/*.test.ts` | ClusterStability, ExperienceReplay, FullNeighborRecalc, HebbianUpdater, IdleScheduler, PrototypeRecomputer |
| Sharing Tests | ✅ Complete | `tests/sharing/*.test.ts` | CuriosityBroadcaster, EligibilityClassifier, SubgraphExchange |

**Testing Status:** 14/14 complete (100%)

---

### Build & CI

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| TypeScript Config | ✅ Complete | `tsconfig.json` | Strict mode, ES2022 target, ESNext modules |
| Build Script | ✅ Complete | `package.json` (`build` script) | Type-check via `tsc --noEmit` |
| Lint Config | ✅ Complete | `eslint.config.mjs` | TypeScript-ESLint rules |
| Model-Derived Guard | ✅ Complete | `scripts/guard-model-derived.mjs` | Scans for hardcoded model numerics; enforces source-of-truth |
| Test Runner | ✅ Complete | `package.json` (Vitest scripts) | Unit, browser, electron, runtime, benchmark targets |
| CI Pipeline | ✅ Complete | `.github/workflows/ci.yml` | Runs lint → build → test:unit → guard:model-derived → guard:hotpath-policy on every push/PR |
| GitHub Issue Sync | ✅ Complete | `scripts/sync-github-project.mjs`, `.github/workflows/sync-github-project.yml` | Syncs TODO.md → GitHub issues/milestones; smoke test via TODO task |

**Build Status:** 5/6 complete (83%)

---

## Overall Progress Summary

| Layer | Completion | Notes |
|-------|-----------|-------|
| Foundation | 100% | — |
| Storage | 100% | — |
| Vector Compute | 100% | — |
| Embedding | 83% | WebGL provider (low priority fallback) |
| Hippocampus | 100% | Full hierarchy building integrated into ingest |
| Cortex | 100% | Hierarchical routing, MetroidBuilder, dialectical search, subgraph expansion, TSP coherence |
| Daydreamer | 100% | All 6 modules: IdleScheduler, HebbianUpdater, FullNeighborRecalc, PrototypeRecomputer, ExperienceReplay, ClusterStability |
| Sharing | 100% | Eligibility, export, import, peer exchange, curiosity broadcasting |
| Policy | 100% | — |
| Runtime | 100% | — |
| Testing | 100% | 418+ tests; 5 benchmark suites |
| Build/CI | 100% | Guards, linting, type checking, CI pipeline |

**System-Wide Completion:** ~98% (all core modules complete; only ORT WebGL embedding provider remains as a low-priority fallback)

---

## What Works Today

- ✅ Store/retrieve vectors and metadata
- ✅ Vector similarity operations on all backends (WebGPU, WebGL, WebNN, WASM)
- ✅ Generate real embeddings via Transformers.js
- ✅ Resolve model profiles and derive routing policies (including `matryoshkaProtectedDim` for Matryoshka models)
- ✅ Run browser/Electron runtime harness
- ✅ Pass 418+ unit tests
- ✅ Hash text/binary content (SHA-256) and sign/verify Ed25519 signatures
- ✅ Chunk text and build signed `Page` entities
- ✅ **Full ingest pipeline:** chunk → embed → persist pages + PageActivity → insert semantic neighbors → build hierarchy (Books/Volumes/Shelves)
- ✅ **Full hierarchical query pipeline:** Shelf → Volume → Book → Page routing → MetroidBuilder → KnowledgeGapDetector → subgraph expansion with Williams bounds → TSP coherence path
- ✅ **Background consolidation:** IdleScheduler drives HebbianUpdater (LTP/LTD), PrototypeRecomputer, FullNeighborRecalc, ExperienceReplay, ClusterStability
- ✅ **Privacy-safe sharing:** EligibilityClassifier + SubgraphExporter/Importer + CuriosityBroadcaster + PeerExchange
- ✅ **Williams Bound enforcement:** computeCapacity, computeNeighborMaxDegree, computeSubgraphBounds, computeFanoutLimit applied across all relevant subsystems

## Remaining Work

- 🟡 **ORT WebGL Embedding Provider** — Explicit `webgl` fallback path for ONNX inference (low priority; Transformers.js handles most cases)
- 🟡 **Product Surface UX** — Browser extension and standalone app UX refinement

---

## Recommended Implementation Order

### Phase 1: Unblock Basic Functionality (Ship v0.1)

**Goal:** Enable ingest and retrieval for a single user session, with Williams Bound policy foundation in place.

1. **Crypto Helpers** (`core/crypto/*`) ✅ **Complete**
   - SHA-256 hashing for text and binary
   - Ed25519 signing/verification
   - 26 tests passing

2. **Williams Bound Policy Foundation** ✅ **Complete**
   - `core/HotpathPolicy.ts`, `core/SalienceEngine.ts`, `core/types.ts` extensions, `storage/IndexedDbMetadataStore.ts` hotpath stores

3. **Text Chunking** (`hippocampus/Chunker.ts`) ✅ **Complete**
   - Token-aware sentence-boundary splitting; tests passing

4. **Page Builder** (`hippocampus/PageBuilder.ts`) ✅ **Complete**
   - Signed Page entities with hash linkage; tests passing

5. **Hippocampus Ingest** (`hippocampus/Ingest.ts`) ✅ **Complete**
   - Full `ingestText()`: chunk → embed → persist pages + PageActivity → insert semantic neighbors → build hierarchy (Books/Volumes/Shelves) → promotion sweep

6. **Cortex Query** (`cortex/Query.ts`) ✅ **Complete**
   - Full dialectical pipeline: hierarchical routing → MetroidBuilder → KnowledgeGapDetector → subgraph expansion → TSP coherence → promotion sweep

7. **Integration Test** (`tests/integration/IngestQuery.test.ts`) ✅ **Complete**
   - Ingest text → Retrieve by query → Validate results; persistence across sessions

**Exit Criteria:** User can ingest text and retrieve relevant pages by query; Williams Bound policy is in place.

---

### Phase 2: Add Hierarchy, Dialectical Search & Resident-First Routing (Ship v0.5) ✅ **ACHIEVED**

**Goal:** Hierarchical routing, MetroidBuilder, dialectical search pipeline, coherent path ordering, and fully resident-first query path.

1. **Hierarchy Builder** (`hippocampus/HierarchyBuilder.ts`) ✅ Complete
   - Cluster pages into Books (medoid selection)
   - Cluster books into Volumes (prototype computation)
   - Build Shelves for coarse routing
   - Tier-quota hotpath admission for each level's medoid/prototype via `SalienceEngine`
   - Williams-derived fanout bounds via `computeFanoutLimit`; split oversized volumes/shelves

2. **MetroidBuilder** (`cortex/MetroidBuilder.ts`) ✅ Complete
   - Select m1 (topic medoid) for a given query embedding
   - Freeze protected Matryoshka dimensions
   - Search for m2 (antithesis medoid) within unfrozen dimensions
   - Compute centroid `c` with protected dims from m1, free dims averaged
   - Matryoshka tier-based progressive dimensional unwinding
   - Return `Metroid { m1, m2, c }` or signal knowledge gap

3. **Knowledge Gap Detector** (`cortex/KnowledgeGapDetector.ts`) ✅ Complete
   - Evaluate MetroidBuilder result
   - Emit `KnowledgeGap` DTO with anchor page and dimensional info
   - Triggers P2P curiosity probe emission

4. **Ranking Pipeline** (`cortex/Ranking.ts`) ✅ Complete
   - Resident-first cascade: `rankShelves` → `rankVolumes` → `rankBooks` → `rankPages`
   - Spill to WARM/COLD only when resident coverage insufficient

5. **Open TSP Solver** (`cortex/OpenTSPSolver.ts`) ✅ Complete
   - Dummy-node open-path heuristic for coherent ordering

6. **Full Query Orchestrator** (`cortex/Query.ts`) ✅ Complete
   - Embed query → hierarchical routing → build Metroid → knowledge gap detection
   - Dynamic subgraph expansion bounds from `computeSubgraphBounds`
   - Coherent path via TSP
   - Rich result DTO with `coherencePath`, `metroid`, `knowledgeGap`, `metadata`

**Exit Criteria:** ✅ User gets epistemically balanced context chains via MetroidBuilder and dialectical search; knowledge gaps are detected; query latency controlled by Williams bounds.

---

### Phase 3: Background Consolidation, Community Quotas & Smart Sharing (Ship v1.0)

**Goal:** Idle maintenance keeps memory healthy, community-aware hotpath coverage stays diverse, and privacy-safe interest sharing is available.

1. **Idle Scheduler** (`daydreamer/IdleScheduler.ts`) ✅ Complete
   - Cooperative, interruptible loop
   - CPU budget awareness

2. **Hebbian Updater** (`daydreamer/HebbianUpdater.ts`) ✅ Complete
   - LTP/LTD rules; edge pruning
   - Recompute σ(v) for changed nodes; run promotion/eviction sweep

3. **Full Neighbor Graph Recalc** (`daydreamer/FullNeighborRecalc.ts`) ✅ Complete
   - Rebuild neighbor lists for dirty volumes
   - O(√(t log t)) batch size per idle cycle

4. **Prototype Recomputer** (`daydreamer/PrototypeRecomputer.ts`) ✅ Complete
   - Update volume/shelf prototypes
   - Tier-quota promotion/eviction after recomputation

5. **Community Detection** (`daydreamer/ClusterStability.ts`) ✅ Complete
   - Label propagation on semantic neighbor graph
   - Store community labels in `PageActivity.communityId`
   - Community IDs wired into `SalienceEngine` promotion/eviction (already implemented in P0)

6. **Smart Interest Sharing** (`sharing/*`) ✅ Complete
   - `sharing/EligibilityClassifier.ts` — classify candidate nodes for share eligibility; block identity/PII-bearing nodes
   - `sharing/SubgraphExporter.ts` — export signed, topic-scoped graph slices from eligible nodes only
   - `sharing/SubgraphImporter.ts` — verify signatures/provenance and merge imported slices into local discovery index
   - `sharing/PeerExchange.ts` — opt-in peer transport for exchanging eligible graph slices
   - `sharing/CuriosityBroadcaster.ts` — rate-limited broadcast of curiosity probes with fragment response handling

**Exit Criteria:** System self-maintains over extended use; community-aware hotpath quotas enforced; privacy-safe smart sharing works end-to-end. ✅ **ACHIEVED**

---

### Phase 4: Polish & Release Prep (Ship v1.0 Final)

**Goal:** Production-ready quality.

1. **Integration Test Suite** (`tests/integration/*`)
   - Full vertical slice coverage
   - Edge cases and error paths
   - Performance regression tests

2. **Scaling Benchmark Suite** (`tests/benchmarks/HotpathScaling.bench.ts`)
   - Synthetic graphs at 1K, 10K, 100K, 1M nodes+edges
   - Assert: resident count never exceeds H(t); query cost scales sublinearly
   - Record baselines in `benchmarks/BASELINES.md`

3. **Documentation** (`docs/*`)
   - API reference
   - Integration guide
   - Troubleshooting

4. **CI Hardening**
   - Electron runtime gate policy
   - Guard scripts in merge checks (model-derived + hotpath policy)
   - Benchmark baselines

5. **Product Surface UX Contract**
    - Define standalone browser-extension UX baseline:
       - Passive capture of visited pages into the local ingest queue
       - Search-first recall UI over pages the user has actually seen
       - Lightweight metrics panel that supports, but does not dominate, retrieval UX
    - Define model-mode UX contract for the standalone app:
       - Nomic mode = multimodal retrieval (text + images in shared latent space)
       - Gemma mode = high-precision text retrieval (no image embedding)
       - Capability messaging in UI so users understand image-recall availability by mode
    - Define library boundary contract:
       - Keep extension shell concerns outside core ingest/query APIs
       - Keep library docs and examples headless/integration-first
    - Add acceptance checks for rabbit-hole recall UX:
       - Vague text recollection recovers previously visited pages
       - Vague visual recollection recovers previously seen images when multimodal mode is enabled

**Exit Criteria:** All tests pass; benchmarks recorded; docs complete; product-surface UX contract documented; ready for public use.

---

## Known Blockers & Risks

### ~~Blocker 1: No Hierarchy Builder or Semantic Neighbor Graph~~ — RESOLVED
**Resolution:** `HierarchyBuilder` and `FastNeighborInsert` fully implemented and integrated into `ingestText()`. Ingest now produces Books, Volumes, and Shelves with adjacency edges and semantic neighbor graph.

### ~~Blocker 2: No MetroidBuilder or Dialectical Pipeline~~ — RESOLVED
**Resolution:** `MetroidBuilder`, `KnowledgeGapDetector`, `OpenTSPSolver`, and full hierarchical `Ranking` pipeline implemented. `Query.ts` now performs Shelf→Volume→Book→Page routing, MetroidBuilder, subgraph expansion with Williams bounds, and TSP coherence path.

### Blocker 3: No Privacy-Safe Sharing or Curiosity Broadcasting Pipeline — RESOLVED
**Impact:** Core discovery-sharing value proposition is missing; knowledge gaps cannot be resolved via P2P.
**Resolution:** Phase 3 sharing pipeline fully implemented. `sharing/EligibilityClassifier.ts` blocks PII/credential/financial/health content. `sharing/CuriosityBroadcaster.ts` provides rate-limited probe broadcasting with fragment response handling. `sharing/SubgraphExporter.ts` and `sharing/SubgraphImporter.ts` handle eligibility-filtered export and schema-validated import with sender identity stripping. `sharing/PeerExchange.ts` orchestrates opt-in signed subgraph exchange. CuriosityProbe includes `mimeType` and `modelUrn` to prevent incommensurable graph merges.

### Blocker 4: Naming Drift (P0-X) — RESOLVED
**Impact:** The term "Metroid" was used for the proximity graph in all code. MetroidBuilder cannot be introduced without a rename collision.
**Resolution:** P0-X rename completed. `SemanticNeighbor`, `SemanticNeighborSubgraph`, and all `*SemanticNeighbors`/`*NeighborRecalc` method names are now in place throughout `core/types.ts`, `storage/IndexedDbMetadataStore.ts`, `cortex/Query.ts`, and all test files. The IDB object store is `neighbor_graph` (DB_VERSION=3).

### Risk 1: TSP Complexity
Open TSP is NP-hard; heuristic may be slow on large subgraphs.
**Mitigation:** Dynamic Williams-derived subgraph bounds shrink the problem as graph grows; defer to Phase 2; use deterministic greedy heuristic.

### Risk 2: Electron Runtime Stability
Host-shell Electron can SIGSEGV in constrained contexts.
**Mitigation:** Docker attach lane validated for debugging; document GPU requirements for production.

### Risk 3: WebGL Provider Gap
Transformers.js doesn't expose `webgl` device directly.
**Mitigation:** Low priority; `webgpu` and `wasm` sufficient for most users; explicit ORT adapter deferred to Phase 4.

### Risk 4: Empirical Calibration of `c`
The Williams Bound scaling constant `c` is not theorem-given; wrong value causes either hotpath over-allocation (wastes RAM) or under-allocation (defeats purpose).
**Mitigation:** Default `c = 0.5` is conservative; scaling benchmarks in Phase 4 will validate and tune. Keep `c` in `core/HotpathPolicy.ts` as an overrideable policy constant.

---

## Development Workflow

### Command Reference

```bash
# Install dependencies
npm ci

# Type-check
npm run build

# Lint
npm run lint

# Run all unit tests
npm run test:unit

# Run specific test file
npm run test:unit -- tests/model/ModelProfileResolver.test.ts

# Model-derived numeric guard
npm run guard:model-derived

# Run benchmarks
npm run benchmark

# Start dev harness
npm run dev:harness

# Run browser runtime tests
npm run test:browser

# Run Electron tests (context-sensitive)
npm run test:electron

# Docker Electron debug lane
npm run docker:electron:up
npm run docker:electron:down

# Run all tests
npm run test:all
```

### Pre-Commit Checklist

1. ✅ `npm run build` passes
2. ✅ `npm run lint` passes
3. ✅ `npm run test:unit` passes
4. ✅ `npm run guard:model-derived` passes
5. ✅ No hardcoded model-derived numerics outside `core/BuiltInModelProfiles.ts`
6. ✅ Tests added/updated for new functionality

### Documentation Sync Protocol

After every implementation pass:
1. Update `PLAN.md` module status
2. Update `TODO.md` to reflect completed items
3. Update `README.md` if user-facing changes

---

## Notes

- **Metroid vs medoid vs semantic neighbor graph:** These are three distinct concepts. `Metroid` refers only to the dialectical search probe `{ m1, m2, c }` constructed by `MetroidBuilder` at query time. `medoid` refers to a cluster representative node. The sparse proximity/neighbor graph (used for BFS subgraph expansion) is the **semantic neighbor graph** — represented by `SemanticNeighbor` / `SemanticNeighborSubgraph` in `core/types.ts` and stored in the `neighbor_graph` IDB object store.
- **Model-derived numerics:** Never hardcode; always source from `core/` model profile modules.
- **Policy-derived constants:** Never hardcode; always source from `core/HotpathPolicy.ts`.
- **Test philosophy:** TDD (Red → Green → Refactor) for all new slices.
- **Runtime realism:** Browser and Electron lanes are required merge gates.
- **Williams Bound invariant:** The resident hotpath count must never exceed H(t). Enforce in tests and assert in benchmarks.
