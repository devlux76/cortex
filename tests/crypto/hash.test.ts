import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { hashText, hashBinary } from "../../core/crypto/hash.js";

describe("hashText", () => {
  it("returns a 64-character hex string (SHA-256)", async () => {
    const result = await hashText("hello");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("cross-validates against node:crypto createHash for consistent output", async () => {
    const inputs = ["hello", "world", "cortex memory engine", "abc", ""];
    for (const input of inputs) {
      const ours = await hashText(input);
      const native = createHash("sha256").update(input).digest("hex");
      expect(ours).toBe(native);
    }
  });

  it("matches known SHA-256 digest for the empty string", async () => {
    // SHA-256("") is a well-known NIST constant
    const result = await hashText("");
    expect(result).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("produces different hashes for different inputs", async () => {
    const h1 = await hashText("hello");
    const h2 = await hashText("world");
    expect(h1).not.toBe(h2);
  });

  it("is deterministic — same input yields identical hash", async () => {
    const content = "deterministic test input";
    const h1 = await hashText(content);
    const h2 = await hashText(content);
    expect(h1).toBe(h2);
  });
});

describe("hashBinary", () => {
  it("returns a 64-character hex string (SHA-256)", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const result = await hashBinary(data);
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("matches known SHA-256 digest for single zero byte", async () => {
    // SHA-256(0x00) = 6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d
    const data = new Uint8Array([0x00]);
    const result = await hashBinary(data);
    expect(result).toBe("6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d");
  });

  it("accepts ArrayBuffer input", async () => {
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer;
    const result = await hashBinary(data);
    expect(result).toHaveLength(64);
  });

  it("produces different hashes for different byte arrays", async () => {
    const h1 = await hashBinary(new Uint8Array([1, 2, 3]));
    const h2 = await hashBinary(new Uint8Array([4, 5, 6]));
    expect(h1).not.toBe(h2);
  });

  it("is consistent with hashText for the same encoded content", async () => {
    const content = "consistent";
    const textHash = await hashText(content);
    const binaryHash = await hashBinary(new TextEncoder().encode(content));
    expect(textHash).toBe(binaryHash);
  });
});
