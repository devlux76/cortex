# CORTEX Implementation Plan

**Version:** 1.0
**Last Updated:** 2026-03-12

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
| Core Types | ✅ Complete | `core/types.ts` | All entity interfaces defined (Page, Book, Volume, Shelf, Edge, MetroidNeighbor, storage interfaces) |
| Model Profiles | ✅ Complete | `core/ModelProfile.ts`, `core/ModelDefaults.ts`, `core/ModelProfileResolver.ts`, `core/BuiltInModelProfiles.ts` | Source-of-truth for model-derived numerics; guard script enforces compliance |
| Numeric Constants | ✅ Complete | `core/NumericConstants.ts` | Runtime constants (byte sizes, workgroup limits) centralized |
| Crypto Helpers | ❌ Missing | `core/crypto/*` (planned) | Hash, sign, verify utilities not yet implemented |

**Foundation Status:** 3/4 complete (75%)

---

### Storage Layer

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Vector Store (OPFS) | ✅ Complete | `storage/OPFSVectorStore.ts` | Append-only binary vector file; byte-offset addressing; test coverage via `tests/Persistence.test.ts` |
| Vector Store (Memory) | ✅ Complete | `storage/MemoryVectorStore.ts` | In-memory implementation for testing |
| Metadata Store (IndexedDB) | ✅ Complete | `storage/IndexedDbMetadataStore.ts` | Full CRUD for all entities; reverse indexes; Metroid neighbor operations; dirty-volume flags; test coverage via `tests/Persistence.test.ts` |

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
| Ingest Orchestrator | ❌ Missing | `hippocampus/Ingest.ts` (planned) | Main entry point: chunk → embed → persist → build hierarchy → fast neighbor insert |
| Hierarchy Builder | ❌ Missing | `hippocampus/HierarchyBuilder.ts` (planned) | Construct/update Books, Volumes, Shelves from new Pages |
| Fast Neighbor Insert | ❌ Missing | `hippocampus/FastMetroidInsert.ts` (planned) | Incremental Metroid neighbor update (avoid full recalc) |

**Hippocampus Status:** 0/5 complete (0%)

**Critical Blocker:** Without this, users cannot ingest text into the memory system.

---

### Cortex (Retrieval Orchestration)

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Ranking Pipeline | ❌ Missing | `cortex/Ranking.ts` (planned) | Shelf → Volume → Book → Page hierarchical scoring |
| Seed Selection | ❌ Missing | `cortex/SeedSelection.ts` (planned) | Threshold-based top-k page selection |
| Subgraph Expansion | 🟡 Partial | `storage/IndexedDbMetadataStore.ts` (`getInducedMetroidSubgraph`) | BFS expansion implemented in storage layer; needs orchestration wrapper |
| Open TSP Solver | ❌ Missing | `cortex/OpenTSPSolver.ts` (planned) | Dummy-node open-path heuristic for coherent ordering |
| Query Orchestrator | ❌ Missing | `cortex/Query.ts` (planned) | Main entry point: embed query → rank → expand → solve path → return result |
| Result DTO | ❌ Missing | `cortex/QueryResult.ts` (planned) | Structured query result with provenance metadata |

**Cortex Status:** 0.5/6 complete (8%)

**Critical Blocker:** Without this, users cannot retrieve memories from the system.

---

### Daydreamer (Background Consolidation)

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Idle Scheduler | ❌ Missing | `daydreamer/IdleScheduler.ts` (planned) | Cooperative background loop; interruptible; respects CPU budget |
| Hebbian Updates | ❌ Missing | `daydreamer/HebbianUpdater.ts` (planned) | LTP (strengthen), LTD (decay), prune below threshold |
| Prototype Recomputation | ❌ Missing | `daydreamer/PrototypeRecomputer.ts` (planned) | Recalculate volume/shelf medoids and centroids |
| Full Metroid Recalc | ❌ Missing | `daydreamer/FullMetroidRecalc.ts` (planned) | Rebuild bounded neighbor lists for dirty volumes |
| Experience Replay | ❌ Missing | `daydreamer/ExperienceReplay.ts` (planned) | Simulate queries to reinforce connections |
| Cluster Stability | ❌ Missing | `daydreamer/ClusterStability.ts` (planned) | Detect/trigger split/merge for unstable clusters |

**Daydreamer Status:** 0/6 complete (0%)

**Note:** Not a v1 blocker — system can ship without background consolidation (manual recalc only).

---

### Policy & Configuration

| Module | Status | Files | Notes |
|--------|--------|-------|-------|
| Routing Policy | ✅ Complete | `Policy.ts` | Derives routing dimensions from ModelProfile; integration tested |

**Policy Status:** 1/1 complete (100%)

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
| Unit Tests | ✅ Complete | `tests/*.test.ts`, `tests/**/*.test.ts` | 89 tests across 10 files; all passing |
| Persistence Tests | ✅ Complete | `tests/Persistence.test.ts` | Full storage layer coverage (OPFS, IndexedDB, Metroid neighbors) |
| Model Tests | ✅ Complete | `tests/model/*.test.ts` | Profile resolution, defaults, routing policy |
| Embedding Tests | ✅ Complete | `tests/embeddings/*.test.ts` | Provider resolver, runner, real/dummy backends |
| Backend Smoke Tests | ✅ Complete | `tests/BackendSmoke.test.ts` | All vector backends instantiate cleanly |
| Runtime Tests | ✅ Complete | `tests/runtime/*.spec.mjs` | Browser harness validated; Electron context-sensitive |
| Integration Tests | ❌ Missing | `tests/integration/*.test.ts` (planned) | End-to-end: ingest → persist → query → coherent result |
| Benchmarks | 🟡 Partial | `tests/benchmarks/DummyEmbedderHotpath.bench.ts` | Baseline dummy embedder benchmark; real-provider benchmarks needed |

**Testing Status:** 7/9 complete (78%)

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

**Build Status:** 5/6 complete (83%)

---

## Overall Progress Summary

| Layer | Completion | Critical Gap |
|-------|-----------|--------------|
| Foundation | 75% | Crypto helpers |
| Storage | 100% | — |
| Vector Compute | 100% | — |
| Embedding | 83% | WebGL provider (low priority) |
| Hippocampus | 0% | **CRITICAL** — No ingest path |
| Cortex | 8% | **CRITICAL** — No retrieval path |
| Daydreamer | 0% | Not v1 blocker |
| Policy | 100% | — |
| Runtime | 100% | — |
| Testing | 78% | Integration tests |
| Build/CI | 83% | — |

**System-Wide Completion:** ~60% (infrastructure complete; orchestration layers missing)

---

## What Works Today

- ✅ Store/retrieve vectors and metadata
- ✅ Vector similarity operations on all backends
- ✅ Generate real embeddings via Transformers.js
- ✅ Resolve model profiles and derive routing policies
- ✅ Run browser/Electron runtime harness
- ✅ Pass 89 unit tests

## What Doesn't Work Today

- ❌ **Cannot ingest text** — No chunking or hierarchy builder
- ❌ **Cannot query memories** — No ranking pipeline or TSP solver
- ❌ **Cannot consolidate** — No Daydreamer loop
- ❌ **Cannot sign/verify** — No crypto helpers

---

## Recommended Implementation Order

### Phase 1: Unblock Basic Functionality (Ship v0.1)

**Goal:** Enable ingest and retrieval for a single user session.

1. **Crypto Helpers** (`core/crypto/*`)
   - Implement SHA-256 hashing
   - Implement Ed25519 signing/verification
   - Test coverage

2. **Text Chunking** (`hippocampus/Chunker.ts`)
   - Token-aware splitting respecting ModelProfile limits
   - Preserve sentence boundaries where possible
   - Test with various text lengths

3. **Hippocampus Ingest** (`hippocampus/Ingest.ts`)
   - Chunk → Embed → Persist orchestration
   - Build Page entities with proper hashing/signing
   - Single-Book hierarchy (defer Volume/Shelf)
   - Basic Metroid neighbor insertion (K-nearest)

4. **Cortex Query** (`cortex/Query.ts`)
   - Embed query
   - Flat page ranking (skip hierarchy for now)
   - Return top-K pages by similarity
   - Skip TSP coherence path (just ranked list)

5. **Integration Test** (`tests/integration/IngestQuery.test.ts`)
   - Ingest text → Retrieve by query → Validate results
   - Persistence across sessions

**Exit Criteria:** User can ingest text and retrieve relevant pages by query.

---

### Phase 2: Add Hierarchy & Coherence (Ship v0.5)

**Goal:** Hierarchical routing and coherent path ordering.

1. **Hierarchy Builder** (`hippocampus/HierarchyBuilder.ts`)
   - Cluster pages into Books (medoid selection)
   - Cluster books into Volumes (prototype computation)
   - Build Shelves for coarse routing

2. **Ranking Pipeline** (`cortex/Ranking.ts`)
   - Shelf → Volume → Book → Page cascade

3. **Open TSP Solver** (`cortex/OpenTSPSolver.ts`)
   - Dummy-node open-path heuristic
   - Test on synthetic graphs

4. **Full Query Orchestrator** (`cortex/Query.ts` — upgrade)
   - Hierarchical ranking
   - Subgraph expansion
   - Coherent path via TSP
   - Rich result DTO with provenance

**Exit Criteria:** User gets coherent ordered context chains, not just similarity-ranked pages.

---

### Phase 3: Background Consolidation (Ship v1.0)

**Goal:** Idle maintenance keeps memory healthy.

1. **Idle Scheduler** (`daydreamer/IdleScheduler.ts`)
   - Cooperative, interruptible loop
   - CPU budget awareness

2. **Hebbian Updater** (`daydreamer/HebbianUpdater.ts`)
   - LTP/LTD rules
   - Edge pruning

3. **Full Metroid Recalc** (`daydreamer/FullMetroidRecalc.ts`)
   - Rebuild neighbor lists for dirty volumes

4. **Prototype Recomputer** (`daydreamer/PrototypeRecomputer.ts`)
   - Update volume/shelf prototypes

**Exit Criteria:** System self-maintains over extended use; no manual intervention required.

---

### Phase 4: Polish & Release Prep (Ship v1.0 Final)

**Goal:** Production-ready quality.

1. **Integration Test Suite** (`tests/integration/*`)
   - Full vertical slice coverage
   - Edge cases and error paths
   - Performance regression tests

2. **Benchmark Suite** (`tests/benchmarks/*`)
   - Real-provider throughput
   - Query latency across corpus sizes
   - Storage overhead

3. **Documentation** (`docs/*`)
   - API reference
   - Integration guide
   - Troubleshooting

4. **CI Hardening**
   - Electron runtime gate policy
   - Guard scripts in merge checks
   - Benchmark baselines

**Exit Criteria:** All tests pass; benchmarks recorded; docs complete; ready for public use.

---

## Known Blockers & Risks

### Blocker 1: No Ingest Orchestration
**Impact:** Cannot use the system at all.
**Mitigation:** Phase 1 priority; single-book hierarchy sufficient for v0.1.

### Blocker 2: No Query Orchestration
**Impact:** Cannot retrieve memories.
**Mitigation:** Phase 1 priority; flat ranking acceptable for v0.1.

### Blocker 3: No Crypto Helpers
**Impact:** Cannot sign/verify pages (integrity risk).
**Mitigation:** Phase 1 priority; required for trustworthy storage.

### Risk 1: TSP Complexity
Open TSP is NP-hard; heuristic may be slow on large subgraphs.
**Mitigation:** Bound subgraph size (<30 nodes); defer to Phase 2; use deterministic greedy heuristic.

### Risk 2: Electron Runtime Stability
Host-shell Electron can SIGSEGV in constrained contexts.
**Mitigation:** Docker attach lane validated for debugging; document GPU requirements for production.

### Risk 3: WebGL Provider Gap
Transformers.js doesn't expose `webgl` device directly.
**Mitigation:** Low priority; `webgpu` and `wasm` sufficient for most users; explicit ORT adapter deferred to Phase 4.

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
- **Test philosophy:** TDD (Red → Green → Refactor) for all new slices.
- **Runtime realism:** Browser and Electron lanes are required merge gates.
