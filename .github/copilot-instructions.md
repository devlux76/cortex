# Copilot Instructions for CORTEX

## Project Overview

CORTEX (**C**lustered **O**ntic **R**outing **T**hrough **E**ntangled e**X**changes) is a neurobiologically inspired, fully on-device episodic memory engine for autonomous agents. It runs 100% in the browser — no servers, no cloud, no telemetry. All memory stays local and private.

The engine models three biological brain regions:
- **Hippocampus** — Fast associative encoding (WebGPU multi-prototype lookups, Matryoshka embeddings, Hebbian edge creation, OPFS-backed vector storage)
- **Cortex** — Intelligent routing & coherence (Metroid construction `{ m1, m2, c }`, dialectical search, Matryoshka dimensional unwinding, knowledge gap detection, P2P curiosity broadcasting, parallel WebGPU scoops, IndexedDB sub-graph retrieval, closed-loop Hebbian path tracing)
- **Daydreamer** — Background consolidation Web Worker (LTP/LTD, pruning, medoid recomputation, experience replay)

## Key Documentation Files

| File | Purpose |
|---|---|
| `README.md` | Product vision and quick start |
| `DESIGN.md` | Complete architecture specification and design principles |
| `PLAN.md` | Module-by-module implementation status and development phases |
| `TODO.md` | Prioritized actionable tasks to ship v1.0 |

Keep all documents synchronized with the real code state after every implementation pass.

## Directory Structure

```
cortex/
├── core/               # Model profile definitions, policy infrastructure
├── embeddings/         # Embedding provider interfaces and adaptive resolver
├── storage/            # Vector & metadata storage backends (OPFS, IndexedDB)
├── runtime/            # Browser/Electron runtime harness
├── tests/              # Unit, benchmark, and integration tests
│   ├── benchmarks/     # Vitest benchmark files (*.bench.ts)
│   └── runtime/        # Playwright browser/Electron specs (*.spec.mjs)
├── scripts/            # Build & test automation scripts (*.mjs)
├── docker/             # Electron debug container configuration
├── .github/workflows/  # GitHub Actions CI pipeline
├── .vscode/            # VS Code debug launch and task configuration
├── *.ts                # Root-level vector backend implementations and policy
└── Vectors.{glsl,wgsl,wat}  # GPU shader and WASM vector operation sources
```

## Build, Lint, and Test Commands

```bash
# Install dependencies
npm ci

# Type-check (no emit)
npm run build

# Lint (ESLint + TypeScript-ESLint)
npm run lint

# Run all unit tests (Vitest)
npm run test:unit

# Run unit tests in watch mode
npm run test:watch

# Run browser harness tests (Playwright)
npm run test:browser

# Run Electron smoke tests
npm run test:electron

# Run all tests
npm run test:all

# Run model-derived numeric guard (must pass before any numeric change)
npm run guard:model-derived

# Start dev harness server
npm run dev:harness

# Docker Electron debug lane (preferred for sandbox-isolated debugging)
npm run docker:electron:up
npm run docker:electron:down
```

CI runs `lint` → `build` → `test:unit` on every push and pull request.

## Coding Standards

- **Language:** TypeScript (strict mode, ES2022 target, ESNext modules). All source files use `.ts`; scripts use `.mjs`.
- **Module system:** ESNext (`"type": "module"` in `package.json`). Use `import`/`export`, never `require`.
- **Async/await:** Always use `async`/`await`. Never use raw Promise chains.
- **Types:** Prefer explicit types over `any`. The ESLint rule `@typescript-eslint/no-explicit-any` is disabled but use `any` only as a last resort.
- **Naming conventions:**
  - `PascalCase` for classes, interfaces, types, and enums
  - `camelCase` for variables, functions, and method names
  - `SCREAMING_SNAKE_CASE` for true compile-time constants
- **File naming:** `PascalCase.ts` for classes/modules (e.g., `VectorBackend.ts`), `kebab-case.mjs` for scripts.
- **Immutability:** Prefer `const` over `let`. Never use `var`.
- **Error handling:** Prefer typed errors; avoid silent swallows.
- **Comments:** Write comments only where the *why* is non-obvious. Avoid restating what the code already says clearly.

## Model-Derived Numerics

**Critical constraint:** All numeric values that derive from a specific ML model's architecture (embedding dimensions, context lengths, thresholds) must **never** be hardcoded as magic numbers. They must be sourced from the model profile in `core/`. Violating this breaks the `guard:model-derived` script and will fail CI.

Run `npm run guard:model-derived` after any numeric change to verify compliance.

## Testing Practices

- **Unit tests:** Vitest, located in `tests/*.test.ts` and `tests/**/*.test.ts`. Use `fake-indexeddb` to mock IndexedDB — never rely on real browser storage in these tests.
- **Browser/Electron tests:** Playwright specs in `tests/runtime/`. These require a running harness.
- **TDD approach:** For new Hippocampus/Cortex/Daydreamer slices, write failing tests first, then implement to green.
- **Benchmarks:** Located in `tests/benchmarks/*.bench.ts`. Run with `npm run benchmark`.
- Never delete or disable existing tests. If a test is wrong, fix the test or the implementation — do not skip it.

## Electron Debugging

- **Preferred debug path:** Docker attach flow via VS Code launch config `Electron: Docker Main + Renderer`.
- **Host-shell Electron** can fail with `SIGSEGV` in some environments; always use Docker as the source of truth for debugger stability.
- Expected (non-fatal) Docker container noise: `dbus/bus.cc` warnings and `WebGL2 blocklisted` messages from software rendering.
- The Docker lane is software-rendered and is **not** a GPU-realism gate.

## Pull Request Requirements

- All CI checks must pass: `lint`, `build` (typecheck), `test:unit`.
- `npm run guard:model-derived` must pass for any change that touches numeric constants.
- Keep `README.md`, `CORTEX-DESIGN-PLAN-TODO.md`, and `PROJECT-EXECUTION-PLAN.md` synchronized with any implementation state changes.
- Record blockers with file path, failure symptom, and next action.

## What NOT to Do

- Do not hardcode model-derived numbers (dimensions, thresholds, context lengths) — always source from model profiles in `core/`.
- Do not add server-side dependencies, cloud calls, or telemetry of any kind. CORTEX must remain 100% on-device.
- Do not modify shader files (`Vectors.glsl`, `Vectors.wgsl`, `Vectors.wat`) unless you fully understand the vector operation being changed and have a corresponding unit test.
- Do not skip or remove existing tests.
- Do not use `var` or CommonJS `require()`.
- Do not commit `.env` files, secrets, or credentials.
- Do not introduce external runtime dependencies without explicit discussion — the current dependency set is intentionally minimal (all `devDependencies`).
