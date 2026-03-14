import type { Hash, Page } from "../core/types";
import type { Metroid } from "./MetroidBuilder";
import type { KnowledgeGap } from "./KnowledgeGapDetector";

export interface QueryResult {
  pages: Page[];
  scores: number[];
  coherencePath: Hash[];
  metroid: Metroid | null;
  knowledgeGap: KnowledgeGap | null;
  metadata: Record<string, unknown>;
}
