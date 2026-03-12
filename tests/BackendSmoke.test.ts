import { describe, expect, it } from "vitest";

import { detectBackend } from "../BackendKind";
import { topKByDistance, topKByScore } from "../TopK";

describe("detectBackend", () => {
  it("returns a known backend kind", () => {
    const kind = detectBackend();

    expect(["webgpu", "webgl", "webnn", "wasm"]).toContain(kind);
  });
});

describe("topK helpers", () => {
  it("ranks float scores in descending order", () => {
    const scores = new Float32Array([0.2, 0.9, 0.4, 0.7]);
    const result = topKByScore(scores, 2);

    expect(result).toHaveLength(2);
    expect(result[0].index).toBe(1);
    expect(result[1].index).toBe(3);
    expect(result[0].score).toBeCloseTo(0.9, 6);
    expect(result[1].score).toBeCloseTo(0.7, 6);
  });

  it("ranks distances in ascending order", () => {
    const distances = new Uint32Array([12, 2, 9, 4]);
    const result = topKByDistance(distances, 3);

    expect(result).toEqual([
      { index: 1, distance: 2 },
      { index: 3, distance: 4 },
      { index: 2, distance: 9 }
    ]);
  });
});
