# CORTEX

**Clustered Ontic Routing Through Entangled eXchanges**

A neurobiologically inspired, fully on-device epistemic memory engine for autonomous agents.

> "The library of dreams is not a collection of words but of things that words have touched — and how those things feel from the inside."

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
- Stores raw vectors in an append-only OPFS file (`vortex_vectors.bin`)

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

- **Biological Scarcity** — Only a fixed number of active prototypes live in VRAM. Everything else is gracefully demoted to disk.
- **Hierarchical & Sparse** — Progressive dimensionality reduction + medoid clustering keeps memory efficient at any scale.
- **Hebbian & Dynamic** — Connections strengthen and weaken naturally.
- **Zero-Copy & Persistent** — OPFS + IndexedDB with cryptographic signing.
