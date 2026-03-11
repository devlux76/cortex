const DOT_MANY_WGSL = /* wgsl */`
struct Params { dim: u32, count: u32, words_per_code: u32, k: u32 }
@group(0) @binding(0) var<storage, read>       query  : array<f32>;
@group(0) @binding(1) var<storage, read>       matrix : array<f32>;
@group(0) @binding(2) var<storage, read_write> scores : array<f32>;
@group(0) @binding(3) var<uniform>             params : Params;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  var sum = 0.0;
  let base = i * params.dim;
  for (var j = 0u; j < params.dim; j++) { sum += query[j] * matrix[base + j]; }
  scores[i] = sum;
}`;

const HASH_BINARY_WGSL = /* wgsl */`
struct Params { dim: u32, bits: u32, words_per_code: u32, _pad: u32 }
@group(0) @binding(0) var<storage, read>            vec_in     : array<f32>;
@group(0) @binding(1) var<storage, read>            hyperplanes: array<f32>;
@group(0) @binding(2) var<storage, read_write>      code_out   : array<atomic<u32>>;
@group(0) @binding(3) var<uniform>                  params     : Params;
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let b = gid.x;
  if (b >= params.bits) { return; }
  var dot = 0.0;
  let base = b * params.dim;
  for (var j = 0u; j < params.dim; j++) { dot += vec_in[j] * hyperplanes[base + j]; }
  if (dot >= 0.0) { atomicOr(&code_out[b >> 5u], 1u << (b & 31u)); }
}`;

const HAMMING_WGSL = /* wgsl */`
struct Params { dim: u32, count: u32, words_per_code: u32, k: u32 }
@group(0) @binding(0) var<storage, read>       q_code  : array<u32>;
@group(0) @binding(1) var<storage, read>        codes   : array<u32>;
@group(0) @binding(2) var<storage, read_write>  out_dist: array<u32>;
@group(0) @binding(3) var<uniform>              params  : Params;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  var dist = 0u;
  let base = i * params.words_per_code;
  for (var w = 0u; w < params.words_per_code; w++) {
    dist += countOneBits(q_code[w] ^ codes[base + w]);
  }
  out_dist[i] = dist;
}`;

// ─────────────────────────────────────────────────────────────────
export class WebGpuVectorBackend implements VectorBackend {
  readonly kind = "webgpu" as const;
  private device!: GPUDevice;
  private dotPipeline!: GPUComputePipeline;
  private hashPipeline!: GPUComputePipeline;
  private hammingPipeline!: GPUComputePipeline;

  static async create(): Promise<WebGpuVectorBackend> {
    const b = new WebGpuVectorBackend();
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    b.device = await adapter.requestDevice();
    b.dotPipeline     = b.makePipeline(DOT_MANY_WGSL);
    b.hashPipeline    = b.makePipeline(HASH_BINARY_WGSL);
    b.hammingPipeline = b.makePipeline(HAMMING_WGSL);
    return b;
  }

  private makePipeline(wgsl: string): GPUComputePipeline {
    return this.device.createComputePipeline({
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({ code: wgsl }),
        entryPoint: "main",
      },
    });
  }

  // Upload a Float32Array into a GPU storage buffer (read-only)
  private f32Buffer(data: Float32Array, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST): GPUBuffer {
    const buf = this.device.createBuffer({ size: data.byteLength, usage });
    this.device.queue.writeBuffer(buf, 0, data);
    return buf;
  }

  private u32Buffer(data: Uint32Array, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST): GPUBuffer {
    const buf = this.device.createBuffer({ size: data.byteLength, usage });
    this.device.queue.writeBuffer(buf, 0, data);
    return buf;
  }

  // Create an output storage buffer + a mapped readback buffer
  private outBuffer(bytes: number): { gpu: GPUBuffer; read: GPUBuffer } {
    return {
      gpu: this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
      read: this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
    };
  }

  private uniformBuffer(data: Uint32Array): GPUBuffer {
    const buf = this.device.createBuffer({
      size: Math.max(16, data.byteLength),  // WebGPU min uniform size = 16 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buf, 0, data);
    return buf;
  }

  private async readbackF32(gpu: GPUBuffer, read: GPUBuffer, count: number): Promise<Float32Array> {
    const cmd = this.device.createCommandEncoder();
    cmd.copyBufferToBuffer(gpu, 0, read, 0, count * 4);
    this.device.queue.submit([cmd.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(read.getMappedRange().slice(0));
    read.unmap();
    return result;
  }

  private async readbackU32(gpu: GPUBuffer, read: GPUBuffer, count: number): Promise<Uint32Array> {
    const cmd = this.device.createCommandEncoder();
    cmd.copyBufferToBuffer(gpu, 0, read, 0, count * 4);
    this.device.queue.submit([cmd.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const result = new Uint32Array(read.getMappedRange().slice(0));
    read.unmap();
    return result;
  }

  // ── dot_many (also used for project — caller sets dim/count accordingly)
  async dotMany(
    query: Float32Array, matrix: Float32Array,
    dim: number, count: number
  ): Promise<Float32Array> {
    const qBuf  = this.f32Buffer(query);
    const mBuf  = this.f32Buffer(matrix);
    const { gpu: oBuf, read: rBuf } = this.outBuffer(count * 4);
    const uBuf  = this.uniformBuffer(new Uint32Array([dim, count, 0, 0]));

    const bg = this.device.createBindGroup({
      layout: this.dotPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: qBuf } },
        { binding: 1, resource: { buffer: mBuf } },
        { binding: 2, resource: { buffer: oBuf } },
        { binding: 3, resource: { buffer: uBuf } },
      ],
    });

    const cmd = this.device.createCommandEncoder();
    const pass = cmd.beginComputePass();
    pass.setPipeline(this.dotPipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(count / 256));
    pass.end();
    this.device.queue.submit([cmd.finish()]);

    return this.readbackF32(oBuf, rBuf, count);
  }

  // project reuses dotMany — P is (dimOut × dimIn), treat each row as a "vector"
  async project(
    vec: Float32Array, P: Float32Array,
    dimIn: number, dimOut: number
  ): Promise<Float32Array> {
    return this.dotMany(vec, P, dimIn, dimOut);
  }

  // ── hash_binary
  async hashToBinary(
    vec: Float32Array, P: Float32Array,
    dimIn: number, bits: number
  ): Promise<Uint32Array> {
    const wordsPerCode = Math.ceil(bits / 32);
    const vBuf = this.f32Buffer(vec);
    const pBuf = this.f32Buffer(P);
    const { gpu: oBuf, read: rBuf } = this.outBuffer(wordsPerCode * 4);
    // zero-init the output buffer before atomicOr writes
    this.device.queue.writeBuffer(oBuf, 0, new Uint32Array(wordsPerCode));
    const uBuf = this.uniformBuffer(new Uint32Array([dimIn, bits, wordsPerCode, 0]));

    const bg = this.device.createBindGroup({
      layout: this.hashPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: vBuf } },
        { binding: 1, resource: { buffer: pBuf } },
        { binding: 2, resource: { buffer: oBuf } },
        { binding: 3, resource: { buffer: uBuf } },
      ],
    });

    const cmd = this.device.createCommandEncoder();
    const pass = cmd.beginComputePass();
    pass.setPipeline(this.hashPipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(bits / 128));
    pass.end();
    this.device.queue.submit([cmd.finish()]);

    return this.readbackU32(oBuf, rBuf, wordsPerCode);
  }

  // ── hamming_scores + top-k (top-k done on CPU; 10k ints is trivial to sort)
  async hammingTopK(
    queryCode: Uint32Array, codes: Uint32Array,
    wordsPerCode: number, count: number, k: number
  ): Promise<{ index: number; distance: number }[]> {
    const qBuf = this.u32Buffer(queryCode);
    const cBuf = this.u32Buffer(codes);
    const { gpu: oBuf, read: rBuf } = this.outBuffer(count * 4);
    const uBuf = this.uniformBuffer(new Uint32Array([0, count, wordsPerCode, k]));

    const bg = this.device.createBindGroup({
      layout: this.hammingPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: qBuf } },
        { binding: 1, resource: { buffer: cBuf } },
        { binding: 2, resource: { buffer: oBuf } },
        { binding: 3, resource: { buffer: uBuf } },
      ],
    });

    const cmd = this.device.createCommandEncoder();
    const pass = cmd.beginComputePass();
    pass.setPipeline(this.hammingPipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(count / 256));
    pass.end();
    this.device.queue.submit([cmd.finish()]);

    const distances = await this.readbackU32(oBuf, rBuf, count);
    return topKCpu(distances, k, false); // ascending for Hamming
  }

  async topKFromScores(
    scores: Float32Array, k: number
  ): Promise<{ index: number; score: number }[]> {
    return topKCpu(scores, k, true); // descending for cosine
  }
}

// ── Shared CPU top-k (trivially fast for k<<N, used by all backends for final pass)
function topKCpu(
  arr: Float32Array | Uint32Array,
  k: number,
  descending: boolean
): { index: number; score?: number; distance?: number }[] {
  const indices = Array.from({ length: arr.length }, (_, i) => i);
  indices.sort((a, b) =>
    descending
      ? (arr[b] as number) - (arr[a] as number)
      : (arr[a] as number) - (arr[b] as number)
  );
  return indices.slice(0, k).map(i => ({
    index: i,
    score: descending ? (arr[i] as number) : undefined,
    distance: descending ? undefined : (arr[i] as number),
  }));
}
