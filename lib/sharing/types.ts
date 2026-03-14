// ---------------------------------------------------------------------------
// sharing/types.ts — Shared data types for P2P curiosity and subgraph exchange
// ---------------------------------------------------------------------------
//
// All types used across sharing modules are defined here to keep the modules
// decoupled from one another while sharing a single canonical schema.
// ---------------------------------------------------------------------------

import type { Edge, Hash, Page, Signature } from "../core/types";

// ---------------------------------------------------------------------------
// CuriosityProbe — broadcast when a knowledge gap is detected
// ---------------------------------------------------------------------------

/**
 * A P2P curiosity probe broadcast when MetroidBuilder cannot find a valid
 * antithesis medoid (m2) for a thesis topic.
 *
 * Peers receiving a probe MUST verify that `mimeType` and `modelUrn` match
 * their local model before attempting to respond. Accepting graph fragments
 * from an incompatible model would introduce incommensurable similarity scores.
 */
export interface CuriosityProbe {
  /** Unique probe identifier (e.g., UUID or hash of probe content). */
  probeId: string;

  /** The thesis medoid page ID for which antithesis was not found. */
  m1: Hash;

  /** The incomplete Metroid at the boundary of local knowledge. */
  partialMetroid: {
    m1: Hash;
    m2?: Hash;
    /** Serialised centroid embedding as a base-64-encoded Float32Array, optional. */
    centroidB64?: string;
  };

  /** Original query embedding serialised as base-64-encoded Float32Array. */
  queryContextB64: string;

  /** Matryoshka dimensional layer at which antithesis search failed. */
  knowledgeBoundary: number;

  /**
   * MIME type of the embedded content (e.g., "text/plain", "image/jpeg").
   * Required: peers must validate content-type commensurability.
   */
  mimeType: string;

  /**
   * URN identifying the specific embedding model used to produce the vectors
   * (e.g., "urn:model:onnx-community/embeddinggemma-300m-ONNX:v1").
   * Required: peers must reject probes with incompatible modelUrn.
   */
  modelUrn: string;

  /** ISO 8601 timestamp when this probe was created. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// GraphFragment — response payload returned to a curiosity probe
// ---------------------------------------------------------------------------

/**
 * A signed graph fragment returned by a peer in response to a CuriosityProbe.
 * Contains nodes and edges relevant to the probe's knowledge boundary.
 */
export interface GraphFragment {
  /** Unique fragment identifier. */
  fragmentId: string;

  /** The probe ID this fragment responds to. */
  probeId: string;

  /** Pages included in this fragment (eligibility-filtered). */
  nodes: Page[];

  /** Hebbian edges among the included nodes. */
  edges: Edge[];

  /**
   * Per-node cryptographic signatures keyed by pageId.
   * Recipients verify these before integrating.
   */
  signatures: Record<Hash, Signature>;

  /** ISO 8601 timestamp when this fragment was assembled. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Eligibility decisions
// ---------------------------------------------------------------------------

export type EligibilityStatus = "eligible" | "blocked";

export type BlockReason =
  | "pii_identity"
  | "pii_credentials"
  | "pii_financial"
  | "pii_health"
  | "no_public_interest";

/** Deterministic eligibility decision for a single candidate page. */
export interface EligibilityDecision {
  pageId: Hash;
  status: EligibilityStatus;
  reason?: BlockReason;
}

// ---------------------------------------------------------------------------
// SubgraphSlice — an exported topic-scoped graph section
// ---------------------------------------------------------------------------

/**
 * A topic-scoped subgraph slice built from eligibility-approved pages.
 * Used for both curiosity responses and proactive peer exchange.
 */
export interface SubgraphSlice {
  sliceId: string;
  nodes: Page[];
  edges: Edge[];
  /** Provenance map: pageId -> source probe or exchange ID. */
  provenance: Record<Hash, string>;
  /** Signatures map for verification. */
  signatures: Record<Hash, Signature>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// PeerMessage — top-level P2P transport envelope
// ---------------------------------------------------------------------------

export type PeerMessageKind = "curiosity_probe" | "graph_fragment" | "subgraph_slice";

export interface PeerMessage {
  kind: PeerMessageKind;
  senderId: string;
  payload: CuriosityProbe | GraphFragment | SubgraphSlice;
}
