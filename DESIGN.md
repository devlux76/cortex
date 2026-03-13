# CORTEX Design Specification

**Version:** 1.2
**Last Updated:** 2026-03-13

## Executive Summary

CORTEX (**C**lustered **O**ntic **R**outing **T**hrough **E**ntangled e**X**changes) is a neurobiologically inspired, fully on-device episodic memory engine for autonomous agents. It runs 100% in the browser with no servers, no cloud, and no telemetry. All memory stays local and private.

## Product Surface Reminder (App vs Library)

The same core engine serves two product surfaces with different user expectations:

### 1) Standalone App (Browser Extension)

The standalone product should feel like a clean, fast, personalized search engine over the internet the user has actually seen.

UX intent:
- Passive capture of visited pages to build a private recall index
- Search-first interface with fast response and minimal visual noise
- Recovery from vague recollection ("rabbit-hole memory"), not only exact keyword matching
- Lightweight metrics display (informative but secondary to search)

Model-mode requirement for app UX:
- **Nomic mode**: multimodal retrieval (text + images in shared latent space)
- **Gemma mode**: high-precision text retrieval (no image embedding)
- UI must make this capability boundary explicit so users understand when image recall is available

### 2) Library Surface (Embeddable)

The library remains headless and integration-first: ingest, retrieve, consolidate, and route memory for external tools without prescribing browser-extension UX patterns.

Design implication:
- Keep engine interfaces surface-agnostic
- Keep app-shell concerns (extension permissions, search controls, metrics presentation) outside core memory contracts

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
Returns self-consistent, coherent context chains rather than bag-of-vectors. Critically, Cortex **constructs Metroids** — structured dialectical search probes — to explore knowledge epistemically rather than merely confirming existing beliefs.

**Responsibilities:**
- Construct Metroids (dialectical probes `{ m1, m2, c }`) for each query topic
- Perform Matryoshka dimensional unwinding to discover antithesis medoids
- Perform parallel WebGPU "scoops" across the active universe (sub-millisecond)
- Pull relevant sub-graphs from IndexedDB
- Trace closed-loop paths through Hebbian connections
- Return only coherent context chains
- Detect knowledge gaps when antithesis discovery fails within dimensional constraints
- Broadcast P2P curiosity requests when a knowledge gap is detected

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

## Conceptual Constructs: Medoid, Centroid, and Metroid

Three separate mathematical constructs are central to CORTEX. They must never be conflated.

| Concept | Meaning |
|---------|---------|
| **Medoid** | An actual memory node selected as the statistical representative of a cluster. A medoid is always an existing page in the graph. |
| **Centroid** | A mathematical average of vectors — a computed geometric point, never a stored memory node. |
| **Metroid** | A structured dialectical search probe: `{ m1, m2, c }`. Constructed at query time. Never stored as a graph edge or persistent entity. |

> **Critical invariant:** These three constructs are entirely distinct. The sparse semantic neighbor graph that connects pages for subgraph expansion is **not** a Metroid. A Metroid is built from medoids, but a medoid is not a Metroid.

---

### The Metroid

A Metroid is a structured search probe used for epistemically balanced exploration of a topic.

```
Metroid = { m1, m2, c }
```

Where:
- **m1** — thesis medoid: the cluster representative most relevant to the query topic
- **m2** — antithesis medoid: a cluster representative discovered through constrained Matryoshka search to represent semantic opposition to m1
- **c** — centroid: the geometric midpoint between m1 and m2, used as the balanced search origin

The Metroid is constructed at query time by the `MetroidBuilder`. It is **not** a persistent graph structure. It is a transient epistemological instrument.

---

### MetroidBuilder Algorithm

1. **Select m1** — Identify the topic medoid most relevant to the query embedding.
2. **Freeze protected dimensions** — Lock the lower Matryoshka embedding dimensions that encode invariant semantic context (domain, language register, topic class). These dimensions are never searched for antithesis.
3. **Search for m2** — Within the remaining (unfrozen) upper dimensions, search for the nearest medoid that represents semantic opposition to m1.
4. **Compute centroid** — Compute `c` as follows:
   - Protected dimensions (index < `matryoshkaProtectedDim`): copy directly from m1. These dimensions are invariant; averaging them would dilute the domain anchor that makes the antithesis search meaningful.
   - Unfrozen dimensions (index >= `matryoshkaProtectedDim`): compute the element-wise average of m1 and m2 — `c[i] = (m1[i] + m2[i]) / 2`.
   - The result is a full-dimensional vector that can be used directly as a scoring anchor.
5. **Prefer centroid as search origin** — Use `c` as the primary starting point for subgraph expansion. This prevents semantic drift toward either pole.
6. **Unwind Matryoshka layers** — Progressively free deeper embedding dimensions and repeat from step 3. Each unwinding broadens the antithesis search.
7. **Stop at the protected dimension** — The protected lower dimensions are never unwound. This preserves semantic invariants throughout all levels of search.

**Why protect dimensions?**

Without dimensional protection, high-dimensional similarity in unrelated vocabulary can dominate the search. Specifically, upper Matryoshka dimensions encode fine-grained distinctions that may closely match surface-level word patterns regardless of topic. Protected lower dimensions encode domain context (e.g., "food/cooking") that anchors the search. Without this anchor, a query about pizza toppings could accumulate similarity mass toward adhesive-related terms in the high dimensions — because words describing how things stick together are statistically present in both culinary and industrial glue contexts. The protected dimensions ensure the culinary domain context is never overridden by this incidental high-dimensional similarity.

---

### Matryoshka Dimensional Unwinding

CORTEX uses Matryoshka Representation Learning (MRL) models that pack semantic information into nested dimensional layers:

- **Protected layer** (lower dimensions): invariant context — domain, topic class, language. Never searched for antithesis.
- **Exploration layers** (upper dimensions): fine-grained semantic distinctions. Progressively unwound during antithesis search.

At each unwinding step:
1. The protected dimension boundary shifts one layer outward.
2. The antithesis search space expands into the newly freed dimensions.
3. A new `m2` candidate is evaluated against the expanded space.
4. The Metroid `{ m1, m2, c }` is recomputed with the updated `m2`.

This produces progressively wider dialectical exploration while maintaining semantic coherence. The search terminates either when the protected dimension is reached or when a satisfactory `m2` is found.

---

### Dialectical Search

Every Metroid-driven query explores three zones:

| Zone | Pole | Meaning |
|------|------|---------|
| Thesis zone | around m1 | Supporting ideas, corroborating evidence |
| Antithesis zone | around m2 | Opposing ideas, counterevidence, alternative perspectives |
| Synthesis zone | around c | Conceptually balanced territory between both poles |

This three-zone exploration prevents **confirmation bias**: a system that only retrieves nearest neighbors to m1 returns documents that confirm the query's premise. By also exploring m2 and c, CORTEX surfaces contradictions, alternatives, and knowledge gaps.

The dialectical structure is the core reason CORTEX is described as an _epistemic_ memory system, not a vector retrieval engine.

---

### Knowledge Gap Detection

If at any stage of MetroidBuilder execution no suitable antithesis medoid `m2` can be found within the constrained search space:

```
knowledge_gap = true
```

This means CORTEX does not possess sufficient knowledge to provide an epistemically balanced answer. The correct response is to acknowledge the gap rather than fill it with ungrounded content.

**Response to a knowledge gap:**

1. Return a `KnowledgeGap` result indicating the topic, the deepest dimensional layer reached, and the search constraints that failed.
2. Emit a P2P curiosity request containing the incomplete Metroid.

---

### P2P Curiosity Requests

When a knowledge gap is detected, CORTEX broadcasts the incomplete Metroid as a curiosity probe to connected peers:

```
CuriosityProbe = {
  m1,
  partialMetroid,
  queryContext,
  knowledgeBoundary,
  mimeType,
  modelUrn
}
```

Where:
- **m1** — the thesis medoid (the topic for which antithesis was not found)
- **partialMetroid** — the incomplete Metroid at the boundary of local knowledge
- **queryContext** — the original query embedding, used for scoring by the responding peer
- **knowledgeBoundary** — the Matryoshka dimensional layer at which antithesis search failed
- **mimeType** — the MIME type of the embedded content (e.g. `text/plain`, `image/jpeg`). Required so receiving peers can validate commensurability of their graph sections.
- **modelUrn** — a URN identifying the specific embedding model and version used to produce the vectors (e.g. `urn:model:onnx-community/embeddinggemma-300m-ONNX:v1`). Peers **must** reject probes whose `modelUrn` does not match a model they can compare against. Accepting graph fragments embedded by a different model would produce incommensurable similarity scores at the dimensional boundaries where the models' Matryoshka layers overlap.

> **Why `mimeType` and `modelUrn` are required:**  
> Embedding models project content into incompatible latent spaces. A fragment embedded with `nomic-embed-text-v1.5` (matryoshkaProtectedDim=64) cannot be meaningfully compared against a fragment embedded with `embeddinggemma-300m` (matryoshkaProtectedDim=128). Without explicit model and content-type identity on the probe, a peer could return graph sections that appear similar by cosine score but are semantically incommensurable — introducing hallucination-equivalent errors at the knowledge boundary.

Peers receiving this probe:

1. Verify `mimeType` and `modelUrn` match a supported local model.
2. Search their own memory graphs for medoids that could serve as `m2` using the same embedding space.
3. If found, respond with the relevant graph fragment (subject to eligibility filtering; see Smart Sharing Guardrails).
4. The originating node integrates the received fragment and may retry MetroidBuilder.

This mechanism enables **distributed learning without hallucination**: the system discovers knowledge through structured peer exchange rather than generating plausible-sounding but ungrounded content.

---



### Motivation

CORTEX applies the Williams 2025 result — S = O(√(t log t)) — as a universal sublinear growth law everywhere the system trades space against time: the resident hotpath index, per-tier hierarchy quotas, per-community graph budgets, semantic neighbor degree limits, and Daydreamer maintenance batch sizing. This single principle ensures the system stays efficient as the memory graph scales from hundreds to millions of nodes.

### Graph Mass Definition

```
t = |V| + |E|  =  total pages  +  (Hebbian edges + semantic neighbor edges)
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

where `nᵢ` is the number of pages in community Cᵢ and N is the total page count. Community detection runs via lightweight label propagation on the semantic neighbor graph during Daydreamer idle passes.

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
t_eff            =  max(t, 2)                                       -- bootstrap floor (see below)
maxSubgraphSize  =  min(30,  ⌊√(t_eff · log₂(1+t_eff)) / log₂(t_eff)⌋)
maxHops          =  max(1,  ⌈log₂(log₂(1 + t_eff))⌉)
perHopBranching  =  max(1,  ⌊maxSubgraphSize ^ (1 / maxHops)⌋)
```

**Domain and bootstrap floor.** The raw formulas are undefined when t ≤ 1 (`log₂(1) = 0` → division by zero; `log₂(t) < 0` for t < 1). The effective-mass floor `t_eff = max(t, 2)` eliminates these edge cases. At cold-start (t < 2) the formulas evaluate conservatively to `maxSubgraphSize = 1, maxHops = 1, perHopBranching = 1`, which is safe and correct — a single-node subgraph is the only valid result when fewer than two nodes exist. As the corpus grows past the floor the clamp becomes inactive (`t_eff = t` for all t ≥ 2), so large-corpus dynamics are completely unaffected. The explicit `max(1, …)` guards on `maxHops` and `perHopBranching` provide a secondary safety net against rounding to zero on very small but valid inputs.

This keeps subgraph expansion cost sublinear in graph mass at scale while remaining well-behaved during cold-start and for tiny corpora.

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

#### Semantic Neighbor (Proximity Edge)
Sparse radius-graph edge connecting pages with high cosine similarity. Used for subgraph expansion during retrieval.

> **Note:** The current codebase names this type `MetroidNeighbor` — this is an architectural naming error introduced by early conceptual drift. The correct term is `SemanticNeighbor` (or equivalent). A code-level rename is tracked in the TODO. The edge is a proximity concept, not a Metroid concept.

```typescript
interface SemanticNeighbor {
  neighborPageId: Hash;
  cosineSimilarity: number;
  distance: number;           // 1 - cosineSimilarity (TSP-ready)
}
```

#### Semantic Neighbor Subgraph
Induced subgraph for BFS-based coherence path expansion.

> **Note:** Currently named `MetroidSubgraph` in the codebase — same renaming correction applies.

```typescript
interface SemanticNeighborSubgraph {
  nodes: Hash[];
  edges: { from: Hash; to: Hash; distance: number }[];
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
The shared record type for HOT membership. Used in two complementary roles:

1. **Live RAM index** — the active resident set (size ≤ H(t)) that every query scans first.
2. **IndexedDB persistence** — the `hotpath_index` store holds a periodic snapshot of the live index so that HOT membership and salience values survive a page reload or machine reboot. On startup, `HotpathEntry` rows are loaded from IndexedDB to reconstruct the RAM index without requiring a full corpus replay.

The Daydreamer worker owns the write path to `hotpath_index`; it checkpoints the live index whenever it runs its maintenance cycle (LTP/LTD pass), making the persisted snapshot no more than one cycle stale.

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
- `neighbor_graph` (sparse semantic neighbor graph — currently named `metroid_neighbors` in code; rename tracked in TODO)
- `flags` (dirty-volume recalc markers)
- `page_to_book`, `book_to_volume`, `volume_to_shelf` (reverse indexes)
- `hotpath_index` (periodic HOT-membership checkpoint, keyed by `entityId`; loaded on startup to reconstruct the RAM resident index; written by Daydreamer each maintenance cycle)
- `page_activity` (per-page activity metadata for salience computation)

## Retrieval Design

### Cortex Query Path

1. **Embed Query** — Generate query embedding
2. **Select m1** — Score resident medoids (HOT shelf/volume/book prototypes) to identify the topic medoid
3. **Build Metroid** — `MetroidBuilder` constructs `{ m1, m2, c }` via Matryoshka dimensional unwinding; if `m2` cannot be found, set `knowledge_gap = true` and emit a curiosity probe
4. **Score Resident Hierarchy** — Score query (anchored at centroid `c`) against HOT shelf prototypes in H(t) resident index
5. **Score Resident Volumes** — Score against HOT volume prototypes within top-ranked shelves
6. **Score Resident Books** — Score against HOT book medoids within top-ranked volumes
7. **Score Resident Pages** — Score against HOT page representatives within top-ranked books; explore thesis zone (m1), antithesis zone (m2), and synthesis zone (c)
8. **Spill to Warm/Cold** — If resident coverage is insufficient, expand lookup to WARM (IndexedDB) and COLD (OPFS) tiers
9. **Expand Subgraph** — BFS through semantic neighbor graph using dynamic Williams-derived bounds (see below)
10. **Solve Coherent Path** — Open TSP with dummy-node heuristic
11. **Return Result** — Ordered memory chain + provenance metadata (including whether a knowledge gap was detected)

Steps 2–3 are the dialectical heart of CORTEX. Steps 4–7 are the Williams-bound-controlled resident-first scoring cascade.

**Query Cost Meter:** The query path counts vector operations. If the cumulative cost exceeds a Williams-derived budget, the query early-stops and returns the best result found so far.

### Coherence via Open TSP
Rather than returning nearest neighbors by similarity, Cortex traces a coherent path through the induced subgraph using a dummy-node open TSP strategy. This produces a natural "narrative flow" through related memories.

### Key Constraints
- Steps 4–7 operate on the resident hotpath (H(t) entries), not the full corpus
- Metroid construction (step 3) is a prerequisite for dialectically balanced exploration; if it fails, a knowledge gap is declared
- Subgraph expansion (step 9) uses the **semantic neighbor graph** and dynamic Williams-derived bounds, not a fixed node cap:
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
6. **Fast Semantic Neighbor Insert** — Update semantic neighbor graph incrementally; bounded degree via `HotpathPolicy`; check new page for hotpath admission
7. **Mark Dirty** — Flag volumes for full recalc by Daydreamer

**Incremental Strategy:**
Fast local semantic neighbor insertion keeps query-time latency low. Full neighborhood recalculation is deferred to idle Daydreamer passes. Hotpath admission runs at ingest time for new pages and hierarchy prototypes.

## Consolidation Design

### Daydreamer Responsibilities

**LTP/LTD (Hebbian Updates):**
- Strengthen edges traversed during successful queries
- Decay unused edges toward zero
- Prune edges below threshold, keeping semantic neighbor degree within Williams-derived bounds
- After LTP/LTD: recompute σ(v) for all nodes whose incident edges changed; run promotion/eviction sweep via `SalienceEngine`

**Prototype Recomputation:**
- Recompute volume/shelf medoids and centroids
- Update prototype vectors in vector file
- After recomputation: recompute salience for affected representative entries; run tier-quota promotion/eviction for volume and shelf tiers

**Full Neighbor Graph Recalc:**
- For dirty volumes, recompute all pairwise similarities
- Bound batch size: process at most O(√(t log t)) pairwise comparisons per idle cycle
- Prioritise dirtiest volumes first
- Rebuild bounded neighbor lists; degree limit derived from `HotpathPolicy`
- Clear dirty flags; recompute salience for affected nodes; run promotion sweep

**Community Detection:**
- Run lightweight label propagation on the semantic neighbor graph during idle passes
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
6. **Privacy-Safe Sharing** — Shared payloads must pass eligibility filtering so identity/PII-bearing nodes are not exported

## System Boundaries

### In Scope for v1
- On-device ingest, query, consolidation, persistence
- Multi-backend vector compute (`webgpu`, `webgl`, `webnn`, `wasm`)
- Signed graph entities with hash verification
- Sparse semantic neighbor graph for coherence routing
- Smart interest sharing: opt-in signed subgraph exchange over P2P with pre-share eligibility filtering

### Out of Scope for v1
- Full production-grade distributed consensus
- Cross-device key escrow or account systems
- Large-scale multi-tenant synchronization services
- Raw, unfiltered whole-graph export

### Smart Sharing Guardrails (v1 Required)

Smart sharing is a core capability, not a post-v1 extra. The v1 exchange path must:

- Share only user-opted, public-interest graph sections (topic slices), not identity-bearing personal traces
- Run an eligibility classifier pass before export to block PII/person-specific leakage
- Preserve signatures and provenance on shared nodes so recipients can verify authenticity
- Keep transport peer-to-peer and on-device, with no central telemetry dependency

## Terminology

**Medoid** (mathematical term): The existing memory node selected as the statistical representative of a cluster. Selected by minimising the sum of distances to all other nodes in the cluster. Used throughout algorithmic descriptions and internal implementation comments.

**Centroid** (mathematical term): In MetroidBuilder, the centroid `c` is a full-dimensional vector where protected dimensions are copied from m1 (domain invariant) and unfrozen dimensions are the element-wise average of m1 and m2. Used as the balanced search origin in dialectical scoring.

**Metroid** (CORTEX architectural term): A structured dialectical search probe constructed at query time: `{ m1, m2, c }`, where m1 is the thesis medoid, m2 is the antithesis medoid, and c is the centroid (protected dims from m1; unfrozen dims averaged). **A Metroid is never stored as a persistent graph structure.** It is an ephemeral instrument used by the CORTEX retrieval subsystem.

**MetroidBuilder**: The CORTEX module responsible for constructing a Metroid for a given query via Matryoshka dimensional unwinding. Planned module: `cortex/MetroidBuilder.ts`.

**Semantic neighbor graph** (also: proximity graph, neighbor graph): The sparse radius-graph of cosine-similarity edges between pages, used for subgraph expansion during retrieval. This is **not** the same as a Metroid. The edges connect pages with high cosine similarity and are used for BFS expansion. Currently named `MetroidNeighbor` / `metroid_neighbors` in the codebase — this is a naming error that must be corrected (tracked in TODO as P0-X).

**Hotpath**: The in-memory resident index of H(t) entries spanning all four hierarchy tiers. The hotpath is the first lookup target for every query; misses spill to WARM/COLD storage. HOT membership and salience are checkpointed to the `hotpath_index` IndexedDB store by Daydreamer each maintenance cycle, allowing the RAM index to be restored after a page reload or machine reboot without full corpus replay.

**Williams Bound**: The theoretical result S = O(√(t log t)) from Williams 2025, applied here as a universal sublinear growth law for all space-time tradeoff subsystems in CORTEX.

**Graph mass (t)**: t = |V| + |E| = total pages plus all edges (Hebbian + semantic neighbor). The canonical input to all capacity and bound formulas.

**Salience (σ)**: Node-level score combining Hebbian edge weight, recency, and query-hit frequency. Drives admission to and eviction from the hotpath.

**Three-zone model**: HOT (resident), WARM (IndexedDB-indexed), COLD (OPFS bytes only). All zones retain data locally; zones differ only in lookup cost.

**Community**: A topically coherent subgraph identified by label propagation on the semantic neighbor graph. Community quotas prevent any single topic from monopolising the hotpath.

**Knowledge gap**: A state where MetroidBuilder cannot find a valid antithesis medoid `m2` within dimensional constraints. Triggers a P2P curiosity request.

**Curiosity probe**: A P2P broadcast containing an incomplete Metroid (`{ m1, partialMetroid, knowledgeBoundary }`) sent when a knowledge gap is detected. Peers respond with graph fragments that may enable antithesis discovery.

## Model-Derived Numerics

**Critical Rule:** All numeric values derived from ML model architecture (embedding dimensions, context lengths, thresholds, and Matryoshka sub-dimension boundaries) must **never** be hardcoded as magic numbers.

**Source of Truth:**
- `core/ModelProfile.ts` — Interface definition (includes `matryoshkaProtectedDim`)
- `core/ModelDefaults.ts` — Default derivation from seed values
- `core/BuiltInModelProfiles.ts` — Concrete model registrations (includes per-model `matryoshkaProtectedDim`)
- `core/ModelProfileResolver.ts` — Runtime resolution

**Model-specific `matryoshkaProtectedDim` values (must be sourced from `BuiltInModelProfiles.ts`):**

| Model | `matryoshkaProtectedDim` | Notes |
|-------|--------------------------|-------|
| `onnx-community/embeddinggemma-300m-ONNX` | 128 | Smallest supported Matryoshka sub-dimension |
| `nomic-ai/nomic-embed-text-v1.5` | 64 | To be added when nomic provider is wired |

**Enforcement:** `npm run guard:model-derived` scans for violations before CI merge. The guard now checks for `matryoshkaProtectedDim` in addition to the standard embedding dimension and context length fields.

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

- **Federated Sharing Optimization** — Better peer-ranking, deduplication, and prioritization for high-signal interest updates
- **Advanced Consolidation** — More sophisticated LTP/LTD policies
- **Query Reranking** — Optional second-pass reranking for quality
- **Adaptive Chunking** — Context-aware page boundary detection
- **Multi-Modal Support** — Image/audio embeddings alongside text
- **CRDT-based Merge** — Conflict-free replicated data structures for multi-device sync
- **Empirical Calibration of c** — Instrument real workloads to tune the Williams Bound scaling constant across diverse corpus profiles
