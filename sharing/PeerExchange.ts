// ---------------------------------------------------------------------------
// PeerExchange — opt-in signed subgraph exchange over P2P transport (P2-G3)
// ---------------------------------------------------------------------------
//
// Manages the lifecycle of proactive peer-to-peer graph slice sharing.
// Peers that opt in can receive public-interest graph sections from neighbours.
// All payloads pass eligibility filtering before export and are verified on
// import. Sender identity is never exposed to the receiving peer's queries.
// ---------------------------------------------------------------------------

import { randomUUID } from "../core/crypto/uuid";
import type { Hash, MetadataStore, VectorStore } from "../core/types";
import { exportForExchange } from "./SubgraphExporter";
import { importSlice } from "./SubgraphImporter";
import type { P2PTransport } from "./CuriosityBroadcaster";
import type { ImportResult } from "./SubgraphImporter";
import type { PeerMessage, SubgraphSlice } from "./types";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PeerExchangeOptions {
  transport: P2PTransport;
  metadataStore: MetadataStore;
  vectorStore: VectorStore;
  /** Local node identifier (used as senderId). */
  nodeId: string;
  /**
   * When true, content hashes on received slices are verified.
   * Defaults to false.
   */
  verifyContentHashes?: boolean;
}

export interface ExchangeResult {
  sliceId: string;
  nodesExported: number;
}

// ---------------------------------------------------------------------------
// PeerExchange
// ---------------------------------------------------------------------------

/**
 * Orchestrates opt-in signed subgraph exchange with connected peers.
 *
 * Usage:
 *   const exchange = new PeerExchange({ transport, metadataStore, vectorStore, nodeId });
 *   exchange.onSliceReceived(async (result) => { ... });
 *   const result = await exchange.sendSlice(seedPageIds);
 */
export class PeerExchange {
  private readonly transport: P2PTransport;
  private readonly metadataStore: MetadataStore;
  private readonly vectorStore: VectorStore;
  private readonly nodeId: string;
  private readonly verifyContentHashes: boolean;
  private sliceHandler?: (result: ImportResult, slice: SubgraphSlice) => Promise<void>;

  constructor(options: PeerExchangeOptions) {
    this.transport = options.transport;
    this.metadataStore = options.metadataStore;
    this.vectorStore = options.vectorStore;
    this.nodeId = options.nodeId;
    this.verifyContentHashes = options.verifyContentHashes ?? false;

    this.transport.onMessage((msg) => {
      if (msg.kind === "subgraph_slice") {
        void this._handleIncoming(msg.payload as SubgraphSlice);
      }
    });
  }

  /**
   * Register a handler called when a slice is received and imported.
   * Replaces any previously registered handler.
   */
  onSliceReceived(handler: (result: ImportResult, slice: SubgraphSlice) => Promise<void>): void {
    this.sliceHandler = handler;
  }

  /**
   * Export a subgraph slice from the given seed page IDs and broadcast it
   * to all connected peers.
   *
   * Only eligibility-approved nodes are included. Returns null if no eligible
   * nodes were found or the export produced an empty slice.
   */
  async sendSlice(
    seedPageIds: Hash[],
    maxNodes = 50,
    maxHops = 2,
  ): Promise<ExchangeResult | null> {
    const exchangeId = randomUUID();

    const slice = await exportForExchange(seedPageIds, exchangeId, {
      metadataStore: this.metadataStore,
      maxNodes,
      maxHops,
    });

    if (!slice) return null;

    const message: PeerMessage = {
      kind: "subgraph_slice",
      senderId: this.nodeId,
      payload: slice,
    };

    await this.transport.broadcast(message);

    return { sliceId: slice.sliceId, nodesExported: slice.nodes.length };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async _handleIncoming(slice: SubgraphSlice): Promise<void> {
    const result = await importSlice(slice, {
      metadataStore: this.metadataStore,
      vectorStore: this.vectorStore,
      verifyContentHashes: this.verifyContentHashes,
    });

    if (this.sliceHandler) {
      await this.sliceHandler(result, slice);
    }
  }
}
