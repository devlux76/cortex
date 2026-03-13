# CORTEX

**Clustered Ontic Routing Through Entangled eXchanges**

A neurobiologically inspired, fully on-device epistemic memory engine for autonomous agents.

> "Our library is not a collection of words but of things that words have touched."

## What is CORTEX?

Modern agents are great at *retrieving* facts.  
They are terrible at *remembering* like a living mind.

CORTEX changes that.

It is a browser-native memory organism that runs 100% on-device — no servers, no cloud, no telemetry. Built from the ground up to feel like a real brain: fast associative encoding, coherent graph reasoning, and continuous background consolidation.

Everything stays private. Everything stays fast. And privacy-safe, interest-focused graph slices can be shared via P2P without ever leaving the browser.

## Product Direction: App + Library

CORTEX is intentionally built with two first-class surfaces:

- **Standalone App (Browser Extension)**
  A lightweight, search-first personal memory engine that passively tracks pages the user has actually visited and turns that history into a fast, clean, private recall interface.

  The target experience is: "I went down a rabbit hole weeks ago and only remember a vague impression" -> one search query should still recover the path, the page, or the image.

  The app UI should prioritize:
  - Instant search results over visited web history
  - Ontic retrieval (thing-level recollection), not only keyword or semantic matching
  - Clear, low-noise metrics (like the current preview, but more polished and scannable)
  - Opt-in discovery feed from privacy-filtered, signed peer graph slices (public-interest content only)

- **Embeddable Library**
  A headless TypeScript memory substrate for other tools and agents. Integrators should be able to ingest, route, query, and consolidate memory without inheriting browser-extension UX concerns.

### Model Choice in the Standalone App

The standalone UX should expose a user-selectable model mode:

- **Nomic**: multimodal embeddings (text + images projected into one latent space). Best for visual recollection, e.g., recalling a previously seen image from a fuzzy prompt like "swirling dream-like scene."
- **Gemma**: text-only embeddings with stronger fine-grained textual precision. Best for exact or nuanced text recall where image embedding is not required.

The model toggle should clearly communicate capability trade-offs, especially that image recall is only available in multimodal mode.

## The Three Living Regions

CORTEX is structured exactly like its biological namesakes:

### 🧠 Hippocampus — Fast Associative Encoding

Hebbian Influenced Parametric Projection Over Clustered Autoassociative Memory Patterns to Unify Systems

When new observations arrive, Hippocampus immediately:
- Embeds them with a Matryoshka-capable model
- Performs lightning-fast WebGPU multi-prototype lookups
- Builds hierarchical prototypes (Pages → Books → Volumes → Shelves)
- Creates probabilistic Hebbian edges
- Stores raw vectors in an append-only OPFS file (e.g. `vortex_vectors.bin`)

This is the rapid, multi-path "write" system that turns raw experience into structured memory scaffolding.

### 🧩 Cortex — Intelligent Routing & Coherence
Cortex does **not** return a bag of similar vectors.

**Required behavior (v0.5+ engineering target):**
- Must construct a **Metroid** `{ m1, m2, c }` for every query — a structured dialectical search probe pairing the thesis medoid (m1) with an antithesis medoid (m2) and a balanced centroid (c)
  - The centroid `c` is a synthetic "Kansas space" vantage point (no real node lives there); scoring from `c` must give equal weight to both poles
- Must perform Matryoshka dimensional unwinding to discover semantically opposing knowledge
- Must perform parallel WebGPU "scoops" across the entire active universe (sub-millisecond)
- Must pull relevant sub-graphs from IndexedDB
- Must trace closed-loop paths through Hebbian connections
- Must return only self-consistent, coherent context chains
- Must detect **knowledge gaps** when no antithesis medoid exists within dimensional constraints
- Must broadcast P2P curiosity probes (with `mimeType` + `modelUrn` for commensurability) to discover missing knowledge from peers

**Current behavior (v0.1 — placeholder):**
- Flat top-K similarity scoring against the hotpath resident index with warm/cold spill
- No MetroidBuilder, no dialectical pipeline, no knowledge gap detection yet

The result of the full v0.5 system will feel like genuine recollection rather than search — and will surface what you *don't* know as clearly as what you do.

### 🌙 Daydreamer — The Default Mode Network
When the agent is idle, a throttled Web Worker takes over:
- Strengthens important connections (LTP)
- Gently decays and prunes weak ones (LTD)
- Recomputes medoids and centroids
- Replays recent experiences in the background
- Keeps the entire memory universe coherent and alive

This is the "dreaming" phase that prevents catastrophic forgetting and forces abstraction.

## Core Design Principles

- **Biological Scarcity** — Only a fixed number of active prototypes live in memory. Everything else is gracefully demoted to disk.
- **Sublinear Growth (Williams Bound)** — The resident hotpath index is bounded to H(t) = ⌈c·√(t·log₂(1+t))⌉ where t = total graph mass (pages + edges). Memory scales sublinearly as the graph grows, trading time for space at a mathematically principled rate. See [`DESIGN.md`](DESIGN.md) for the full theorem mapping.
- **Three-Zone Memory** — HOT (resident in-memory index, capacity H(t)), WARM (indexed in IndexedDB, reachable via nearest-neighbour search), COLD (metadata in IndexedDB + raw vectors in OPFS, but semantically isolated from the search path — no strong nearest neighbours in vector space at insertion time; only discoverable by a deliberate random walk). All data is retained locally forever; zones control lookup cost and discoverability, not data lifetime.
- **Hierarchical & Sparse** — Progressive dimensionality reduction + medoid clustering keeps memory efficient at any scale, with Williams-derived fanout bounds preventing any single tier from monopolising the index.
- **Hebbian & Dynamic** — Connections strengthen and weaken naturally. Node salience (σ = α·H_in + β·R + γ·Q) drives promotion into and eviction from the resident hotpath.
- **Zero-Copy & Persistent** — OPFS + IndexedDB with cryptographic signing.

## Quick Start

```sh
bun install
bun run build       # type-check
bun run test:unit   # unit tests
bun run dev:harness # start the browser runtime harness at http://127.0.0.1:4173
```

## Documentation

| Document | Purpose |
|---|---|
| [`DESIGN.md`](DESIGN.md) | Architecture specification and core design principles |
| [`PLAN.md`](PLAN.md) | Module-by-module implementation status and development phases |
| [`TODO.md`](TODO.md) | Prioritized actionable tasks to ship v1.0 |
| [`ARCHITECTURE-REVIEW.md`](ARCHITECTURE-REVIEW.md) | Repository-wide architectural drift report and correction tasks |
| [`docs/api.md`](docs/api.md) | API reference for developers integrating with CORTEX |
| [`docs/development.md`](docs/development.md) | Build, test, debug, and Docker workflow |
