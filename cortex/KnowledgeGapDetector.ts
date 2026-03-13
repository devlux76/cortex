import type { Hash } from "../core/types";
import type { ModelProfile } from "../core/ModelProfile";
import { hashText } from "../core/crypto/hash";
import type { Metroid } from "./MetroidBuilder";

export interface KnowledgeGap {
  queryText: string;
  queryEmbedding: Float32Array;
  knowledgeBoundary: Hash | null;
  detectedAt: string;
}

export interface CuriosityProbe {
  probeId: Hash;
  queryText: string;
  queryEmbedding: Float32Array;
  knowledgeBoundary: Hash | null;
  mimeType: string;
  modelUrn: string;
  createdAt: string;
}

/**
 * Returns a KnowledgeGap when the metroid signals that m2 could not be found
 * (i.e. the engine has no antithesis for this query). Returns null when the
 * metroid is complete and no gap was detected.
 */
export async function detectKnowledgeGap(
  queryText: string,
  queryEmbedding: Float32Array,
  metroid: Metroid,
  _modelProfile: ModelProfile,
): Promise<KnowledgeGap | null> {
  if (!metroid.knowledgeGap) return null;

  return {
    queryText,
    queryEmbedding,
    knowledgeBoundary: metroid.m1 !== "" ? metroid.m1 : null,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Builds a serialisable CuriosityProbe from a detected KnowledgeGap.
 * The probeId is the SHA-256 of (queryText + detectedAt) so it is
 * deterministic for the same gap inputs.
 */
export async function buildCuriosityProbe(
  gap: KnowledgeGap,
  modelProfile: ModelProfile,
  mimeType = "text/plain",
): Promise<CuriosityProbe> {
  const probeId = await hashText(gap.queryText + gap.detectedAt);

  return {
    probeId,
    queryText: gap.queryText,
    queryEmbedding: gap.queryEmbedding,
    knowledgeBoundary: gap.knowledgeBoundary,
    mimeType,
    modelUrn: `urn:model:${modelProfile.modelId}`,
    createdAt: new Date().toISOString(),
  };
}
