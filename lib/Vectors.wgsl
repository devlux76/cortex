//////////////////////////////////////////////////////////////////
// CORTEX GPU Vector Kernels (High-Performance Version)
//////////////////////////////////////////////////////////////////

// ---------------------------------------------------------------
// Shared runtime parameters
// ---------------------------------------------------------------
struct Params {
  dim            : u32,
  count          : u32,
  words_per_code : u32,
  k              : u32,
}

@group(0) @binding(3)
var<uniform> params : Params;


// ---------------------------------------------------------------
// WORKGROUP TILE SIZE
// ---------------------------------------------------------------

const TILE : u32 = 256;


// ---------------------------------------------------------------
// SHARED MEMORY
// ---------------------------------------------------------------

var<workgroup> query_tile : array<f32, TILE>;


// ===============================================================
// DOT MANY (Tiled)
// ===============================================================

@group(0) @binding(0)
var<storage, read> query  : array<f32>;

@group(0) @binding(1)
var<storage, read> matrix : array<f32>;

@group(0) @binding(2)
var<storage, read_write> scores : array<f32>;

@compute @workgroup_size(256)
fn dot_many(
  @builtin(global_invocation_id) gid : vec3<u32>,
  @builtin(local_invocation_id)  lid : vec3<u32>
) {

  let row = gid.x;

  if (row >= params.count) {
    return;
  }

  let dim  = params.dim;
  let base = row * dim;

  var sum : f32 = 0.0;

  // iterate query vector in tiles
  for (var tile : u32 = 0u; tile < dim; tile = tile + TILE) {

    let load_index = tile + lid.x;

    if (load_index < dim) {
      query_tile[lid.x] = query[load_index];
    }

    workgroupBarrier();

    let tile_size = min(TILE, dim - tile);

    // compute partial dot
    for (var j : u32 = 0u; j < tile_size; j = j + 1u) {
      sum = sum + query_tile[j] * matrix[base + tile + j];
    }

    workgroupBarrier();
  }

  scores[row] = sum;
}



// ===============================================================
// RANDOM HYPERPLANE BINARY HASH
// ===============================================================

@group(0) @binding(0)
var<storage, read> vec_in : array<f32>;

@group(0) @binding(1)
var<storage, read> hyperplanes : array<f32>;

@group(0) @binding(2)
var<storage, read_write> code_out : array<atomic<u32>>;

@compute @workgroup_size(128)
fn hash_binary(
  @builtin(global_invocation_id) gid : vec3<u32>
) {

  let bit_index = gid.x;
  let bits = params.count;

  if (bit_index >= bits) {
    return;
  }

  let dim = params.dim;
  let base = bit_index * dim;

  var dot : f32 = 0.0;

  for (var j : u32 = 0u; j < dim; j = j + 1u) {
    dot = dot + vec_in[j] * hyperplanes[base + j];
  }

  if (dot >= 0.0) {

    let word = bit_index >> 5u;
    let bit  = bit_index & 31u;

    atomicOr(&code_out[word], 1u << bit);
  }
}



// ===============================================================
// HAMMING DISTANCE SCORES
// ===============================================================

@group(0) @binding(0)
var<storage, read> q_code : array<u32>;

@group(0) @binding(1)
var<storage, read> codes : array<u32>;

@group(0) @binding(2)
var<storage, read_write> out_dist : array<u32>;

@compute @workgroup_size(256)
fn hamming_scores(
  @builtin(global_invocation_id) gid : vec3<u32>
) {

  let i = gid.x;

  if (i >= params.count) {
    return;
  }

  let words = params.words_per_code;
  let base  = i * words;

  var dist : u32 = 0u;

  for (var w : u32 = 0u; w < words; w = w + 1u) {

    let xorv = q_code[w] ^ codes[base + w];

    dist = dist + countOneBits(xorv);
  }

  out_dist[i] = dist;
}

// ===============================================================
// DOT BATCH — Dual-Tiled GEMM
// queries : [num_queries × dim]   reuses params.k = num_queries
// matrix  : [count × dim]
// scores  : [num_queries × count] row-major output
// Dispatch: (ceil(count/TILE), ceil(num_queries/TILE), 1)
// ===============================================================

const TILE : u32 = 16u;

var<workgroup> q_smem : array<f32, TILE * TILE>;  // [num_queries_local × dim_tile]
var<workgroup> m_smem : array<f32, TILE * TILE>;  // [num_matrix_local  × dim_tile]

@group(0) @binding(0)
var<storage, read> queries : array<f32>;

@group(0) @binding(1)
var<storage, read> matrix  : array<f32>;

@group(0) @binding(2)
var<storage, read_write> scores : array<f32>;

@compute @workgroup_size(TILE, TILE, 1)
fn dot_batch(
  @builtin(local_invocation_id) lid : vec3<u32>,
  @builtin(workgroup_id)        wid : vec3<u32>
) {
  let ln = lid.x;   // local matrix-row index  (0..TILE-1)
  let lm = lid.y;   // local query-row index   (0..TILE-1)

  let mat_row   = wid.x * TILE + ln;
  let query_row = wid.y * TILE + lm;

  let dim = params.dim;
  var acc : f32 = 0.0;

  for (var t : u32 = 0u; t < dim; t += TILE) {

    // Collaborative load — each thread loads exactly 1 element per tile per buffer
    // ln acts as column index for query, lm acts as column index for matrix
    q_smem[lm * TILE + ln] = select(0.0, queries[query_row * dim + t + ln],
                                    query_row < params.k && (t + ln) < dim);

    m_smem[ln * TILE + lm] = select(0.0, matrix[mat_row * dim + t + lm],
                                    mat_row < params.count && (t + lm) < dim);

    workgroupBarrier();

    let tile_end = min(TILE, dim - t);
    for (var j : u32 = 0u; j < tile_end; j++) {
      acc += q_smem[lm * TILE + j] * m_smem[ln * TILE + j];
    }

    workgroupBarrier();
  }

  if query_row < params.k && mat_row < params.count {
    scores[query_row * params.count + mat_row] = acc;
  }
}

