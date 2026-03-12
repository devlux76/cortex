import type { PublicKey, Signature } from "../types.js";

function base64ToBuffer(base64: Signature): ArrayBuffer | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}

/**
 * Verifies an Ed25519 signature produced by `signData`.
 *
 * Returns `true` if `signature` is a valid Ed25519 signature over `data`
 * by the key encoded in `publicKey` (JWK JSON string).
 * Returns `false` for any signature mismatch or malformed signature.
 * Throws for structurally invalid public key (malformed JWK JSON).
 *
 * @param data      - The original data that was signed (string or bytes).
 * @param signature - Base64-encoded signature from `signData()`.
 * @param publicKey - JWK JSON string from `KeyPair.publicKey`.
 */
export async function verifySignature(
  data: string | ArrayBuffer,
  signature: Signature,
  publicKey: PublicKey,
): Promise<boolean> {
  const signatureBuffer = base64ToBuffer(signature);
  if (signatureBuffer === null) {
    return false;
  }

  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const publicKeyJwk = JSON.parse(publicKey) as JsonWebKey;

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    { name: "Ed25519" } as Algorithm,
    false,
    ["verify"],
  );

  return crypto.subtle.verify("Ed25519", cryptoKey, signatureBuffer, bytes);
}
