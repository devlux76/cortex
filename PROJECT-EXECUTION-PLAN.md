# Project Execution Plan (2026-03-11)

This file is the canonical carry-over plan for implementation sequencing, test gates, and next-session priority. Keep this file updated as work progresses.

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

Open items carried to next pass:
1. Wire resolved `ModelProfile` into first concrete ingest/query orchestrator path (once those runtime modules are added).
2. Add embedding provider resolver/runner modules and connect fallback policy to runtime execution.
3. Add browser/electron runtime scripts and CI lanes for non-Node merge gating.

## Next Session Highest Priority (P0)

Integrate model-profile ownership into runtime flows and start the embedding vertical slice.

Instruction:
1. Use `ModelProfileResolver` at runtime boundaries before any policy derivation or embedding execution.
2. Implement first embedding runner/provider resolver slice with fallback semantics.
3. Keep strict TDD (Red -> Green -> Refactor).
4. If a blocker appears, record it in this document under an error log entry and continue with the next actionable slice.

Definition of done for this pass:
1. Runtime path resolves model metadata through `ModelProfileResolver` before use.
2. Embedding provider resolver tests and implementation are present.
3. Any unresolved blocker is documented with file/symptom/next action.

## Non-Negotiable Rules

1. Strict TDD: Red -> Green -> Refactor for every slice.
2. Runtime realism: browser and Electron lanes are required merge gates.
3. Provider fallback policy: `webnn -> webgpu -> webgl -> wasm`.
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
   - `embeddings/EmbeddingRunner.ts`
   - `embeddings/ProviderResolver.ts`
   - `embeddings/TransformersEmbeddingBackend.ts`
   - `embeddings/OrtWebglEmbeddingBackend.ts`
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
5. `npm run build && npm run lint`

Planned commands to add in later passes:
1. `npm run test:unit -- tests/embeddings/ProviderResolver.test.ts`
2. `npm run test:unit -- tests/embeddings/OnnxEmbeddingRunner.test.ts`
3. `npm run test:browser`
4. `npm run test:electron`
5. `npm run test:all`
6. `npm run benchmark`

## Known Hardcoded Hotspots To Clean First

1. ~~`core/types.ts` comments with sample token/dimension values.~~ ✅ Updated to source-owned wording.
2. ~~`Policy.ts` sample projection dimensions.~~ ✅ Replaced with derived policy implementation.
3. ~~`Cortex-sketch.md` and `Cortex-sketch-errata.md` illustrative constants (`2048`, `768`, `128`, `0.68`, `40`, etc.).~~ ✅ Clarified as illustrative.
4. Any ingest/query defaults currently assumed without model metadata backing. (Pending runtime module implementation)

## Scope Notes

1. ONNX runner scope for this milestone is embeddings-first.
2. `webgl` support is preserved through explicit ORT fallback adapter even when Transformers.js device mapping does not expose it directly.
3. Daydreamer depth, peer exchange, and advanced merge policies remain post-vertical work.
