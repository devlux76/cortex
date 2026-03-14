export type ModelProfileSource = "metadata" | "registry" | "mixed";

export interface ModelProfileSeed {
  modelId: string;
  embeddingDimension: number;
  contextWindowTokens: number;
  source: ModelProfileSource;
  /**
   * The most coarse-grained Matryoshka sub-dimension for this model.
   *
   * This is the smallest nested embedding size the model officially supports.
   * It defines the "protected floor" used by MetroidBuilder: lower dimensions
   * encode invariant domain context and are never searched for antithesis.
   *
   * Known values:
   *   - embeddinggemma-300m: 128
   *   - nomic-embed-text-v1.5: 64
   *
   * `undefined` for models that do not use Matryoshka Representation Learning.
   * When undefined, MetroidBuilder cannot perform dimensional unwinding and will
   * always declare a knowledge gap (antithesis search is not possible).
   */
  matryoshkaProtectedDim?: number;
}

export interface PartialModelMetadata {
  embeddingDimension?: number;
  contextWindowTokens?: number;
}

export interface ModelProfile {
  modelId: string;
  embeddingDimension: number;
  contextWindowTokens: number;
  truncationTokens: number;
  maxChunkTokens: number;
  source: ModelProfileSource;
  /**
   * The most coarse-grained Matryoshka sub-dimension for this model.
   *
   * This is the smallest nested embedding size the model officially supports.
   * It defines the "protected floor" used by MetroidBuilder: dimensions below
   * this boundary encode invariant domain context and are never searched for
   * antithesis during Matryoshka dimensional unwinding.
   *
   * Known values:
   *   - embeddinggemma-300m: 128
   *   - nomic-embed-text-v1.5: 64
   *
   * `undefined` for models that do not use Matryoshka Representation Learning.
   * When undefined, MetroidBuilder cannot perform dimensional unwinding and will
   * always declare a knowledge gap (antithesis search is not possible without
   * a protected-dimension floor).
   */
  matryoshkaProtectedDim?: number;
}
