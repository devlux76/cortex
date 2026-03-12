import {
  DeterministicDummyEmbeddingBackend,
  type DeterministicDummyEmbeddingBackendOptions,
} from "./DeterministicDummyEmbeddingBackend";
import type { EmbeddingBackend } from "./EmbeddingBackend";
import {
  TransformersJsEmbeddingBackend,
  type TransformersJsDevice,
  type TransformersJsEmbeddingBackendOptions,
} from "./TransformersJsEmbeddingBackend";

export type EmbeddingProviderKind =
  | "webnn"
  | "webgpu"
  | "webgl"
  | "wasm"
  | "dummy"
  | (string & {});

export interface EmbeddingProviderCandidate {
  kind: EmbeddingProviderKind;
  isSupported: () => boolean | Promise<boolean>;
  createBackend: () => EmbeddingBackend | Promise<EmbeddingBackend>;
}

export interface EmbeddingProviderBenchmarkPolicy {
  enabled: boolean;
  warmupRuns: number;
  timedRuns: number;
  sampleTexts: string[];
}

export interface EmbeddingProviderMeasurement {
  kind: EmbeddingProviderKind;
  meanMs: number;
}

export type EmbeddingProviderResolveReason =
  | "forced"
  | "benchmark"
  | "capability-order";

export interface ResolvedEmbeddingBackend {
  backend: EmbeddingBackend;
  selectedKind: EmbeddingProviderKind;
  reason: EmbeddingProviderResolveReason;
  supportedKinds: EmbeddingProviderKind[];
  measurements: EmbeddingProviderMeasurement[];
}

export const DEFAULT_PROVIDER_ORDER: ReadonlyArray<EmbeddingProviderKind> =
  Object.freeze([
  "webnn",
  "webgpu",
  "webgl",
  "wasm",
  "dummy",
  ]);

export const DEFAULT_PROVIDER_BENCHMARK_POLICY: EmbeddingProviderBenchmarkPolicy =
  Object.freeze({
    enabled: true,
    warmupRuns: 1,
    timedRuns: 3,
    sampleTexts: [
      "cortex benchmark probe",
      "routing and coherence warmup",
      "deterministic provider timing",
    ],
  });

export type BenchmarkBackendFn = (
  backend: EmbeddingBackend,
  policy: EmbeddingProviderBenchmarkPolicy,
) => Promise<number>;

export interface ResolveEmbeddingBackendOptions {
  candidates: EmbeddingProviderCandidate[];
  preferredOrder?: ReadonlyArray<EmbeddingProviderKind>;
  forceKind?: EmbeddingProviderKind;
  benchmark?: Partial<EmbeddingProviderBenchmarkPolicy>;
  benchmarkBackend?: BenchmarkBackendFn;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function validateBenchmarkPolicy(
  policy: EmbeddingProviderBenchmarkPolicy,
): EmbeddingProviderBenchmarkPolicy {
  assertPositiveInteger("warmupRuns", policy.warmupRuns);
  assertPositiveInteger("timedRuns", policy.timedRuns);

  if (policy.sampleTexts.length === 0) {
    throw new Error("sampleTexts must not be empty");
  }

  return policy;
}

function nowMs(): number {
  const perfNow = globalThis.performance?.now?.bind(globalThis.performance);
  if (perfNow) {
    return perfNow();
  }
  return Date.now();
}

async function defaultBenchmarkBackend(
  backend: EmbeddingBackend,
  policy: EmbeddingProviderBenchmarkPolicy,
): Promise<number> {
  for (let i = 0; i < policy.warmupRuns; i++) {
    await backend.embed(policy.sampleTexts);
  }

  let totalMs = 0;
  for (let i = 0; i < policy.timedRuns; i++) {
    const start = nowMs();
    await backend.embed(policy.sampleTexts);
    totalMs += nowMs() - start;
  }

  return totalMs / policy.timedRuns;
}

function orderCandidates(
  candidates: EmbeddingProviderCandidate[],
  preferredOrder: ReadonlyArray<EmbeddingProviderKind>,
): EmbeddingProviderCandidate[] {
  const orderIndex = new Map<EmbeddingProviderKind, number>();
  for (let i = 0; i < preferredOrder.length; i++) {
    orderIndex.set(preferredOrder[i], i);
  }

  return [...candidates].sort((a, b) => {
    const aIndex = orderIndex.get(a.kind) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = orderIndex.get(b.kind) ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

export async function resolveEmbeddingBackend(
  options: ResolveEmbeddingBackendOptions,
): Promise<ResolvedEmbeddingBackend> {
  const preferredOrder = options.preferredOrder ?? DEFAULT_PROVIDER_ORDER;
  const benchmarkPolicy = validateBenchmarkPolicy({
    ...DEFAULT_PROVIDER_BENCHMARK_POLICY,
    ...options.benchmark,
  });

  const capabilityChecks = await Promise.all(
    options.candidates.map(async (candidate) => ({
      candidate,
      supported: await candidate.isSupported(),
    })),
  );

  if (options.forceKind !== undefined) {
    const forcedEntry = capabilityChecks.find(
      (entry) => entry.candidate.kind === options.forceKind,
    );

    if (!forcedEntry || !forcedEntry.supported) {
      throw new Error(`Forced provider ${options.forceKind} is not supported`);
    }

    return {
      backend: await forcedEntry.candidate.createBackend(),
      selectedKind: forcedEntry.candidate.kind,
      reason: "forced",
      supportedKinds: orderCandidates(
        capabilityChecks
          .filter((entry) => entry.supported)
          .map((entry) => entry.candidate),
        preferredOrder,
      ).map((candidate) => candidate.kind),
      measurements: [],
    };
  }

  const supportedCandidates = orderCandidates(
    capabilityChecks
      .filter((entry) => entry.supported)
      .map((entry) => entry.candidate),
    preferredOrder,
  );

  if (supportedCandidates.length === 0) {
    throw new Error("No supported embedding providers are available");
  }

  const supportedKinds = supportedCandidates.map((candidate) => candidate.kind);

  const benchmarkBackend = options.benchmarkBackend ?? defaultBenchmarkBackend;
  if (benchmarkPolicy.enabled) {
    const measurements: {
      candidate: EmbeddingProviderCandidate;
      backend: EmbeddingBackend;
      meanMs: number;
    }[] = [];

    for (const candidate of supportedCandidates) {
      const backend = await candidate.createBackend();
      const meanMs = await benchmarkBackend(backend, benchmarkPolicy);
      measurements.push({ candidate, backend, meanMs });
    }

    let winner = measurements[0];
    for (let i = 1; i < measurements.length; i++) {
      if (measurements[i].meanMs < winner.meanMs) {
        winner = measurements[i];
      }
    }

    return {
      backend: winner.backend,
      selectedKind: winner.candidate.kind,
      reason: "benchmark",
      supportedKinds,
      measurements: measurements.map((m) => ({
        kind: m.candidate.kind,
        meanMs: m.meanMs,
      })),
    };
  }

  const selectedCandidate = supportedCandidates[0];
  return {
    backend: await selectedCandidate.createBackend(),
    selectedKind: selectedCandidate.kind,
    reason: "capability-order",
    supportedKinds,
    measurements: [],
  };
}

export function createDummyProviderCandidate(
  options: DeterministicDummyEmbeddingBackendOptions = {},
): EmbeddingProviderCandidate {
  return {
    kind: "dummy",
    isSupported: () => globalThis.crypto?.subtle !== undefined,
    createBackend: () => new DeterministicDummyEmbeddingBackend(options),
  };
}

/**
 * Checks whether a given Transformers.js ONNX device is available in the
 * current runtime environment.
 *
 * - `"wasm"` is always considered supported (lowest common denominator).
 * - `"webgpu"` requires `navigator.gpu` to be present.
 * - `"webnn"` requires `navigator.ml` to be present.
 */
function isTransformersJsDeviceSupported(
  device: TransformersJsDevice,
): boolean {
  switch (device) {
    case "webnn":
      return (
        typeof globalThis.navigator !== "undefined" &&
        "ml" in globalThis.navigator
      );
    case "webgpu":
      return (
        typeof globalThis.navigator !== "undefined" &&
        "gpu" in globalThis.navigator
      );
    case "wasm":
      return true;
  }
}

/**
 * Returns an `EmbeddingProviderCandidate` array for each Transformers.js
 * ONNX device (`"webnn"`, `"webgpu"`, `"wasm"`), ordered from fastest to most
 * widely available.
 *
 * Each candidate:
 * - Exposes a `kind` matching the underlying device (e.g. `"webgpu"`).
 * - Runs its `isSupported()` check at resolution time (no eager pipeline load).
 * - Creates a `TransformersJsEmbeddingBackend` with the shared `options` plus
 *   the candidate-specific `device`.
 *
 * Pass these candidates to `resolveEmbeddingBackend` or
 * `EmbeddingRunner.fromResolverOptions` to select the best available device
 * at runtime.
 *
 * @example
 * ```ts
 * const runner = EmbeddingRunner.fromResolverOptions({
 *   candidates: [
 *     ...createTransformersJsProviderCandidates(),
 *     createDummyProviderCandidate(),
 *   ],
 * });
 * ```
 */
export function createTransformersJsProviderCandidates(
  options: TransformersJsEmbeddingBackendOptions = {},
): EmbeddingProviderCandidate[] {
  const devices: TransformersJsDevice[] = ["webnn", "webgpu", "wasm"];

  return devices.map((device) => ({
    kind: device,
    isSupported: () => isTransformersJsDeviceSupported(device),
    createBackend: () =>
      new TransformersJsEmbeddingBackend({ ...options, device }),
  }));
}
