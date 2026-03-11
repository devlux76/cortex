export async function createVectorBackend(
  wasmBytes: ArrayBuffer
): Promise<VectorBackend> {
  const kind = detectBackend();
  if (kind === "webgpu") {
    return WebGpuVectorBackend.create().catch(() =>
      WasmVectorBackend.create(wasmBytes)
    );
  }
  if (kind === "webgl") {
    return Promise.resolve(WebGlVectorBackend.create()).catch(() =>
      WasmVectorBackend.create(wasmBytes)
    );
  }
  if (kind === "webnn") {
    return WebNnVectorBackend.create(wasmBytes).catch(() =>
      WasmVectorBackend.create(wasmBytes)
    );
  }
  return WasmVectorBackend.create(wasmBytes);
}
