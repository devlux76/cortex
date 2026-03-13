# CORTEX Architecture Review — Naming Drift Report

**Date:** 2026-03-13
**Scope:** Full repository audit against corrected DESIGN.md (v1.2)
**Status:** Documentation-only pass; no code changes made in this review

**Update (P0-X resolved):** All P0-X naming drift items (D1–D9) have been corrected. `SemanticNeighbor`, `SemanticNeighborSubgraph`, `putSemanticNeighbors`, `getSemanticNeighbors`, `getInducedNeighborSubgraph`, `needsNeighborRecalc`, `flagVolumeForNeighborRecalc`, and `clearNeighborRecalcFlag` are now in place throughout `core/types.ts`, `storage/IndexedDbMetadataStore.ts`, `cortex/Query.ts`, and all test files. The IDB object store is `neighbor_graph` (DB_VERSION=3). The divergence entries below are preserved as historical record.

---

## Executive Summary

The repository has drifted from the intended CORTEX architecture due to an early conceptual collapse between **medoids** and **Metroids**. This caused the term "Metroid" to be applied throughout the codebase and documentation to describe the sparse proximity/neighbor graph connecting pages — a fundamentally different concept.

The correct meaning of each term is:

| Term | Correct Meaning |
|------|----------------|
| **Medoid** | An existing memory node selected as a cluster representative via the medoid statistic |
| **Centroid** | A mathematical average of vectors — a computed point, never a stored node |
| **Metroid** | A structured dialectical search probe: `{ m1, m2, c }` — ephemeral, constructed at query time |

The sparse proximity graph connecting pages with high cosine similarity is **not** a Metroid. It is the **semantic neighbor graph**. The entire MetroidBuilder component — the heart of CORTEX's epistemic search capability — does not yet exist in the codebase.

This report catalogs every divergence found and maps each to a correction task in TODO.md.

---

## Divergence Catalog

### D1 — `core/types.ts`: `MetroidNeighbor` interface

| Field | Value |
|-------|-------|
| **File** | `core/types.ts` |
| **Line** | ~70 |
| **Component** | `MetroidNeighbor` interface |
| **Current behavior** | Defines a sparse proximity graph edge with `neighborPageId`, `cosineSimilarity`, and `distance`. Named as if it represents a "Metroid" concept. |
| **Intended behavior** | This is a proximity edge in the semantic neighbor graph. It has nothing to do with the `Metroid = { m1, m2, c }` dialectical probe. Should be named `SemanticNeighbor`. |
| **Required correction** | Rename `MetroidNeighbor` → `SemanticNeighbor`. Update all references. |
| **TODO task** | P0-X1 |

---

### D2 — `core/types.ts`: `MetroidSubgraph` interface

| Field | Value |
|-------|-------|
| **File** | `core/types.ts` |
| **Line** | ~76 |
| **Component** | `MetroidSubgraph` interface |
| **Current behavior** | Defines the induced subgraph used for BFS expansion during retrieval. Named "MetroidSubgraph". |
| **Intended behavior** | This is a semantic neighbor subgraph, not a Metroid. Should be named `SemanticNeighborSubgraph`. |
| **Required correction** | Rename `MetroidSubgraph` → `SemanticNeighborSubgraph`. |
| **TODO task** | P0-X2 |

---

### D3 — `core/types.ts`: `MetadataStore` proximity graph methods

| Field | Value |
|-------|-------|
| **File** | `core/types.ts` |
| **Lines** | ~178–191 |
| **Component** | `MetadataStore` interface — methods section "Metroid NN radius index" |
| **Current behavior** | Six methods use "Metroid" naming: `putMetroidNeighbors`, `getMetroidNeighbors`, `getInducedMetroidSubgraph`, `needsMetroidRecalc`, `flagVolumeForMetroidRecalc`, `clearMetroidRecalcFlag`. |
| **Intended behavior** | These methods operate on the semantic neighbor graph (a proximity graph). "Metroid" in method names implies a connection to the dialectical probe construct, which is incorrect. |
| **Required correction** | Rename all six methods: `putSemanticNeighbors`, `getSemanticNeighbors`, `getInducedNeighborSubgraph`, `needsNeighborRecalc`, `flagVolumeForNeighborRecalc`, `clearNeighborRecalcFlag`. |
| **TODO task** | P0-X3 |

---

### D4 — `storage/IndexedDbMetadataStore.ts`: `metroid_neighbors` IDB store

| Field | Value |
|-------|-------|
| **File** | `storage/IndexedDbMetadataStore.ts` |
| **Lines** | ~32–35 (DB store declarations) |
| **Component** | IndexedDB object store named `metroid_neighbors` |
| **Current behavior** | Persists proximity graph edges between pages in a store named `metroid_neighbors`. |
| **Intended behavior** | The store name should reflect that it holds semantic proximity edges, not Metroid probes. Should be `neighbor_graph`. |
| **Required correction** | Rename IDB store from `metroid_neighbors` → `neighbor_graph`. Increment `DB_VERSION`. Add migration in `applyUpgrade` to copy existing data. |
| **TODO task** | P0-X6 |

---

### D5 — `storage/IndexedDbMetadataStore.ts`: proximity graph method implementations

| Field | Value |
|-------|-------|
| **File** | `storage/IndexedDbMetadataStore.ts` |
| **Lines** | All methods implementing `MetadataStore` proximity graph interface |
| **Component** | `putMetroidNeighbors`, `getMetroidNeighbors`, `getInducedMetroidSubgraph`, `needsMetroidRecalc`, `flagVolumeForMetroidRecalc`, `clearMetroidRecalcFlag` implementations |
| **Current behavior** | Implements the six methods using `MetroidNeighbor` types and `metroid_neighbors` IDB store. |
| **Intended behavior** | Should use renamed types and store. |
| **Required correction** | After interface rename (D1–D4), update all implementations to use new names. |
| **TODO task** | P0-X1–X6 |

---

### D6 — `cortex/Query.ts`: Absent MetroidBuilder

| Field | Value |
|-------|-------|
| **File** | `cortex/Query.ts` |
| **Lines** | Entire file |
| **Component** | `query()` function |
| **Current behavior** | Embeds query, scores hotpath pages, falls back to full scan, updates PageActivity, runs promotion sweep. Returns a ranked list of pages. **No Metroid is ever constructed. No dialectical search is performed. No knowledge gap is ever detected.** |
| **Intended behavior** | The query path should: (1) select m1 (topic medoid), (2) call MetroidBuilder to construct `{ m1, m2, c }`, (3) use centroid `c` as the balanced search anchor, (4) explore thesis/antithesis/synthesis zones, (5) detect and surface knowledge gaps. |
| **Required correction** | After MetroidBuilder is implemented (P1-M), upgrade `cortex/Query.ts` to include the full dialectical pipeline (P1-E). |
| **TODO task** | P1-E1 |

---

### D7 — `cortex/Query.ts`: `getInducedMetroidSubgraph` call

| Field | Value |
|-------|-------|
| **File** | `cortex/Query.ts` |
| **Lines** | The subgraph expansion step (BFS, if present) |
| **Component** | Subgraph expansion via `MetadataStore` |
| **Current behavior** | If subgraph BFS is called, it uses `getInducedMetroidSubgraph`, propagating the incorrect naming. |
| **Intended behavior** | Should call `getInducedNeighborSubgraph` (after rename). |
| **Required correction** | Rename the method call after P0-X3 is complete. |
| **TODO task** | P0-X3 |

---

### D8 — DESIGN.md (pre-correction): Incorrect Terminology

| Field | Value |
|-------|-------|
| **File** | `DESIGN.md` (pre-v1.2) |
| **Component** | Terminology section |
| **Current behavior** | Defined "Metroid (canonical domain term): Sparse nearest-neighbor graph structure inspired by medoid-based clustering." This is architecturally incorrect. |
| **Intended behavior** | Metroid = dialectical probe `{ m1, m2, c }`. The sparse NN graph is the semantic neighbor graph. |
| **Required correction** | **Already corrected in DESIGN.md v1.2.** |
| **TODO task** | Resolved |

---

### D9 — DESIGN.md (pre-correction): Missing MetroidBuilder, Dialectical Search, Knowledge Gap

| Field | Value |
|-------|-------|
| **File** | `DESIGN.md` (pre-v1.2) |
| **Component** | Entire document |
| **Current behavior** | No section describing MetroidBuilder, Matryoshka dimensional unwinding, antithesis discovery, dialectical search, or knowledge gap detection. |
| **Intended behavior** | These are core architectural concepts that must be described for any engineer to implement CORTEX correctly. |
| **Required correction** | **Already corrected in DESIGN.md v1.2** — new section "Conceptual Constructs: Medoid, Centroid, and Metroid" added. |
| **TODO task** | Resolved |

---

### D10 — PLAN.md (pre-correction): "Metroid vs medoid" note

| Field | Value |
|-------|-------|
| **File** | `PLAN.md` (pre-v1.2) |
| **Component** | Notes section |
| **Current behavior** | Note read: "Metroid vs medoid: Use Metroid in all API surfaces and docs; medoid only in algorithmic comments." This instructs developers to use the wrong term everywhere, making MetroidBuilder impossible to introduce without collision. |
| **Intended behavior** | The note must distinguish three concepts: Metroid (dialectical probe), medoid (cluster representative), and semantic neighbor graph (proximity graph for BFS). |
| **Required correction** | **Already corrected in PLAN.md v1.2.** |
| **TODO task** | Resolved |

---

### D11 — `PLAN.md` (pre-correction): Missing MetroidBuilder in CORTEX module table

| Field | Value |
|-------|-------|
| **File** | `PLAN.md` (pre-v1.2) |
| **Component** | CORTEX module table |
| **Current behavior** | No MetroidBuilder, KnowledgeGapDetector, or DialecticalSearch pipeline listed as planned modules. |
| **Intended behavior** | These are critical CORTEX components without which the system is merely a vector search engine. |
| **Required correction** | **Already corrected in PLAN.md v1.2** — new rows added. |
| **TODO task** | Resolved |

---

### D12 — `hippocampus/Ingest.ts`: Semantic neighbor insertion absent

| Field | Value |
|-------|-------|
| **File** | `hippocampus/Ingest.ts` |
| **Lines** | Entire file |
| **Component** | `ingestText()` function |
| **Current behavior** | Chunks, embeds, persists pages, builds a book, runs promotion sweep. Does **not** insert semantic neighbor edges. |
| **Intended behavior** | After persisting pages, should call `FastNeighborInsert` to maintain the semantic neighbor graph with Williams-bounded degree. |
| **Required correction** | After `FastNeighborInsert` is implemented (P1-C), upgrade `ingestText` to call it (P1-C2). |
| **TODO task** | P1-C2 |

---

### D13 — `core/types.ts`: No Metroid type defined

| Field | Value |
|-------|-------|
| **File** | `core/types.ts` |
| **Component** | Type definitions |
| **Current behavior** | The word "Metroid" appears only as part of `MetroidNeighbor`, `MetroidSubgraph`, and `MetadataStore` method names — all of which are proximity-graph concepts. The **actual Metroid type** `{ m1, m2, c }` does not exist. |
| **Intended behavior** | `core/types.ts` should define: `interface Metroid { m1: Hash; m2: Hash | null; centroid: Float32Array | null; knowledgeGap: boolean }` and `interface KnowledgeGap { topicMedoidId: Hash; queryEmbedding: Float32Array; dimensionalBoundary: number; timestamp: string }`. |
| **Required correction** | Add these types to `core/types.ts` as part of MetroidBuilder implementation (P1-M). |
| **TODO task** | P1-M1 |

---

### D14 — `core/types.ts`: No `matryoshkaProtectedDim` in `ModelProfile`

| Field | Value |
|-------|-------|
| **File** | `core/ModelProfile.ts` |
| **Component** | `ModelProfile` interface |
| **Current behavior** | No field for the protected Matryoshka dimension boundary. |
| **Intended behavior** | MetroidBuilder needs to know which lower dimensions to freeze during antithesis search. `ModelProfile` should include `matryoshkaProtectedDim: number` — the number of lower dimensions that encode invariant semantic context. |
| **Required correction** | Add `matryoshkaProtectedDim` to `ModelProfile` interface; add default value to `ModelDefaults.ts`; add per-model value to `BuiltInModelProfiles.ts`. |
| **TODO task** | P1-M1 (prerequisite) |

---

### D15 — `cortex/QueryResult.ts`: No Metroid or knowledge gap fields

| Field | Value |
|-------|-------|
| **File** | `cortex/QueryResult.ts` |
| **Component** | `QueryResult` interface |
| **Current behavior** | Contains only `pages`, `scores`, and `metadata`. No field for Metroid probe used, no knowledge gap field. |
| **Intended behavior** | Should include `metroid`, `knowledgeGap`, `coherencePath`, and `provenance` fields (see P1-E2). |
| **Required correction** | Upgrade `QueryResult` as part of P1-E2. |
| **TODO task** | P1-E2 |

---

## Summary by Severity

| Severity | Count | Description |
|----------|-------|-------------|
| **Critical (blocks MetroidBuilder)** | 3 | D1, D2, D3 — type/interface naming collision |
| **High (architectural gap)** | 4 | D4, D6, D13, D14 — missing types and IDB store |
| **Medium (propagated naming error)** | 4 | D5, D7, D12, D15 — implementations following wrong names |
| **Resolved by this PR** | 4 | D8, D9, D10, D11 — corrected in DESIGN.md v1.2 and PLAN.md v1.2 |

**Total: 15 divergences** (3 + 4 + 4 + 4)

---

## Components with Zero Drift

The following components are correctly implemented (or partially implemented in the correct direction) and require no changes related to this naming review:

- `core/HotpathPolicy.ts` — Williams Bound policy implementation; correct
- `core/SalienceEngine.ts` — Promotion/eviction lifecycle; correct
- `core/crypto/` — Hash, sign, verify; correct
- `storage/OPFSVectorStore.ts` — Append-only vector file; correct
- `storage/MemoryVectorStore.ts` — In-memory testing backend; correct
- `embeddings/` — All embedding providers; correct
- `hippocampus/Chunker.ts` — Text chunking; **implemented and correct**
- `hippocampus/PageBuilder.ts` — Page entity construction; **implemented and correct**
- `hippocampus/Ingest.ts` — Minimal ingest path; **partially implemented** (chunk→embed→persist→Book→hotpath); correct direction, hierarchy and neighbor insertion deferred
- `cortex/Query.ts` — Minimal query path; **partially implemented** (hotpath-first flat scoring); **must be substantially rewritten** for the dialectical pipeline (P1-E)
- `cortex/QueryResult.ts` — Minimal result DTO; **partially implemented**; **must be rewritten** to add coherencePath, metroid, knowledgeGap, provenance fields (P1-E2)
- All `VectorBackend` implementations — correct

> **Important caveat on "zero drift":**
>
> - **What it means:** No architectural logic in these files conflicts with the corrected design. They do not need to be deleted or redesigned from scratch.
> - **What it does not mean:** Unaffected by future work. The "roughed in" implementations (`Ingest.ts`, `Query.ts`, `QueryResult.ts`) were scaffolded before the MetroidBuilder design was fully specified.
> - **Impact:** `Query.ts` and `QueryResult.ts` must be substantially rewritten (P1-E); `Ingest.ts` must gain hierarchy building and neighbor insertion (P1-B, P1-C). Each is a correct stub in the right direction, but not a complete implementation.
> - **Authoritative status:** Refer to **PLAN.md**, not this section, when assessing whether a file needs additional work.

---

## Recommended Fix Order

1. **P0-X1–X7** — Fix naming drift in `core/types.ts`, `storage/IndexedDbMetadataStore.ts`, `cortex/Query.ts`, and planned file names. This unblocks MetroidBuilder without risking collision.
2. **P1-M1–M3** — Add `Metroid` and `KnowledgeGap` types; implement `MetroidBuilder`.
3. **P1-N1–N4** — Implement `KnowledgeGapDetector`.
4. **P1-E1–E3** — Rewrite `cortex/Query.ts` to full dialectical orchestrator (not backward-compatible with existing flat top-K code).
5. **P1-C1–C3** — Implement `FastNeighborInsert` (correctly named after P0-X).
