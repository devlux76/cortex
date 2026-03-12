# CORTEX Design, Plan, and TODO

Date: 2026-03-11

This plan is synthesized from:
- `README.md`
- `PROJECT-EXECUTION-PLAN.md`
- Canonical contracts in `core/types.ts`, `storage/IndexedDbMetadataStore.ts`, `Policy.ts`, and model profile modules under `core/`
- Existing proof-of-concept backend files in this repo

## 0. Execution Synchronization (2026-03-11)

Canonical document contract:
1. Product vision and non-negotiables: `README.md`
2. Architecture contracts and backlog: `CORTEX-DESIGN-PLAN-TODO.md`
3. Execution sequencing, test gates, and command contract: `PROJECT-EXECUTION-PLAN.md`

Current delivery priorities (P0):
1. Keep docs synchronized to real code state on every implementation pass.
2. Stabilize Electron provisioning in CI so `runtime-electron` can run as a hard gate.
3. Wire first real embedding providers into runtime selection path.
4. Implement Hippocampus ingest and Cortex retrieval vertical slices with strict TDD.
5. Preserve model-derived defaults and avoid hardcoded model-dependent numerics.

Interpretation rule for this document:
1. Architectural intent remains here.
2. Execution order, command contract, and test matrix are governed by `PROJECT-EXECUTION-PLAN.md`.

### 0.1 Status Update (2026-03-11)

Completed since the prior snapshot:
1. Model-profile source-of-truth layer exists (`core/ModelProfile.ts`, `core/ModelDefaults.ts`, `core/ModelProfileResolver.ts`).
2. Routing policy dimensions are now derived from profile-owned embedding dimensions (`createRoutingPolicy`).
3. Guard command exists for model-related hardcoded numeric literals (`npm run guard:model-derived`).
4. Runtime numeric constants are centralized for backend/storage internals (`core/NumericConstants.ts`).
5. Runtime helper resolves model metadata and derives routing policy in one call (`resolveRoutingPolicyForModel` in `Policy.ts`).
6. Deterministic dummy SHA-256 embedder exists for pre-model hotpath testing (`embeddings/DeterministicDummyEmbeddingBackend.ts`).
7. Benchmark harness exists for dummy embedder throughput baselining (`npm run benchmark:dummy`).
8. Baseline adaptive provider selection exists with capability filtering + benchmark-based winner choice (`embeddings/ProviderResolver.ts`, `embeddings/EmbeddingRunner.ts`).
9. External capability verification completed for real-provider planning:
	- Transformers.js is ONNX Runtime-backed and directly exposes `webnn`, `webgpu`, and `wasm` device paths.
	- Transformers.js does not currently expose `webgl` as a direct device; `webgl` should remain an explicit ORT adapter path.

Next focus:
1. Wire resolved model profiles into runtime ingest/query entry points.
2. Add real embedding providers to resolver candidate sets, split by runtime family:
	- Transformers.js provider (`webnn/webgpu/wasm`)
	- Explicit ORT WebGL provider (`webgl`)
3. Add browser/electron runtime test lanes to match merge-gate policy.

### 0.2 Legacy Sketch Consolidation (2026-03-11)

The earlier `Cortex-sketch` and `Cortex-sketch-errata` notes are retired.
Their durable content is preserved as canonical implementation/doc contracts:
1. Data-model and storage interfaces are canonical in `core/types.ts`.
2. Metroid NN radius graph APIs (neighbors, induced subgraph, dirty recalc flags) are canonical in `core/types.ts` and `storage/IndexedDbMetadataStore.ts`, with persistence coverage in `tests/Persistence.test.ts`.
3. Backend abstraction/detection/fallback is canonical in `VectorBackend.ts`, `BackendKind.ts`, and `CreateVectorBackend.ts`.
4. Model-derived numeric ownership is canonical in `core/ModelDefaults.ts`, `core/ModelProfileResolver.ts`, and `Policy.ts`.
5. Naming convention is settled: use `Metroid` for project-domain graph terms; keep `medoid` only when referring to the underlying clustering statistic.

### 0.3 Runtime Harness Direction (2026-03-11)

Decision from runtime research and hotpath verification:
1. Keep the test harness browser-first; do not fork into a large Electron-specific app shell.
2. Use one renderer harness that can run unchanged in Chromium and Electron.
3. Wrap it in a thin Electron launcher for Linux GPU/WebGPU realism, switch control, and GPU diagnostics.
4. Keep Chromium as the web-parity lane and Electron as the primary runtime-realism lane.
5. Serve the harness over localhost during development/testing so WebGPU secure-context requirements are satisfied.

Why this direction won:
1. Electron retains Chromium's WebGPU path and limitations, so it is realistic instead of synthetic.
2. Electron gives better observability than raw browser automation on Linux (`app.commandLine`, GPU feature status/info).
3. The current missing confidence is browser-runtime execution, not WASM kernel validity; `Vectors.wat` and the dummy embedder hotpaths have already been executed successfully in ad hoc verification.

### 0.4 Documentation Maintenance Protocol (Anti-Drift)

At the end of every implementation pass, update docs in this order:
1. `PROJECT-EXECUTION-PLAN.md`: append pass status delta and exact commands executed.
2. `CORTEX-DESIGN-PLAN-TODO.md`: update design-to-code status matrix below.
3. `README.md`: confirm top blocker and P0 priorities still match reality.

Required blocker logging format:
1. File path
2. Failure symptom
3. Next actionable step

### 0.5 Design-To-Code Status Matrix (2026-03-11)

Legend: `Implemented`, `Partial`, `Missing`

| Capability | Status | Primary Code Anchors | Notes |
| --- | --- | --- | --- |
| Vector backend abstraction (`webgpu`, `webgl`, `webnn`, `wasm`) | Implemented | `VectorBackend.ts`, `CreateVectorBackend.ts`, `WebGPUVectorBackend.ts`, `WebGLVectorBackend.ts`, `WebNNVectorBackend.ts`, `WasmVectorBackend.ts` | Runtime lanes still needed for real-environment confidence. |
| Storage contracts and persistence schema | Implemented | `core/types.ts`, `storage/OPFSVectorStore.ts`, `storage/IndexedDbMetadataStore.ts`, `tests/Persistence.test.ts` | Current tests are Node-lane with mocked browser APIs. |
| Model-derived numeric governance | Implemented | `core/ModelProfile.ts`, `core/ModelDefaults.ts`, `core/ModelProfileResolver.ts`, `Policy.ts`, `scripts/guard-model-derived.mjs` | Guard command enforced by `npm run guard:model-derived`. |
| Adaptive provider resolver infrastructure | Partial | `embeddings/ProviderResolver.ts`, `embeddings/EmbeddingRunner.ts` | Real providers not yet wired; dummy provider baseline exists. |
| Browser/Electron runtime-realism lanes | Partial | `playwright.config.mjs`, `runtime/harness/index.html`, `tests/runtime/browser-harness.spec.mjs`, `tests/runtime/electron-harness.spec.mjs`, `.vscode/launch.json`, `.vscode/tasks.json` | Browser lane passes; Electron lane works in desktop sessions but can `SIGSEGV` in constrained non-desktop shells. CI/runtime-context policy is still pending. |
| Hippocampus ingest orchestrator | Missing | (planned module) | No text chunking -> embed -> persist orchestration path yet. |
| Cortex retrieval and coherence path | Missing | (planned module) | Ranking stack and open-path solver not yet implemented. |
| Daydreamer consolidation loop | Missing | (planned module) | Idle scheduling and recalc loop not yet implemented. |
| Crypto signing and verification helpers | Missing | (planned module `core/crypto`) | Entity fields exist in `core/types.ts`, helper module pending. |

## 1. Design

### 1.1 Product contract
CORTEX is a browser-native, on-device memory engine with three cooperating regions:
1. Hippocampus for high-throughput ingestion and initial association.
2. Cortex for hierarchical retrieval plus coherent path routing.
3. Daydreamer for background consolidation, replay, and pruning.

Non-negotiable constraints:
1. No cloud dependency for core operation.
2. Fast local retrieval under degraded hardware.
3. Persistent local state with integrity checks.
4. Gradual quality improvements in idle time instead of expensive write-time computation.

### 1.2 System boundaries
In scope for v1:
1. On-device ingest, query, consolidation, and local persistence.
2. Multi-backend vector compute abstraction (`webgpu`, `webgl`, `webnn`, `wasm`).
3. Signed graph entities and hash verification.
4. Sparse Metroid-neighbor graph for coherence routing.

Out of scope for v1:
1. Full production-grade distributed consensus.
2. Cross-device key escrow or account systems.
3. Large-scale multi-tenant synchronization services.

### 1.3 Reference architecture
Core modules:
1. `core/types`: Page, Book, Volume, Shelf, Edge, MetroidNeighbor, query DTOs.
2. `core/crypto`: hashing, signatures, verification helpers.
3. `storage/vector`: OPFS append-only vector file and vector index metadata.
4. `storage/meta`: IndexedDB stores and graph indexes.
5. `compute/vector-backend`: backend detection and adapters.
6. `hippocampus`: ingest orchestration and fast neighbor updates.
7. `cortex`: hierarchical routing plus induced-subgraph coherence ordering.
8. `daydreamer`: idle consolidation, edge updates, full neighborhood recalculation.
9. `runtime`: queues, scheduling, feature flags, telemetry hooks.
10. `p2p`: peer advertisements, payload verification, merge logic.

### 1.4 Data model and indexing
Primary entities:
1. `Page`: immutable content chunk, embedding offset, hashes, signature, linked-list pointers.
2. `Book`: ordered page list and representative page.
3. `Volume`: grouped books with one or more prototypes.
4. `Shelf`: coarse routing prototypes for fast top-level selection.
5. `Edge`: Hebbian weighted relation between pages.
6. `MetroidNeighbor`: sparse radius graph edge with cosine and distance.

Required IndexedDB stores:
1. `pages`
2. `books`
3. `volumes`
4. `shelves`
5. `edges_hebbian`
6. `metroid_neighbors`
7. `flags` (dirty-volume / recalc flags)
8. `indexes` (lookup helpers: page->book, book->volume, volume->shelf)

Storage invariants:
1. Vectors are append-only in OPFS.
2. Metadata writes are idempotent and versioned.
3. All signed entities include stable canonical serialization.
4. Neighbor lists are bounded by `maxNeighbors` and sorted by similarity.

### 1.5 Retrieval design
Cortex query path:
1. Embed query.
2. Rank shelves using coarse prototypes.
3. Rank candidate volumes.
4. Rank candidate books.
5. Rank top seed pages.
6. Expand induced Metroid subgraph from seed pages using limited hops.
7. Compute coherent open path over induced graph (dummy-node open TSP strategy).
8. Return ordered memory chain plus provenance path.

Design rules:
1. Keep query-time subgraphs small (target under 30 nodes).
2. Prefer sparse graph expansion over global graph traversal.
3. Keep TSP heuristic deterministic under same input for reproducibility.

### 1.6 Ingestion and consolidation design
Ingestion responsibilities:
1. Chunk text to pages.
2. Generate embeddings.
3. Persist vectors and page metadata.
4. Build/attach books, volumes, shelves.
5. Perform fast local Metroid neighbor insertion.
6. Mark dirty volumes for idle full recalculation.

Daydreamer responsibilities:
1. Replay and strengthen meaningful edges.
2. Decay weak Hebbian edges.
3. Recompute medoids/prototypes.
4. Rebuild full Metroid neighborhoods for dirty volumes.
5. Trigger split/merge decisions for unstable clusters.

### 1.7 Security and trust design
1. Every persisted page stores `contentHash`, `vectorHash`, and signature metadata.
2. Incoming peer payloads are verified before merge.
3. Merge rejects malformed graph payloads and hash mismatches.
4. Keep cryptographic service isolated from storage and routing concerns.

### 1.8 Performance model
Performance budget targets for v1:
1. Ingest: single-page persist and fast neighbor update under 50 ms on WebGPU-class hardware.
2. Query: shelf->page seed ranking under 20 ms for moderate corpus size.
3. Coherence path solve under 10 ms for induced subgraphs under 30 nodes.
4. Daydreamer work is opportunistic and interruptible.

Graceful degradation:
1. `webgpu` preferred.
2. `webnn` optional path for matmul-friendly ops.
3. `webgl` fallback via explicit ORT adapter path.
4. `wasm` guaranteed baseline.

Implementation note (verified 2026-03-11):
1. Transformers.js path currently maps to `webnn/webgpu/wasm` (no direct `webgl` device key).
2. Keep `webgl` in architecture through the explicit ORT adapter backend.

### 1.9 Current gap analysis from repo snapshot
Observed blockers in current PoC files:
1. Embedding runtime modules exist (`ProviderResolver` + `EmbeddingRunner`), but only baseline/dummy-provider flow is wired.
2. Real provider adapters are not yet wired (Transformers.js for `webnn/webgpu/wasm`; explicit ORT adapter for `webgl`).
3. Ingest/query orchestrators are not yet wired to resolved `ModelProfile` values.
4. Browser/Electron runtime test lanes are not yet implemented in scripts/CI.
5. Shader and backend files compile but are not yet integrated into a full vertical runtime path.

These are the remaining vertical-slice blockers before broader feature expansion.

## 2. Implementation Plan

Planning horizon: 7 phases, each with explicit exit criteria.

### Phase 0: Foundation and contract alignment
Objective: make the codebase buildable and interfaces stable.

Deliverables:
1. Repository scaffolding with TypeScript build and tests.
2. Canonical `VectorBackend` interface and aligned backend adapters.
3. Shared `BackendKind` and backend detection utility.
4. Initial project layout for runtime, storage, core, and compute modules.

Exit criteria:
1. `npm test` and `npm run build` pass locally.
2. All backends compile against the same interface.
3. Type definitions exist for all core domain entities.

### Phase 1: Storage and schema layer
Objective: implement reliable local persistence.

Deliverables:
1. `OPFSVectorStore` append and read primitives.
2. `IndexedDbMetadataStore` with all object stores and indexes.
3. Schema versioning and migration framework.
4. Consistency checks for vector offset and dimension metadata.

Exit criteria:
1. Round-trip tests pass for all entities and vector reads.
2. Schema upgrade test from v0 to v1 passes.
3. No data loss across browser restart in smoke tests.

### Phase 2: Hippocampus vertical slice
Objective: ingest text and produce retrievable memory hierarchy.

Deliverables:
1. Page chunking plus embedding interface integration.
2. Page/book/volume/shelf construction path.
3. Fast Metroid neighbor insertion and reverse updates.
4. Dirty-volume recalc flagging.

Exit criteria:
1. Ingested pages are queryable by ID and graph links.
2. Neighbor lists are bounded and symmetric enough for traversal.
3. Ingest benchmark instrumentation exists.

### Phase 3: Cortex retrieval and coherence
Objective: return coherent ordered context, not only nearest neighbors.

Deliverables:
1. Shelf->Volume->Book->Page ranking pipeline.
2. Induced Metroid subgraph expansion with hop limits.
3. Open-path TSP heuristic (`findOpenTSPPath`) over induced graph.
4. Query result object with coherent path metadata.

Exit criteria:
1. Query returns deterministic ordered chains for fixed seed and corpus.
2. Path solver passes correctness tests on synthetic graphs.
3. End-to-end query latency is within initial budget on at least one backend.

### Phase 4: Daydreamer consolidation
Objective: maintain memory health in idle time.

Deliverables:
1. Idle scheduler and cooperative background loop.
2. Hebbian strengthen/decay updates.
3. Full Metroid neighborhood recalc for dirty volumes.
4. Prototype recomputation hooks for volumes and shelves.

Exit criteria:
1. Background work can be interrupted without corruption.
2. Recalc clears dirty flags and updates neighbor quality.
3. Long-run simulation shows bounded graph growth.

### Phase 5: Peer exchange and verified merge
Objective: exchange semantic subgraphs safely.

Deliverables:
1. Peer advertisement schema and router scoring.
2. Signed payload verification and merge policy.
3. Conflict-safe import path for pages, vectors, and edges.

Exit criteria:
1. Two local peers can exchange and merge a subgraph.
2. Invalid signatures or hashes are rejected and logged.
3. Merge does not break local graph invariants.

### Phase 6: Hardening, benchmarks, and release prep
Objective: make behavior measurable and stable.

Deliverables:
1. Benchmark suite for ingest/query/daydream loops.
2. Property and fuzz tests for graph invariants.
3. Performance tuning on all available backends.
4. Documentation and developer runbook.

Exit criteria:
1. Benchmark baselines recorded.
2. Critical invariants covered by automated tests.
3. v1 release checklist complete.

## 3. TODO Backlog

Priority legend:
1. P0 = unblock architecture and build.
2. P1 = core v1 functionality.
3. P2 = optimization, resilience, polish.

### P0 (do first)
1. ~~Create TypeScript project scaffolding (`package.json`, `tsconfig`, test runner).~~ ✅ Done
2. ~~Define canonical shared types for all entities from legacy design notes.~~ ✅ Done
3. ~~Resolve `VectorBackend` interface mismatch against all backend classes.~~ ✅ Done
4. ~~Add `BackendKind` and `detectBackend` in real code module.~~ ✅ Done
5. ~~Add missing imports/exports so backend factory compiles.~~ ✅ Done
6. ~~Decide and document naming convention: `Metroid` vs `Medoid`.~~ ✅ Done (`Metroid` canonical domain term; `medoid` math term)
7. Add minimal CI workflow for build and tests.
8. ~~Add lint/format rules for consistent style.~~ ✅ Done
9. Add deterministic floating-point tolerance helpers for backend parity tests.
10. ~~Add smoke test that instantiates each backend or cleanly falls back.~~ ✅ Done (`tests/BackendSmoke.test.ts`)

### P1 (v1 core)
1. ~~Implement `OPFSVectorStore.appendVector` and `readVector`.~~ ✅ Done (Phase 1, 2026-03-11)
2. ~~Implement `IndexedDbMetadataStore` entity CRUD methods.~~ ✅ Done (Phase 1, 2026-03-11)
3. ~~Implement metadata helper indexes (`page->book`, `book->volume`, `volume->shelf`).~~ ✅ Done (Phase 1, 2026-03-11)
4. ~~Implement `putMetroidNeighbors` and `getMetroidNeighbors`.~~ ✅ Done (Phase 1, 2026-03-11)
5. ~~Implement `getInducedMetroidSubgraph` with bounded BFS.~~ ✅ Done (Phase 1, 2026-03-11)
6. Implement page chunking utility and deterministic page ID generation.
7. Implement page signature creation and verification helpers.
8. Implement Hippocampus ingest orchestration.
9. Implement fast Metroid insert path for newly ingested pages.
10. Implement reverse neighbor update path with bounded degree.
11. ~~Implement dirty-volume recalc flagging in metadata.~~ ✅ Done (Phase 1, 2026-03-11)
12. Implement Shelf/Volume/Book/Page ranking in Cortex query.
13. Implement query seed selection threshold logic.
14. Implement `findOpenTSPPath` with dummy-node open-path strategy.
15. Add fallback coherence ordering if TSP heuristic fails.
16. Return query provenance metadata and confidence score.
17. Implement Daydreamer loop scheduling with safe cancellation.
18. Implement Hebbian update service with clamp and prune behavior.
19. Implement full neighborhood recalc for dirty volumes.
20. Implement split/merge hooks for unstable clusters.
21. Add end-to-end test: ingest -> query -> coherent ordered response.
22. ~~Add restart persistence test for vectors + metadata.~~ ✅ Done (Phase 1, 2026-03-11)
23. Add regression tests for neighbor symmetry and bounded degree.
24. Add benchmark harness and first baseline capture.

### P2 (scale and resilience)
1. Add peer transport abstraction and local loopback transport.
2. Implement peer advertisement ranking by prototype similarity.
3. Implement signed subgraph payload export/import.
4. Add merge conflict strategy for duplicate pages and edges.
5. Add instrumentation counters and latency histograms.
6. Add corruption recovery tooling for vector store and metadata store.
7. Add schema migration tests across multiple versions.
8. Add large-corpus stress tests for memory and latency.
9. Extend adaptive runtime policy with real providers and runtime telemetry persistence.
10. Add resource governance controls for Daydreamer CPU budget.
11. Improve ranking quality with optional rerank stage.
12. Add developer docs with architecture diagrams and troubleshooting.

## 4. Suggested initial milestone (first 2 weeks)
1. Finish Phase 0 entirely.
2. Implement minimal storage layer from Phase 1.
3. Ship a vertical demo: ingest text, persist pages/vectors, run simple top-k query.
4. Defer TSP path and full Daydreamer recalculation until baseline is stable.

## 5. Risks and mitigations
1. Risk: backend divergence causes inconsistent scores.
Mitigation: backend parity test suite with fixed vectors and tolerance thresholds.

2. Risk: IndexedDB graph updates become bottleneck.
Mitigation: batched writes and deferred heavy recalculations in Daydreamer.

3. Risk: complexity creep from simultaneous P2P and local core work.
Mitigation: lock scope to local single-node quality before peer exchange.

4. Risk: terminology drift reintroduces mixed `Metroid`/`medoid` naming in API surfaces.
Mitigation: keep `Metroid` as the canonical domain term; reserve `medoid` for algorithmic comments and internal statistical descriptions only.

## 6. Definition of done for v1
1. Local-only node can ingest, persist, retrieve, and return coherent ordered context.
2. Data survives restart with integrity checks.
3. Daydreamer improves graph quality without blocking foreground query/ingest.
4. At least one GPU path and WASM fallback are validated end-to-end.
5. Core behavior is covered by automated tests and baseline benchmarks.
