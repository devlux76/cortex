// ── Vertex shader (full-screen triangle trick, no geometry needed) ──
#version 300 es
out vec2 v_uv;
void main() {
  // Three hardcoded positions produce a triangle covering the viewport
  vec2 pos[3] = vec2[](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
  gl_Position = vec4(pos[gl_VertexID], 0, 1);
  v_uv = pos[gl_VertexID] * 0.5 + 0.5;
}

// ── Fragment shader: one score per output pixel ──────────────────
#version 300 es
precision highp float;
precision highp int;

// matrix: RGBA32F texture, width=ceil(dim/4), height=count
// Each texel holds 4 consecutive floats from a vector row.
uniform highp sampler2D u_matrix;
// query: same RGBA32F layout, height=1
uniform highp sampler2D u_query;
// dim_packed = ceil(dim/4);  actual_dim for the tail
uniform int u_dim_packed;
uniform int u_actual_dim;   // in floats (not texels)
uniform int u_count;

out vec4 out_color;         // R = score; GBA unused

void main() {
  int row = int(gl_FragCoord.x);   // one pixel per candidate
  if (row >= u_count) { discard; }

  float sum = 0.0;
  for (int j = 0; j < u_dim_packed; j++) {
    vec4 q = texelFetch(u_query,  ivec2(j, 0),   0);
    vec4 m = texelFetch(u_matrix, ivec2(j, row), 0);
    sum += dot(q, m);   // GPU
