import {
  DEFAULT_MODEL_DERIVATION_POLICY,
  type ModelDerivationPolicy,
  buildModelProfileFromSeed,
} from "./ModelDefaults";
import type {
  ModelProfile,
  ModelProfileSource,
  PartialModelMetadata,
} from "./ModelProfile";

export interface ModelProfileRegistryEntry {
  embeddingDimension: number;
  contextWindowTokens: number;
}

export interface ModelProfileResolverOptions {
  registry?: Record<string, ModelProfileRegistryEntry>;
  derivationPolicy?: ModelDerivationPolicy;
}

export interface ResolveModelProfileInput {
  modelId: string;
  metadata?: PartialModelMetadata;
}

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

export class ModelProfileResolver {
  private readonly registry = new Map<string, ModelProfileRegistryEntry>();
  private readonly derivationPolicy: ModelDerivationPolicy;

  constructor(options: ModelProfileResolverOptions = {}) {
    this.derivationPolicy = options.derivationPolicy ?? DEFAULT_MODEL_DERIVATION_POLICY;

    if (options.registry) {
      for (const [modelId, entry] of Object.entries(options.registry)) {
        this.register(modelId, entry);
      }
    }
  }

  register(modelId: string, entry: ModelProfileRegistryEntry): void {
    this.registry.set(normalizeModelId(modelId), {
      embeddingDimension: entry.embeddingDimension,
      contextWindowTokens: entry.contextWindowTokens,
    });
  }

  resolve(input: ResolveModelProfileInput): ModelProfile {
    const modelId = input.modelId.trim();
    if (modelId.length === 0) {
      throw new Error("modelId must be a non-empty string");
    }

    const normalized = normalizeModelId(modelId);
    const registryEntry = this.registry.get(normalized);

    const embeddingDimension =
      input.metadata?.embeddingDimension ?? registryEntry?.embeddingDimension;
    const contextWindowTokens =
      input.metadata?.contextWindowTokens ?? registryEntry?.contextWindowTokens;

    if (embeddingDimension === undefined || contextWindowTokens === undefined) {
      throw new Error(
        `Cannot resolve model profile for ${modelId}. ` +
          "Provide metadata or register a profile entry.",
      );
    }

    const source = this.resolveSource(input.metadata, registryEntry);

    return buildModelProfileFromSeed(
      {
        modelId,
        embeddingDimension,
        contextWindowTokens,
        source,
      },
      this.derivationPolicy,
    );
  }

  private resolveSource(
    metadata: PartialModelMetadata | undefined,
    registryEntry: ModelProfileRegistryEntry | undefined,
  ): ModelProfileSource {
    const hasMetadataEmbedding = metadata?.embeddingDimension !== undefined;
    const hasMetadataContext = metadata?.contextWindowTokens !== undefined;

    if (hasMetadataEmbedding && hasMetadataContext) {
      return "metadata";
    }

    if (!hasMetadataEmbedding && !hasMetadataContext && registryEntry) {
      return "registry";
    }

    return "mixed";
  }
}
