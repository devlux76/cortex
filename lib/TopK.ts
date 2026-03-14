import type { DistanceResult, ScoreResult } from "./VectorBackend";

export function topKByScore(scores: Float32Array, k: number): ScoreResult[] {
  const limit = Math.max(0, Math.min(k, scores.length));
  const indices = Array.from({ length: scores.length }, (_, i) => i);

  indices.sort((a, b) => scores[b] - scores[a]);

  return indices.slice(0, limit).map((index) => ({
    index,
    score: scores[index]
  }));
}

export function topKByDistance(
  distances: Uint32Array | Int32Array | Float32Array,
  k: number
): DistanceResult[] {
  const limit = Math.max(0, Math.min(k, distances.length));
  const indices = Array.from({ length: distances.length }, (_, i) => i);

  indices.sort((a, b) => Number(distances[a]) - Number(distances[b]));

  return indices.slice(0, limit).map((index) => ({
    index,
    distance: Number(distances[index])
  }));
}
