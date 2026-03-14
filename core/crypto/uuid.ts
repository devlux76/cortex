// ---------------------------------------------------------------------------
// uuid.ts — Minimal UUID v4 generation utility
// ---------------------------------------------------------------------------
//
// Generates a RFC 4122 version 4 (random) UUID.
// Uses crypto.randomUUID() when available (browsers and modern Node/Bun),
// with a pure-JS fallback for environments that lack it.
// ---------------------------------------------------------------------------

/**
 * Generate a RFC 4122 version 4 UUID string.
 *
 * Prefers the platform's built-in crypto.randomUUID() when available,
 * falling back to a pure-JS crypto.getRandomValues() implementation.
 */
export function randomUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof (crypto as { randomUUID?: () => string }).randomUUID === "function"
  ) {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }

  // Fallback: manually construct UUID v4 from random bytes
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // No secure RNG available: refuse to generate a UUID with weak randomness
    throw new Error(
      "randomUUID() requires a secure crypto.getRandomValues implementation; " +
        "no suitable crypto API was found in this environment."
    );
  }

  // Set version bits (v4) and variant bits (RFC 4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" + hex.slice(4, 6).join("") +
    "-" + hex.slice(6, 8).join("") +
    "-" + hex.slice(8, 10).join("") +
    "-" + hex.slice(10).join("")
  );
}
