import type { VectorStore } from "../core/types";
import { FLOAT32_BYTES } from "../core/NumericConstants";

/**
 * OPFSVectorStore — append-only binary vector file stored in the browser's
 * Origin Private File System.
 *
 * Layout: raw IEEE-754 float32 bytes written sequentially.
 *
 * Offset semantics: every public method accepts/returns **byte offsets**
 * (not vector indices) so callers can store mixed-dimension vectors
 * (full embeddings, compressed prototypes, routing codes) in the same file.
 *
 * Concurrency: for Phase 1 all writes are serialised through a promise chain
 * (`_writeQueue`).  A dedicated sync-access-handle approach for high-throughput
 * ingestion is deferred to Phase 2.
 */
export class OPFSVectorStore implements VectorStore {
  private readonly fileName: string;
  private _writeQueue: Promise<void> = Promise.resolve();

  constructor(fileName = "cortex-vectors.bin") {
    this.fileName = fileName;
  }

  // -------------------------------------------------------------------------
  // VectorStore implementation
  // -------------------------------------------------------------------------

  async appendVector(vector: Float32Array): Promise<number> {
    let byteOffset = 0;

    this._writeQueue = this._writeQueue.then(async () => {
      const fileHandle = await this._fileHandle(true);
      const file = await fileHandle.getFile();
      byteOffset = file.size;

      const writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.seek(byteOffset);
      // Produce a plain ArrayBuffer copy of the exact float bytes.  We cast
      // to ArrayBuffer (rather than SharedArrayBuffer) because Float32Arrays
      // constructed from normal JS sources always back a plain ArrayBuffer, and
      // FileSystemWritableFileStream.write() requires ArrayBuffer / ArrayBufferView<ArrayBuffer>.
      const copy = vector.buffer.slice(
        vector.byteOffset,
        vector.byteOffset + vector.byteLength,
      ) as ArrayBuffer;
      await writable.write(copy);
      await writable.close();
    });

    await this._writeQueue;
    return byteOffset;
  }

  async readVector(offset: number, dim: number): Promise<Float32Array> {
    const fileHandle = await this._fileHandle(false);
    const file = await fileHandle.getFile();
    const slice = file.slice(offset, offset + dim * FLOAT32_BYTES);
    const buf = await slice.arrayBuffer();
    return new Float32Array(buf);
  }

  async readVectors(offsets: number[], dim: number): Promise<Float32Array[]> {
    if (offsets.length === 0) return [];

    const fileHandle = await this._fileHandle(false);
    const file = await fileHandle.getFile();
    // Read the entire file once and extract each vector by slice.
    const fullBuf = await file.arrayBuffer();

    return offsets.map((offset) => {
      const byteLen = dim * FLOAT32_BYTES;
      return new Float32Array(fullBuf.slice(offset, offset + byteLen));
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Returns the underlying OPFS file handle, optionally creating the file. */
  private async _fileHandle(
    create: boolean,
  ): Promise<FileSystemFileHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getFileHandle(this.fileName, { create });
  }
}
