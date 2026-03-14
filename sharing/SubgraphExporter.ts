// ---------------------------------------------------------------------------
// SubgraphExporter — build eligibility-filtered graph slices for sharing (P2-G2)
// ---------------------------------------------------------------------------
//
// Constructs topic-scoped graph slices from pages that pass the eligibility
// classifier. For curiosity responses, the slice is constrained to content
// relevant to the probe's knowledge boundary.
//
// Personal metadata fields not needed for discovery are stripped or coarsened
// before export. Node/edge signatures and provenance are preserved.
// ---------------------------------------------------------------------------

import { randomUUID } from "../core/crypto/uuid";
import type { Edge, Hash, MetadataStore, MetroidNeighbor, Page } from "../core/types";
import { filterEligible } from "./EligibilityClassifier";
import type { CuriosityProbe, SubgraphSlice } from "./types";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ExportOptions {
  metadataStore: MetadataStore;
  /** Maximum nodes to include in a single slice. Default: 50. */
  maxNodes?: number;
  /** Maximum hops to expand from seed nodes. Default: 2. */
  maxHops?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip creator public key and signature from a page before export.
 * Only content, hashes, and embedding metadata are preserved for discovery.
 */
function coarsenPage(page: Page): Page {
  return {
    ...page,
    creatorPubKey: "",
    signature: "",
  };
}

/**
 * Build a provenance map for exported nodes.
 * Each node is tagged with the source identifier (probeId or exchangeId).
 */
function buildProvenance(nodeIds: Hash[], sourceId: string): Record<Hash, string> {
  const prov: Record<Hash, string> = {};
  for (const id of nodeIds) {
    prov[id] = sourceId;
  }
  return prov;
}

// ---------------------------------------------------------------------------
// BFS expansion from seed nodes
// ---------------------------------------------------------------------------

async function expandSeeds(
  seedIds: Hash[],
  maxHops: number,
  maxNodes: number,
  metadataStore: MetadataStore,
): Promise<{ pages: Page[]; edges: Edge[] }> {
  const visited = new Set<Hash>(seedIds);
  let frontier = [...seedIds];

  const collectedPages: Page[] = [];
  const edgeMap = new Map<string, Edge>();

  // Load seed pages
  for (const id of seedIds) {
    const page = await metadataStore.getPage(id);
    if (page) collectedPages.push(page);
  }

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const nextFrontier: Hash[] = [];

    for (const pageId of frontier) {
      if (collectedPages.length >= maxNodes) break;

      // Expand via Metroid (semantic) neighbors
      const metroidNeighbors: MetroidNeighbor[] = await metadataStore.getMetroidNeighbors(pageId);
      for (const n of metroidNeighbors) {
        if (!visited.has(n.neighborPageId) && collectedPages.length < maxNodes) {
          visited.add(n.neighborPageId);
          nextFrontier.push(n.neighborPageId);
          const page = await metadataStore.getPage(n.neighborPageId);
          if (page) collectedPages.push(page);
        }
      }
    }

    frontier = nextFrontier;
  }

  // After BFS completes, collect Hebbian edges among visited nodes using the final visited set
  for (const fromPageId of visited) {
    const hebbianEdges = await metadataStore.getNeighbors(fromPageId);
    for (const e of hebbianEdges) {
      if (visited.has(e.toPageId)) {
        const key = `${e.fromPageId}\x00${e.toPageId}`;
        if (!edgeMap.has(key)) edgeMap.set(key, e);
      }
    }
  }

  return { pages: collectedPages, edges: [...edgeMap.values()] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a subgraph slice for export in response to a CuriosityProbe.
 *
 * Starts BFS from `m1` in the probe, expands up to `maxHops`, applies
 * eligibility filtering, strips personal metadata, and returns a
 * signed-provenance SubgraphSlice ready for transmission.
 *
 * Returns null if no eligible nodes are found.
 */
export async function exportForProbe(
  probe: CuriosityProbe,
  options: ExportOptions,
): Promise<SubgraphSlice | null> {
  const { metadataStore, maxNodes = 50, maxHops = 2 } = options;

  const { pages, edges } = await expandSeeds(
    [probe.m1],
    maxHops,
    maxNodes,
    metadataStore,
  );

  const eligiblePages = filterEligible(pages);
  if (eligiblePages.length === 0) return null;

  const eligibleIds = new Set(eligiblePages.map((p) => p.pageId));
  const filteredEdges = edges.filter(
    (e) => eligibleIds.has(e.fromPageId) && eligibleIds.has(e.toPageId),
  );

  const coarsened = eligiblePages.map(coarsenPage);
  const provenance = buildProvenance(coarsened.map((p) => p.pageId), probe.probeId);

  return {
    sliceId: randomUUID(),
    nodes: coarsened,
    edges: filteredEdges,
    provenance,
    signatures: {},
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a subgraph slice for proactive opt-in peer exchange.
 *
 * Starts BFS from `seedPageIds`, applies eligibility filtering,
 * and returns a SubgraphSlice tagged with the exchange ID.
 *
 * Returns null if no eligible nodes are found.
 */
export async function exportForExchange(
  seedPageIds: Hash[],
  exchangeId: string,
  options: ExportOptions,
): Promise<SubgraphSlice | null> {
  const { metadataStore, maxNodes = 50, maxHops = 2 } = options;

  const { pages, edges } = await expandSeeds(
    seedPageIds,
    maxHops,
    maxNodes,
    metadataStore,
  );

  const eligiblePages = filterEligible(pages);
  if (eligiblePages.length === 0) return null;

  const eligibleIds = new Set(eligiblePages.map((p) => p.pageId));
  const filteredEdges = edges.filter(
    (e) => eligibleIds.has(e.fromPageId) && eligibleIds.has(e.toPageId),
  );

  const coarsened = eligiblePages.map(coarsenPage);
  const provenance = buildProvenance(coarsened.map((p) => p.pageId), exchangeId);

  return {
    sliceId: randomUUID(),
    nodes: coarsened,
    edges: filteredEdges,
    provenance,
    signatures: {},
    timestamp: new Date().toISOString(),
  };
}
