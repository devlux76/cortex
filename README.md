# CORTEX

**Clustered Ontic Routing Through Entangled eXchanges**

A neurobiologically inspired, fully on-device epistemic memory engine for autonomous agents.

> "The library of dreams is not a collection of words but of things that words have touched — and how those things feel from the inside."

## Execution Update (2026-03-11)

Canonical documentation contract:
1. Product vision and non-negotiables: `README.md`
2. Architecture contracts and capability backlog: `CORTEX-DESIGN-PLAN-TODO.md`
3. Execution sequencing, command contract, and test gates: `PROJECT-EXECUTION-PLAN.md`

Current implementation snapshot:
1. Foundation, storage schema, and vector backend abstractions are implemented.
2. Model-profile-driven numeric ownership is implemented and guarded by `npm run guard:model-derived`.
3. Adaptive embedding resolver infrastructure exists, but real providers are still being wired.
4. Runtime harness and browser lane are implemented (`npm run dev:harness`, `npm run test:browser`).
5. Electron lane is wired but environment-dependent (`npm run test:electron` requires Electron binary availability).
6. Hippocampus/Cortex/Daydreamer orchestration layers remain the primary vertical-slice gap.

Current delivery priorities (P0):
1. Keep docs synchronized to real code state on every implementation pass.
2. Stabilize Electron provisioning in CI so `runtime-electron` can run as a hard gate.
3. Wire first real embedding providers into runtime selection path.
4. Implement Hippocampus ingest and Cortex retrieval vertical slices with strict TDD.
5. Preserve model-derived defaults and avoid hardcoded model-dependent numerics.

Session-close update checklist (required):
1. Update `PROJECT-EXECUTION-PLAN.md` pass status with completed work and exact commands run.
2. Update `CORTEX-DESIGN-PLAN-TODO.md` status matrix when implementation state changes.
3. Record blockers with file path, failure symptom, and next action.
4. Confirm README priorities still match the real top blocker.

VS Code debugging setup (Electron docs aligned):
1. Launch config file: `.vscode/launch.json`
2. Task file: `.vscode/tasks.json`
3. Main-process debug entry: `Electron: Debug Main (Harness)`
4. Renderer attach entry: `Electron: Attach Renderer`
5. Combined session: `Electron: Main + Renderer`
6. Shell fallback launcher: `./scripts/launch-electron-harness.sh`

Docs note:
1. Numeric examples in design docs are illustrative unless explicitly sourced from model metadata.
2. Legacy sketch docs were retired; canonical architecture lives in `CORTEX-DESIGN-PLAN-TODO.md` and execution sequencing lives in `PROJECT-EXECUTION-PLAN.md`.

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
