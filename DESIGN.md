# CORTEX Design Specification

**Version:** 1.0
**Last Updated:** 2026-03-12

## Executive Summary

CORTEX (**C**lustered **O**ntic **R**outing **T**hrough **E**ntangled e**X**changes) is a neurobiologically inspired, fully on-device episodic memory engine for autonomous agents. It runs 100% in the browser with no servers, no cloud, and no telemetry. All memory stays local and private.

## Core Architecture

### Three Living Regions

CORTEX models three biological brain regions working in concert:

#### 1. Hippocampus — Fast Associative Encoding
The rapid-write system that turns raw experience into structured memory scaffolding.

**Responsibilities:**
- Embed new observations with Matryoshka-capable models
- Perform lightning-fast WebGPU multi-prototype lookups
- Build hierarchical prototypes (Pages → Books → Volumes → Shelves)
- Create probabilistic Hebbian edges
- Store raw vectors in append-only OPFS file

**Performance Target:** Single-page persist + fast neighbor update under 50ms on WebGPU hardware

#### 2. Cortex — Intelligent Routing & Coherence
Returns self-consistent, coherent context chains rather than bag-of-vectors.

**Responsibilities:**
- Perform parallel WebGPU "scoops" across the active universe (sub-millisecond)
- Pull relevant sub-graphs from IndexedDB
- Trace closed-loop paths through Hebbian connections
- Return only coherent context chains

**Performance Target:** Shelf→page seed ranking under 20ms; coherence path solve under 10ms for <30 node subgraphs

#### 3. Daydreamer — The Default Mode Network
Idle background consolidation that prevents catastrophic forgetting.

**Responsibilities:**
- Strengthen important connections (Long-Term Potentiation)
- Gently decay and prune weak edges (Long-Term Depression)
- Recompute medoids and centroids
- Replay recent experiences
- Keep memory universe coherent and alive

**Performance Target:** Opportunistic, interruptible, no foreground blocking

## Data Model

### Entity Hierarchy

```
Shelf (coarsest)
  └─ Volume (cluster of books)
      └─ Book (ordered page sequence)
          └─ Page (atomic content chunk + embedding)
```

### Core Entities

#### Page
Immutable content chunk with embedding and metadata.

```typescript
interface Page {
  pageId: Hash;               // SHA-256(content)
  content: string;            // bounded by chunk policy
  embeddingOffset: number;    // byte offset into vector file
  embeddingDim: number;       // from ModelProfile
  contentHash: Hash;          // SHA-256(content)
  vectorHash: Hash;           // SHA-256(vector bytes)
  prevPageId?: Hash;          // linked-list for sequential content
  nextPageId?: Hash;
  creatorPubKey: PublicKey;
  signature: Signature;
  createdAt: string;          // ISO timestamp
}
```

#### Book
Ordered sequence of pages with representative medoid.

```typescript
interface Book {
  bookId: Hash;               // SHA-256(pageIds) or Merkle root
  pageIds: Hash[];
  medoidPageId: Hash;         // representative via medoid statistic
  meta: BookMetadata;         // title, sourceUri, tags, extra
}
```

#### Volume
Cluster of books with multiple prototypes.

```typescript
interface Volume {
  volumeId: Hash;
  bookIds: Hash[];
  prototypeOffsets: number[]; // byte offsets into vector file
  prototypeDim: number;       // runtime policy dimension
  variance: number;
}
```

#### Shelf
Top-level routing structure with coarse prototypes.

```typescript
interface Shelf {
  shelfId: Hash;
  volumeIds: Hash[];
  routingPrototypeOffsets: number[];
  routingDim: number;
}
```

### Graph Structures

#### Hebbian Edge
Weighted connection that strengthens/decays over time.

```typescript
interface Edge {
  fromPageId: Hash;
  toPageId: Hash;
  weight: number;             // 0.0 to 1.0
  lastUpdatedAt: string;
}
```

#### Metroid Neighbor
Sparse radius-graph edge (project term; medoid-inspired).

```typescript
interface MetroidNeighbor {
  neighborPageId: Hash;
  cosineSimilarity: number;
  distance: number;           // 1 - cosineSimilarity (TSP-ready)
}
```

## Storage Architecture

### Vector Storage (OPFS)
Append-only binary file storing raw IEEE-754 float32 vectors.

**Key Properties:**
- Mixed-dimension support (full embeddings + compressed prototypes)
- Byte-offset addressing
- Zero-copy reads
- Persistent across sessions

**File:** `cortex-vectors.bin`

### Metadata Storage (IndexedDB)
Structured entity storage with automatic reverse indexes.

**Object Stores:**
- `pages`, `books`, `volumes`, `shelves`
- `edges_hebbian` (Hebbian weights)
- `metroid_neighbors` (sparse NN graph)
- `flags` (dirty-volume recalc markers)
- `page_to_book`, `book_to_volume`, `volume_to_shelf` (reverse indexes)

## Retrieval Design

### Cortex Query Path

1. **Embed Query** — Generate query embedding
2. **Rank Shelves** — Score using coarse prototypes
3. **Rank Volumes** — Within top shelves
4. **Rank Books** — Within top volumes
5. **Rank Pages** — Select seed pages
6. **Expand Subgraph** — BFS through Metroid neighbors (bounded hops)
7. **Solve Coherent Path** — Open TSP with dummy-node heuristic
8. **Return Result** — Ordered memory chain + provenance metadata

**Key Constraints:**
- Keep query-time subgraphs small (target <30 nodes)
- Prefer sparse graph expansion over global traversal
- Deterministic under same input for reproducibility

### Coherence via Open TSP
Rather than returning nearest neighbors by similarity, Cortex traces a coherent path through the induced subgraph using a dummy-node open TSP strategy. This produces a natural "narrative flow" through related memories.

## Ingestion Design

### Hippocampus Ingest Path

1. **Chunk Text** — Split into pages respecting token budgets from ModelProfile
2. **Generate Embeddings** — Batch embed with selected provider
3. **Persist Vectors** — Append to OPFS vector file
4. **Persist Pages** — Write page metadata to IndexedDB
5. **Build/Attach Hierarchy** — Construct/update books, volumes, shelves
6. **Fast Neighbor Insert** — Update Metroid neighbors incrementally
7. **Mark Dirty** — Flag volumes for full recalc by Daydreamer

**Incremental Strategy:**
Fast local Metroid neighbor insertion keeps query-time latency low. Full neighborhood recalculation is deferred to idle Daydreamer passes.

## Consolidation Design

### Daydreamer Responsibilities

**LTP/LTD (Hebbian Updates):**
- Strengthen edges traversed during successful queries
- Decay unused edges toward zero
- Prune edges below threshold

**Prototype Recomputation:**
- Recompute volume/shelf medoids and centroids
- Update prototype vectors in vector file

**Full Metroid Recalc:**
- For dirty volumes, recompute all pairwise similarities
- Rebuild bounded neighbor lists
- Clear dirty flags

**Experience Replay:**
- Simulate queries over recent memories
- Reinforce important connection patterns

**Cluster Stability:**
- Detect unstable clusters (high variance, imbalanced size)
- Trigger split/merge when thresholds exceeded

## Security & Trust

### Cryptographic Integrity

**Every Page Includes:**
- `contentHash`: SHA-256 of content text
- `vectorHash`: SHA-256 of embedding bytes
- `signature`: Ed25519 or equivalent signature
- `creatorPubKey`: Public key of creator

**Verification Points:**
- On page creation (sign)
- On page retrieval (verify)
- On peer payload import (reject invalid)

**Isolation:**
Keep cryptographic service separate from routing/storage concerns. All hashing/signing operations go through dedicated `core/crypto` module.

## Performance Model

### Backend Fallback Chain

**Transformers.js Path:**
1. `webnn` (hardware ML accelerator)
2. `webgpu` (compute shaders)
3. `wasm` (guaranteed baseline)

**Explicit ORT Path:**
1. `webnn`
2. `webgpu`
3. `webgl` (fragment shader fallback)
4. `wasm`

**Selection Strategy:**
- Capability check (API availability)
- Benchmark race (small batch inference)
- Telemetry-informed hint (cached winner from previous session)

### Performance Budgets (v1 Targets)

| Operation | Target | Hardware Assumption |
|-----------|--------|---------------------|
| Ingest single page | <50ms | WebGPU-class |
| Query seed ranking | <20ms | Moderate corpus |
| Coherence path solve | <10ms | <30 node subgraph |
| Daydreamer work | Interruptible | No blocking |

**Graceful Degradation:**
All operations must complete on WASM fallback, albeit slower.

## Non-Negotiable Constraints

1. **No Cloud Dependency** — Core operation 100% on-device
2. **Fast Local Retrieval** — Must work on degraded hardware
3. **Persistent Local State** — Survive browser restart with integrity checks
4. **Idle Consolidation** — Background quality improvements, not expensive write-time computation

## System Boundaries

### In Scope for v1
- On-device ingest, query, consolidation, persistence
- Multi-backend vector compute (`webgpu`, `webgl`, `webnn`, `wasm`)
- Signed graph entities with hash verification
- Sparse Metroid-neighbor graph for coherence routing

### Out of Scope for v1
- Full production-grade distributed consensus
- Cross-device key escrow or account systems
- Large-scale multi-tenant synchronization services

## Terminology

**Metroid** (canonical domain term): Sparse nearest-neighbor graph structure inspired by medoid-based clustering. Used throughout API surfaces and documentation.

**medoid** (mathematical term): The underlying clustering statistic. Reserved for algorithmic comments and internal statistical descriptions only.

## Model-Derived Numerics

**Critical Rule:** All numeric values derived from ML model architecture (embedding dimensions, context lengths, thresholds) must **never** be hardcoded as magic numbers.

**Source of Truth:**
- `core/ModelProfile.ts` — Interface definition
- `core/ModelDefaults.ts` — Default fallback values
- `core/BuiltInModelProfiles.ts` — Concrete model registrations
- `core/ModelProfileResolver.ts` — Runtime resolution

**Enforcement:** `npm run guard:model-derived` scans for violations before CI merge.

## Future Directions (Post-v1)

- **P2P Memory Exchange** — Signed subgraph payloads over WebRTC
- **Advanced Consolidation** — More sophisticated LTP/LTD policies
- **Query Reranking** — Optional second-pass reranking for quality
- **Adaptive Chunking** — Context-aware page boundary detection
- **Multi-Modal Support** — Image/audio embeddings alongside text
- **CRDT-based Merge** — Conflict-free replicated data structures for multi-device sync
