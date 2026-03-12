import type { Hash } from "../types.js";

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Returns the SHA-256 hex digest of a UTF-8 encoded text string.
 * Used to produce `contentHash` on Page entities.
 */
export async function hashText(content: string): Promise<Hash> {
  const encoded = new TextEncoder().encode(content);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return bufferToHex(buffer);
}

/**
 * Returns the SHA-256 hex digest of raw binary data.
 * Used to produce `vectorHash` on Page entities.
 */
export async function hashBinary(data: BufferSource): Promise<Hash> {
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(buffer);
}
