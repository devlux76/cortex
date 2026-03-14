import type { EmbeddingBackend } from "./EmbeddingBackend";
import {
  type ResolveEmbeddingBackendOptions,
  type ResolvedEmbeddingBackend,
  resolveEmbeddingBackend,
} from "./ProviderResolver";

export type ResolveEmbeddingSelection = () => Promise<ResolvedEmbeddingBackend>;

export class EmbeddingRunner {
  private selectionPromise: Promise<ResolvedEmbeddingBackend> | undefined;
  private resolvedSelection: ResolvedEmbeddingBackend | undefined;

  constructor(private readonly resolveSelection: ResolveEmbeddingSelection) {}

  static fromResolverOptions(
    options: ResolveEmbeddingBackendOptions,
  ): EmbeddingRunner {
    return new EmbeddingRunner(() => resolveEmbeddingBackend(options));
  }

  get selectedKind(): string | undefined {
    return this.resolvedSelection?.selectedKind;
  }

  async getSelection(): Promise<ResolvedEmbeddingBackend> {
    return this.ensureSelection();
  }

  async getBackend(): Promise<EmbeddingBackend> {
    const selection = await this.ensureSelection();
    return selection.backend;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const backend = await this.getBackend();
    return backend.embed(texts);
  }

  private async ensureSelection(): Promise<ResolvedEmbeddingBackend> {
    if (this.resolvedSelection) {
      return this.resolvedSelection;
    }

    if (!this.selectionPromise) {
      this.selectionPromise = this.resolveSelection().then((selection) => {
        this.resolvedSelection = selection;
        return selection;
      });
    }

    return this.selectionPromise;
  }
}
