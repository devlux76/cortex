import type { Hash, VectorStore } from "../core/types";
import type { ModelProfile } from "../core/ModelProfile";

export interface Metroid {
  m1: Hash;
  m2: Hash | null;
  c: Float32Array | null;
  knowledgeGap: boolean;
}

export interface MetroidBuilderOptions {
  modelProfile: ModelProfile;
  vectorStore: VectorStore;
}

/** Standard Matryoshka tier sizes in ascending order. */
const MATRYOSHKA_TIERS = [32, 64, 128, 256, 512, 768, 1024, 2048] as const;

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  return 1 - cosineSimilarity(a, b);
}

/**
 * Returns the index of the medoid: the element that minimises total cosine
 * distance to every other element in the set.
 */
function findMedoidIndex(embeddings: Float32Array[]): number {
  if (embeddings.length === 1) return 0;

  let bestIdx = 0;
  let bestTotal = Infinity;

  for (let i = 0; i < embeddings.length; i++) {
    let total = 0;
    for (let j = 0; j < embeddings.length; j++) {
      if (i !== j) {
        total += cosineDistance(embeddings[i], embeddings[j]);
      }
    }
    if (total < bestTotal) {
      bestTotal = total;
      bestIdx = i;
    }
  }

  return bestIdx;
}

interface CandidateEntry {
  pageId: Hash;
  embeddingOffset: number;
  embeddingDim: number;
}

interface CandidateWithEmbedding extends CandidateEntry {
  embedding: Float32Array;
}

/**
 * Searches for m2 among `others` (candidates excluding m1) using the free
 * dimensions starting at `protectedDim`.
 *
 * Returns the selected medoid candidate or `null` if no valid opposite set
 * can be assembled.
 */
function searchM2(
  others: CandidateWithEmbedding[],
  m1Embedding: Float32Array,
  protectedDim: number,
): CandidateWithEmbedding | null {
  if (others.length === 0) return null;

  const m1Free = m1Embedding.slice(protectedDim);

  const scored = others.map((c) => {
    const free = c.embedding.slice(protectedDim);
    return { candidate: c, score: -cosineSimilarity(free, m1Free) };
  });

  // Prefer candidates that are genuinely opposite (score >= 0).
  let oppositeSet = scored.filter((s) => s.score >= 0);

  // Fall back to the top 50% when the genuine-opposite set is too small.
  if (oppositeSet.length < 2) {
    const byScore = [...scored].sort((a, b) => b.score - a.score);
    const topHalf = Math.max(1, Math.ceil(byScore.length / 2));
    oppositeSet = byScore.slice(0, topHalf);
  }

  if (oppositeSet.length === 0) return null;

  const medoidIdx = findMedoidIndex(oppositeSet.map((s) => s.candidate.embedding.slice(protectedDim)));
  return oppositeSet[medoidIdx].candidate;
}

/**
 * Builds the dialectical probe (Metroid) for a given query embedding and a
 * ranked list of candidate memory nodes.
 *
 * Step overview
 * 1. Select m1 (thesis): the candidate with highest cosine similarity to the query.
 * 2. Select m2 (antithesis): the medoid of the cosine-opposite set in free dims.
 *    Uses Matryoshka dimensional unwinding when the initial tier yields no m2.
 * 3. Compute centroid c (synthesis): protected dims copied from m1, free dims
 *    averaged between m1 and m2.
 */
export async function buildMetroid(
  queryEmbedding: Float32Array,
  candidateMedoids: Array<{ pageId: Hash; embeddingOffset: number; embeddingDim: number }>,
  options: MetroidBuilderOptions,
): Promise<Metroid> {
  const { modelProfile, vectorStore } = options;

  if (candidateMedoids.length === 0) {
    return { m1: "", m2: null, c: null, knowledgeGap: true };
  }

  // Load all candidate embeddings in one pass.
  const candidates: CandidateWithEmbedding[] = await Promise.all(
    candidateMedoids.map(async (cand) => ({
      ...cand,
      embedding: await vectorStore.readVector(cand.embeddingOffset, cand.embeddingDim),
    })),
  );

  // Select m1: highest cosine similarity to the query.
  let m1Candidate = candidates[0];
  let m1Score = cosineSimilarity(queryEmbedding, candidates[0].embedding);

  for (let i = 1; i < candidates.length; i++) {
    const score = cosineSimilarity(queryEmbedding, candidates[i].embedding);
    if (score > m1Score) {
      m1Score = score;
      m1Candidate = candidates[i];
    }
  }

  const protectedDim = modelProfile.matryoshkaProtectedDim;

  if (protectedDim === undefined) {
    // Non-Matryoshka model: antithesis search is impossible.
    return { m1: m1Candidate.pageId, m2: null, c: null, knowledgeGap: true };
  }

  const others = candidates.filter((c) => c.pageId !== m1Candidate.pageId);

  // --- Matryoshka dimensional unwinding ---
  // Start at modelProfile.matryoshkaProtectedDim. If m2 not found, progressively
  // shrink the protected boundary (expand the free-dimension search region).

  const startingTierIndex = MATRYOSHKA_TIERS.indexOf(
    protectedDim as (typeof MATRYOSHKA_TIERS)[number],
  );

  // Build the list of tier boundaries to attempt, from the configured value
  // down to the smallest tier (expanding the free region at each step).
  const tierBoundaries: number[] = [];
  if (startingTierIndex !== -1) {
    for (let i = startingTierIndex; i >= 0; i--) {
      tierBoundaries.push(MATRYOSHKA_TIERS[i]);
    }
  } else {
    // protectedDim is not a standard tier; try it as-is plus any smaller standard tiers.
    tierBoundaries.push(protectedDim);
    for (const t of [...MATRYOSHKA_TIERS].reverse()) {
      if (t < protectedDim) tierBoundaries.push(t);
    }
  }

  let m2Candidate: CandidateWithEmbedding | null = null;
  let usedProtectedDim = protectedDim;

  for (const tierBoundary of tierBoundaries) {
    const found = searchM2(others, m1Candidate.embedding, tierBoundary);
    if (found !== null) {
      m2Candidate = found;
      usedProtectedDim = tierBoundary;
      break;
    }
  }

  if (m2Candidate === null) {
    return { m1: m1Candidate.pageId, m2: null, c: null, knowledgeGap: true };
  }

  // Compute frozen synthesis centroid c.
  const fullDim = m1Candidate.embedding.length;
  const c = new Float32Array(fullDim);

  for (let i = 0; i < usedProtectedDim; i++) {
    c[i] = m1Candidate.embedding[i];
  }
  for (let i = usedProtectedDim; i < fullDim; i++) {
    c[i] = (m1Candidate.embedding[i] + m2Candidate.embedding[i]) / 2;
  }

  return {
    m1: m1Candidate.pageId,
    m2: m2Candidate.pageId,
    c,
    knowledgeGap: false,
  };
}
