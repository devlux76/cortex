import { topKByDistance, topKByScore } from "./TopK";
import type {
  DistanceResult,
  ScoreResult,
  VectorBackend
} from "./VectorBackend";
import {
  FULLSCREEN_TRIANGLE_VERTEX_COUNT,
  RGBA_CHANNELS,
  UINT32_BITS,
} from "./core/NumericConstants";

const VERT_SRC = /* glsl */`#version 300 es
out vec2 v_uv;
void main() {
  // Full-screen triangle; no geometry buffer needed
  vec2 pos[3];
  pos[0] = vec2(-1.0, -1.0);
  pos[1] = vec2( 3.0, -1.0);
  pos[2] = vec2(-1.0,  3.0);
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
  v_uv = pos[gl_VertexID] * 0.5 + 0.5;
}`;

// One fragment per candidate vector; textures are RGBA32F so 4 floats per texel
const DOT_FRAG_SRC = /* glsl */`#version 300 es
precision highp float;
// matrix rows packed as RGBA32F: width = ceil(dim/4), height = count
uniform highp sampler2D u_matrix;
// query packed the same way; height = 1
uniform highp sampler2D u_query;
uniform int u_dim_packed;   // ceil(dim/4)
uniform int u_actual_dim;   // true dim in floats
uniform int u_count;
out vec4 out_color;          // r = score
void main() {
  int row = int(gl_FragCoord.x);
  if (row >= u_count) { discard; }
  float sum = 0.0;
  for (int j = 0; j < u_dim_packed; j++) {
    vec4 q = texelFetch(u_query,  ivec2(j, 0),   0);
    vec4 m = texelFetch(u_matrix, ivec2(j, row), 0);
    // For the last texel, zero out unused lanes beyond actual_dim
    int base = j * 4;
    if (base + 3 >= u_actual_dim) {
      int rem = u_actual_dim - base;  // 1, 2, or 3
      if (rem == 1) { q.g = 0.0; q.b = 0.0; q.a = 0.0;
                      m.g = 0.0; m.b = 0.0; m.a = 0.0; }
      if (rem == 2) { q.b = 0.0; q.a = 0.0;
                      m.b = 0.0; m.a = 0.0; }
      if (rem == 3) { q.a = 0.0; m.a = 0.0; }
    }
    sum += dot(q, m);
  }
  out_color = vec4(sum, 0.0, 0.0, 1.0);
}`;

// Binary hash: one fragment per bit; writes 0.0 or 1.0; caller packs into Uint32Array on CPU
const HASH_FRAG_SRC = /* glsl */`#version 300 es
precision highp float;
uniform highp sampler2D u_vec;           // [1 x 1], packed RGBA32F, width=ceil(dim/4)
uniform highp sampler2D u_hyperplanes;   // width=ceil(dim/4), height=bits
uniform int u_dim_packed;
uniform int u_actual_dim;
uniform int u_bits;
out vec4 out_color;                      // r = 1.0 if bit set
void main() {
  int b = int(gl_FragCoord.x);
  if (b >= u_bits) { discard; }
  float dot_val = 0.0;
  for (int j = 0; j < u_dim_packed; j++) {
    vec4 v = texelFetch(u_vec,         ivec2(j, 0), 0);
    vec4 h = texelFetch(u_hyperplanes, ivec2(j, b), 0);
    int base = j * 4;
    if (base + 3 >= u_actual_dim) {
      int rem = u_actual_dim - base;
      if (rem <= 3) { v.a = 0.0; h.a = 0.0; }
      if (rem <= 2) { v.b = 0.0; h.b = 0.0; }
      if (rem <= 1) { v.g = 0.0; h.g = 0.0; }
    }
    dot_val += dot(v, h);
  }
  out_color = vec4(dot_val >= 0.0 ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}`;

// ─────────────────────────────────────────────────────────────────
export class WebGlVectorBackend implements VectorBackend {
  readonly kind = "webgl" as const;
  private gl!: WebGL2RenderingContext;
  private dotProg!: WebGLProgram;
  private hashProg!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;   // empty VAO for attribute-less draw

  static create(canvas?: HTMLCanvasElement): WebGlVectorBackend {
    const b = new WebGlVectorBackend();
    const c = canvas ?? document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 not supported");
    const ext = gl.getExtension("EXT_color_buffer_float");
    if (!ext) throw new Error("EXT_color_buffer_float required");
    b.gl = gl;
    b.dotProg  = b.compileProgram(VERT_SRC, DOT_FRAG_SRC);
    b.hashProg = b.compileProgram(VERT_SRC, HASH_FRAG_SRC);
    b.vao = gl.createVertexArray()!;
    return b;
  }

  private compileProgram(vert: string, frag: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? "Shader compile error");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog) ?? "Program link error");
    return prog;
  }

  // Pack a Float32Array into an RGBA32F texture of size (ceil(len/4), height)
  private packF32Texture(data: Float32Array, height: number): WebGLTexture {
    const gl = this.gl;
    const texWidth = Math.ceil(data.length / height / RGBA_CHANNELS);
    // Pad to texWidth * height * 4
    const padded = new Float32Array(texWidth * height * RGBA_CHANNELS);
    padded.set(data);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F,
      texWidth, height, 0,
      gl.RGBA, gl.FLOAT, padded
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  // Render to a 1D float framebuffer, return raw pixels
  private drawToFramebuffer(
    prog: WebGLProgram,
    width: number,           // = count (one pixel per candidate)
    setup: (prog: WebGLProgram) => void
  ): Float32Array {
    const gl = this.gl;
    gl.canvas.width  = width;
    gl.canvas.height = 1;

    const fbo = gl.createFramebuffer()!;
    const rbuf = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, rbuf);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA32F, width, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rbuf);

    gl.viewport(0, 0, width, 1);
    gl.useProgram(prog);
    setup(prog);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_TRIANGLE_VERTEX_COUNT);

    const pixels = new Float32Array(width * RGBA_CHANNELS);
    gl.readPixels(0, 0, width, 1, gl.RGBA, gl.FLOAT, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteRenderbuffer(rbuf);
    return pixels;
  }

  private uniform1i(prog: WebGLProgram, name: string, v: number) {
    this.gl.uniform1i(this.gl.getUniformLocation(prog, name), v);
  }

  private bindTex(prog: WebGLProgram, name: string, tex: WebGLTexture, unit: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  }

  async dotMany(
    query: Float32Array, matrix: Float32Array,
    dim: number, count: number
  ): Promise<Float32Array> {
    const dimPacked = Math.ceil(dim / 4);
    const qTex = this.packF32Texture(query,  1);
    const mTex = this.packF32Texture(matrix, count);

    const pixels = this.drawToFramebuffer(this.dotProg, count, (prog) => {
      this.bindTex(prog, "u_matrix", mTex, 0);
      this.bindTex(prog, "u_query",  qTex, 1);
      this.uniform1i(prog, "u_dim_packed", dimPacked);
      this.uniform1i(prog, "u_actual_dim", dim);
      this.uniform1i(prog, "u_count", count);
    });

    this.gl.deleteTexture(qTex);
    this.gl.deleteTexture(mTex);

    // Extract r channel from RGBA pixels → scores
    return Float32Array.from(
      { length: count },
      (_, i) => pixels[i * RGBA_CHANNELS]
    );
  }

  async project(
    vec: Float32Array, P: Float32Array,
    dimIn: number, dimOut: number
  ): Promise<Float32Array> {
    return this.dotMany(vec, P, dimIn, dimOut);
  }

  async hashToBinary(
    vec: Float32Array,
    projectionMatrix: Float32Array,
    dimIn: number, bits: number
  ): Promise<Uint32Array> {
    const dimPacked = Math.ceil(dimIn / 4);
    const vTex = this.packF32Texture(vec, 1);
    const hTex = this.packF32Texture(projectionMatrix, bits);

    const pixels = this.drawToFramebuffer(this.hashProg, bits, (prog) => {
      this.bindTex(prog, "u_vec",         vTex, 0);
      this.bindTex(prog, "u_hyperplanes", hTex, 1);
      this.uniform1i(prog, "u_dim_packed", dimPacked);
      this.uniform1i(prog, "u_actual_dim", dimIn);
      this.uniform1i(prog, "u_bits",       bits);
    });

    this.gl.deleteTexture(vTex);
    this.gl.deleteTexture(hTex);

    // Pack the per-bit float results (0.0 or 1.0) into Uint32 words
    const wordsPerCode = Math.ceil(bits / UINT32_BITS);
    const code = new Uint32Array(wordsPerCode);
    for (let b = 0; b < bits; b++) {
      if (pixels[b * RGBA_CHANNELS] >= 0.5) {
        const wordIndex = Math.floor(b / UINT32_BITS);
        const bitIndex = b % UINT32_BITS;
        code[wordIndex] |= (1 << bitIndex);
      }
    }
    return code;
  }

  // Hamming done on CPU — WebGL2 has no integer atomic ops,
  // and the XOR+popcnt kernel is not naturally expressible in GLSL for large buffers.
  // For 10k items at 4–8 words each this is ~40k i32 ops and comfortably fast.
  async hammingTopK(
    queryCode: Uint32Array, codes: Uint32Array,
    wordsPerCode: number, count: number, k: number
  ): Promise<DistanceResult[]> {
    const distances = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      let dist = 0;
      const base = i * wordsPerCode;
      for (let w = 0; w < wordsPerCode; w++) {
        let xor = queryCode[w] ^ codes[base + w];
        // Popcount via Hamming weight bit trick
        xor = xor - ((xor >> 1) & 0x55555555);
        xor = (xor & 0x33333333) + ((xor >> 2) & 0x33333333);
        dist += (((xor + (xor >> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
      }
      distances[i] = dist;
    }
    return topKByDistance(distances, k);
  }

  async topKFromScores(
    scores: Float32Array, k: number
  ): Promise<ScoreResult[]> {
    return topKByScore(scores, k);
  }
}
