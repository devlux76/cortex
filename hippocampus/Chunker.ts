import type { ModelProfile } from "../core/ModelProfile";

/**
 * Splits input text into page-sized chunks based on a token budget.
 *
 * This is a lightweight, whitespace-token-based chunker (no external tokenizer).
 * It prefers to keep sentence boundaries when possible but will split overlong
 * sentences at token boundaries to respect the budget.
 */
export function chunkText(text: string, profile: ModelProfile): string[] {
  return chunkTextWithMaxTokens(text, profile.maxChunkTokens);
}

export function chunkTextWithMaxTokens(
  text: string,
  maxChunkTokens: number,
): string[] {
  if (!Number.isInteger(maxChunkTokens) || maxChunkTokens <= 0) {
    throw new Error("maxChunkTokens must be a positive integer");
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return [];
  }

  // Simple sentence boundary heuristic: split after `.`, `?`, or `!` followed by whitespace.
  // This is intentionally lightweight and avoids pulling in a full NLP dependency.
  const sentences = normalized
    .split(/(?<=[.!?])\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const tokenize = (s: string): string[] => {
    return s.trim().split(/\s+/).filter(Boolean);
  };

  const chunks: string[] = [];
  let currentTokens: string[] = [];

  const pushCurrent = () => {
    if (currentTokens.length === 0) return;
    chunks.push(currentTokens.join(" "));
    currentTokens = [];
  };

  const appendSentence = (sentence: string) => {
    const sentenceTokens = tokenize(sentence);
    if (sentenceTokens.length === 0) return;

    // Sentence is larger than budget: split it across multiple chunks.
    if (sentenceTokens.length > maxChunkTokens) {
      pushCurrent();
      for (let i = 0; i < sentenceTokens.length; i += maxChunkTokens) {
        const slice = sentenceTokens.slice(i, i + maxChunkTokens);
        chunks.push(slice.join(" "));
      }
      return;
    }

    // Try to keep sentence with current chunk.
    if (currentTokens.length + sentenceTokens.length <= maxChunkTokens) {
      currentTokens.push(...sentenceTokens);
      return;
    }

    // Otherwise, start a new chunk.
    pushCurrent();
    currentTokens.push(...sentenceTokens);
  };

  for (const sentence of sentences) {
    appendSentence(sentence);
  }

  pushCurrent();
  return chunks;
}
