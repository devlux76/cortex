import type { PublicKey, Signature } from "../types.js";

export interface KeyPair {
  /** JWK JSON string — safe to store and share. */
  publicKey: PublicKey;
  /** JWK JSON string — store securely; used to reconstruct `signingKey`. */
  privateKeyJwk: string;
  /** Runtime CryptoKey ready for immediate signing operations. */
  signingKey: CryptoKey;
}

function bufferToBase64(buffer: ArrayBuffer): Signature {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Generates a new Ed25519 key pair.
 * Returns the public key as a JWK string, the private key as both a JWK
 * string (for secure storage) and a runtime `CryptoKey` (for signing).
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" } as Algorithm,
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;

  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", keyPair.publicKey),
    crypto.subtle.exportKey("jwk", keyPair.privateKey),
  ]);

  return {
    publicKey: JSON.stringify(publicKeyJwk),
    privateKeyJwk: JSON.stringify(privateKeyJwk),
    signingKey: keyPair.privateKey,
  };
}

/**
 * Imports a private key from its JWK JSON string for use in signing.
 * Call this when restoring a key pair from persistent storage.
 */
export async function importSigningKey(privateKeyJwk: string): Promise<CryptoKey> {
  const jwk = JSON.parse(privateKeyJwk) as JsonWebKey;
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "Ed25519" } as Algorithm,
    false,
    ["sign"],
  );
}

/**
 * Signs arbitrary data with an Ed25519 private key.
 * Returns a base64-encoded signature string.
 *
 * @param data   - UTF-8 string or raw bytes to sign.
 * @param signingKey - CryptoKey from `generateKeyPair()` or `importSigningKey()`.
 */
export async function signData(
  data: string | ArrayBuffer,
  signingKey: CryptoKey,
): Promise<Signature> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const signatureBuffer = await crypto.subtle.sign("Ed25519", signingKey, bytes);
  return bufferToBase64(signatureBuffer);
}
