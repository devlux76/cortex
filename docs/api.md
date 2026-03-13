# CORTEX API Reference

> **Status:** The codebase is under active development. The interfaces documented here reflect the current implemented contracts. The Hippocampus, Cortex, and Daydreamer orchestration layers are planned but not yet implemented.

## Table of Contents

1. [Core Data Types](#core-data-types)
2. [Storage Interfaces](#storage-interfaces)
3. [Vector Backends](#vector-backends)
4. [Embedding Backends](#embedding-backends)
5. [Model Profiles](#model-profiles)
6. [Routing Policy](#routing-policy)

---

## Core Data Types

All core data types are defined in [`core/types.ts`](../core/types.ts).

### Primitive Aliases

```typescript
type Hash      = string;   // SHA-256 hex digest
type Signature = string;   // base64 or hex signature
type PublicKey = string;   // JWK or raw public key
```

### Knowledge Hierarchy

CORTEX organises memory into a four-level hierarchy: **Page → Book → Volume → Shelf**.

#### `Page`

The fundamental unit of memory. A `Page` holds a single chunk of text and the byte offset of its embedding in the vector file.

```typescript
interface Page {
  pageId: Hash;             // SHA-256(content)
  content: string;          // bounded by the chunk policy derived from ModelProfile
  embeddingOffset: number;  // byte offset in the vector file
  embeddingDim: number;     // embedding dimension resolved from ModelProfile

  contentHash: Hash;        // SHA-256(content)
  vectorHash: Hash;         // SHA-256(vector bytes)

  prevPageId?: Hash | null;
  nextPageId?: Hash | null;

  creatorPubKey: PublicKey;
  signature: Signature;
  createdAt: string;        // ISO 8601 timestamp
}
```

#### `Book`

A named, ordered collection of `Page` objects, representing a coherent document or section.

```typescript
interface BookMetadata {
  title?: string;
  sourceUri?: string;
  tags?: string[];
  extra?: Record<string, unknown>;
}

interface Book {
  bookId: Hash;        // SHA-256(pageIds joined or Merkle root)
  pageIds: Hash[];
  medoidPageId: Hash;  // most representative page (medoid statistic)
  meta: BookMetadata;
}
```

#### `Volume`

A cluster of `Book` objects. Volumes store prototype vectors for fast coarse routing.

```typescript
interface Volume {
  volumeId: Hash;
  bookIds: Hash[];
  prototypeOffsets: number[];  // byte offsets of prototype vectors in the vector file
  prototypeDim: number;        // dimension of prototypes at this tier
  variance: number;
}
```

#### `Shelf`

The top-level cluster of `Volume` objects. Used for the coarsest level of routing.

```typescript
interface Shelf {
  shelfId: Hash;
  volumeIds: Hash[];
  routingPrototypeOffsets: number[];  // coarse prototype byte offsets
  routingDim: number;
}
```

#### `Edge`

A Hebbian connection between two pages.

```typescript
interface Edge {
  fromPageId: Hash;
  toPageId: Hash;
  weight: number;          // Hebbian weight (strengthened by co-activation)
  lastUpdatedAt: string;   // ISO 8601 timestamp
}
```

#### `SemanticNeighbor`

A nearest-neighbor entry in the semantic neighbor radius graph — a sparse proximity graph connecting pages with high cosine similarity, used for BFS subgraph expansion during retrieval.

```typescript
interface SemanticNeighbor {
  neighborPageId: Hash;
  cosineSimilarity: number;  // threshold defined by runtime policy
  distance: number;          // 1 – cosineSimilarity (TSP-ready)
}

interface SemanticNeighborSubgraph {
  nodes: Hash[];
  edges: { from: Hash; to: Hash; distance: number }[];
}
```

---

## Storage Interfaces

### `VectorStore`

An append-only binary store for raw embedding vectors. The default browser implementation uses OPFS (`storage/OPFSVectorStore.ts`). An in-memory implementation is available for testing (`storage/MemoryVectorStore.ts`).

```typescript
interface VectorStore {
  /** Append a vector and return its byte offset in the file. */
  appendVector(vector: Float32Array): Promise<number>;

  /** Read `dim` floats starting at byte offset `offset`. */
  readVector(offset: number, dim: number): Promise<Float32Array>;

  /** Read multiple vectors by their individual byte offsets. */
  readVectors(offsets: number[], dim: number): Promise<Float32Array[]>;
}
```

### `MetadataStore`

A structured store for the knowledge hierarchy backed by IndexedDB (or any equivalent engine). The default implementation is `storage/IndexedDbMetadataStore.ts`.

Reverse-index helpers (`getBooksByPage`, `getVolumesByBook`, `getShelvesByVolume`) are maintained automatically on every `put*` call.

```typescript
interface MetadataStore {
  // Core CRUD
  putPage(page: Page): Promise<void>;
  getPage(pageId: Hash): Promise<Page | undefined>;

  putBook(book: Book): Promise<void>;
  getBook(bookId: Hash): Promise<Book | undefined>;

  putVolume(volume: Volume): Promise<void>;
  getVolume(volumeId: Hash): Promise<Volume | undefined>;

  putShelf(shelf: Shelf): Promise<void>;
  getShelf(shelfId: Hash): Promise<Shelf | undefined>;

  // Hebbian edges
  putEdges(edges: Edge[]): Promise<void>;
  getNeighbors(pageId: Hash, limit?: number): Promise<Edge[]>;

  // Reverse-index helpers
  getBooksByPage(pageId: Hash): Promise<Book[]>;
  getVolumesByBook(bookId: Hash): Promise<Volume[]>;
  getShelvesByVolume(volumeId: Hash): Promise<Shelf[]>;

  // Semantic neighbor radius index
  putSemanticNeighbors(pageId: Hash, neighbors: SemanticNeighbor[]): Promise<void>;
  getSemanticNeighbors(pageId: Hash, maxDegree?: number): Promise<SemanticNeighbor[]>;

  /** BFS expansion of the semantic neighbor subgraph up to `maxHops` levels deep. */
  getInducedNeighborSubgraph(
    seedPageIds: Hash[],
    maxHops: number,
  ): Promise<SemanticNeighborSubgraph>;

  // Dirty-volume recalculation flags
  needsNeighborRecalc(volumeId: Hash): Promise<boolean>;
  flagVolumeForNeighborRecalc(volumeId: Hash): Promise<void>;
  clearNeighborRecalcFlag(volumeId: Hash): Promise<void>;
}
```

---

## Vector Backends

Vector backends handle the compute-intensive operations: dot products, projections, binary hashing, and top-K scoring.

### `VectorBackend` Interface

Defined in [`VectorBackend.ts`](../VectorBackend.ts).

```typescript
interface ScoreResult {
  index: number;
  score: number;
}

interface DistanceResult {
  index: number;
  distance: number;
}

interface VectorBackend {
  readonly kind: BackendKind;
  // ... dot product, project, hash, topK methods
}
```

### `BackendKind`

```typescript
type BackendKind = "webgpu" | "webgl" | "webnn" | "wasm";
```

### Creating a Backend

Use `createVectorBackend` from [`CreateVectorBackend.ts`](../CreateVectorBackend.ts). It detects the best available backend automatically and falls back to WASM if the preferred backend fails.

```typescript
import { createVectorBackend } from "./CreateVectorBackend";

// wasmBytes: the compiled Vectors.wat module as an ArrayBuffer
const backend = await createVectorBackend(wasmBytes);
console.log(backend.kind); // "webgpu" | "webgl" | "webnn" | "wasm"
```

**Fallback order:** WebGPU → WebGL / WebNN → WASM

---

## Embedding Backends

Embedding backends convert text into `Float32Array` vectors.

### `EmbeddingBackend` Interface

Defined in [`embeddings/EmbeddingBackend.ts`](../embeddings/EmbeddingBackend.ts).

```typescript
interface EmbeddingBackend {
  readonly kind: string;
  readonly dimension: number;

  /** Embed one or more texts. Returns one Float32Array per input text. */
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

### `EmbeddingRunner`

`EmbeddingRunner` (in [`embeddings/EmbeddingRunner.ts`](../embeddings/EmbeddingRunner.ts)) provides a lazy-initialising wrapper around an `EmbeddingBackend`. The backend is resolved once on first use and reused for subsequent calls.

```typescript
import { EmbeddingRunner } from "./embeddings/EmbeddingRunner";
import { createDummyProviderCandidate } from "./embeddings/ProviderResolver";

const runner = EmbeddingRunner.fromResolverOptions({
  candidates: [createDummyProviderCandidate()],
});

// Lazily resolves and caches the backend on first call
const vectors = await runner.embed(["hello world", "cortex memory"]);

// Inspect which provider was selected
console.log(runner.selectedKind); // e.g. "dummy"
```

### `resolveEmbeddingBackend`

For lower-level control, call `resolveEmbeddingBackend` directly from [`embeddings/ProviderResolver.ts`](../embeddings/ProviderResolver.ts).

```typescript
import {
  resolveEmbeddingBackend,
  createDummyProviderCandidate,
} from "./embeddings/ProviderResolver";

const result = await resolveEmbeddingBackend({
  candidates: [
    createDummyProviderCandidate({ dimension: 384 }),
    // add real WebNN / WebGPU / WebGL / WASM candidates here
  ],
  // preferredOrder: ["webnn", "webgpu", "webgl", "wasm", "dummy"],
  // forceKind: "wasm",
  // benchmark: { enabled: true, warmupRuns: 1, timedRuns: 3 },
});

console.log(result.selectedKind); // e.g. "webnn"
console.log(result.reason);       // "forced" | "benchmark" | "capability-order"
console.log(result.supportedKinds);
console.log(result.measurements); // per-provider mean latency in ms (when benchmark enabled)
```

#### `EmbeddingProviderCandidate`

Supply one candidate object per provider:

```typescript
interface EmbeddingProviderCandidate {
  kind: EmbeddingProviderKind;                          // "webnn" | "webgpu" | "webgl" | "wasm" | "dummy" | string
  isSupported: () => boolean | Promise<boolean>;        // runtime capability check
  createBackend: () => EmbeddingBackend | Promise<EmbeddingBackend>;
}
```

#### `ResolveEmbeddingBackendOptions`

```typescript
interface ResolveEmbeddingBackendOptions {
  candidates: EmbeddingProviderCandidate[];
  preferredOrder?: ReadonlyArray<EmbeddingProviderKind>; // default: webnn → webgpu → webgl → wasm → dummy
  forceKind?: EmbeddingProviderKind;                     // bypass capability checks and benchmarking
  benchmark?: Partial<EmbeddingProviderBenchmarkPolicy>;
  benchmarkBackend?: BenchmarkBackendFn;                 // override the timing function
}
```

---

## Model Profiles

A `ModelProfile` captures all numerics derived from an embedding model and prevents hardcoded model-dependent constants from spreading through the codebase.

### `ModelProfile`

Defined in [`core/ModelProfile.ts`](../core/ModelProfile.ts).

```typescript
interface ModelProfile {
  modelId: string;
  embeddingDimension: number;    // raw embedding size (e.g. 768, 1536)
  contextWindowTokens: number;   // model's maximum context window
  truncationTokens: number;      // derived: safe truncation limit
  maxChunkTokens: number;        // derived: maximum chunk size for ingest
  source: "metadata" | "registry" | "mixed";
}
```

### `ModelProfileResolver`

`ModelProfileResolver` (in [`core/ModelProfileResolver.ts`](../core/ModelProfileResolver.ts)) builds `ModelProfile` objects from runtime metadata or a pre-registered model registry.

```typescript
import { ModelProfileResolver } from "./core/ModelProfileResolver";

const resolver = new ModelProfileResolver({
  registry: {
    "nomic-embed-text-v1.5": {
      embeddingDimension: 768,
      contextWindowTokens: 8192,
    },
  },
});

// Resolve from the registry
const profile = resolver.resolve({ modelId: "nomic-embed-text-v1.5" });

// Resolve from runtime metadata (overrides registry values)
const profileFromMeta = resolver.resolve({
  modelId: "my-custom-model",
  metadata: { embeddingDimension: 1024, contextWindowTokens: 4096 },
});
```

### `buildModelProfileFromSeed`

A lower-level function for building a `ModelProfile` directly from seed values.

```typescript
import { buildModelProfileFromSeed } from "./core/ModelDefaults";

const profile = buildModelProfileFromSeed({
  modelId: "my-model",
  embeddingDimension: 384,
  contextWindowTokens: 512,
  source: "metadata",
});
```

---

## Routing Policy

A `RoutingPolicy` defines the three projection heads (broad, normal, narrow) used by the Cortex routing layer.

### `RoutingPolicy`

Defined in [`Policy.ts`](../Policy.ts).

```typescript
interface ProjectionHead {
  dimIn: number;    // input dimension (from the model profile)
  dimOut: number;   // compressed output dimension
  bits?: number;    // optional binary hash bit count (broad head)
  offset: number;   // byte offset in the shared projection buffer
}

interface RoutingPolicy {
  broad: ProjectionHead;    // coarsest projection, widest coverage
  normal: ProjectionHead;   // mid-range projection
  narrow: ProjectionHead;   // finest projection, highest precision
}
```

### `createRoutingPolicy`

Derives a `RoutingPolicy` from a `ModelProfile` (or any object with `embeddingDimension`).

```typescript
import { createRoutingPolicy } from "./Policy";

const policy = createRoutingPolicy(profile);
// policy.broad.dimOut, policy.normal.dimOut, policy.narrow.dimOut are all
// derived from profile.embeddingDimension via DEFAULT_ROUTING_POLICY_DERIVATION
```

### `resolveRoutingPolicyForModel`

Convenience function that resolves a model profile and derives the routing policy in a single call.

```typescript
import { resolveRoutingPolicyForModel } from "./Policy";

const { modelProfile, routingPolicy } = resolveRoutingPolicyForModel(
  { modelId: "nomic-embed-text-v1.5" },
  {
    resolverOptions: {
      registry: {
        "nomic-embed-text-v1.5": {
          embeddingDimension: 768,
          contextWindowTokens: 8192,
        },
      },
    },
  },
);
```

### `RoutingPolicyDerivation`

Override the default ratios when creating a policy:

```typescript
interface RoutingPolicyDerivation {
  broadDimRatio: number;    // default: 1/8  (0.125)
  normalDimRatio: number;   // default: 1/4  (0.25)
  narrowDimRatio: number;   // default: 1/2  (0.5)
  broadHashBits: number;    // default: 128
  dimAlignment: number;     // default: 8
  minProjectionDim: number; // default: 8
}
```

```typescript
const policy = createRoutingPolicy(profile, { normalDimRatio: 1 / 3 });
```
