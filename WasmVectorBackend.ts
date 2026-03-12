import type {
  DistanceResult,
  ScoreResult,
  VectorBackend
} from "./VectorBackend";

interface WasmVectorExports {
  mem: WebAssembly.Memory;
  dot_many(qPtr: number, mPtr: number, outPtr: number, dim: number, count: number): void;
  project(vecPtr: number, pPtr: number, outPtr: number, dimIn: number, dimOut: number): void;
  hash_binary(vecPtr: number, pPtr: number, codePtr: number, dimIn: number, bits: number): void;
  hamming_scores(
    queryCodePtr: number,
    codesPtr: number,
    outPtr: number,
    wordsPerCode: number,
    count: number
  ): void;
  topk_i32(scoresPtr: number, outPtr: number, count: number, k: number): void;
  topk_f32(scoresPtr: number, outPtr: number, count: number, k: number): void;
}

export class WasmVectorBackend implements VectorBackend {
  readonly kind = "wasm" as const;
  private exports!: WasmVectorExports;
  private mem!: WebAssembly.Memory;
  private bump = 1024; // first 1KB reserved as guard

  static async create(wasmBytes: ArrayBuffer): Promise<WasmVectorBackend> {
    const b = new WasmVectorBackend();
    const { instance } = await WebAssembly.instantiate(wasmBytes);
    b.exports = instance.exports as unknown as WasmVectorExports;
    b.mem = instance.exports.mem as WebAssembly.Memory;
    return b;
  }

  // 16-byte-aligned bump allocator; call reset() between requests
  private alloc(bytes: number): number {
    const ptr = (this.bump + 15) & ~15;
    this.bump = ptr + bytes;
    if (this.bump > this.mem.buffer.byteLength) {
      this.mem.grow(Math.ceil((this.bump - this.mem.buffer.byteLength) / 65536));
    }
    return ptr;
  }

  reset(): void { this.bump = 1024; }

  private writeF32(data: Float32Array): number {
    const ptr = this.alloc(data.byteLength);
    new Float32Array(this.mem.buffer, ptr, data.length).set(data);
    return ptr;
  }

  private writeU32(data: Uint32Array): number {
    const ptr = this.alloc(data.byteLength);
    new Uint32Array(this.mem.buffer, ptr, data.length).set(data);
    return ptr;
  }

  async dotMany(
    query: Float32Array, matrix: Float32Array,
    dim: number, count: number
  ): Promise<Float32Array> {
    this.reset();
    const q_ptr  = this.writeF32(query);
    const m_ptr  = this.writeF32(matrix);
    const out_ptr = this.alloc(count * 4);
    this.exports.dot_many(q_ptr, m_ptr, out_ptr, dim, count);
    return new Float32Array(this.mem.buffer.slice(out_ptr, out_ptr + count * 4));
  }

  async project(
    vec: Float32Array,
    projectionMatrix: Float32Array,
    dimIn: number, dimOut: number
  ): Promise<Float32Array> {
    this.reset();
    const v_ptr   = this.writeF32(vec);
    const P_ptr   = this.writeF32(projectionMatrix);
    const out_ptr = this.alloc(dimOut * 4);
    this.exports.project(v_ptr, P_ptr, out_ptr, dimIn, dimOut);
    return new Float32Array(this.mem.buffer.slice(out_ptr, out_ptr + dimOut * 4));
  }

  async hashToBinary(
    vec: Float32Array,
    projectionMatrix: Float32Array,
    dimIn: number, bits: number
  ): Promise<Uint32Array> {
    this.reset();
    const wordsPerCode = Math.ceil(bits / 32);
    const v_ptr    = this.writeF32(vec);
    const P_ptr    = this.writeF32(projectionMatrix);
    const code_ptr = this.alloc(wordsPerCode * 4);
    this.exports.hash_binary(v_ptr, P_ptr, code_ptr, dimIn, bits);
    return new Uint32Array(this.mem.buffer.slice(code_ptr, code_ptr + wordsPerCode * 4));
  }

  async hammingTopK(
    queryCode: Uint32Array, codes: Uint32Array,
    wordsPerCode: number, count: number, k: number
  ): Promise<DistanceResult[]> {
    this.reset();
    const q_ptr       = this.writeU32(queryCode);
    const codes_ptr   = this.writeU32(codes);
    const scores_ptr  = this.alloc(count * 4);
    const out_ptr     = this.alloc(k * 4);

    this.exports.hamming_scores(q_ptr, codes_ptr, scores_ptr, wordsPerCode, count);

    // Snapshot distances before topk_i32 mutates scores in-place
    const distances = new Int32Array(
      this.mem.buffer.slice(scores_ptr, scores_ptr + count * 4)
    );

    this.exports.topk_i32(scores_ptr, out_ptr, count, k);

    const indices = new Int32Array(this.mem.buffer, out_ptr, k);
    return Array.from(indices).map(idx => ({ index: idx, distance: distances[idx] }));
  }

  async topKFromScores(
    scores: Float32Array, k: number
  ): Promise<ScoreResult[]> {
    this.reset();
    // copy: topk_f32 mutates in-place
    const copy_ptr = this.writeF32(new Float32Array(scores));
    const out_ptr  = this.alloc(k * 4);
    this.exports.topk_f32(copy_ptr, out_ptr, scores.length, k);
    const indices = new Int32Array(this.mem.buffer, out_ptr, k);
    return Array.from(indices).map(idx => ({ index: idx, score: scores[idx] }));
  }
}
