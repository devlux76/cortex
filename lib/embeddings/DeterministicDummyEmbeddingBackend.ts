import type { EmbeddingBackend } from "./EmbeddingBackend";

export const DEFAULT_DUMMY_EMBEDDING_DIMENSION = 1024;
export const SHA256_BLOCK_BYTES = 64;

const SHA256_DIGEST_BYTES = 32;
const COUNTER_BYTES = 4;
const BYTE_TO_UNIT_SCALE = 127.5;

export interface DeterministicDummyEmbeddingBackendOptions {
  dimension?: number;
  blockBytes?: number;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SubtleCrypto is required for DeterministicDummyEmbeddingBackend");
  }
  return subtle;
}

function padBytesToBoundary(input: Uint8Array, blockBytes: number): Uint8Array {
  const remainder = input.byteLength % blockBytes;
  if (remainder === 0) {
    return input;
  }

  const padLength = blockBytes - remainder;
  const padded = new Uint8Array(input.byteLength + padLength);
  padded.set(input);
  return padded;
}

function byteToUnitFloat(byteValue: number): number {
  return byteValue / BYTE_TO_UNIT_SCALE - 1;
}

export class DeterministicDummyEmbeddingBackend implements EmbeddingBackend {
  readonly kind = "dummy-sha256" as const;
  readonly dimension: number;

  private readonly blockBytes: number;
  private readonly subtle = getSubtleCrypto();
  private readonly encoder = new TextEncoder();

  constructor(options: DeterministicDummyEmbeddingBackendOptions = {}) {
    this.dimension = options.dimension ?? DEFAULT_DUMMY_EMBEDDING_DIMENSION;
    this.blockBytes = options.blockBytes ?? SHA256_BLOCK_BYTES;

    assertPositiveInteger("dimension", this.dimension);
    assertPositiveInteger("blockBytes", this.blockBytes);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((text) => this.embedOne(text)));
  }

  private async embedOne(text: string): Promise<Float32Array> {
    const sourceBytes = padBytesToBoundary(
      this.encoder.encode(text),
      this.blockBytes,
    );

    const embedding = new Float32Array(this.dimension);
    let counter = 0;
    let writeIndex = 0;

    while (writeIndex < this.dimension) {
      const digest = await this.digestWithCounter(sourceBytes, counter);
      for (
        let digestIndex = 0;
        digestIndex < SHA256_DIGEST_BYTES && writeIndex < this.dimension;
        digestIndex++
      ) {
        embedding[writeIndex] = byteToUnitFloat(digest[digestIndex]);
        writeIndex++;
      }
      counter++;
    }

    return embedding;
  }

  private async digestWithCounter(
    sourceBytes: Uint8Array,
    counter: number,
  ): Promise<Uint8Array> {
    const payload = new Uint8Array(sourceBytes.byteLength + COUNTER_BYTES);
    payload.set(sourceBytes, 0);

    const counterView = new DataView(
      payload.buffer,
      payload.byteOffset + sourceBytes.byteLength,
      COUNTER_BYTES,
    );
    counterView.setUint32(0, counter, false);

    const digest = await this.subtle.digest("SHA-256", payload);
    return new Uint8Array(digest);
  }
}
