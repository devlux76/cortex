import type { VectorStore } from "../core/types";
import { FLOAT32_BYTES } from "../core/NumericConstants";

/**
 * MemoryVectorStore — in-memory implementation of VectorStore.
 *
 * Byte-offset semantics are identical to OPFSVectorStore so the two
 * implementations are interchangeable for testing.
 */
export class MemoryVectorStore implements VectorStore {
  private _buf: Uint8Array = new Uint8Array(0);

  async appendVector(vector: Float32Array): Promise<number> {
    const byteOffset = this._buf.byteLength;
    const incoming = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
    const next = new Uint8Array(byteOffset + incoming.byteLength);
    next.set(this._buf);
    next.set(incoming, byteOffset);
    this._buf = next;
    return byteOffset;
  }

  async readVector(offset: number, dim: number): Promise<Float32Array> {
    const byteLen = dim * FLOAT32_BYTES;
    return new Float32Array(this._buf.buffer.slice(offset, offset + byteLen));
  }

  async readVectors(offsets: number[], dim: number): Promise<Float32Array[]> {
    const byteLen = dim * FLOAT32_BYTES;
    return offsets.map(
      (offset) => new Float32Array(this._buf.buffer.slice(offset, offset + byteLen)),
    );
  }

  /** Total bytes currently stored (useful in tests). */
  get byteLength(): number {
    return this._buf.byteLength;
  }
}
