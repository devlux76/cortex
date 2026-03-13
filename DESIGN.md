# CORTEX Design Specification

**Version:** 1.1
**Last Updated:** 2026-03-13

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

## The Williams Bound & Sublinear Growth

### Motivation

CORTEX applies the Williams 2025 result — S = O(√(t log t)) — as a universal sublinear growth law everywhere the system trades space against time: the resident hotpath index, per-tier hierarchy quotas, per-community graph budgets, Metroid degree limits, and Daydreamer maintenance batch sizing. This single principle ensures the system stays efficient as the memory graph scales from hundreds to millions of nodes.

### Graph Mass Definition

```
t = |V| + |E|  =  total pages  +  (Hebbian edges + Metroid edges)
```

This is the canonical measure of graph complexity used in all capacity formulas.

### Resident Hotpath Capacity

```
H(t) = ⌈c · √(t · log₂(1 + t))⌉
```

`c` is an empirically tuned constant (default in `core/HotpathPolicy.ts`; not a theorem output). H(t) defines the maximum number of entities resident in the in-memory hotpath index across all tiers.

**Growth properties (required by tests):**
- H(t) is monotonically non-decreasing as t grows
- H(t) grows sublinearly relative to t (confirmed by benchmark at 1K, 10K, 100K, 1M)

### Three-Zone Memory Model

| Zone | Resident? | Storage | Typical Lookup Cost |
|------|-----------|---------|---------------------|
| **HOT** | Yes — in resident index, capacity H(t) | RAM | Sub-millisecond |
| **WARM** | No — indexed, not resident | IndexedDB | Single-digit milliseconds |
| **COLD** | No — raw bytes only, no index entry | OPFS | Tens of milliseconds |

All data is retained locally across all three zones. Zones control lookup **cost**, not data **lifetime**. The runtime continuously promotes and evicts entries between HOT and WARM based on salience.

### Node Salience

Each page `v` carries a node-level salience score that drives promotion into and eviction from the hotpath:

```
σ(v) = α · H_in(v)  +  β · R(v)  +  γ · Q(v)
```

| Component | Meaning |
|-----------|---------|
| `H_in(v)` | Sum of incident Hebbian edge weights |
| `R(v)` | Recency score — exponential decay from `createdAt` / `lastQueryAt` |
| `Q(v)` | Query-hit count for the node |
| α, β, γ | Tunable weights summing to 1.0 (defaults: 0.5 / 0.3 / 0.2) |

Salience requires lightweight per-page activity metadata (`queryHitCount`, `lastQueryAt`) stored in the `page_activity` IndexedDB object store.

### Hierarchical Tier Quotas

H(t) is partitioned across the four-tier hierarchy so no single tier can monopolise the resident index:

| Tier | Default Quota | Purpose |
|------|--------------|---------|
| Shelf | q_s = 10% | Routing prototypes |
| Volume | q_v = 20% | Cluster prototypes |
| Book | q_b = 20% | Book medoids |
| Page | q_p = 50% | Individual page representatives |

**Constraint:** q_s + q_v + q_b + q_p = 1.0

Within each tier, entries are ranked by salience; the highest-salience representatives are admitted up to the tier budget. Shelf, Volume, and Book representatives are selected by the medoid statistic within their cluster, then ranked by salience for admission.

### Graph-Community Coverage Quotas

Within each tier's budget, slots are allocated proportionally across detected graph communities to prevent a single dense topic from consuming all capacity. The allocation uses the **largest-remainder method** to guarantee the quotas sum exactly to `tier_budget`:

1. Compute the ideal fractional share for each community:
   ```
   share(Cᵢ) = tier_budget · nᵢ / N
   ```
2. Floor each share to get a base allocation:
   ```
   base(Cᵢ) = ⌊share(Cᵢ)⌋
   ```
3. Distribute the remaining `tier_budget − Σ base(Cᵢ)` slots one-by-one to the communities with the largest fractional remainders (`share(Cᵢ) − base(Cᵢ)`), breaking ties by community size (larger community wins).
4. Communities that receive a base of 0 and are not selected in step 3 are **excluded** from this tier (no slot). This is intentional: sparse communities are not promoted until they grow.

The resulting quotas sum to exactly `tier_budget` regardless of the number or sizes of communities, even when there are more communities than `tier_budget`.

where `nᵢ` is the number of pages in community Cᵢ and N is the total page count. Community detection runs via lightweight label propagation on the Metroid neighbor graph during Daydreamer idle passes.

This **dual constraint** — tier quota × community quota — ensures both vertical coverage across hierarchy levels and horizontal coverage across topics.

### Promotion and Eviction Lifecycle

**Bootstrap phase** (while resident count < H(t)): admit the highest-salience candidate not yet resident.

**Steady-state phase**: promote a new or updated node only if its salience exceeds the weakest resident in the same tier and community bucket. On promotion, evict the weakest; break ties by recency.

**Trigger points:**
- On ingest — newly ingested pages become candidates
- On query hit — `queryHitCount` increases; salience is recomputed; promotion sweep runs
- On Daydreamer pass — after LTP/LTD, recompute salience for affected nodes; run promotion sweep

### Sublinear Fanout Bounds

Maximum children per hierarchy node also respect Williams-derived limits to prevent unbounded fan-out:

```
Max volumes per shelf  =  O(√(|volumes| · log |volumes|))
Max books per volume   =  O(√(|books_in_volume| · log |books_in_volume|))
```

When exceeded, `HierarchyBuilder` or `ClusterStability` triggers a split.

### Dynamic Subgraph Expansion Bounds

The fixed `<30 node` subgraph target is replaced by dynamic formulas that shrink gracefully as the graph grows:

```
maxSubgraphSize  =  min(30,  ⌊√(t · log₂(1+t)) / log₂(t)⌋)
maxHops          =  ⌈log₂(log₂(1 + t))⌉
perHopBranching  =  ⌊maxSubgraphSize ^ (1 / maxHops)⌋
```

This keeps subgraph expansion cost sublinear in graph mass.

### Policy Source of Truth

All hotpath constants — `c`, `α`, `β`, `γ`, `q_s`, `q_v`, `q_b`, `q_p` — live in `core/HotpathPolicy.ts` as a frozen default policy object. These are **policy-derived constants** (not model-derived) and are kept strictly separate from `core/ModelDefaults.ts`. A companion guard (or an extension to `guard:model-derived`) is planned (see TODO.md P3-E3) to prevent these constants from being hardcoded elsewhere; until that guard is in place, discipline is enforced by convention.

---

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

### Hotpath Entities

#### PageActivity
Lightweight per-page activity metadata maintained alongside each Page. Drives salience computation and community assignment.

```typescript
interface PageActivity {
  pageId: Hash;
  queryHitCount: number;      // incremented on each query hit
  lastQueryAt: string;        // ISO timestamp of most recent query hit
  communityId?: string;       // set by Daydreamer label propagation
}
```

#### HotpathEntry
A record in the resident in-memory index. Tracks which entity is HOT and at what salience level.

```typescript
interface HotpathEntry {
  entityId: Hash;             // pageId, bookId, volumeId, or shelfId
  tier: 'shelf' | 'volume' | 'book' | 'page';
  salience: number;           // σ value at last computation
  communityId?: string;       // community this entry counts against
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
- `hotpath_index` (resident hotpath entries, keyed by `entityId`)
- `page_activity` (per-page activity metadata for salience computation)

## Retrieval Design

### Cortex Query Path

1. **Embed Query** — Generate query embedding
2. **Score Resident Shelves** — Score query against HOT shelf prototypes in H(t) resident index
3. **Score Resident Volumes** — Score against HOT volume prototypes within top-ranked shelves
4. **Score Resident Books** — Score against HOT book medoids within top-ranked volumes
5. **Score Resident Pages** — Score against HOT page representatives within top-ranked books
6. **Spill to Warm/Cold** — If resident coverage is insufficient, expand lookup to WARM (IndexedDB) and COLD (OPFS) tiers
7. **Expand Subgraph** — BFS through Metroid neighbors using dynamic bounds (see below)
8. **Solve Coherent Path** — Open TSP with dummy-node heuristic
9. **Return Result** — Ordered memory chain + provenance metadata

Steps 2–5 operate exclusively on the resident set of size H(t), making H(t) the primary latency-control mechanism. Spill to WARM/COLD (step 6) occurs only when the resident set does not contain sufficient coverage.

**Query Cost Meter:** The query path counts vector operations. If the cumulative cost exceeds a Williams-derived budget, the query early-stops and returns the best result found so far.

### Coherence via Open TSP
Rather than returning nearest neighbors by similarity, Cortex traces a coherent path through the induced subgraph using a dummy-node open TSP strategy. This produces a natural "narrative flow" through related memories.

### Key Constraints
- Steps 2–5 operate on the resident hotpath (H(t) entries), not the full corpus
- Subgraph expansion uses dynamic Williams-derived bounds, not a fixed node cap:
  - `maxSubgraphSize = min(30, ⌊√(t · log₂(1+t)) / log₂(t)⌋)`
  - `maxHops = ⌈log₂(log₂(1 + t))⌉`
  - `perHopBranching = ⌊maxSubgraphSize ^ (1/maxHops)⌋`
- Deterministic under same input for reproducibility
- Query cost is metered; early-stop prevents unbounded latency

## Ingestion Design

### Hippocampus Ingest Path

1. **Chunk Text** — Split into pages respecting token budgets from ModelProfile
2. **Generate Embeddings** — Batch embed with selected provider
3. **Persist Vectors** — Append to OPFS vector file
4. **Persist Pages** — Write page metadata to IndexedDB; initialise `PageActivity` record
5. **Build/Attach Hierarchy** — Construct/update books, volumes, shelves; attempt hotpath admission for each level's medoid/prototype using tier quota via `SalienceEngine`
6. **Fast Neighbor Insert** — Update Metroid neighbors incrementally; bounded degree via `HotpathPolicy`; check new page for hotpath admission
7. **Mark Dirty** — Flag volumes for full recalc by Daydreamer

**Incremental Strategy:**
Fast local Metroid neighbor insertion keeps query-time latency low. Full neighborhood recalculation is deferred to idle Daydreamer passes. Hotpath admission runs at ingest time for new pages and hierarchy prototypes.

## Consolidation Design

### Daydreamer Responsibilities

**LTP/LTD (Hebbian Updates):**
- Strengthen edges traversed during successful queries
- Decay unused edges toward zero
- Prune edges below threshold, keeping Metroid degree within Williams-derived bounds
- After LTP/LTD: recompute σ(v) for all nodes whose incident edges changed; run promotion/eviction sweep via `SalienceEngine`

**Prototype Recomputation:**
- Recompute volume/shelf medoids and centroids
- Update prototype vectors in vector file
- After recomputation: recompute salience for affected representative entries; run tier-quota promotion/eviction for volume and shelf tiers

**Full Metroid Recalc:**
- For dirty volumes, recompute all pairwise similarities
- Bound batch size: process at most O(√(t log t)) pairwise comparisons per idle cycle
- Prioritise dirtiest volumes first
- Rebuild bounded neighbor lists; degree limit derived from `HotpathPolicy`
- Clear dirty flags; recompute salience for affected nodes; run promotion sweep

**Community Detection:**
- Run lightweight label propagation on the Metroid neighbor graph during idle passes
- Store community labels in `PageActivity.communityId`
- Rerun when dirty-volume flags indicate meaningful structural change
- Empty communities release their slots; new communities receive at least one slot

**Experience Replay:**
- Simulate queries over recent memories
- Reinforce important connection patterns

**Cluster Stability:**
- Detect unstable clusters (high variance, imbalanced size, Williams fanout violation)
- Trigger split/merge when thresholds exceeded
- Run community detection after structural changes

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
| Query seed ranking (resident) | <20ms | H(t) resident index |
| Coherence path solve | <10ms | Dynamic subgraph (≤30 nodes) |
| Daydreamer work | Interruptible | No blocking |
| Hotpath promotion/eviction | <5ms | Per trigger point |

**Graceful Degradation:**
All operations must complete on WASM fallback, albeit slower. The resident hotpath index reduces query latency proportionally to H(t) coverage of the working set.

## Non-Negotiable Constraints

1. **No Cloud Dependency** — Core operation 100% on-device
2. **Fast Local Retrieval** — Must work on degraded hardware
3. **Persistent Local State** — Survive browser restart with integrity checks
4. **Idle Consolidation** — Background quality improvements, not expensive write-time computation
5. **Sublinear Growth** — The resident hotpath index must never exceed H(t); all space-time tradeoff subsystems must target O(√(t log t)) scaling

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

**Hotpath**: The in-memory resident index of H(t) entries spanning all four hierarchy tiers. The hotpath is the first lookup target for every query; misses spill to WARM/COLD storage.

**Williams Bound**: The theoretical result S = O(√(t log t)) from Williams 2025, applied here as a universal sublinear growth law for all space-time tradeoff subsystems in CORTEX.

**Graph mass (t)**: t = |V| + |E| = total pages plus all edges (Hebbian + Metroid). The canonical input to all capacity and bound formulas.

**Salience (σ)**: Node-level score combining Hebbian edge weight, recency, and query-hit frequency. Drives admission to and eviction from the hotpath.

**Three-zone model**: HOT (resident), WARM (IndexedDB-indexed), COLD (OPFS bytes only). All zones retain data locally; zones differ only in lookup cost.

**Community**: A topically coherent subgraph identified by label propagation on the Metroid neighbor graph. Community quotas prevent any single topic from monopolising the hotpath.

## Model-Derived Numerics

**Critical Rule:** All numeric values derived from ML model architecture (embedding dimensions, context lengths, thresholds) must **never** be hardcoded as magic numbers.

**Source of Truth:**
- `core/ModelProfile.ts` — Interface definition
- `core/ModelDefaults.ts` — Default fallback values
- `core/BuiltInModelProfiles.ts` — Concrete model registrations
- `core/ModelProfileResolver.ts` — Runtime resolution

**Enforcement:** `npm run guard:model-derived` scans for violations before CI merge.

## Policy-Derived Constants

A parallel class of constants governs the Williams Bound hotpath architecture. These are **not** model-derived (they do not depend on ML architecture); they are empirically tuned policy values.

**Source of Truth:** `core/HotpathPolicy.ts` — frozen default policy object

| Constant | Default | Meaning |
|----------|---------|---------|
| `c` | 0.5 | Scaling factor in H(t) formula |
| `α` | 0.5 | Salience weight for Hebbian connectivity |
| `β` | 0.3 | Salience weight for recency |
| `γ` | 0.2 | Salience weight for query-hit frequency |
| `q_s` | 0.10 | Shelf tier quota fraction |
| `q_v` | 0.20 | Volume tier quota fraction |
| `q_b` | 0.20 | Book tier quota fraction |
| `q_p` | 0.50 | Page tier quota fraction |

**Enforcement:** Policy constants must not be hardcoded outside `core/HotpathPolicy.ts`. A companion guard or ESLint rule prevents silent duplication.

## Future Directions (Post-v1)

- **P2P Memory Exchange** — Signed subgraph payloads over WebRTC
- **Advanced Consolidation** — More sophisticated LTP/LTD policies
- **Query Reranking** — Optional second-pass reranking for quality
- **Adaptive Chunking** — Context-aware page boundary detection
- **Multi-Modal Support** — Image/audio embeddings alongside text
- **CRDT-based Merge** — Conflict-free replicated data structures for multi-device sync
- **Empirical Calibration of c** — Instrument real workloads to tune the Williams Bound scaling constant across diverse corpus profiles
