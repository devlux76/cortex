import type { ModelProfileRegistryEntry } from "./ModelProfileResolver";

/**
 * Built-in model profile registry entries for known matryoshka embedding models.
 *
 * Numeric values here are model-derived and sourced from the original model cards.
 * This file is a declared source of truth for model profile numerics and is explicitly
 * allowed by the guard:model-derived script.
 *
 * Add new entries when wiring additional real embedding providers.
 */

/**
 * Profile for `onnx-community/embeddinggemma-300m-ONNX` (Q4 quantized).
 *
 * Base model: google/embeddinggemma-300m
 * Architecture: Gemma 2-based matryoshka embedding model.
 *
 * Supported matryoshka sub-dimensions (nested, smallest-to-largest):
 *   64, 128, 256, 512, 768
 *
 * The default dimension registered here (768) is the full-fidelity output.
 * Callers may slice to a smaller sub-dimension for compressed retrieval tiers.
 *
 * matryoshkaProtectedDim = 128: the most coarse-grained (smallest) sub-dimension
 * officially supported by the model. MetroidBuilder uses this as the protected
 * floor — dimensions below 128 are not a supported embedding granularity.
 *
 * Task prompts (required for best retrieval quality):
 *   Query prefix:    "query: "
 *   Document prefix: "passage: "
 *
 * @see https://huggingface.co/google/embeddinggemma-300m
 * @see https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX
 */
export const EMBEDDING_GEMMA_300M_MODEL_ID =
  "onnx-community/embeddinggemma-300m-ONNX";

export const EMBEDDING_GEMMA_300M_PROFILE: ModelProfileRegistryEntry = {
  embeddingDimension: 768,
  contextWindowTokens: 512,
  matryoshkaProtectedDim: 128,
};

/**
 * Canonical registry of all built-in model profiles, keyed by model ID.
 * This record is used as the default registry in `ModelProfileResolver`.
 *
 * When adding a new Matryoshka embedding model, set `matryoshkaProtectedDim`
 * to the smallest sub-dimension the model officially supports. Known values:
 *   - embeddinggemma-300m:      128
 *   - nomic-embed-text-v1.5:    64  (to be added when nomic provider is wired)
 */
export const BUILT_IN_MODEL_REGISTRY: Record<string, ModelProfileRegistryEntry> =
  Object.freeze({
    [EMBEDDING_GEMMA_300M_MODEL_ID]: EMBEDDING_GEMMA_300M_PROFILE,
  });
