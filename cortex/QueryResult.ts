import type { Page } from "../core/types";

export interface QueryResult {
  pages: Page[];
  scores: number[];
  metadata: Record<string, unknown>;
}
