import type { FeatureExtractionPipeline } from "@huggingface/transformers";

import type { EmbeddingBackend } from "./EmbeddingBackend";
import {
  EMBEDDING_GEMMA_300M_DOCUMENT_PREFIX,
  EMBEDDING_GEMMA_300M_EMBEDDING_DIMENSION,
  EMBEDDING_GEMMA_300M_MODEL_ID,
  EMBEDDING_GEMMA_300M_QUERY_PREFIX,
} from "./TransformersJsEmbeddingBackend";

export interface OrtWebglEmbeddingBackendOptions {
  /**
   * Hugging Face model ID to load. Must be a matryoshka-compatible embedding model.
   * Defaults to `EMBEDDING_GEMMA_300M_MODEL_ID`.
   */
  modelId?: string;

  /**
   * Number of embedding dimensions to return.
   * Defaults to `EMBEDDING_GEMMA_300M_EMBEDDING_DIMENSION`.
   */
  dimension?: number;

  /**
   * Prefix prepended to each text when embedding documents/passages.
   * Defaults to `EMBEDDING_GEMMA_300M_DOCUMENT_PREFIX`.
   */
  documentPrefix?: string;

  /**
   * Prefix prepended to each text when embedding search queries.
   * Defaults to `EMBEDDING_GEMMA_300M_QUERY_PREFIX`.
   */
  queryPrefix?: string;
}

/**
 * Embedding backend that uses ONNX Runtime Web's explicit WebGL execution
 * provider via Hugging Face Transformers.js.
 *
 * This backend targets systems that have WebGL but lack WebGPU or WebNN,
 * providing a hardware-accelerated fallback below the WebGPU/WebNN tier.
 *
 * The pipeline is loaded lazily on the first `embed()` or `embedQueries()`
 * call so that import cost is zero until the backend is actually needed.
 */
export class OrtWebglEmbeddingBackend implements EmbeddingBackend {
  readonly kind = "webgl" as const;
  readonly dimension: number;
  readonly modelId: string;
  readonly documentPrefix: string;
  readonly queryPrefix: string;

  private pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

  constructor(options: OrtWebglEmbeddingBackendOptions = {}) {
    this.modelId = options.modelId ?? EMBEDDING_GEMMA_300M_MODEL_ID;
    this.dimension =
      options.dimension ?? EMBEDDING_GEMMA_300M_EMBEDDING_DIMENSION;
    this.documentPrefix =
      options.documentPrefix ?? EMBEDDING_GEMMA_300M_DOCUMENT_PREFIX;
    this.queryPrefix =
      options.queryPrefix ?? EMBEDDING_GEMMA_300M_QUERY_PREFIX;
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
      device: "webgl",
    });
  }
}
