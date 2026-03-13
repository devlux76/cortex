/**
 * CuriosityBroadcaster tests (P2-G4)
 *
 * Tests probe enqueueing, rate-limiting, fragment handler dispatch,
 * and queue capacity management.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { CuriosityBroadcaster } from "../../sharing/CuriosityBroadcaster";
import type { P2PTransport } from "../../sharing/CuriosityBroadcaster";
import type { CuriosityProbe, GraphFragment, PeerMessage } from "../../sharing/types";

// ---------------------------------------------------------------------------
// Mock P2P transport
// ---------------------------------------------------------------------------

class MockTransport implements P2PTransport {
  broadcast_log: PeerMessage[] = [];
  private handler?: (msg: PeerMessage) => void;

  async broadcast(message: PeerMessage): Promise<void> {
    this.broadcast_log.push(message);
  }

  onMessage(handler: (message: PeerMessage) => void): void {
    this.handler = handler;
  }

  /** Simulate an incoming message from a peer. */
  receive(message: PeerMessage): void {
    this.handler?.(message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-03-13T00:00:00.000Z");

function makeProbePartial(): Omit<CuriosityProbe, "probeId"> {
  return {
    m1: "page-m1",
    partialMetroid: { m1: "page-m1" },
    queryContextB64: "AAAA",
    knowledgeBoundary: 64,
    mimeType: "text/plain",
    modelUrn: "urn:model:test:v1",
    timestamp: new Date(NOW).toISOString(),
  };
}

function makeFragment(probeId: string): GraphFragment {
  return {
    fragmentId: "frag-1",
    probeId,
    nodes: [],
    edges: [],
    signatures: {},
    timestamp: new Date(NOW).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CuriosityBroadcaster", () => {
  let transport: MockTransport;
  let broadcaster: CuriosityBroadcaster;

  beforeEach(() => {
    transport = new MockTransport();
    broadcaster = new CuriosityBroadcaster({
      transport,
      nodeId: "local-node",
      rateLimitMs: 1000,
    });
  });

  it("pendingCount is 0 initially", () => {
    expect(broadcaster.pendingCount).toBe(0);
  });

  it("enqueueProbe increments pendingCount", () => {
    broadcaster.enqueueProbe(makeProbePartial());
    expect(broadcaster.pendingCount).toBe(1);
  });

  it("flush broadcasts a probe and decrements pendingCount", async () => {
    broadcaster.enqueueProbe(makeProbePartial());
    const sent = await broadcaster.flush(NOW);
    expect(sent).toBe(1);
    expect(broadcaster.pendingCount).toBe(0);
    expect(transport.broadcast_log).toHaveLength(1);
  });

  it("flush respects rate limit — returns 0 when called too soon", async () => {
    broadcaster.enqueueProbe(makeProbePartial());
    await broadcaster.flush(NOW);

    // Enqueue another but call flush immediately (same timestamp)
    broadcaster.enqueueProbe(makeProbePartial());
    const sent = await broadcaster.flush(NOW);
    expect(sent).toBe(0);
    expect(transport.broadcast_log).toHaveLength(1);
  });

  it("flush sends after rate-limit window elapses", async () => {
    broadcaster.enqueueProbe(makeProbePartial());
    await broadcaster.flush(NOW);

    broadcaster.enqueueProbe(makeProbePartial());
    const sent = await broadcaster.flush(NOW + 1001);
    expect(sent).toBe(1);
    expect(transport.broadcast_log).toHaveLength(2);
  });

  it("flush returns 0 when queue is empty", async () => {
    const sent = await broadcaster.flush(NOW);
    expect(sent).toBe(0);
  });

  it("broadcast message has kind=curiosity_probe and correct nodeId", async () => {
    broadcaster.enqueueProbe(makeProbePartial());
    await broadcaster.flush(NOW);

    const msg = transport.broadcast_log[0];
    expect(msg.kind).toBe("curiosity_probe");
    expect(msg.senderId).toBe("local-node");
  });

  it("probe gets a probeId assigned if not provided", async () => {
    broadcaster.enqueueProbe(makeProbePartial()); // no probeId
    await broadcaster.flush(NOW);

    const msg = transport.broadcast_log[0];
    const probe = msg.payload as CuriosityProbe;
    expect(typeof probe.probeId).toBe("string");
    expect(probe.probeId.length).toBeGreaterThan(0);
  });

  it("queue drops oldest probe when maxQueueDepth is exceeded", () => {
    const smallBroadcaster = new CuriosityBroadcaster({
      transport,
      nodeId: "node",
      rateLimitMs: 0,
      maxQueueDepth: 2,
    });

    // Enqueue 3 probes into a max-2 queue
    const p1 = { ...makeProbePartial(), timestamp: "2026-01-01T00:00:00.000Z" };
    const p2 = { ...makeProbePartial(), timestamp: "2026-01-02T00:00:00.000Z" };
    const p3 = { ...makeProbePartial(), timestamp: "2026-01-03T00:00:00.000Z" };

    smallBroadcaster.enqueueProbe(p1);
    smallBroadcaster.enqueueProbe(p2);
    smallBroadcaster.enqueueProbe(p3);

    // Queue should cap at 2 (oldest dropped)
    expect(smallBroadcaster.pendingCount).toBe(2);
  });

  it("onFragment handler is called when a graph_fragment message arrives", async () => {
    const received: GraphFragment[] = [];
    broadcaster.onFragment(async (frag) => {
      received.push(frag);
    });

    const frag = makeFragment("probe-123");
    transport.receive({ kind: "graph_fragment", senderId: "peer", payload: frag });

    // Allow microtask queue to settle
    await Promise.resolve();

    expect(received).toHaveLength(1);
    expect(received[0].probeId).toBe("probe-123");
  });

  it("non-fragment messages are ignored by the fragment handler", async () => {
    const received: GraphFragment[] = [];
    broadcaster.onFragment(async (frag) => { received.push(frag); });

    transport.receive({
      kind: "curiosity_probe",
      senderId: "peer",
      payload: { ...makeProbePartial(), probeId: "p" },
    });
    await Promise.resolve();

    expect(received).toHaveLength(0);
  });
});
