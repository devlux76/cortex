// ================================================================
// CORTEX Vector Compute Kernels
// ================================================================

// ── Shared parameter block ──────────────────────────────────────
struct Params {
  dim            : u32,   // vector dimensionality
  count          : u32,   // number of rows / vectors
  words_per_code : u32,   // u32 words per binary code
  k              : u32,   // optional top-k parameter
}

@group(0) @binding(3)
var<uniform> params : Params;


// ================================================================
// DOT PRODUCT: query • matrix[i]
// ================================================================

@group(0) @binding(0)
var<storage, read> query  : array<f32>;

@group(0) @binding(1)
var<storage, read> matrix : array<f32>;

@group(0) @binding(2)
var<storage, read_write> scores : array<f32>;

@compute @workgroup_size(256)
fn dot_many(@builtin(global_invocation_id) gid : vec3<u32>) {

  let i = gid.x;

  if (i >= params.count) {
    return;
  }

  var sum : f32 = 0.0;
  let base = i * params.dim;

  for (var j : u32 = 0u; j < params.dim; j = j + 1u) {
    sum = sum + query[j] * matrix[base + j];
  }

  scores[i] = sum;
}


// ================================================================
// RANDOM HYPERPLANE BINARY HASH (LSH)
// ================================================================

@group(0) @binding(0)
var<storage, read> vec_in : array<f32>;

@group(0) @binding(1)
var<storage, read> hyperplanes : array<f32>;

@group(0) @binding(2)
var<storage, read_write> code_out : array<atomic<u32>>;

@compute @workgroup_size(128)
fn hash_binary(@builtin(global_invocation_id) gid : vec3<u32>) {

  let bit_index = gid.x;
  let bits = params.count;

  if (bit_index >= bits) {
    return;
  }

  var dot : f32 = 0.0;

  let base = bit_index * params.dim;

  for (var j : u32 = 0u; j < params.dim; j = j + 1u) {
    dot = dot + vec_in[j] * hyperplanes[base + j];
  }

  if (dot >= 0.0) {

    let word = bit_index >> 5u;
    let bit  = bit_index & 31u;

    atomicOr(&code_out[word], 1u << bit);
  }
}


// ================================================================
// HAMMING DISTANCE COMPUTATION
// ================================================================

@group(0) @binding(0)
var<storage, read> q_code : array<u32>;

@group(0) @binding(1)
var<storage, read> codes : array<u32>;

@group(0) @binding(2)
var<storage, read_write> out_dist : array<u32>;

@compute @workgroup_size(256)
fn hamming_scores(@builtin(global_invocation_id) gid : vec3<u32>) {

  let i = gid.x;

  if (i >= params.count) {
    return;
  }

  var dist : u32 = 0u;

  let base = i * params.words_per_code;

  for (var w : u32 = 0u; w < params.words_per_code; w = w + 1u) {

    let x = q_code[w] ^ codes[base + w];

    dist = dist + countOneBits(x);
  }

  out_dist[i] = dist;
}
