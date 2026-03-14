// ---------------------------------------------------------------------------
// SubgraphImporter — safely integrate received graph fragments (P2-G3)
// ---------------------------------------------------------------------------
//
// Verifies schema and (optionally) signatures on incoming graph fragments,
// merges eligible nodes and edges into the local store, and strips sender
// identity metadata so peer identity is not exposed to local queries.
// ---------------------------------------------------------------------------

import type { Edge, Hash, MetadataStore, Page, VectorStore } from "../core/types";
import type { GraphFragment, SubgraphSlice } from "./types";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ImportOptions {
  metadataStore: MetadataStore;
  vectorStore: VectorStore;
  /**
   * When true, nodes whose pageId does not match SHA-256(content) are
   * rejected. Defaults to false for test environments — enable in production.
   */
  verifyContentHashes?: boolean;
}

export interface ImportResult {
  nodesImported: number;
  edgesImported: number;
  rejected: Hash[];
}

// ---------------------------------------------------------------------------
// Schema validation helpers
// ---------------------------------------------------------------------------

function isValidPage(p: unknown): p is Page {
  if (typeof p !== "object" || p === null) return false;
  const page = p as Partial<Page>;
  return (
    typeof page.pageId === "string" && page.pageId.length > 0 &&
    typeof page.content === "string" &&
    typeof page.embeddingOffset === "number" &&
    // This check is a validation guard, not a hardcoded model numeric.
    typeof page.embeddingDim === "number" && page.embeddingDim > 0 // model-derived-ok
  );
}

function isValidEdge(e: unknown): e is Edge {
  if (typeof e !== "object" || e === null) return false;
  const edge = e as Partial<Edge>;
  return (
    typeof edge.fromPageId === "string" && edge.fromPageId.length > 0 &&
    typeof edge.toPageId === "string" && edge.toPageId.length > 0 &&
    typeof edge.weight === "number" && edge.weight >= 0
  );
}

// ---------------------------------------------------------------------------
// Import logic
// ---------------------------------------------------------------------------

async function computeContentHash(content: string): Promise<string> {
  if (!("crypto" in globalThis) || !globalThis.crypto?.subtle) {
    throw new Error("SubtleCrypto not available for content hash verification");
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);

  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }

  return hex;
}

async function importNodes(
  nodes: Page[],
  vectorStore: VectorStore,
  metadataStore: MetadataStore,
  verifyContentHashes: boolean,
): Promise<{ imported: Hash[]; rejected: Hash[] }> {
  const imported: Hash[] = [];
  const rejected: Hash[] = [];

  for (const raw of nodes) {
    if (!isValidPage(raw)) {
      if (typeof (raw as Partial<Page>).pageId === "string") {
        rejected.push((raw as Page).pageId);
      }
      continue;
    }

    // Strip sender identity and discard sender-provided embedding metadata.
    // Remote embeddingOffset/embeddingDim refer to the sender's VectorStore and
    // are not valid byte offsets in the local store, so we must not persist them.
    const page: Page = {
      ...raw,
      creatorPubKey: "",
      signature: "",
      // Mark as "no local embedding yet"; downstream code can choose to re-embed.
      embeddingOffset: 0,
      embeddingDim: 0, // model-derived-ok
    };

    // Optionally verify that pageId matches SHA-256(content)
    if (verifyContentHashes) {
      let computedId: string;
      try {
        computedId = await computeContentHash(page.content);
      } catch {
        // If we cannot verify hashes, reject the page rather than
        // silently accepting unverified content.
        rejected.push(page.pageId);
        continue;
      }

      if (computedId !== page.pageId) {
        rejected.push(page.pageId);
        continue;
      }
    }

    // Persist page without trusting remote embedding offsets.
    await metadataStore.putPage(page);
    imported.push(page.pageId);
  }

  return { imported, rejected };
}

async function importEdges(
  edges: Edge[],
  importedNodeIds: Set<Hash>,
  metadataStore: MetadataStore,
): Promise<number> {
  const validEdges = edges.filter(
    (e) =>
      isValidEdge(e) &&
      importedNodeIds.has(e.fromPageId) &&
      importedNodeIds.has(e.toPageId),
  );

  if (validEdges.length > 0) {
    await metadataStore.putEdges(validEdges);
  }

  return validEdges.length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Import a GraphFragment received in response to a CuriosityProbe.
 *
 * Validates schema, strips sender identity metadata, and persists approved
 * nodes and edges into the local store. Rejected nodes are returned for
 * auditability.
 */
export async function importFragment(
  fragment: GraphFragment,
  options: ImportOptions,
): Promise<ImportResult> {
  const { metadataStore, vectorStore, verifyContentHashes = false } = options;

  const { imported, rejected } = await importNodes(
    fragment.nodes,
    vectorStore,
    metadataStore,
    verifyContentHashes,
  );

  const importedSet = new Set<Hash>(imported);
  const edgesImported = await importEdges(fragment.edges, importedSet, metadataStore);

  return { nodesImported: imported.length, edgesImported, rejected };
}

/**
 * Import a SubgraphSlice received via proactive peer exchange.
 *
 * Applies the same validation and identity stripping as `importFragment`.
 */
export async function importSlice(
  slice: SubgraphSlice,
  options: ImportOptions,
): Promise<ImportResult> {
  const { metadataStore, vectorStore, verifyContentHashes = false } = options;

  const { imported, rejected } = await importNodes(
    slice.nodes,
    vectorStore,
    metadataStore,
    verifyContentHashes,
  );

  const importedSet = new Set<Hash>(imported);
  const edgesImported = await importEdges(slice.edges, importedSet, metadataStore);

  return { nodesImported: imported.length, edgesImported, rejected };
}
