import { describe, expect, it } from "vitest";
import { generateKeyPair, importSigningKey, signData } from "../../core/crypto/sign.js";

describe("generateKeyPair", () => {
  it("returns publicKey as a non-empty JWK JSON string", async () => {
    const kp = await generateKeyPair();
    expect(typeof kp.publicKey).toBe("string");
    const jwk = JSON.parse(kp.publicKey) as Record<string, unknown>;
    expect(jwk.kty).toBe("OKP");
    expect(jwk.crv).toBe("Ed25519");
    expect(typeof jwk.x).toBe("string"); // public key material
    expect(jwk.d).toBeUndefined();       // private material must not appear
  });

  it("returns privateKeyJwk as a non-empty JWK JSON string with private material", async () => {
    const kp = await generateKeyPair();
    expect(typeof kp.privateKeyJwk).toBe("string");
    const jwk = JSON.parse(kp.privateKeyJwk) as Record<string, unknown>;
    expect(jwk.kty).toBe("OKP");
    expect(jwk.crv).toBe("Ed25519");
    expect(typeof jwk.d).toBe("string"); // private key material present
  });

  it("returns a CryptoKey for the signingKey field", async () => {
    const kp = await generateKeyPair();
    expect(kp.signingKey).toBeDefined();
    expect(kp.signingKey.type).toBe("private");
    expect(kp.signingKey.algorithm.name).toBe("Ed25519");
  });

  it("generates a distinct key pair on each call", async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
    expect(kp1.privateKeyJwk).not.toBe(kp2.privateKeyJwk);
  });
});

describe("importSigningKey", () => {
  it("imports a private key that can be used for signing", async () => {
    const kp = await generateKeyPair();
    const importedKey = await importSigningKey(kp.privateKeyJwk);
    expect(importedKey.type).toBe("private");
    expect(importedKey.algorithm.name).toBe("Ed25519");
    // Confirm the imported key produces a valid signature
    const signature = await signData("test", importedKey);
    expect(typeof signature).toBe("string");
    expect(signature.length).toBeGreaterThan(0);
  });
});

describe("signData", () => {
  it("returns a non-empty base64 string for a string input", async () => {
    const { signingKey } = await generateKeyPair();
    const signature = await signData("hello, cortex", signingKey);
    expect(typeof signature).toBe("string");
    expect(signature.length).toBeGreaterThan(0);
    // Base64 alphabet only
    expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("returns a non-empty base64 string for an ArrayBuffer input", async () => {
    const { signingKey } = await generateKeyPair();
    const data = new Uint8Array([1, 2, 3, 4]).buffer;
    const signature = await signData(data, signingKey);
    expect(typeof signature).toBe("string");
    expect(signature.length).toBeGreaterThan(0);
  });

  it("produces a deterministic-length signature (Ed25519 = 64 bytes = 88 base64 chars)", async () => {
    const { signingKey } = await generateKeyPair();
    const sig1 = await signData("a", signingKey);
    const sig2 = await signData("much longer content that should still produce the same length", signingKey);
    // Ed25519 always produces 64-byte signatures → 88 base64 characters (with padding)
    expect(sig1).toHaveLength(88);
    expect(sig2).toHaveLength(88);
  });

  it("different data produces different signatures with the same key", async () => {
    const { signingKey } = await generateKeyPair();
    const sig1 = await signData("data A", signingKey);
    const sig2 = await signData("data B", signingKey);
    expect(sig1).not.toBe(sig2);
  });
});
