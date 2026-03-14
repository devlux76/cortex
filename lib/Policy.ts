import type { ModelProfile } from "./core/ModelProfile";
import {
  ModelProfileResolver,
  type ModelProfileResolverOptions,
  type ResolveModelProfileInput,
} from "./core/ModelProfileResolver";

export type QueryScope = "broad" | "normal" | "narrow" | "default";

export interface ProjectionHead {
  dimIn: number;
  dimOut: number;
  bits?: number;
  // Byte offset for the projection head in a flattened projection buffer.
  offset: number;
}

export interface RoutingPolicy {
  broad: ProjectionHead;
  normal: ProjectionHead;
  narrow: ProjectionHead;
}

export interface ResolvedRoutingPolicy {
  modelProfile: ModelProfile;
  routingPolicy: RoutingPolicy;
}

export interface ResolveRoutingPolicyOptions {
  resolver?: ModelProfileResolver;
  resolverOptions?: ModelProfileResolverOptions;
  routingPolicyOverrides?: Partial<RoutingPolicyDerivation>;
}

export interface RoutingPolicyDerivation {
  broadDimRatio: number;
  normalDimRatio: number;
  narrowDimRatio: number;
  broadHashBits: number;
  dimAlignment: number;
  minProjectionDim: number;
}

export const DEFAULT_ROUTING_POLICY_DERIVATION: RoutingPolicyDerivation =
  Object.freeze({
    broadDimRatio: 1 / 8,
    normalDimRatio: 1 / 4,
    narrowDimRatio: 1 / 2,
    broadHashBits: 128,
    dimAlignment: 8,
    minProjectionDim: 8,
  });

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
}

function alignDown(value: number, alignment: number): number {
  return Math.floor(value / alignment) * alignment;
}

function deriveProjectionDim(
  dimIn: number,
  ratio: number,
  derivation: RoutingPolicyDerivation,
): number {
  const raw = Math.floor(dimIn * ratio);
  const aligned = alignDown(raw, derivation.dimAlignment);
  const bounded = Math.max(derivation.minProjectionDim, aligned);
  return Math.min(dimIn, bounded);
}

function validateDerivation(derivation: RoutingPolicyDerivation): void {
  assertPositiveFinite("broadDimRatio", derivation.broadDimRatio);
  assertPositiveFinite("normalDimRatio", derivation.normalDimRatio);
  assertPositiveFinite("narrowDimRatio", derivation.narrowDimRatio);
  assertPositiveInteger("broadHashBits", derivation.broadHashBits);
  assertPositiveInteger("dimAlignment", derivation.dimAlignment);
  assertPositiveInteger("minProjectionDim", derivation.minProjectionDim);
}

export function createRoutingPolicy(
  modelProfile: Pick<ModelProfile, "embeddingDimension">,
  overrides: Partial<RoutingPolicyDerivation> = {},
): RoutingPolicy {
  assertPositiveInteger("embeddingDimension", modelProfile.embeddingDimension);

  const derivation: RoutingPolicyDerivation = {
    ...DEFAULT_ROUTING_POLICY_DERIVATION,
    ...overrides,
  };

  validateDerivation(derivation);

  const dimIn = modelProfile.embeddingDimension;
  const broadDim = deriveProjectionDim(dimIn, derivation.broadDimRatio, derivation);
  const normalDim = deriveProjectionDim(dimIn, derivation.normalDimRatio, derivation);
  const narrowDim = deriveProjectionDim(dimIn, derivation.narrowDimRatio, derivation);

  const broadOffset = 0;
  const normalOffset = broadOffset + broadDim * dimIn;
  const narrowOffset = normalOffset + normalDim * dimIn;

  return {
    broad: {
      dimIn,
      dimOut: broadDim,
      bits: derivation.broadHashBits,
      offset: broadOffset,
    },
    normal: {
      dimIn,
      dimOut: normalDim,
      offset: normalOffset,
    },
    narrow: {
      dimIn,
      dimOut: narrowDim,
      offset: narrowOffset,
    },
  };
}

export function resolveRoutingPolicyForModel(
  input: ResolveModelProfileInput,
  options: ResolveRoutingPolicyOptions = {},
): ResolvedRoutingPolicy {
  const resolver =
    options.resolver ?? new ModelProfileResolver(options.resolverOptions);
  const modelProfile = resolver.resolve(input);

  return {
    modelProfile,
    routingPolicy: createRoutingPolicy(
      modelProfile,
      options.routingPolicyOverrides,
    ),
  };
}
