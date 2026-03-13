# CORTEX

**Clustered Ontic Routing Through Entangled eXchanges**

A neurobiologically inspired, fully on-device epistemic memory engine for autonomous agents.

> "Our library is not a collection of words but of things that words have touched."

## What is CORTEX?

Modern agents are great at *retrieving* facts.  
They are terrible at *remembering* like a living mind.

CORTEX changes that.

It is a browser-native memory organism that runs 100% on-device — no servers, no cloud, no telemetry. Built from the ground up to feel like a real brain: fast associative encoding, coherent graph reasoning, and continuous background consolidation.

Everything stays private. Everything stays fast. And the entire memory graph can be shared via P2P without ever leaving the browser.

## The Three Living Regions

CORTEX is structured exactly like its biological namesakes:

### 🧠 Hippocampus — Fast Associative Encoding
When new observations arrive, Hippocampus immediately:
- Embeds them with a Matryoshka-capable model
- Performs lightning-fast WebGPU multi-prototype lookups
- Builds hierarchical prototypes (Pages → Books → Volumes → Shelves)
- Creates probabilistic Hebbian edges
- Stores raw vectors in an append-only OPFS file (e.g. `vortex_vectors.bin`)

This is the rapid, multi-path "write" system that turns raw experience into structured memory scaffolding.

### 🧩 Cortex — Intelligent Routing & Coherence
When you ask a question, Cortex does **not** return a bag of similar vectors.

Instead it:
- Performs parallel WebGPU "scoops" across the entire active universe (sub-millisecond)
- Pulls relevant sub-graphs from IndexedDB
- Traces closed-loop paths through Hebbian connections
- Returns only self-consistent, coherent context chains

The result feels like genuine recollection rather than search.

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
- **Three-Zone Memory** — HOT (resident in-memory index, capacity H(t)), WARM (indexed in IndexedDB), COLD (raw bytes in OPFS only). All data is retained locally; zones control lookup cost, not data lifetime.
- **Hierarchical & Sparse** — Progressive dimensionality reduction + medoid clustering keeps memory efficient at any scale, with Williams-derived fanout bounds preventing any single tier from monopolising the index.
- **Hebbian & Dynamic** — Connections strengthen and weaken naturally. Node salience (σ = α·H_in + β·R + γ·Q) drives promotion into and eviction from the resident hotpath.
- **Zero-Copy & Persistent** — OPFS + IndexedDB with cryptographic signing.

## Quick Start

```sh
npm install
npm run build       # type-check
npm run test:unit   # unit tests
npm run dev:harness # start the browser runtime harness at http://127.0.0.1:4173
```

## Documentation

| Document | Purpose |
|---|---|
| [`DESIGN.md`](DESIGN.md) | Architecture specification and core design principles |
| [`PLAN.md`](PLAN.md) | Module-by-module implementation status and development phases |
| [`TODO.md`](TODO.md) | Prioritized actionable tasks to ship v1.0 |
| [`docs/api.md`](docs/api.md) | API reference for developers integrating with CORTEX |
| [`docs/development.md`](docs/development.md) | Build, test, debug, and Docker workflow |
