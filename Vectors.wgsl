// ── Params uniform (shared by all shaders) ─────────────────────
struct Params {
  dim            : u32,
  count          : u32,
  words_per_code : u32,
  k              : u32,
}
@group(0) @binding(3) var<uniform> params: Params;

// ── dot_many ────────────────────────────────────────────────────
@group(0) @binding(0) var<storage, read>       query  : array<f32>;
@group(0) @binding(1) var<storage, read>       matrix : array<f32>;
@group(0) @binding(2) var<storage, read_write> scores : array<f32>;

@compute @workgroup_size(256)
fn dot_many(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  var sum = 0.0;
  let base = i * params.dim;
  for (var j = 0u; j < params.dim; j++) {
    sum += query[j] * matrix[base + j];
  }
  scores[i] = sum;
}

// ── project ─────────────────────────────────────────────────────
// Reuse dot_many with dim_in in params.dim, dim_out in params.count
// (caller sets params accordingly per dispatch)

// ── hash_binary ─────────────────────────────────────────────────
// Each thread handles one hyperplane (one bit)
@group(0) @binding(0) var<storage, read>       vec_in    : array<f32>;   // [dim_in]
@group(0) @binding(1) var<storage, read>       hyperplanes: array<f32>;  // [bits * dim_in]
@group(0) @binding(2) var<storage, read_write> code_out  : array<u32>;   // [words_per_code]

@compute @workgroup_size(128)
fn hash_binary(@builtin(global_invocation_id) gid: vec3<u32>) {
  let b = gid.x;             // one thread per bit
  let bits = params.count;   // reuse count field for bit count
  if (b >= bits) { return; }

  var dot = 0.0;
  let base = b * params.dim;
  for (var j = 0u; j < params.dim; j++) {
    dot += vec_in[j] * hyperplanes[base + j];
  }

  if (dot >= 0.0) {
    let word = b >> 5u;       // b / 32
    let bit  = b &  31u;      // b % 32
    atomicOr(&code_out_atomic[word], 1u << bit);
  }
}
// Note: declare code_out as array<atomic<u32>> for the atomic version above.

// ── hamming_scores ───────────────────────────────────────────────
@group(0) @binding(0) var<storage, read>       q_code  : array<u32>;   // [words_per_code]
@group(0) @binding(1) var<storage, read>       codes   : array<u32>;   // [words_per_code * count]
@group(0) @binding(2) var<storage, read_write> out_dist: array<u32>;   // [count]

@compute @workgroup_size(256)
fn hamming_scores(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  var dist = 0u;
  let base = i * params.words_per_code;
  for (var w = 0u; w < params.words_per_code; w++) {
    dist += countOneBits(q_code[w] ^ codes[base + w]);
  }
  out_dist[i] = dist;
}
