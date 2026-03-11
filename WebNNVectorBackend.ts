// WebNN types are in @webnn/types or via the browser's MLContext
declare const ml: { createContext(): Promise<MLContext> };

export class WebNnVectorBackend implements VectorBackend {
  readonly kind = "webnn" as const;
  private ctx!: MLContext;
  private builder!: MLGraphBuilder;
  // Cache compiled graphs keyed by "dimIn,dimOut" to avoid recompilation
  private graphCache = new Map<string, MLGraph>();
  // Fallback for binary ops (WebNN has no bitwise)
  private wasmFallback!: WasmVectorBackend;

  static async create(wasmBytes: ArrayBuffer): Promise<WebNnVectorBackend> {
    const b = new WebNnVectorBackend();
    b.ctx     = await navigator.ml.createContext({ deviceType: "gpu" });
    b.builder = new MLGraphBuilder(b.ctx);
    b.wasmFallback = await WasmVectorBackend.create(wasmBytes);
    return b;
  }

  // Build and cache an MLGraph for a given matmul shape.
  // graph computes: output[count] = matrix[count, dim] · query[dim]
  // (treating dot_many as a single matmul: output = M @ q)
  private async getOrBuildGraph(
    dim: number, count: number
  ): Promise<{ graph: MLGraph; qInput: MLOperand; mInput: MLOperand }> {
    const key = `${dim},${count}`;
    if (!this.graphCache.has(key)) {
      const qDesc: MLOperandDescriptor = { dataType: "float32", dimensions: [dim] };
      const mDesc: MLOperandDescriptor = { dataType: "float32", dimensions: [count, dim] };

      const q = this.builder.input("query",  qDesc);
      const M = this.builder.input("matrix", mDesc);

      // Reshape query to [dim, 1] for matmul
      const qCol = this.builder.reshape(q, [dim, 1]);
      // matmul: [count, dim] × [dim, 1] → [count, 1]
      const out  = this.builder.matmul(M, qCol);
      // Flatten to [count]
      const flat = this.builder.reshape(out, [count]);

      const graph = await this.builder.build({ scores: flat });
      this.graphCache.set(key, graph);
    }
    return { graph: this.graphCache.get(key)!, qInput: null!, mInput: null! };
  }

  async dotMany(
    query: Float32Array, matrix: Float32Array,
    dim: number, count: number
  ): Promise<Float32Array> {
    const { graph } = await this.getOrBuildGraph(dim, count);
    const outputs = { scores: new Float32Array(count) };
    await this.ctx.compute(graph, { query, matrix }, outputs);
    return outputs.scores;
  }

  // project: same matmul, just dimIn→dimOut; WebNN handles any shape
  async project(
    vec: Float32Array, P: Float32Array,
    dimIn: number, dimOut: number
  ): Promise<Float32Array> {
    return this.dotMany(vec, P, dimIn, dimOut);
  }

  // WebNN has no bitwise instructions — delegate to WASM
  async hashToBinary(
    vec: Float32Array, P: Float32Array,
    dimIn: number, bits: number
  ): Promise<Uint32Array> {
    return this.wasmFallback.hashToBinary(vec, P, dimIn, bits);
  }

  async hammingTopK(
    queryCode: Uint32Array, codes: Uint32Array,
    wordsPerCode: number, count: number, k: number
  ): Promise<{ index: number; distance: number }[]> {
    return this.wasmFallback.hammingTopK(queryCode, codes, wordsPerCode, count, k);
  }

  async topKFromScores(
    scores: Float32Array, k: number
  ): Promise<{ index: number; score: number }[]> {
    return topKCpu(scores, k, true);
  }
}
