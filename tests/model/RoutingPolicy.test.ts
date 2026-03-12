import { describe, expect, it } from "vitest";

import { createRoutingPolicy } from "../../Policy";

describe("createRoutingPolicy", () => {
  it("derives projection dimensions from embedding dimension", () => {
    const policy = createRoutingPolicy({ embeddingDimension: 1536 });

    expect(policy.broad.dimIn).toBe(1536);
    expect(policy.normal.dimIn).toBe(1536);
    expect(policy.narrow.dimIn).toBe(1536);

    expect(policy.broad.dimOut).toBe(192);
    expect(policy.normal.dimOut).toBe(384);
    expect(policy.narrow.dimOut).toBe(768);
    expect(policy.broad.bits).toBe(128);
  });

  it("keeps dimensions bounded and aligned", () => {
    const policy = createRoutingPolicy(
      { embeddingDimension: 99 },
      {
        dimAlignment: 8,
      }
    );

    expect(policy.broad.dimOut).toBe(8);
    expect(policy.normal.dimOut).toBe(24);
    expect(policy.narrow.dimOut).toBe(48);
  });

  it("computes deterministic contiguous projection offsets", () => {
    const policy = createRoutingPolicy({ embeddingDimension: 256 });

    expect(policy.broad.offset).toBe(0);
    expect(policy.normal.offset).toBe(8192);
    expect(policy.narrow.offset).toBe(24576);
  });
});
