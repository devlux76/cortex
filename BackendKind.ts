export type BackendKind = "webnn" | "webgpu" | "webgl" | "wasm";

function hasWebGpuSupport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { gpu?: unknown }).gpu !== "undefined"
  );
}

function hasWebGl2Support(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const canvas = document.createElement("canvas");
  return canvas.getContext("webgl2") !== null;
}

function hasWebNnSupport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { ml?: unknown }).ml !== "undefined"
  );
}

export function detectBackend(): BackendKind {
  if (hasWebGpuSupport()) {
    return "webgpu";
  }

  if (hasWebGl2Support()) {
    return "webgl";
  }

  if (hasWebNnSupport()) {
    return "webnn";
  }

  return "wasm";
}
