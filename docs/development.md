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
11. [Documentation Maintenance](#documentation-maintenance)

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later (LTS recommended)
- [npm](https://www.npmjs.com/)
- [Playwright](https://playwright.dev/) browsers (installed automatically via `npm install`)
- [Electron](https://www.electronjs.org/) (installed as an optional dev dependency)
- [Docker](https://www.docker.com/) — required only for the containerised Electron debug lane

---

## Installation

```sh
npm install
```

---

## Build & Type-check

```sh
npm run build       # TypeScript type-check (no emit)
npm run typecheck   # alias for npm run build
```

---

## Linting

```sh
npm run lint
```

---

## Testing

### Unit Tests

```sh
npm run test:unit   # run all unit tests once
npm run test:watch  # run unit tests in watch mode
```

### Browser Runtime Tests

Starts the local harness server, then runs Playwright tests against it in Chromium.

```sh
npm run dev:harness      # start the harness server on http://127.0.0.1:4173
npm run test:browser     # run Playwright browser-harness tests
```

### Electron Runtime Tests

```sh
npm run test:electron          # smoke test (headless)
npm run test:electron:desktop  # smoke test with visible window
npm run test:electron:playwright  # full Playwright Electron test suite
```

Set `CORTEX_ALLOW_ELECTRON_SKIP=1` to skip the Electron lane locally and exit with code 0 (rather than failing the build) if Electron is not installed or crashes during setup:

```sh
CORTEX_ALLOW_ELECTRON_SKIP=1 npm run test:electron
```

### All Tests

```sh
npm run test:runtime   # browser + electron
npm run test:all       # unit + runtime
```

---

## Runtime Harness

The harness is a thin browser page that detects runtime capabilities (WebGPU, WebNN, WebGL, WASM, OPFS, IndexedDB) and publishes a report as `globalThis.__cortexHarnessReport`.

```sh
npm run dev:harness
# → serving runtime/harness on http://127.0.0.1:4173
```

Open the URL in Chrome/Edge to see the capability report in the browser console.

---

## Benchmarks

```sh
npm run benchmark         # runs the dummy embedder hotpath benchmark
npm run benchmark:dummy   # same, explicit alias
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
npm run docker:electron:up

# Stream logs
npm run docker:electron:logs

# Stop and clean up
npm run docker:electron:down
```

From VS Code, use the `Electron: Docker Main + Renderer` launch config. It automatically starts and stops the container via the `docker:electron:up` / `docker:electron:down` tasks.

**Expected non-fatal log noise inside Docker:**

- `dbus/bus.cc` connection warnings — no system DBus daemon in the slim container.
- `WebGL2 blocklisted` — expected with Xvfb software rendering; this is not an app crash.

---

## Model-Derived Numeric Guard

To prevent hardcoded model-dependent numeric literals (embedding dimensions, context window sizes, etc.) from leaking into non-approved source files, run:

```sh
npm run guard:model-derived
```

This command will fail the build if it detects numeric literals that are likely to be model-dependent (e.g. embedding dimensions such as `768`, `1536`, or context-window sizes such as `8192`) in files outside the approved source files (`core/ModelDefaults.ts`, `core/ModelProfile.ts`, `core/ModelProfileResolver.ts`). All other code must obtain these values from a resolved `ModelProfile`.

---

## Documentation Maintenance

At the end of every implementation pass, update documents in this order:

1. **`PROJECT-EXECUTION-PLAN.md`** — append pass status delta and exact commands executed.
2. **`CORTEX-DESIGN-PLAN-TODO.md`** — update the design-to-code status matrix.
3. **`README.md`** — confirm the project description still reflects reality.
4. **`docs/api.md`** — update if new public APIs are added or existing ones change.

> Numeric examples in design docs are illustrative unless explicitly sourced from model metadata.
