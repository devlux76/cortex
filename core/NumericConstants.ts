// Runtime and memory-layout numeric constants shared across backends.

export const FLOAT32_BYTES = 4;
export const UINT32_BYTES = 4;
export const UINT32_BITS = 32;
export const RGBA_CHANNELS = 4;

export const WASM_ALLOC_GUARD_BYTES = 1024;
export const WASM_ALLOC_ALIGNMENT_BYTES = 16;
export const WASM_PAGE_BYTES = 64 * 1024;

export const WEBGPU_MIN_UNIFORM_BYTES = 16;
export const WEBGPU_DOT_WORKGROUP_SIZE = 256;
export const WEBGPU_HASH_WORKGROUP_SIZE = 128;
export const WEBGPU_HAMMING_WORKGROUP_SIZE = 256;

export const FULLSCREEN_TRIANGLE_VERTEX_COUNT = 3;
