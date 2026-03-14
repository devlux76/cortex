// ---------------------------------------------------------------------------
// CuriosityBroadcaster — broadcast pending probes and handle responses (P2-G0)
// ---------------------------------------------------------------------------
//
// Consumes CuriosityProbe objects queued by KnowledgeGapDetector, serialises
// them for P2P transport, rate-limits broadcasts to prevent spam, and
// delegates incoming graph fragment responses to SubgraphImporter.
// ---------------------------------------------------------------------------

import { randomUUID } from "../core/crypto/uuid";
import type { CuriosityProbe, GraphFragment, PeerMessage } from "./types";

// ---------------------------------------------------------------------------
// P2P transport abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal P2P transport interface.
 * The broadcaster is transport-agnostic — inject any WebRTC/WebSocket
 * implementation that satisfies this contract.
 */
export interface P2PTransport {
  /** Broadcast a message to all connected peers. */
  broadcast(message: PeerMessage): Promise<void>;
  /** Register a listener for incoming messages from peers. */
  onMessage(handler: (message: PeerMessage) => void): void;
}

// ---------------------------------------------------------------------------
// Response handler
// ---------------------------------------------------------------------------

export type FragmentHandler = (fragment: GraphFragment) => Promise<void>;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CuriosityBroadcasterOptions {
  transport: P2PTransport;
  /** Local node identifier (used as senderId). */
  nodeId: string;
  /** Minimum milliseconds between broadcasts of any probe. Default: 5000. */
  rateLimitMs?: number;
  /** Maximum probe queue depth before oldest probes are dropped. Default: 100. */
  maxQueueDepth?: number;
}

// ---------------------------------------------------------------------------
// CuriosityBroadcaster
// ---------------------------------------------------------------------------

/**
 * Manages the lifecycle of outbound curiosity probes.
 *
 * Probes are enqueued via `enqueueProbe()`, then broadcast during idle time
 * via `flush()`. Rate limiting prevents probe spam. Incoming graph fragment
 * responses are dispatched to the registered `onFragment` handler.
 */
export class CuriosityBroadcaster {
  private readonly transport: P2PTransport;
  private readonly nodeId: string;
  private readonly rateLimitMs: number;
  private readonly maxQueueDepth: number;

  private pendingProbes: CuriosityProbe[] = [];
  private lastBroadcastAt = 0;
  private fragmentHandler?: FragmentHandler;

  constructor(options: CuriosityBroadcasterOptions) {
    this.transport = options.transport;
    this.nodeId = options.nodeId;
    this.rateLimitMs = options.rateLimitMs ?? 5_000;
    this.maxQueueDepth = options.maxQueueDepth ?? 100;

    // Listen for incoming graph fragment responses
    this.transport.onMessage((msg) => {
      if (msg.kind === "graph_fragment") {
        void this._handleFragment(msg.payload as GraphFragment);
      }
    });
  }

  /**
   * Register a handler that will be called when a graph fragment response
   * arrives from a peer. Replaces any previously registered handler.
   */
  onFragment(handler: FragmentHandler): void {
    this.fragmentHandler = handler;
  }

  /**
   * Enqueue a CuriosityProbe for broadcast.
   *
   * If the queue is already at capacity, the oldest probe is dropped to make
   * room. A fresh probeId is assigned here if the probe does not already have
   * one, ensuring each broadcast can be correlated with its response.
   */
  enqueueProbe(probe: Omit<CuriosityProbe, "probeId"> & { probeId?: string }): void {
    const full: CuriosityProbe = {
      ...probe,
      probeId: probe.probeId ?? randomUUID(),
    };

    if (this.pendingProbes.length >= this.maxQueueDepth) {
      this.pendingProbes.shift(); // drop oldest
    }
    this.pendingProbes.push(full);
  }

  /**
   * Flush pending probes to connected peers, respecting the rate limit.
   *
   * Call this from the IdleScheduler during background passes. Each call
   * broadcasts at most one probe; subsequent calls broadcast the next one.
   *
   * Returns the number of probes broadcast (0 or 1).
   */
  async flush(now = Date.now()): Promise<number> {
    if (this.pendingProbes.length === 0) return 0;
    if (now - this.lastBroadcastAt < this.rateLimitMs) return 0;

    const probe = this.pendingProbes.shift();
    if (!probe) return 0;

    const message: PeerMessage = {
      kind: "curiosity_probe",
      senderId: this.nodeId,
      payload: probe,
    };

    await this.transport.broadcast(message);
    this.lastBroadcastAt = now;
    return 1;
  }

  /** Number of probes waiting to be broadcast. */
  get pendingCount(): number {
    return this.pendingProbes.length;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async _handleFragment(fragment: GraphFragment): Promise<void> {
    if (this.fragmentHandler) {
      await this.fragmentHandler(fragment);
    }
  }
}
