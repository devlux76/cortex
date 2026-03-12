import type { ModelProfile, ModelProfileSeed } from "./ModelProfile";

export interface ModelDerivationPolicy {
  truncationRatio: number;
  chunkRatio: number;
  minTruncationTokens: number;
  minChunkTokens: number;
  maxChunkTokens: number;
}

export const DEFAULT_MODEL_DERIVATION_POLICY: ModelDerivationPolicy = Object.freeze({
  truncationRatio: 0.75,
  chunkRatio: 0.25,
  minTruncationTokens: 256,
  minChunkTokens: 128,
  maxChunkTokens: 2048,
});

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertPositiveRatio(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validatePolicy(policy: ModelDerivationPolicy): void {
  assertPositiveRatio("truncationRatio", policy.truncationRatio);
  assertPositiveRatio("chunkRatio", policy.chunkRatio);
  assertPositiveInteger("minTruncationTokens", policy.minTruncationTokens);
  assertPositiveInteger("minChunkTokens", policy.minChunkTokens);
  assertPositiveInteger("maxChunkTokens", policy.maxChunkTokens);

  if (policy.minChunkTokens > policy.maxChunkTokens) {
    throw new Error("minChunkTokens cannot exceed maxChunkTokens");
  }
}

export function deriveTruncationTokens(
  contextWindowTokens: number,
  policy: ModelDerivationPolicy = DEFAULT_MODEL_DERIVATION_POLICY,
): number {
  assertPositiveInteger("contextWindowTokens", contextWindowTokens);
  validatePolicy(policy);

  const derived = Math.floor(contextWindowTokens * policy.truncationRatio);
  return Math.max(policy.minTruncationTokens, derived);
}

export function deriveChunkTokenLimit(
  contextWindowTokens: number,
  policy: ModelDerivationPolicy = DEFAULT_MODEL_DERIVATION_POLICY,
): number {
  const truncationTokens = deriveTruncationTokens(contextWindowTokens, policy);
  const derived = Math.floor(truncationTokens * policy.chunkRatio);

  return clamp(derived, policy.minChunkTokens, policy.maxChunkTokens);
}

export function buildModelProfileFromSeed(
  seed: ModelProfileSeed,
  policy: ModelDerivationPolicy = DEFAULT_MODEL_DERIVATION_POLICY,
): ModelProfile {
  const modelId = seed.modelId.trim();
  if (modelId.length === 0) {
    throw new Error("modelId must be a non-empty string");
  }

  assertPositiveInteger("embeddingDimension", seed.embeddingDimension);
  assertPositiveInteger("contextWindowTokens", seed.contextWindowTokens);

  return {
    modelId,
    embeddingDimension: seed.embeddingDimension,
    contextWindowTokens: seed.contextWindowTokens,
    truncationTokens: deriveTruncationTokens(seed.contextWindowTokens, policy),
    maxChunkTokens: deriveChunkTokenLimit(seed.contextWindowTokens, policy),
    source: seed.source,
  };
}
