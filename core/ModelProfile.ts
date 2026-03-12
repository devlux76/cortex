export type ModelProfileSource = "metadata" | "registry" | "mixed";

export interface ModelProfileSeed {
  modelId: string;
  embeddingDimension: number;
  contextWindowTokens: number;
  source: ModelProfileSource;
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
}
