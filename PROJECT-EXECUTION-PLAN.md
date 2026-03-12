# Project Execution Plan (2026-03-11)

This file is the canonical carry-over plan for implementation sequencing, test gates, and next-session priority. Keep this file updated as work progresses.

## Next Session Highest Priority (P0)

Run a full code pass across the repository before new feature coding.

Instruction:
1. Traverse all TypeScript source and tests.
2. Remove hardcoded model-dependent assumptions.
3. Classify every numeric constant as one of:
   - `model-derived`: must come from resolved model metadata.
   - `runtime-policy`: must come from explicit policy/config objects.
4. Add or update tests first (Red), then implement (Green), then refactor.

Definition of done for this pass:
1. No model-dependent domain constants remain in feature code.
2. A `ModelProfile` contract is the single source of truth for model-derived values.
3. A guard command fails CI when disallowed hardcoded literals are introduced.

## Non-Negotiable Rules

1. Strict TDD: Red -> Green -> Refactor for every slice.
2. Runtime realism: browser and Electron lanes are required merge gates.
3. Provider fallback policy: `webnn -> webgpu -> webgl -> wasm`.
4. Numeric ownership: model-derived values from profile; policy values from declared policy objects.

## Execution Sequence

1. Lock contracts and TDD workflow.
2. Lock command contract and CI lanes.
3. Implement model-profile layer first:
   - `core/ModelProfile.ts`
   - `core/ModelProfileResolver.ts`
   - `core/ModelDefaults.ts`
4. Replace hardcoded model-dependent values with `ModelProfile` lookups.
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

1. `npm run test:unit`
2. `npm run test:unit -- tests/model/ModelProfileResolver.test.ts`
3. `npm run test:unit -- tests/model/ModelDefaults.test.ts`
4. `npm run test:unit -- tests/embeddings/ProviderResolver.test.ts`
5. `npm run test:unit -- tests/embeddings/OnnxEmbeddingRunner.test.ts`
6. `npm run guard:model-derived`
7. `npm run test:browser`
8. `npm run test:electron`
9. `npm run build && npm run lint`
10. `npm run test:all`
11. `npm run benchmark`

## Known Hardcoded Hotspots To Clean First

1. `core/types.ts` comments with sample token/dimension values.
2. `Policy.ts` sample projection dimensions.
3. `Cortex-sketch.md` and `Cortex-sketch-errata.md` illustrative constants (`2048`, `768`, `128`, `0.68`, `40`, etc.).
4. Any ingest/query defaults currently assumed without model metadata backing.

## Scope Notes

1. ONNX runner scope for this milestone is embeddings-first.
2. `webgl` support is preserved through explicit ORT fallback adapter even when Transformers.js device mapping does not expose it directly.
3. Daydreamer depth, peer exchange, and advanced merge policies remain post-vertical work.
