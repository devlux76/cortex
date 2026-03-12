import type { FeatureExtractionPipeline } from "@huggingface/transformers";

import type { EmbeddingBackend } from "./EmbeddingBackend";

export type TransformersJsDevice = "webnn" | "webgpu" | "wasm";

export interface TransformersJsEmbeddingBackendOptions {
  /**
   * Hugging Face model ID to load. Must be a matryoshka-compatible embedding model.
   * Defaults to `EMBEDDING_GEMMA_300M_MODEL_ID`.
   */
  modelId?: string;

  /**
   * ONNX runtime device to use for inference.
   * Defaults to `"wasm"` (always available, lowest common denominator).
   */
  device?: TransformersJsDevice;

  /**
   * Number of embedding dimensions to return. For matryoshka models, this may be
   * any supported sub-dimension (smaller values are valid nested sub-spaces).
   * Defaults to `EMBEDDING_GEMMA_300M_EMBEDDING_DIMENSION`.
   */
  dimension?: number;

  /**
   * Prefix prepended to each text when embedding documents/passages.
   * Required by some models (e.g. EmbeddingGemma) for best retrieval quality.
   * Defaults to `EMBEDDING_GEMMA_300M_DOCUMENT_PREFIX`.
   */
  documentPrefix?: string;

  /**
   * Prefix prepended to each text when embedding search queries.
   * Required by some models (e.g. EmbeddingGemma) for best retrieval quality.
   * Defaults to `EMBEDDING_GEMMA_300M_QUERY_PREFIX`.
   */
  queryPrefix?: string;
}

/**
 * Default model used when no `modelId` is provided.
 * Q4-quantized ONNX variant of google/embeddinggemma-300m.
 */
export const EMBEDDING_GEMMA_300M_MODEL_ID =
  "onnx-community/embeddinggemma-300m-ONNX";

/**
 * Default embedding dimension used when no `dimension` is provided.
 * 768 is the full-fidelity matryoshka output dimension for EmbeddingGemma-300M.
 */
export const EMBEDDING_GEMMA_300M_EMBEDDING_DIMENSION = 768;

/**
 * Query task prefix for EmbeddingGemma-300M, as specified on the model card.
 * @see https://huggingface.co/google/embeddinggemma-300m
 */
export const EMBEDDING_GEMMA_300M_QUERY_PREFIX = "query: ";

/**
 * Document/passage prefix for EmbeddingGemma-300M, as specified on the model card.
 * @see https://huggingface.co/google/embeddinggemma-300m
 */
export const EMBEDDING_GEMMA_300M_DOCUMENT_PREFIX = "passage: ";

/**
 * Real embedding backend backed by `@huggingface/transformers`.
 *
 * Supports WebNN, WebGPU, and WASM ONNX runtime devices. The default model is
 * the Q4-quantized EmbeddingGemma-300M (matryoshka). Any matryoshka-compatible
 * model on the Hugging Face Hub can be substituted via `options.modelId`.
 *
 * The pipeline is loaded lazily on the first `embed()` or `embedQueries()` call
 * so that import cost is zero until the backend is actually needed.
 */
export class TransformersJsEmbeddingBackend implements EmbeddingBackend {
  readonly kind: string;
  readonly dimension: number;
  readonly modelId: string;
  readonly device: TransformersJsDevice;
  readonly documentPrefix: string;
  readonly queryPrefix: string;

  private pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

  constructor(options: TransformersJsEmbeddingBackendOptions = {}) {
    this.device = options.device ?? "wasm";
    this.modelId = options.modelId ?? EMBEDDING_GEMMA_300M_MODEL_ID;
    this.dimension =
      options.dimension ?? EMBEDDING_GEMMA_300M_EMBEDDING_DIMENSION;
    this.documentPrefix =
      options.documentPrefix ?? EMBEDDING_GEMMA_300M_DOCUMENT_PREFIX;
    this.queryPrefix = options.queryPrefix ?? EMBEDDING_GEMMA_300M_QUERY_PREFIX;
    this.kind = `transformers-js:${this.device}`;
  }

  /**
   * Embeds the given texts as document/passage representations.
   * Prepends `documentPrefix` before each text as required by the model.
   */
  async embed(texts: string[]): Promise<Float32Array[]> {
    return this.embedWithPrefix(texts, this.documentPrefix);
  }

  /**
   * Embeds the given texts as search query representations.
   * Prepends `queryPrefix` before each text as required by the model.
   *
   * Use this method when encoding queries for retrieval; use `embed()` for
   * documents/passages being indexed.
   */
  async embedQueries(texts: string[]): Promise<Float32Array[]> {
    return this.embedWithPrefix(texts, this.queryPrefix);
  }

  private async embedWithPrefix(
    texts: string[],
    prefix: string,
  ): Promise<Float32Array[]> {
    const extractor = await this.ensurePipeline();
    const prefixed =
      prefix.length > 0 ? texts.map((t) => `${prefix}${t}`) : texts;

    const output = await extractor(prefixed, {
      pooling: "mean",
      normalize: true,
    });

    const rawData = output.data as Float32Array;
    const fullDim = rawData.length / texts.length;
    const sliceDim = Math.min(this.dimension, fullDim);

    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      const start = i * fullDim;
      results.push(rawData.slice(start, start + sliceDim));
    }
    return results;
  }

  private ensurePipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = this.loadPipeline();
    }
    return this.pipelinePromise;
  }

  private async loadPipeline(): Promise<FeatureExtractionPipeline> {
    const { pipeline } = await import("@huggingface/transformers");
    // Cast through unknown to work around the overloaded pipeline union type complexity.
    const pipelineFn = pipeline as unknown as (
      task: string,
      model: string,
      options?: Record<string, unknown>,
    ) => Promise<FeatureExtractionPipeline>;
    return pipelineFn("feature-extraction", this.modelId, {
      device: this.device,
    });
  }
}
