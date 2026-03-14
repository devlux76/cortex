# CORTEX Development Guide

This guide covers building, testing, debugging, and contributing to CORTEX.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Build & Type-check](#build--type-check)
4. [Linting](#linting)
5. [Testing](#testing)
6. [Runtime Harness](#runtime-harness)
7. [Benchmarks](#benchmarks)
8. [VS Code Debugging (Electron)](#vs-code-debugging-electron)
9. [Docker Debug Lane](#docker-debug-lane)
10. [Model-Derived Numeric Guard](#model-derived-numeric-guard)
11. [Electron Runtime Gate Policy](#electron-runtime-gate-policy)
12. [Documentation Maintenance](#documentation-maintenance)

---

## Prerequisites

- [Bun](https://bun.sh/) latest (used in CI)
- [Playwright](https://playwright.dev/) browsers (installed automatically via `bun install`)
- [Electron](https://www.electronjs.org/) (installed as an optional dev dependency)
- [Docker](https://www.docker.com/) — required only for the containerised Electron debug lane

---

## Installation

```sh
bun install
```

---

## Build & Type-check

```sh
bun run build       # TypeScript type-check (no emit)
bun run typecheck   # alias for bun run build
```

---

## Linting

```sh
bun run lint
```

---

## Testing

### Unit Tests

```sh
bun run test:unit   # run all unit tests once
bun run test:watch  # run unit tests in watch mode
```

### Browser Runtime Tests

Starts the local harness server, then runs Playwright tests against it in Chromium.

```sh
bun run dev:harness      # start the harness server on http://127.0.0.1:4173
bun run test:browser     # run Playwright browser-harness tests
```

### Electron Runtime Tests

```sh
bun run test:electron          # smoke test (headless)
bun run test:electron:desktop  # smoke test with visible window
bun run test:electron:playwright  # full Playwright Electron test suite
```

Set `CORTEX_ALLOW_ELECTRON_SKIP=1` to skip the Electron lane locally and exit with code 0 (rather than failing the build) if Electron is not installed or crashes during setup:

```sh
CORTEX_ALLOW_ELECTRON_SKIP=1 bun run test:electron
```

### All Tests

```sh
bun run test:runtime   # browser + electron
bun run test:all       # unit + runtime
```

---

## Runtime Harness

The harness is a thin browser page that detects runtime capabilities (WebGPU, WebNN, WebGL, WASM, OPFS, IndexedDB) and publishes a report as `globalThis.__cortexHarnessReport`.

```sh
bun run dev:harness
# → serving ui/harness on http://127.0.0.1:4173
```

Open the URL in Chrome/Edge to see the capability report in the browser console.

---

## Benchmarks

```sh
bun run benchmark         # runs the dummy embedder hotpath benchmark
bun run benchmark:dummy   # same, explicit alias
```

---

## VS Code Debugging (Electron)

Launch configurations are in [`.vscode/launch.json`](../.vscode/launch.json) and tasks in [`.vscode/tasks.json`](../.vscode/tasks.json).

| Configuration | Description |
|---|---|
| `Electron: Debug Main (Harness)` | Attach Node debugger to the Electron main process |
| `Electron: Attach Renderer` | Attach Chrome DevTools to the renderer |
| `Electron: Main + Renderer` | Combined session (local host shell) |
| `Electron: Docker Main + Renderer` | Combined session via Docker (recommended for CI parity) |

> If Electron exits with `SIGSEGV` in a local shell, switch to the Docker attach flow.

---

## Docker Debug Lane

The Docker lane provides a sandbox-isolated Electron environment with software rendering.

```sh
# Start the lane (auto-rebuilds the image)
bun run docker:electron:up

# Stream logs
bun run docker:electron:logs

# Stop and clean up
bun run docker:electron:down
```

From VS Code, use the `Electron: Docker Main + Renderer` launch config. It automatically starts and stops the container via the `docker:electron:up` / `docker:electron:down` tasks.

**Expected non-fatal log noise inside Docker:**

- `dbus/bus.cc` connection warnings — no system DBus daemon in the slim container.
- `WebGL2 blocklisted` — expected with Xvfb software rendering; this is not an app crash.

---

## Model-Derived Numeric Guard

To prevent hardcoded model-dependent numeric literals (embedding dimensions, context window sizes, etc.) from leaking into non-approved source files, run:

```sh
bun run guard:model-derived
```

This command will fail the build if it detects numeric literals that are likely to be model-dependent (e.g. embedding dimensions such as `768`, `1536`, or context-window sizes such as `8192`) in files outside the approved source files (`core/ModelDefaults.ts`, `core/ModelProfile.ts`, `core/ModelProfileResolver.ts`). All other code must obtain these values from a resolved `ModelProfile`.

---

## Documentation Maintenance

At the end of every implementation pass, update documents in this order:

1. **`DESIGN.md`** — update if the design landing/TOC changes.
2. **Wiki** — update the relevant wiki page(s) for any architecture or algorithm changes.
3. **`README.md`** — confirm the project description still reflects reality.
4. **`docs/api.md`** — update if new public APIs are added or existing ones change.
5. **GitHub Issues** — close completed tasks, create new ones as needed via `gh` CLI or the web UI.

> Numeric examples in design docs are illustrative unless explicitly sourced from model metadata.

---

## Electron Runtime Gate Policy

The Electron test lane enforces the following gate policy for GPU/graphics
requirements:

### GPU Requirements

| Capability | Required? | Notes |
|---|---|---|
| **WebGPU** | Optional | Preferred for vector operations and TransformersJs device; CI runners lack GPU access |
| **WebNN** | Optional | Preferred for ML inference; not available on most CI runners |
| **WebGL** | Required (software OK) | Minimum graphics capability; software-rendered via Xvfb in Docker |
| **WASM** | Required | Always-available compute fallback for vectors and embeddings |
| **OPFS** | Required | Origin Private File System for vector persistence |
| **IndexedDB** | Required | Metadata and hierarchy persistence |

### CI Gate Behaviour

- **Host-shell Electron** may crash with `SIGSEGV` in headless sandbox
  environments that lack a GPU. This is **not** a blocking failure — use the
  Docker lane instead.
- **Docker Electron lane** (`npm run docker:electron:up`) runs with Xvfb
  software rendering. WebGL reports as available but WebGPU does not.
  This lane is **not** a GPU-realism gate — it validates application startup,
  IPC wiring, and storage initialisation.
- Set `CORTEX_ALLOW_ELECTRON_SKIP=1` to soft-skip the **full Electron runtime
  tests** (driven by `scripts/run-electron-runtime-tests.mjs`, typically via
  `npm run test:runtime`) when hardware is unavailable. The smoke-test runner
  (`scripts/run-electron-runtime-smoke.mjs`, typically via
  `npm run test:electron`) does **not** honor this variable and will still
  fail if Electron is not installed or cannot start.
- The CI workflow does **not** run Electron tests by default. Full Electron
  runtime tests are gated behind the `test:runtime` script and should be run
  manually or in a dedicated GPU-enabled runner. The `test:electron` script
  is a lightweight smoke test and remains a hard failure if Electron is
  unavailable.

### Decision Matrix

| Environment | Electron tests run? | GPU available? | Expectation |
|---|---|---|---|
| Local (with GPU) | Yes | Yes | Full pass |
| Local (no GPU) | Skip full runtime tests (`CORTEX_ALLOW_ELECTRON_SKIP=1`) | No | Skip full harness gracefully; smoke tests may still fail without Electron |
| CI (ubuntu-latest) | No | No | Unit tests only |
| Docker lane | Yes (software render) | No | Startup + storage pass; WebGPU tests skipped |

---

## Hotpath Policy Constants Guard

To prevent hardcoded hotpath policy numeric literals (salience weights, tier
quota ratios, Williams Bound constant) from leaking outside
`core/HotpathPolicy.ts`, run:

```sh
node scripts/guard-hotpath-policy.mjs
```

Or with the npm script alias:

```sh
npm run guard:hotpath-policy
```

Any line that assigns a raw numeric literal to a field named `alpha`, `beta`,
`gamma`, `salienceWeights`, or `tierQuotaRatios` outside
`core/HotpathPolicy.ts` will be flagged as a violation.

To explicitly allow an exception (e.g. in a test helper), add the inline
suppression comment `// hotpath-policy-ok` to the line:

```typescript
const w = { alpha: 0.5, beta: 0.3, gamma: 0.2 }; // hotpath-policy-ok
```

---

## Troubleshooting

### Build fails: "Cannot find module 'fake-indexeddb'"

Ensure all dev dependencies are installed:

```sh
npm install       # or: bun install
```

### TypeScript error: "Type 'X' is not assignable to type 'Y'"

Run the full type-check to see all errors at once:

```sh
npm run build
```

Do not silence errors with `// @ts-ignore` or `as any` — fix the root cause.

### Unit tests fail with IndexedDB errors

All IndexedDB tests use `fake-indexeddb` via in-test setup. Ensure that:

1. Your test file imports `IDBFactory` and `IDBKeyRange` from `fake-indexeddb`.
2. You assign them to `globalThis.indexedDB` and `globalThis.IDBKeyRange` in
   a `beforeEach` block (or equivalent).

Example:

```typescript
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  (globalThis as any).IDBKeyRange = IDBKeyRange;
});
```

### Electron smoke test crashes with SIGSEGV

Use the Docker debug lane (see [Docker Debug Lane](#docker-debug-lane) above).
The host-shell Electron path can produce `SIGSEGV` in some sandbox environments;
the Docker container is the source of truth for debugger stability.

### guard:model-derived flags a legitimate test constant

Add the inline suppression comment `// model-derived-ok` to the line:

```typescript
const backend = new DeterministicDummyEmbeddingBackend({ dimension: 32 }); // model-derived-ok
```

---

## Performance Tuning

### Embedding throughput

- Use `"webgpu"` or `"webnn"` device for `TransformersJsEmbeddingBackend`
  when available — they are significantly faster than `"wasm"` for batched
  inference.
- Use `OrtWebglEmbeddingBackend` as a fallback on systems with WebGL but
  without WebGPU/WebNN.
- Increase batch sizes in `EmbeddingRunner` to amortise pipeline overhead.

### Query latency

- The hotpath (resident set) is scored first; most queries are served from
  there without touching the full corpus.
- Keep `topK` as small as is useful — smaller values reduce the cold-path
  scan when the hotpath is insufficient.
- For large corpora, run `ExperienceReplay` regularly during idle time to
  keep frequently-queried pages in the hotpath.

### Hotpath capacity (Williams Bound)

- The resident set capacity H(t) = ceil(0.5 * sqrt(t * log2(1+t))) grows
  sublinearly. For a 10 000-page corpus, the hotpath holds roughly 99 pages.
- Increase the scaling factor `c` in `DEFAULT_HOTPATH_POLICY` (in
  `core/HotpathPolicy.ts`) to allow a larger hotpath at the cost of more
  memory. The default value is `c = 0.5`.
- Adjust `tierQuotaRatios` to redistribute the hotpath budget between the
  shelf, volume, book, and page tiers.

### Storage

- `MemoryVectorStore` is for testing only — it holds all vectors in RAM.
- `OPFSVectorStore` is the production backend; it uses the Origin Private
  File System for zero-copy append writes and mmap-style reads.
- Avoid calling `getAllPages()` in hot paths — it scans the entire IndexedDB
  store. Use the hotpath index (`getHotpathEntries`) for latency-sensitive
  lookups.

---

## Running Benchmarks

```sh
# Dummy embedder throughput
npm run benchmark:dummy

# Query latency vs corpus size
npm run benchmark:query-latency

# Storage overhead vs page count
npm run benchmark:storage-overhead

# Hotpath scaling and Williams Bound invariants
npm run benchmark:hotpath-scaling

# All benchmarks
npm run benchmark:all
```

Baseline measurements are recorded in [`benchmarks/BASELINES.md`](../benchmarks/BASELINES.md).
