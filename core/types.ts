// ---------------------------------------------------------------------------
// Primitive aliases
// ---------------------------------------------------------------------------

export type Hash = string;        // SHA-256 hex
export type Signature = string;   // base64 or hex
export type PublicKey = string;   // JWK or raw

// ---------------------------------------------------------------------------
// Knowledge-hierarchy entities
// ---------------------------------------------------------------------------

export interface Page {
  pageId: Hash;               // SHA-256(content)
  content: string;            // bounded by chunk policy derived from ModelProfile
  embeddingOffset: number;    // byte offset into the vector file
  embeddingDim: number;       // resolved embedding dimension from ModelProfile

  contentHash: Hash;          // SHA-256(content)
  vectorHash: Hash;           // SHA-256(vector bytes)

  prevPageId?: Hash | null;
  nextPageId?: Hash | null;

  creatorPubKey: PublicKey;
  signature: Signature;
  createdAt: string;          // ISO timestamp
}

export interface BookMetadata {
  title?: string;
  sourceUri?: string;
  tags?: string[];
  extra?: Record<string, unknown>;
}

export interface Book {
  bookId: Hash;               // SHA-256(pageIds joined or Merkle root)
  pageIds: Hash[];
  medoidPageId: Hash;
  meta: BookMetadata;
}

export interface Volume {
  volumeId: Hash;
  bookIds: Hash[];
  prototypeOffsets: number[]; // byte offsets into the vector file
  prototypeDim: number;       // runtime policy dimension for this prototype tier
  variance: number;
}

export interface Shelf {
  shelfId: Hash;
  volumeIds: Hash[];
  routingPrototypeOffsets: number[]; // coarse prototype byte offsets
  routingDim: number;
}

export interface Edge {
  fromPageId: Hash;
  toPageId: Hash;
  weight: number;             // Hebbian weight
  lastUpdatedAt: string;      // ISO timestamp
}

// ---------------------------------------------------------------------------
// Metroid (medoid) nearest-neighbour graph
// ---------------------------------------------------------------------------

export interface MetroidNeighbor {
  neighborPageId: Hash;
  cosineSimilarity: number;   // threshold is defined by runtime policy
  distance: number;           // 1 – cosineSimilarity (ready for TSP)
}

export interface MetroidSubgraph {
  nodes: Hash[];
  edges: { from: Hash; to: Hash; distance: number }[];
}

// ---------------------------------------------------------------------------
// Storage abstractions
// ---------------------------------------------------------------------------

/**
 * Append-only binary vector file.
 *
 * `offset` values are **byte offsets** inside the file so that mixed-dimension
 * vectors (full embeddings vs. compressed prototypes) coexist without
 * additional metadata.
 */
export interface VectorStore {
  /** Appends `vector` to the file and returns its starting byte offset. */
  appendVector(vector: Float32Array): Promise<number>;

  /** Reads `dim` floats starting at byte offset `offset`. */
  readVector(offset: number, dim: number): Promise<Float32Array>;

  /** Reads multiple vectors by their individual byte offsets. */
  readVectors(offsets: number[], dim: number): Promise<Float32Array[]>;
}

/**
 * Structured metadata store backed by IndexedDB (or any equivalent engine).
 *
 * Reverse-index helpers (`getBooksByPage`, `getVolumesByBook`,
 * `getShelvesByVolume`) are maintained automatically on every `put*` call so
 * callers never need to manage the mappings directly.
 */
export interface MetadataStore {
  // --- Core CRUD ---
  putPage(page: Page): Promise<void>;
  getPage(pageId: Hash): Promise<Page | undefined>;

  putBook(book: Book): Promise<void>;
  getBook(bookId: Hash): Promise<Book | undefined>;

  putVolume(volume: Volume): Promise<void>;
  getVolume(volumeId: Hash): Promise<Volume | undefined>;

  putShelf(shelf: Shelf): Promise<void>;
  getShelf(shelfId: Hash): Promise<Shelf | undefined>;

  // --- Hebbian edges ---
  putEdges(edges: Edge[]): Promise<void>;
  getNeighbors(pageId: Hash, limit?: number): Promise<Edge[]>;

  // --- Reverse-index helpers ---
  getBooksByPage(pageId: Hash): Promise<Book[]>;
  getVolumesByBook(bookId: Hash): Promise<Volume[]>;
  getShelvesByVolume(volumeId: Hash): Promise<Shelf[]>;

  // --- Metroid NN radius index ---
  putMetroidNeighbors(pageId: Hash, neighbors: MetroidNeighbor[]): Promise<void>;
  getMetroidNeighbors(pageId: Hash, maxDegree?: number): Promise<MetroidNeighbor[]>;

  /** BFS expansion of the Metroid subgraph up to `maxHops` levels deep. */
  getInducedMetroidSubgraph(
    seedPageIds: Hash[],
    maxHops: number,
  ): Promise<MetroidSubgraph>;

  // --- Dirty-volume recalc flags ---
  needsMetroidRecalc(volumeId: Hash): Promise<boolean>;
  flagVolumeForMetroidRecalc(volumeId: Hash): Promise<void>;
  clearMetroidRecalcFlag(volumeId: Hash): Promise<void>;
}
