export interface EmbeddingBackend {
  readonly kind: string;
  readonly dimension: number;

  embed(texts: string[]): Promise<Float32Array[]>;
}
