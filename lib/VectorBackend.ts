import type { BackendKind } from "./BackendKind";

export interface ScoreResult {
  index: number;
  score: number;
}

export interface DistanceResult {
  index: number;
  distance: number;
}

export interface VectorBackend {
  kind: BackendKind;

  // Exact or high-precision dot-product scoring over row-major matrices.
  dotMany(
    query: Float32Array,
    matrix: Float32Array,
    dim: number,
    count: number
  ): Promise<Float32Array>;

  // Projection helper used to reduce dimensionality for routing tiers.
  project(
    vector: Float32Array,
    projectionMatrix: Float32Array,
    dimIn: number,
    dimOut: number
  ): Promise<Float32Array>;

  topKFromScores(scores: Float32Array, k: number): Promise<ScoreResult[]>;

  // Random-hyperplane hash from projected vectors into packed binary codes.
  hashToBinary(
    vector: Float32Array,
    projectionMatrix: Float32Array,
    dimIn: number,
    bits: number
  ): Promise<Uint32Array>;

  hammingTopK(
    queryCode: Uint32Array,
    codes: Uint32Array,
    wordsPerCode: number,
    count: number,
    k: number
  ): Promise<DistanceResult[]>;
}
