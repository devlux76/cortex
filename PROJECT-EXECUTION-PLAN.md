# Project Execution Plan (2026-03-11)

This file is the canonical carry-over plan for implementation sequencing, test gates, and next-session priority. Keep this file updated as work progresses.

Canonical document contract:
1. Product vision and non-negotiables: `README.md`
2. Architecture contracts and backlog: `CORTEX-DESIGN-PLAN-TODO.md`
3. Execution sequencing, command contract, and test gates: `PROJECT-EXECUTION-PLAN.md`

## Pass Status (2026-03-11)

Completed in this pass:
1. Implemented `ModelProfile` source-of-truth layer:
   - `core/ModelProfile.ts`
   - `core/ModelDefaults.ts`
   - `core/ModelProfileResolver.ts`
2. Added TDD coverage for model defaults/resolution and routing derivation:
   - `tests/model/ModelDefaults.test.ts`
   - `tests/model/ModelProfileResolver.test.ts`
   - `tests/model/RoutingPolicy.test.ts`
3. Added `createRoutingPolicy(...)` derivation from profile-owned embedding dimensions.
4. Added runtime numeric constants surface (`core/NumericConstants.ts`) and removed repeated byte/workgroup literals from backends and storage paths.
5. Added `guard:model-derived` command and scanner (`scripts/guard-model-derived.mjs`) to block hardcoded model-related numeric literals outside approved sources.
6. Validation gates passed in this workspace state:
   - `npm run test:unit`
   - `npm run guard:model-derived`
   - `npm run build`
   - `npm run lint`
7. Added model-profile-to-policy bridge helper so runtime callers can resolve profile and derive routing in one step:
   - `resolveRoutingPolicyForModel(...)` in `Policy.ts`
   - integration tests in `tests/model/RoutingPolicy.test.ts`
8. Added deterministic dummy embedder for hotpath benchmarking before real model wiring:
   - `embeddings/EmbeddingBackend.ts`
   - `embeddings/DeterministicDummyEmbeddingBackend.ts`
   - tests: `tests/embeddings/DeterministicDummyEmbeddingBackend.test.ts`
9. Added executable dummy hotpath benchmark harness:
   - `tests/benchmarks/DummyEmbedderHotpath.bench.ts`
   - `npm run benchmark:dummy`
10. Implemented baseline embedding runtime selection modules:
   - `embeddings/ProviderResolver.ts`
   - `embeddings/EmbeddingRunner.ts`
   - tests: `tests/embeddings/ProviderResolver.test.ts`, `tests/embeddings/EmbeddingRunner.test.ts`
   - selection now supports capability filtering + benchmark-based winner choice
11. Retired legacy design-note docs after full code/doc audit and preserved canonical pointers in current docs.
12. Verified current hotpath elements compile/run in this workspace state:
   - `npm run build`
   - `npm run benchmark:dummy`
   - ad hoc `Vectors.wat` compile + instantiate + export smoke (`dot_many`, `project`, `hash_binary`, `hamming_scores`, `topk_i32`, `topk_f32`) via transient `wabt`
13. Synchronized canonical docs with anti-drift protocol and shared P0 priorities:
   - `README.md`
   - `CORTEX-DESIGN-PLAN-TODO.md`
   - `PROJECT-EXECUTION-PLAN.md`
14. Implemented browser-first runtime harness and local server:
   - `runtime/harness/index.html`
   - `scripts/runtime-harness-server.mjs`
15. Implemented thin Electron wrapper and runtime lane tests:
   - `scripts/electron-harness-main.mjs`
   - `tests/runtime/browser-harness.spec.mjs`
   - `tests/runtime/electron-harness.spec.mjs`
16. Added Playwright runtime lane configuration and scripts:
   - `playwright.config.mjs`
   - `package.json` scripts (`dev:harness`, `test:browser`, `test:electron`, `test:electron:playwright`, `test:electron:desktop`, `test:runtime`, `test:all`)
17. Added explicit Electron lane runner with actionable setup messaging and optional local soft-skip:
   - `scripts/run-electron-runtime-tests.mjs`
   - `CORTEX_ALLOW_ELECTRON_SKIP=1` local skip flag
18. Validation gates executed in this pass:
   - `npm run build`
   - `npm run lint`
   - `npm run guard:model-derived`
   - `npm run test:unit`
   - `npm run test:browser`
   - `CORTEX_ALLOW_ELECTRON_SKIP=1 npm run test:electron`
19. Added VS Code Electron debugging workflow aligned with Electron docs:
   - `.vscode/launch.json`
   - `.vscode/tasks.json`
   - README references for `Electron: Debug Main (Harness)`, `Electron: Attach Renderer`, and `Electron: Main + Renderer`
20. Additional validation in this workspace context:
   - `npm run lint`
   - `node scripts/runtime-harness-server.mjs` + Electron launch with `--remote-debugging-port=9222` (desktop-style flags)
   - same launch with headless/software flags
   - both Electron launches exited with `SIGSEGV` (`139`) in this non-desktop tooling context
21. Added containerized Electron debug lane to isolate host/editor sandbox effects:
   - `docker/electron-debug/Dockerfile`
   - `docker/electron-debug/entrypoint.sh`
   - `docker-compose.electron-debug.yml`
   - package scripts: `docker:electron:build`, `docker:electron:up`, `docker:electron:down`, `docker:electron:logs`
   - VS Code attach workflow: `Electron: Attach Main (Docker)`, `Electron: Attach Renderer (Docker)`, `Electron: Docker Main + Renderer`
22. Docker lane validation in this workspace:
   - `npm run docker:electron:build`
   - short `docker compose ... up` smoke with forced recreate + teardown
   - ready markers observed (`harness ready`, main inspector `9230`, renderer debugger `9222`)
   - no `SIGSEGV` observed inside container during smoke window

Open items carried to next pass:
1. Wire resolved `ModelProfile` into first concrete ingest/query orchestrator path.
2. Add real embedding providers (ONNX/Transformers/WebNN/WebGPU/WebGL/WASM) as candidates for the resolver.
3. Validate full VS Code host attach cycle against the Docker lane (`Electron: Docker Main + Renderer`) and codify it as the runtime-electron context contract when host-shell runs are unstable.
4. Define CI prerequisites for the chosen runtime-electron context (binary + graphics/runtime assumptions) and enforce one canonical gate.
5. Implement first Hippocampus/Cortex vertical slice on top of runtime harness lanes.

### Documentation Synchronization Protocol (Required)

At the end of every implementation pass, update docs in this order:
1. `PROJECT-EXECUTION-PLAN.md`: pass status delta and exact commands executed.
2. `CORTEX-DESIGN-PLAN-TODO.md`: design-to-code status matrix.
3. `README.md`: top blocker and current P0 priorities.

Blocker logging format:
1. File path
2. Failure symptom
3. Next actionable step

### Runtime Verification Snapshot (2026-03-11)

Verified directly in this workspace:
1. TypeScript compile/typecheck passes.
2. Dummy embedding hotpath benchmark executes successfully in Vitest bench mode.
3. `Vectors.wat` is not just present as source text: it was compiled to wasm bytes and executed successfully through a one-off smoke harness.
4. The current terminal-only Node runtime cannot execute browser GPU paths directly:
   - `document` is unavailable
   - `navigator.gpu` is unavailable
   - `navigator.ml` is unavailable

Interpretation:
1. WASM and deterministic embedding hotpaths are validated.
2. WebGPU/WebNN/WebGL paths still require a real browser/Electron runtime lane.
3. The missing confidence is now runtime-environment realism, not core kernel syntax.

### External Capability Verification (2026-03-11)

Verified during this pass (hard handoff facts):
1. Transformers.js is ONNX Runtime-backed (docs + upstream source).
2. Transformers.js device mapping exposes `webnn`, `webnn-gpu`, `webnn-cpu`, `webnn-npu`, `webgpu`, and `wasm` for web environments.
3. Transformers.js does not currently expose `webgl` as a direct `device` type; WebGL should remain an explicit ORT adapter path.
4. Node-side ONNX providers (platform-dependent) include `cuda`, `dml`, and `coreml` in upstream mapping.
5. Electron inherits Chromium GPU/WebGPU capability rather than bypassing it; it is still subject to host GPU drivers and Linux graphics stack limitations.
6. Electron is still the preferred Linux realism harness because it gives explicit Chromium switch control via `app.commandLine.appendSwitch(...)` before `ready`, plus GPU diagnostics via `app.getGPUFeatureStatus()` / `app.getGPUInfo()` after `gpu-info-update`.
7. Chrome WebGPU guidance confirms Linux support exists but can still require environment fixes when `navigator.gpu` is undefined or `requestAdapter()` returns `null`:
   - secure context is required (`http://localhost` is acceptable for local dev)
   - hardware acceleration must be enabled
   - Linux experimental cases may need unsafe WebGPU / Vulkan enablement
   - some hardware may require blocklist override for testing

Source anchors to re-check quickly in a new session:
1. `huggingface/transformers.js` -> `packages/transformers/src/backends/onnx.js`:
   - `DEVICE_TO_EXECUTION_PROVIDER_MAPPING`
   - `deviceToExecutionProviders(...)`
2. `huggingface/transformers.js` -> `packages/transformers/src/utils/devices.js`:
   - `DEVICE_TYPES`
3. Transformers.js docs (`v3.8.1` and `main`):
   - index + WebGPU guide + ONNX backend API pages
4. Electron docs:
   - `app.commandLine.appendSwitch(...)`
   - `app.getGPUFeatureStatus()`
   - `app.getGPUInfo()`
   - `gpu-info-update`
5. Chrome WebGPU troubleshooting docs:
   - secure-context requirement
   - Linux Vulkan / unsafe WebGPU notes
   - blocklist / hardware acceleration troubleshooting

### Runtime Harness Direction (2026-03-11)

Decision from this pass:
1. Do not build a full Electron-first app shell just for testing.
2. Build one browser-first harness page/app that can run unchanged in Chromium and Electron.
3. Wrap that harness in a thin Electron launcher for Linux GPU realism and observability.
4. Keep Chromium as the web-parity lane; use Electron as the primary GPU/runtime realism lane.
5. Serve the harness over `http://127.0.0.1` / `http://localhost` during development and testing; do not rely on `file://` for WebGPU-sensitive execution.

## Current Pass Highest Priority (P0)

Move from harness scaffolding to production validation by locking Electron runtime-context policy, wiring real providers, and implementing first ingest/query orchestration slices.

Instruction:
1. Keep canonical docs synchronized (`README.md`, `CORTEX-DESIGN-PLAN-TODO.md`, `PROJECT-EXECUTION-PLAN.md`) before and after implementation slices.
2. Define Electron runtime prerequisites (binary + graphics/runtime context) in CI/runtime images and remove local soft-skip in gated contexts.
3. Register the first real embedding providers in `ProviderResolver` and test selection inside runtime lanes.
4. Implement first `Hippocampus` ingest orchestration entry point with profile-resolved settings.
5. Implement first `Cortex` retrieval orchestration entry point with deterministic coherence ordering baseline.
6. Keep strict TDD (Red -> Green -> Refactor).
7. If a blocker appears, record it in this document under an error log entry and continue with the next actionable slice.

Definition of done for this pass:
1. Canonical docs expose the same P0 priorities and maintenance protocol.
2. Runtime browser lane passes from Playwright against shared harness.
3. Electron lane has explicit provisioning contract and blocker handling.
4. Any unresolved blocker is documented with file/symptom/next action.

## Non-Negotiable Rules

1. Strict TDD: Red -> Green -> Refactor for every slice.
2. Runtime realism: browser and Electron lanes are required merge gates.
3. Provider fallback policy:
   - Transformers.js path: `webnn -> webgpu -> wasm`
   - Explicit ORT path: `webnn -> webgpu -> webgl -> wasm`
4. Numeric ownership: model-derived values from profile; policy values from declared policy objects.

## Execution Sequence

1. Lock contracts and TDD workflow.
2. Lock command contract and CI lanes.
3. ~~Implement model-profile layer first:~~ ✅ Done (2026-03-11)
   - `core/ModelProfile.ts`
   - `core/ModelProfileResolver.ts`
   - `core/ModelDefaults.ts`
4. ~~Replace hardcoded model-dependent values with `ModelProfile` lookups.~~ ✅ Done for current code paths (2026-03-11)
5. Implement embedding runner with fallback chain and telemetry:
   - `embeddings/EmbeddingRunner.ts` ✅ baseline done (2026-03-11)
   - `embeddings/ProviderResolver.ts` ✅ baseline done (2026-03-11)
   - `embeddings/TransformersEmbeddingBackend.ts` (targeting `webnn/webgpu/wasm`)
   - `embeddings/OrtWebglEmbeddingBackend.ts` (explicit `webgl` path)
   - `embeddings/OnnxEmbeddingRunner.ts`
6. Build Hippocampus ingest using profile-derived chunking/dimensions.
7. Build Cortex retrieval using profile-derived routing/truncation policies.
8. Add parity, integration, runtime, and benchmark gates.

## Required Test Matrix

1. `unit-node` (required on each PR):
   - Model profile derivation and defaults
   - Fallback resolver semantics
   - Deterministic logic helpers
2. `runtime-browser` (required on each PR):
   - Real IndexedDB + OPFS
   - Real ONNX runtime provider selection
3. `runtime-electron` (required on each PR):
   - Desktop parity for embedding/storage contracts
4. `integration-vertical` (required on each PR):
   - ingest -> persist -> query coherence with deterministic fixtures
5. `benchmark-nightly` (release gate):
   - latency and throughput trend tracking

## Command Contract

Available now:
1. `npm run test:unit`
2. `npm run test:unit -- tests/model/ModelProfileResolver.test.ts`
3. `npm run test:unit -- tests/model/ModelDefaults.test.ts`
4. `npm run guard:model-derived`
5. `npm run test:unit -- tests/embeddings/DeterministicDummyEmbeddingBackend.test.ts`
6. `npm run test:unit -- tests/embeddings/ProviderResolver.test.ts`
7. `npm run test:unit -- tests/embeddings/EmbeddingRunner.test.ts`
8. `npm run benchmark:dummy`
9. `npm run benchmark`
10. `npm run build && npm run lint`
11. `npm run dev:harness`
12. `npm run test:browser`
13. `npm run test:electron`
14. `npm run test:electron:playwright`
15. `npm run test:electron:desktop`
16. `npm run test:runtime`
17. `npm run test:all`
18. `npm run docker:electron:build`
19. `npm run docker:electron:up`
20. `npm run docker:electron:down`
21. `npm run docker:electron:logs`

Planned commands to add in later passes:
1. `npm run test:unit -- tests/embeddings/OnnxEmbeddingRunner.test.ts`
2. `npm run test:integration`
3. `npm run test:runtime:strict` (no local soft-skip)

## Error Log

1. Blocker A - File path: `scripts/electron-harness-main.mjs`, `.vscode/launch.json`, `scripts/run-electron-runtime-smoke.mjs`
2. Blocker A - Failure symptom: Electron exits with `SIGSEGV` (`139`) in this tool-executed terminal context for both desktop-style and headless/software-style launches, despite Electron being installed and harness server reachability.
3. Blocker A - Next action: run the containerized attach flow (`npm run docker:electron:up` + `Electron: Docker Main + Renderer`) and treat host-shell crashes as environment-limited unless reproducible in the Docker lane.
4. Blocker B - File path: `.vscode/launch.json`, `.vscode/tasks.json`, `docker-compose.electron-debug.yml`
5. Blocker B - Failure symptom: Docker lane now builds and starts cleanly, but host-side VS Code attach/breakpoint workflow against that lane has not yet been validated in-session.
6. Blocker B - Next action: run `Electron: Docker Main + Renderer` from VS Code, verify main + renderer breakpoint binding, then lock CI/runtime-electron contract to that validated context.

## Known Hardcoded Hotspots To Clean First

1. ~~`core/types.ts` comments with sample token/dimension values.~~ ✅ Updated to source-owned wording.
2. ~~`Policy.ts` sample projection dimensions.~~ ✅ Replaced with derived policy implementation.
3. ~~Legacy design-note illustrative constants (`2048`, `768`, `128`, `0.68`, `40`, etc.).~~ ✅ Canonicalized to model-derived policy/runtime constants and retired from source docs.
4. Any ingest/query defaults currently assumed without model metadata backing. (Pending runtime module implementation)

## Scope Notes

1. ONNX runner scope for this milestone is embeddings-first.
2. `webgl` support is preserved through explicit ORT fallback adapter even when Transformers.js device mapping does not expose it directly.
3. Daydreamer depth, peer exchange, and advanced merge policies remain post-vertical work.
