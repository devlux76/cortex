# CORTEX Implementation Plan

**Version:** 1.1
**Last Updated:** 2026-03-13

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
| Metadata Store (IndexedDB) | ✅ Complete | `storage/IndexedDbMetadataStore.ts` | Full CRUD for all entities; reverse indexes; Metroid neighbor operations; dirty-volume flags; includes `hotpath_index` and `page_activity` object stores; hotpath CRUD methods are implemented and covered by `tests/Persistence.test.ts` |

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
| Text Chunking | ❌ Missing | `hippocampus/Chunker.ts` (planned) | Token-aware page boundary detection respecting ModelProfile limits |
| Page ID Generation | ❌ Missing | `hippocampus/PageIdGenerator.ts` (planned) | Deterministic hash-based ID creation |
| Ingest Orchestrator | ❌ Missing | `hippocampus/Ingest.ts` (planned) | Main entry point: chunk → embed → persist → initialise PageActivity → build hierarchy → fast neighbor insert → hotpath admission |
| Hierarchy Builder | ❌ Missing | `hippocampus/HierarchyBuilder.ts` (planned) | Construct/update Books, Volumes, Shelves; attempt tier-quota hotpath admission for each level's medoid/prototype; Williams-derived fanout bounds; trigger split via ClusterStability when bounds exceeded |
| Fast Neighbor Insert | ❌ Missing | `hippocampus/FastMetroidInsert.ts` (planned) | Incremental Metroid neighbor update; max degree derived from HotpathPolicy (not hardcoded K); evict lowest-weight neighbor on degree overflow; check new page for hotpath admission |

**Hippocampus Status:** 0/5 complete (0%)

**Critical Blocker:** Without this, users cannot ingest text into the memory system.

---

### Cortex (Retrieval Orchestration)

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Ranking Pipeline | ❌ Missing | `cortex/Ranking.ts` (planned) | Resident-first scoring cascade: HOT shelves → HOT volumes → HOT books → HOT pages; spill to WARM/COLD only when coverage insufficient |
| Seed Selection | ❌ Missing | `cortex/SeedSelection.ts` (planned) | Threshold-based top-k page selection from ranking output |
| Subgraph Expansion | 🟡 Partial | `storage/IndexedDbMetadataStore.ts` (`getInducedMetroidSubgraph`) | BFS expansion implemented in storage layer; needs dynamic Williams bounds; needs orchestration wrapper |
| Open TSP Solver | ❌ Missing | `cortex/OpenTSPSolver.ts` (planned) | Dummy-node open-path heuristic for coherent ordering |
| Query Orchestrator | ❌ Missing | `cortex/Query.ts` (planned) | Main entry point: embed → resident-first ranking → subgraph expansion with dynamic bounds → TSP path → query cost meter → early-stop; return result |
| Result DTO | ❌ Missing | `cortex/QueryResult.ts` (planned) | Structured query result with provenance metadata (coherence path, subgraph size, hop count, edge weights) |

**Cortex Status:** 0.5/6 complete (8%)

**Critical Blocker:** Without this, users cannot retrieve memories from the system.

---

### Daydreamer (Background Consolidation)

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Idle Scheduler | ❌ Missing | `daydreamer/IdleScheduler.ts` (planned) | Cooperative background loop; interruptible; respects CPU budget |
| Hebbian Updates | ❌ Missing | `daydreamer/HebbianUpdater.ts` (planned) | LTP (strengthen), LTD (decay), prune below threshold; recompute σ(v) for changed nodes; run promotion/eviction sweep |
| Prototype Recomputation | ❌ Missing | `daydreamer/PrototypeRecomputer.ts` (planned) | Recalculate volume/shelf medoids and centroids; recompute salience for affected entries; run tier-quota promotion/eviction |
| Full Metroid Recalc | ❌ Missing | `daydreamer/FullMetroidRecalc.ts` (planned) | Rebuild bounded neighbor lists for dirty volumes; batch size bounded by O(√(t log t)) per idle cycle; recompute salience after recalc |
| Experience Replay | ❌ Missing | `daydreamer/ExperienceReplay.ts` (planned) | Simulate queries to reinforce connections |
| Cluster Stability | ❌ Missing | `daydreamer/ClusterStability.ts` (planned) | Detect/trigger split/merge for unstable clusters; run lightweight label propagation for community detection; store community labels in PageActivity |

**Daydreamer Status:** 0/6 complete (0%)

**Note:** Not a v1 blocker — system can ship without background consolidation (manual recalc only). Community detection is required before graph-community quota enforcement is active.

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
| Browser Harness | ✅ Complete | `runtime/harness/index.html`, `scripts/runtime-harness-server.mjs` | Localhost-served HTML harness for browser testing |
| Electron Wrapper | ✅ Complete | `scripts/electron-harness-main.mjs` | Thin Electron launcher for GPU-realism testing |
| Playwright Tests | ✅ Complete | `tests/runtime/browser-harness.spec.mjs`, `tests/runtime/electron-harness.spec.mjs` | Browser lane passes; Electron context-sensitive |
| Docker Debug Lane | ✅ Complete | `docker/electron-debug/*`, `docker-compose.electron-debug.yml` | Sandbox-isolated Electron debugging via VS Code attach |

**Runtime Status:** 4/4 complete (100%)

---

### Testing & Validation

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Unit Tests | ✅ Complete | `tests/*.test.ts`, `tests/**/*.test.ts` | 115 tests across 13 files; all passing |
| Persistence Tests | ✅ Complete | `tests/Persistence.test.ts` | Full storage layer coverage (OPFS, IndexedDB, Metroid neighbors, hotpath indexes) |
| Model Tests | ✅ Complete | `tests/model/*.test.ts` | Profile resolution, defaults, routing policy |
| Embedding Tests | ✅ Complete | `tests/embeddings/*.test.ts` | Provider resolver, runner, real/dummy backends |
| Backend Smoke Tests | ✅ Complete | `tests/BackendSmoke.test.ts` | All vector backends instantiate cleanly |
| Runtime Tests | ✅ Complete | `tests/runtime/*.spec.mjs` | Browser harness validated; Electron context-sensitive |
| Integration Tests | ❌ Missing | `tests/integration/*.test.ts` (planned) | End-to-end: ingest → persist → query → coherent result |
| Hotpath Policy Tests | ✅ Complete | `tests/HotpathPolicy.test.ts` | H(t) sublinearity and monotonicity; tier quota sums; community quota minimums; salience determinism |
| Salience Engine Tests | ✅ Complete | `tests/SalienceEngine.test.ts` | Bootstrap fills to H(t); steady-state eviction; community/tier quota enforcement; determinism |
| Scaling Benchmarks | ❌ Missing | `tests/benchmarks/HotpathScaling.bench.ts` (planned) | Synthetic graphs at 1K/10K/100K/1M; assert resident count ≤ H(t); query cost sublinear |
| Benchmarks | 🟡 Partial | `tests/benchmarks/DummyEmbedderHotpath.bench.ts` | Baseline dummy embedder benchmark; real-provider and hotpath scaling benchmarks needed |

**Testing Status:** 8/12 complete (67%)

---

### Build & CI

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| TypeScript Config | ✅ Complete | `tsconfig.json` | Strict mode, ES2022 target, ESNext modules |
| Build Script | ✅ Complete | `package.json` (`build` script) | Type-check via `tsc --noEmit` |
| Lint Config | ✅ Complete | `eslint.config.mjs` | TypeScript-ESLint rules |
| Model-Derived Guard | ✅ Complete | `scripts/guard-model-derived.mjs` | Scans for hardcoded model numerics; enforces source-of-truth |
| Test Runner | ✅ Complete | `package.json` (Vitest scripts) | Unit, browser, electron, runtime, benchmark targets |
| CI Pipeline | 🟡 Partial | `.github/workflows/*` (if exists) | Needs verification; not examined in detail |
| GitHub Issue Sync | ✅ Complete | `scripts/sync-github-project.mjs`, `.github/workflows/sync-github-project.yml` | Syncs TODO.md → GitHub issues/milestones; smoke test via TODO task |

**Build Status:** 5/6 complete (83%)

---

## Overall Progress Summary

| Layer | Completion | Critical Gap |
|-------|-----------|--------------|
| Foundation | 100% | — |
| Storage | 100% | — |
| Vector Compute | 100% | — |
| Embedding | 83% | WebGL provider (low priority) |
| Hippocampus | 0% | **CRITICAL** — No ingest path |
| Cortex | 8% | **CRITICAL** — No retrieval path |
| Daydreamer | 0% | Not v1 blocker |
| Policy | 100% | — |
| Runtime | 100% | — |
| Testing | 67% | Integration tests, scaling benchmarks |
| Build/CI | 83% | — |

**System-Wide Completion:** ~70% (core infrastructure and policy foundation complete; ingest/query/benchmarks remain.)

---

## What Works Today

- ✅ Store/retrieve vectors and metadata
- ✅ Vector similarity operations on all backends
- ✅ Generate real embeddings via Transformers.js
- ✅ Resolve model profiles and derive routing policies
- ✅ Run browser/Electron runtime harness
- ✅ Pass 115 unit tests
- ✅ Hash text/binary content (SHA-256) and sign/verify Ed25519 signatures

## What Doesn't Work Today

- ❌ **Cannot ingest text** — No chunking or hierarchy builder
- ❌ **Cannot query memories** — No ranking pipeline or TSP solver
- ❌ **Cannot consolidate** — No Daydreamer loop
- ❌ **Cannot share discovery updates safely** — No privacy-filtered interest-subgraph exchange path

---

## Recommended Implementation Order

### Phase 1: Unblock Basic Functionality (Ship v0.1)

**Goal:** Enable ingest and retrieval for a single user session, with Williams Bound policy foundation in place.

1. **Crypto Helpers** (`core/crypto/*`) ✅ **Complete**
   - SHA-256 hashing for text and binary
   - Ed25519 signing/verification
   - 26 tests passing

2. **Williams Bound Policy Foundation**
   - `core/HotpathPolicy.ts` — `computeCapacity`, `computeSalience`, `deriveTierQuotas`, `deriveCommunityQuotas`; all constants as frozen default policy object
   - `core/SalienceEngine.ts` — `computeNodeSalience`, `batchComputeSalience`, `shouldPromote`, `selectEvictionTarget`; bootstrap and steady-state lifecycle
   - Extend `core/types.ts` — `PageActivity`, `HotpathEntry`, `TierQuotas`, `MetadataStore` hotpath method signatures
   - Extend `storage/IndexedDbMetadataStore.ts` — `hotpath_index` and `page_activity` object stores; implement new `MetadataStore` hotpath methods
   - Tests: `tests/HotpathPolicy.test.ts`, `tests/SalienceEngine.test.ts`, extend `tests/Persistence.test.ts`

3. **Text Chunking** (`hippocampus/Chunker.ts`)
   - Token-aware splitting respecting ModelProfile limits
   - Preserve sentence boundaries where possible
   - Test with various text lengths

4. **Hippocampus Ingest** (`hippocampus/Ingest.ts`)
   - Chunk → Embed → Persist orchestration
   - Build Page entities with proper hashing/signing; initialise `PageActivity` record
   - Single-Book hierarchy (defer Volume/Shelf)
   - Basic Metroid neighbor insertion with Williams-bounded degree

5. **Cortex Query** (`cortex/Query.ts`)
   - Embed query
   - Flat page ranking against resident hotpath (skip full hierarchy for now)
   - Return top-K pages by similarity
   - Skip TSP coherence path (just ranked list)

6. **Integration Test** (`tests/integration/IngestQuery.test.ts`)
   - Ingest text → Retrieve by query → Validate results
   - Persistence across sessions

**Exit Criteria:** User can ingest text and retrieve relevant pages by query; Williams Bound policy is in place.

---

### Phase 2: Add Hierarchy, Coherence & Resident-First Routing (Ship v0.5)

**Goal:** Hierarchical routing, coherent path ordering, and fully resident-first query path.

1. **Hierarchy Builder** (`hippocampus/HierarchyBuilder.ts`)
   - Cluster pages into Books (medoid selection)
   - Cluster books into Volumes (prototype computation)
   - Build Shelves for coarse routing
   - Attempt tier-quota hotpath admission for each level's medoid/prototype via `SalienceEngine`
   - Williams-derived fanout bounds; trigger split via `ClusterStability` when exceeded

2. **Ranking Pipeline** (`cortex/Ranking.ts`)
   - Resident-first cascade: HOT shelves → HOT volumes → HOT books → HOT pages
   - Spill to WARM/COLD only when resident coverage insufficient

3. **Open TSP Solver** (`cortex/OpenTSPSolver.ts`)
   - Dummy-node open-path heuristic
   - Test on synthetic graphs

4. **Full Query Orchestrator** (`cortex/Query.ts` — upgrade)
   - Resident-first hierarchical ranking
   - Dynamic subgraph expansion bounds from `HotpathPolicy`
   - Query cost meter; early-stop on budget exceeded
   - Coherent path via TSP
   - Rich result DTO with provenance

**Exit Criteria:** User gets coherent ordered context chains through the resident hotpath; query latency controlled by H(t).

---

### Phase 3: Background Consolidation, Community Quotas & Smart Sharing (Ship v1.0)

**Goal:** Idle maintenance keeps memory healthy, community-aware hotpath coverage stays diverse, and privacy-safe interest sharing is available.

1. **Idle Scheduler** (`daydreamer/IdleScheduler.ts`)
   - Cooperative, interruptible loop
   - CPU budget awareness

2. **Hebbian Updater** (`daydreamer/HebbianUpdater.ts`)
   - LTP/LTD rules; edge pruning
   - Recompute σ(v) for changed nodes; run promotion/eviction sweep

3. **Full Metroid Recalc** (`daydreamer/FullMetroidRecalc.ts`)
   - Rebuild neighbor lists for dirty volumes
   - O(√(t log t)) batch size per idle cycle

4. **Prototype Recomputer** (`daydreamer/PrototypeRecomputer.ts`)
   - Update volume/shelf prototypes
   - Tier-quota promotion/eviction after recomputation

5. **Community Detection** (`daydreamer/ClusterStability.ts` — extend)
   - Label propagation on Metroid neighbor graph
   - Store community labels in `PageActivity.communityId`
   - Wire community IDs into `SalienceEngine` promotion/eviction

6. **Smart Interest Sharing** (`sharing/*` planned)
   - `sharing/EligibilityClassifier.ts` — classify candidate nodes for share eligibility; block identity/PII-bearing nodes
   - `sharing/SubgraphExporter.ts` — export signed, topic-scoped graph slices from eligible nodes only
   - `sharing/SubgraphImporter.ts` — verify signatures/provenance and merge imported slices into local discovery index
   - `sharing/PeerExchange.ts` — opt-in peer transport for exchanging eligible graph slices

**Exit Criteria:** System self-maintains over extended use; community-aware hotpath quotas enforced; privacy-safe smart sharing works end-to-end.

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

### Blocker 1: No Ingest Orchestration
**Impact:** Cannot use the system at all.
**Mitigation:** Phase 1 priority; single-book hierarchy sufficient for v0.1.

### Blocker 2: No Query Orchestration
**Impact:** Cannot retrieve memories.
**Mitigation:** Phase 1 priority; flat ranking against resident hotpath acceptable for v0.1.

### Blocker 3: No HotpathPolicy or SalienceEngine
**Impact:** Cannot enforce Williams Bound invariants; all subsequent phases depend on these.
**Mitigation:** Phase 1 priority; implement before ingest/query orchestration.

### Blocker 4: No Privacy-Safe Sharing Pipeline
**Impact:** Core discovery-sharing value proposition is missing.
**Mitigation:** Phase 3 required track; implement eligibility classifier + signed subgraph exchange as v1 scope.

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

- **Metroid vs medoid:** Use `Metroid` in all API surfaces and docs; `medoid` only in algorithmic comments.
- **Model-derived numerics:** Never hardcode; always source from `core/` model profile modules.
- **Policy-derived constants:** Never hardcode; always source from `core/HotpathPolicy.ts`.
- **Test philosophy:** TDD (Red → Green → Refactor) for all new slices.
- **Runtime realism:** Browser and Electron lanes are required merge gates.
- **Williams Bound invariant:** The resident hotpath count must never exceed H(t). Enforce in tests and assert in benchmarks.
