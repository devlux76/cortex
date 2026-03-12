import { describe, expect, it } from "vitest";
import { generateKeyPair, signData } from "../../core/crypto/sign.js";
import { verifySignature } from "../../core/crypto/verify.js";

describe("verifySignature", () => {
  it("returns true for a valid signature over a string", async () => {
    const { signingKey, publicKey } = await generateKeyPair();
    const data = "hello, cortex";
    const signature = await signData(data, signingKey);
    const valid = await verifySignature(data, signature, publicKey);
    expect(valid).toBe(true);
  });

  it("returns true for a valid signature over an ArrayBuffer", async () => {
    const { signingKey, publicKey } = await generateKeyPair();
    const data = new Uint8Array([10, 20, 30, 40]).buffer;
    const signature = await signData(data, signingKey);
    const valid = await verifySignature(data, signature, publicKey);
    expect(valid).toBe(true);
  });

  it("returns false when the signed data has been tampered with", async () => {
    const { signingKey, publicKey } = await generateKeyPair();
    const original = "original content";
    const tampered = "tampered content";
    const signature = await signData(original, signingKey);
    const valid = await verifySignature(tampered, signature, publicKey);
    expect(valid).toBe(false);
  });

  it("returns false when the signature has been altered", async () => {
    const { signingKey, publicKey } = await generateKeyPair();
    const data = "some page content";
    const signature = await signData(data, signingKey);
    // Replace the last 4 base64 chars with 'AAAA' to corrupt the signature bytes
    const corrupted = signature.slice(0, -4) + "AAAA";
    const valid = await verifySignature(data, corrupted, publicKey);
    expect(valid).toBe(false);
  });

  it("returns false when verified against a different key pair", async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const data = "signed by kp1";
    const signature = await signData(data, kp1.signingKey);
    const valid = await verifySignature(data, signature, kp2.publicKey);
    expect(valid).toBe(false);
  });

  it("handles round-trip with importSigningKey correctly", async () => {
    const { privateKeyJwk, publicKey } = await generateKeyPair();
    // Simulate restoring the key from storage
    const { importSigningKey } = await import("../../core/crypto/sign.js");
    const restoredKey = await importSigningKey(privateKeyJwk);
    const data = "restored key signing test";
    const signature = await signData(data, restoredKey);
    const valid = await verifySignature(data, signature, publicKey);
    expect(valid).toBe(true);
  });

  it("is consistent for empty string data", async () => {
    const { signingKey, publicKey } = await generateKeyPair();
    const signature = await signData("", signingKey);
    const valid = await verifySignature("", signature, publicKey);
    expect(valid).toBe(true);
  });
});
