// TS side
export interface VectorBackend {
  kind: BackendKind; // "wasm" | "webgl" | "webgpu" | "webnn"

  // ---- float space (exact or high-precision cosine) ----
  dotMany(
    query: Float32Array,      // length = dim
    matrix: Float32Array,     // length = dim * count, row-major
    dim: number,
    count: number
  ): Promise<Float32Array>;   // scores[length = count]

  topKFromScores(
    scores: Float32Array,
    k: number
  ): Promise<{ index: number; score: number }[]>;

  // ---- binary space (approximate, XOR / popcnt) ----
  hashToBinary(
    vector: Float32Array,     // original embedding (e.g. 768-d)
    dim: number,              // same as vector.length
    bits: number              // e.g. 64, 128
  ): Promise<Uint32Array>;    // packed bits (words = ceil(bits/32))

  hammingTopK(
    queryCode: Uint32Array,   // packed bits
    codes: Uint32Array,       // concatenated codes for N items
    wordsPerCode: number,
    count: number,            // N
    k: number
  ): Promise<{ index: number; distance: number }[]>;
}
