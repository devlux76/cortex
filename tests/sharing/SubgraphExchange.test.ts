/**
 * SubgraphExchange tests (P2-G4)
 *
 * Covers SubgraphExporter, SubgraphImporter, and PeerExchange:
 * - blocked nodes are never exported
 * - imported fragments are discoverable via store
 * - PeerExchange round-trip
 */

import { beforeEach, describe, expect, it } from "vitest";

import type {
  Book,
  Edge,
  Hash,
  HotpathEntry,
  MetadataStore,
  SemanticNeighbor,
  SemanticNeighborSubgraph,
  Page,
  PageActivity,
  Shelf,
  Volume,
} from "../../core/types";
import type { VectorStore } from "../../core/types";
import { exportForExchange, exportForProbe } from "../../sharing/SubgraphExporter";
import { importFragment, importSlice } from "../../sharing/SubgraphImporter";
import { PeerExchange } from "../../sharing/PeerExchange";
import type { P2PTransport } from "../../sharing/CuriosityBroadcaster";
import type { CuriosityProbe, GraphFragment, PeerMessage, SubgraphSlice } from "../../sharing/types";

// ---------------------------------------------------------------------------
// In-memory implementations
// ---------------------------------------------------------------------------

const NOW_STR = "2026-03-13T00:00:00.000Z";

function makePage(pageId: Hash, content: string): Page {
  return {
    pageId,
    content,
    embeddingOffset: 0,
    embeddingDim: 4,
    contentHash: pageId,
    vectorHash: pageId,
    creatorPubKey: "real-public-key",
    signature: "real-signature",
    createdAt: NOW_STR,
  };
}

class InMemoryVectorStore implements VectorStore {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async appendVector(v: Float32Array): Promise<number> { return 0; }
  async readVector(_offset: number, dim: number): Promise<Float32Array> { return new Float32Array(dim); }
  async readVectors(offsets: number[], dim: number): Promise<Float32Array[]> {
    return offsets.map(() => new Float32Array(dim));
  }
}

class FullMockMetadataStore implements MetadataStore {
  private pages = new Map<Hash, Page>();
  private books = new Map<Hash, Book>();
  private volumes = new Map<Hash, Volume>();
  private shelves = new Map<Hash, Shelf>();
  private edgeMap = new Map<string, Edge>();
  private activities = new Map<Hash, PageActivity>();
  private hotpath = new Map<Hash, HotpathEntry>();
  private semanticNeighbors = new Map<Hash, SemanticNeighbor[]>();
  private dirtyFlags = new Map<Hash, boolean>();

  async putPage(page: Page) { this.pages.set(page.pageId, page); }
  async getPage(id: Hash) { return this.pages.get(id); }
  async getAllPages() { return [...this.pages.values()]; }

  async putBook(book: Book) { this.books.set(book.bookId, book); }
  async getBook(id: Hash) { return this.books.get(id); }

  async putVolume(v: Volume) { this.volumes.set(v.volumeId, v); }
  async getVolume(id: Hash) { return this.volumes.get(id); }
  async getAllVolumes() { return [...this.volumes.values()]; }
  async deleteVolume(id: Hash) { this.volumes.delete(id); }

  async putShelf(s: Shelf) { this.shelves.set(s.shelfId, s); }
  async getShelf(id: Hash) { return this.shelves.get(id); }
  async getAllShelves() { return [...this.shelves.values()]; }

  async putEdges(edges: Edge[]) {
    for (const e of edges) this.edgeMap.set(`${e.fromPageId}\x00${e.toPageId}`, e);
  }
  async deleteEdge(from: Hash, to: Hash) { this.edgeMap.delete(`${from}\x00${to}`); }
  async getNeighbors(id: Hash) { return [...this.edgeMap.values()].filter((e) => e.fromPageId === id); }

  async getBooksByPage() { return []; }
  async getVolumesByBook() { return []; }
  async getShelvesByVolume() { return []; }

  async putSemanticNeighbors(pageId: Hash, neighbors: SemanticNeighbor[]) {
    this.semanticNeighbors.set(pageId, neighbors);
  }
  async getSemanticNeighbors(pageId: Hash) { return this.semanticNeighbors.get(pageId) ?? []; }
  async getInducedNeighborSubgraph(): Promise<SemanticNeighborSubgraph> { return { nodes: [], edges: [] }; }

  async needsNeighborRecalc(id: Hash) { return this.dirtyFlags.get(id) === true; }
  async flagVolumeForNeighborRecalc(id: Hash) { this.dirtyFlags.set(id, true); }
  async clearNeighborRecalcFlag(id: Hash) { this.dirtyFlags.set(id, false); }

  async putHotpathEntry(entry: HotpathEntry) { this.hotpath.set(entry.entityId, { ...entry }); }
  async getHotpathEntries(tier?: HotpathEntry["tier"]) {
    const all = [...this.hotpath.values()];
    return tier ? all.filter((e) => e.tier === tier) : all;
  }
  async removeHotpathEntry(id: Hash) { this.hotpath.delete(id); }
  async evictWeakest(tier: HotpathEntry["tier"]) {
    const entries = await this.getHotpathEntries(tier);
    if (!entries.length) return;
    const w = entries.reduce((a, b) => (a.salience <= b.salience ? a : b));
    this.hotpath.delete(w.entityId);
  }
  async getResidentCount() { return this.hotpath.size; }

  async putPageActivity(a: PageActivity) { this.activities.set(a.pageId, { ...a }); }
  async getPageActivity(id: Hash) { return this.activities.get(id); }

  hasPage(id: Hash): boolean { return this.pages.has(id); }
  getPageSync(id: Hash): Page | undefined { return this.pages.get(id); }
}

class MockTransport implements P2PTransport {
  sent: PeerMessage[] = [];
  private handler?: (msg: PeerMessage) => void;

  async broadcast(msg: PeerMessage): Promise<void> { this.sent.push(msg); }
  onMessage(handler: (msg: PeerMessage) => void): void { this.handler = handler; }
  receive(msg: PeerMessage): void { this.handler?.(msg); }
}

// ---------------------------------------------------------------------------
// Tests — SubgraphExporter
// ---------------------------------------------------------------------------

describe("SubgraphExporter", () => {
  let store: FullMockMetadataStore;

  beforeEach(() => {
    store = new FullMockMetadataStore();
  });

  it("returns null when seed page does not exist", async () => {
    const probe: CuriosityProbe = {
      probeId: "p1",
      m1: "nonexistent",
      partialMetroid: { m1: "nonexistent" },
      queryContextB64: "AAAA",
      knowledgeBoundary: 64,
      mimeType: "text/plain",
      modelUrn: "urn:model:test:v1",
      timestamp: NOW_STR,
    };
    const result = await exportForProbe(probe, { metadataStore: store });
    expect(result).toBeNull();
  });

  it("blocked pages are never exported", async () => {
    // PII-bearing page — contains email address
    const piPage = makePage("pii", "Contact alice@personal.example.com for secret credentials access.");
    await store.putPage(piPage);

    const probe: CuriosityProbe = {
      probeId: "p2",
      m1: "pii",
      partialMetroid: { m1: "pii" },
      queryContextB64: "AAAA",
      knowledgeBoundary: 64,
      mimeType: "text/plain",
      modelUrn: "urn:model:test:v1",
      timestamp: NOW_STR,
    };
    const result = await exportForProbe(probe, { metadataStore: store });
    // PII page blocked → no eligible nodes → null
    expect(result).toBeNull();
  });

  it("eligible pages are included in the exported slice", async () => {
    const eligible = makePage(
      "eligible-1",
      "Distributed hash tables enable scalable peer-to-peer networks for efficient content routing.",
    );
    await store.putPage(eligible);

    const probe: CuriosityProbe = {
      probeId: "p3",
      m1: "eligible-1",
      partialMetroid: { m1: "eligible-1" },
      queryContextB64: "AAAA",
      knowledgeBoundary: 64,
      mimeType: "text/plain",
      modelUrn: "urn:model:test:v1",
      timestamp: NOW_STR,
    };
    const slice = await exportForProbe(probe, { metadataStore: store });

    expect(slice).not.toBeNull();
    expect(slice!.nodes.some((n) => n.pageId === "eligible-1")).toBe(true);
  });

  it("creator public key and signature are stripped from exported nodes", async () => {
    const page = makePage(
      "eligible-2",
      "Byzantine fault tolerance requires at least 3f+1 replicas to tolerate f faulty nodes.",
    );
    await store.putPage(page);

    const slice = await exportForExchange(["eligible-2"], "exch-1", {
      metadataStore: store,
    });

    expect(slice).not.toBeNull();
    for (const node of slice!.nodes) {
      expect(node.creatorPubKey).toBe("");
      expect(node.signature).toBe("");
    }
  });

  it("provenance map tags every node with the exchange/probe ID", async () => {
    const page = makePage(
      "eligible-3",
      "Raft consensus algorithm uses leader election and log replication for distributed agreement.",
    );
    await store.putPage(page);

    const slice = await exportForExchange(["eligible-3"], "my-exchange-id", {
      metadataStore: store,
    });

    expect(slice).not.toBeNull();
    for (const id of Object.keys(slice!.provenance)) {
      expect(slice!.provenance[id]).toBe("my-exchange-id");
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — SubgraphImporter
// ---------------------------------------------------------------------------

describe("SubgraphImporter", () => {
  let store: FullMockMetadataStore;
  const vectorStore = new InMemoryVectorStore();

  beforeEach(() => {
    store = new FullMockMetadataStore();
  });

  it("importFragment persists valid pages to the store", async () => {
    const page = makePage(
      "import-1",
      "Content about distributed systems that is long enough to be public-interest.",
    );
    const fragment: GraphFragment = {
      fragmentId: "frag-1",
      probeId: "probe-1",
      nodes: [page],
      edges: [],
      signatures: {},
      timestamp: NOW_STR,
    };

    const result = await importFragment(fragment, { metadataStore: store, vectorStore });

    expect(result.nodesImported).toBe(1);
    expect(store.hasPage("import-1")).toBe(true);
  });

  it("importFragment strips sender identity from imported nodes", async () => {
    const page = makePage(
      "import-2",
      "Knowledge graph embedding methods like TransE and RotatE learn entity representations.",
    );
    const fragment: GraphFragment = {
      fragmentId: "frag-2",
      probeId: "probe-2",
      nodes: [page],
      edges: [],
      signatures: {},
      timestamp: NOW_STR,
    };

    await importFragment(fragment, { metadataStore: store, vectorStore });

    const stored = store.getPageSync("import-2");
    expect(stored?.creatorPubKey).toBe("");
    expect(stored?.signature).toBe("");
  });

  it("importFragment rejects nodes with invalid schema", async () => {
    const fragment: GraphFragment = {
      fragmentId: "frag-bad",
      probeId: "probe-bad",
      nodes: [{ invalid: true } as unknown as Page],
      edges: [],
      signatures: {},
      timestamp: NOW_STR,
    };

    const result = await importFragment(fragment, { metadataStore: store, vectorStore });

    expect(result.nodesImported).toBe(0);
    expect(result.rejected).toHaveLength(0); // no pageId to record
  });

  it("importSlice persists nodes and edges from slice", async () => {
    const p1 = makePage("s1", "Graph attention networks apply attention mechanisms to node neighbourhood aggregation.");
    const p2 = makePage("s2", "Variational autoencoders learn latent representations for generative modelling tasks.");
    const edge: Edge = {
      fromPageId: "s1",
      toPageId: "s2",
      weight: 0.8,
      lastUpdatedAt: NOW_STR,
    };

    const slice: SubgraphSlice = {
      sliceId: "slice-1",
      nodes: [p1, p2],
      edges: [edge],
      provenance: {},
      signatures: {},
      timestamp: NOW_STR,
    };

    const result = await importSlice(slice, { metadataStore: store, vectorStore });

    expect(result.nodesImported).toBe(2);
    expect(result.edgesImported).toBe(1);
  });

  it("imported pages are discoverable via getPage", async () => {
    const page = makePage(
      "disc-1",
      "Merkle trees provide efficient cryptographic verification of large data structures.",
    );
    const fragment: GraphFragment = {
      fragmentId: "f",
      probeId: "p",
      nodes: [page],
      edges: [],
      signatures: {},
      timestamp: NOW_STR,
    };

    await importFragment(fragment, { metadataStore: store, vectorStore });

    const found = await store.getPage("disc-1");
    expect(found).toBeDefined();
    expect(found!.content).toBe(page.content);
  });
});

// ---------------------------------------------------------------------------
// Tests — PeerExchange round-trip
// ---------------------------------------------------------------------------

describe("PeerExchange", () => {
  let localStore: FullMockMetadataStore;
  let remoteStore: FullMockMetadataStore;
  let transport: MockTransport;
  const vectorStore = new InMemoryVectorStore();

  beforeEach(() => {
    localStore = new FullMockMetadataStore();
    remoteStore = new FullMockMetadataStore();
    transport = new MockTransport();
  });

  it("sendSlice returns null when no eligible pages exist", async () => {
    const exchange = new PeerExchange({
      transport,
      metadataStore: localStore,
      vectorStore,
      nodeId: "local",
    });

    const result = await exchange.sendSlice(["nonexistent"]);
    expect(result).toBeNull();
  });

  it("sendSlice broadcasts a subgraph_slice message to peers", async () => {
    const page = makePage(
      "broadcast-1",
      "Federated learning allows model training across decentralised data without sharing raw data.",
    );
    await localStore.putPage(page);

    const exchange = new PeerExchange({
      transport,
      metadataStore: localStore,
      vectorStore,
      nodeId: "local",
    });

    const result = await exchange.sendSlice(["broadcast-1"]);

    expect(result).not.toBeNull();
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].kind).toBe("subgraph_slice");
    expect(transport.sent[0].senderId).toBe("local");
  });

  it("onSliceReceived handler is called with imported nodes", async () => {
    const remoteExchange = new PeerExchange({
      transport,
      metadataStore: remoteStore,
      vectorStore,
      nodeId: "remote",
    });

    const imported: string[] = [];
    remoteExchange.onSliceReceived(async (result) => {
      imported.push(...Array(result.nodesImported).fill("node"));
    });

    const page = makePage(
      "incoming-1",
      "Homomorphic encryption enables computation on encrypted data without decryption.",
    );
    const slice: SubgraphSlice = {
      sliceId: "sl-1",
      nodes: [page],
      edges: [],
      provenance: {},
      signatures: {},
      timestamp: NOW_STR,
    };

    transport.receive({ kind: "subgraph_slice", senderId: "local", payload: slice });
    // Allow the full async chain (_handleIncoming -> importSlice -> putPage -> onSliceReceived) to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(imported.length).toBe(1);
    expect(remoteStore.hasPage("incoming-1")).toBe(true);
  });
});
