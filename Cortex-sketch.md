## Execution Note (2026-03-11)

Canonical execution plan: `PROJECT-EXECUTION-PLAN.md`.

Next session highest priority (P0):
1. Run a full code pass across implementation files.
2. Remove hardcoded model-dependent constants.
3. Replace them with values derived from model metadata via a `ModelProfile` layer.

Sketch note:
1. Numeric values in this sketch are examples for architectural discussion.
2. Implementation values must be model-derived or explicit runtime policy values.

A concrete TypeScript-oriented architecture that maps each conceptual element (Page → Shelf, HIPPOCAMPUS, CORTEX, backends, etc.) into interfaces, classes, and modules, staying framework-agnostic but browser-friendly.  
  
## Data model types  
  
Represent the knowledge hierarchy as immutable, strongly-typed records; IDs and hashes are strings (hex) and timestamps are ISO strings.  
  
```ts  
export type Hash = string;          // SHA-256 hex  
export type Signature = string;     // base64 or hex  
export type PublicKey = string;     // JWK or raw  
  
export interface Page {  
  pageId: Hash;                     // SHA256(content)  
  content: string;                  // ≤ 2048 tokens  
  embeddingOffset: number;          // index into vector file  
  embeddingDim: number;             // e.g. 768  
  
  contentHash: Hash;                // SHA256(content)  
  vectorHash: Hash;                 // SHA256(vector bytes)  
  
  prevPageId?: Hash | null;  
  nextPageId?: Hash | null;  
  
  creatorPubKey: PublicKey;  
  signature: Signature;  
  
  createdAt: string;                // ISO timestamp  
}  
  
export interface BookMetadata {  
  title?: string;  
  sourceUri?: string;  
  tags?: string[];  
  extra?: Record<string, unknown>;  
}  
  
export interface Book {  
  bookId: Hash;                     // SHA256(pageIds concatenated or Merkle root)  
  pageIds: Hash[];  
  medoidPageId: Hash;  
  meta BookMetadata;  
}  
  
export interface Volume {  
  volumeId: Hash;  
  bookIds: Hash[];  
  
  // e.g. multiple prototypes to avoid "Kansas problem"  
  prototypeOffsets: number[];       // offsets into vector file  
  prototypeDim: number;             // e.g. 128  
  variance: number;  
}  
  
export interface Shelf {  
  shelfId: Hash;  
  volumeIds: Hash[];  
  
  routingPrototypeOffsets: number[]; // coarse prototypes, 32–64 dim  
  routingDim: number;  
}  
  
export interface Library {  
  shelves: Record<Hash, Shelf>;  
  volumes: Record<Hash, Volume>;  
  books: Record<Hash, Book>;  
  pages: Record<Hash, Page>;  
}  
  
export interface Edge {  
  fromPageId: Hash;  
  toPageId: Hash;  
  weight: number;                   // Hebbian weight  
  lastUpdatedAt: string;  
}  
```  
  
## Storage layer abstractions  
  
Encapsulate vector storage (append-only binary) and metadata (IndexedDB) behind interfaces so you can swap implementations for browser/edge/server.  
  
```ts  
export interface VectorStore {  
  appendVector(vector: Float32Array): Promise<number>;          // returns embeddingOffset  
  readVector(offset: number, dim: number): Promise<Float32Array>;  
  readVectors(offsets: number[], dim: number): Promise<Float32Array[]>;  
}  
  
export interface MetadataStore {  
  putPage(page: Page): Promise<void>;  
  getPage(pageId: Hash): Promise<Page | undefined>;  
  putBook(book: Book): Promise<void>;  
  getBook(bookId: Hash): Promise<Book | undefined>;  
  putVolume(volume: Volume): Promise<void>;  
  getVolume(volumeId: Hash): Promise<Volume | undefined>;  
  putShelf(shelf: Shelf): Promise<void>;  
  getShelf(shelfId: Hash): Promise<Shelf | undefined>;  
  
  putEdges(edges: Edge[]): Promise<void>;  
  getNeighbors(pageId: Hash, limit?: number): Promise<Edge[]>;  
  
  // indexing helpers  
  getBooksByPage(pageId: Hash): Promise<Book[]>;  
  getVolumesByBook(bookId: Hash): Promise<Volume[]>;  
  getShelvesByVolume(volumeId: Hash): Promise<Shelf[]>;  
}  
```  
  
Example browser implementations:  
  
- `OPFSVectorStore` using `navigator.storage.getDirectory()` and a single grow-only file.  
- `IndexedDbMetadataStore` using an IndexedDB wrapper (e.g. `idb`) with object stores: `pages`, `books`, `volumes`, `shelves`, `edges`.  
  
## Embedding and compute backends  
  
Define a uniform embedding backend and a vector backend that all higher layers depend on.  
  
```ts  
export interface EmbeddingBackend {  
  embed(texts: string[]): Promise<Float32Array[]>;  // batched for throughput  
  dim: number;  
}  
  
export type BackendKind = "webnn" | "webgpu" | "webgl" | "wasm";  
  
export interface VectorBackend {  
  kind: BackendKind;  
  
  cosineSimilarity(  
    query: Float32Array,  
    vectors: Float32Array[]  
  ): Promise<Float32Array>;         // scores  
  
  topK(  
    query: Float32Array,  
    vectors: Float32Array[],  
    k: number  
  ): Promise<{ index: number; score: number }[]>;  
  
  vectorNorm(v: Float32Array): Promise<number>;  
  dotProduct(a: Float32Array, b: Float32Array): Promise<number>;  
  centroid(vectors: Float32Array[]): Promise<Float32Array>;  
  medoid(vectors: Float32Array[]): Promise<number>; // index of medoid  
}  
```  
  
Backend detection and wiring:  
  
```ts  
export function detectBackend(): BackendKind {  
  // WebNN for embeddings, but for vector ops we prioritize GPUs  
  if (typeof navigator !== "undefined" && (navigator as any).gpu) {  
    return "webgpu";  
  }  
  const canvas = document.createElement("canvas");  
  if (canvas.getContext("webgl2")) {  
    return "webgl";  
  }  
  return "wasm";  
}  
```  
  
Implementations:  
  
- `WebGpuVectorBackend` with compute shaders for batch cosine similarity and top-k reduction.  
- `WebGlVectorBackend` with float textures and fragment shaders.  
- `WasmVectorBackend` with a WASM module (Rust/C) exposing SIMD-accelerated primitives.  
  
## Verification and crypto utilities  
  
Use Web Crypto for SHA-256 and signatures; keep utilities isolated so they can be swapped (e.g., to Node’s `crypto`).  
  
```ts  
export class CryptoService {  
  constructor(  
    private subtle: SubtleCrypto = crypto.subtle  
  ) {}  
  
  async sha256Bytes(bytes: ArrayBuffer): Promise<Hash> {  
    const hash = await this.subtle.digest("SHA-256", bytes);  
    return Buffer.from(new Uint8Array(hash)).toString("hex");  
  }  
  
  async sha256String(content: string): Promise<Hash> {  
    const enc = new TextEncoder().encode(content);  
    return this.sha256Bytes(enc.buffer);  
  }  
  
  async sign(  
    privateKey: CryptoKey,  
     ArrayBuffer  
  ): Promise<Signature> {  
    const sig = await this.subtle.sign(  
      { name: "Ed25519" },  
      privateKey,  
      data  
    );  
    return Buffer.from(new Uint8Array(sig)).toString("base64");  
  }  
  
  async verify(  
    publicKey: CryptoKey,  
    signature: Signature,  
     ArrayBuffer  
  ): Promise<boolean> {  
    const sigBytes = Uint8Array.from(  
      Buffer.from(signature, "base64")  
    );  
    return this.subtle.verify(  
      { name: "Ed25519" },  
      publicKey,  
      sigBytes,  
      data  
    );  
  }  
}  
```  
  
Helper for constructing a verified `Page`:  
  
```ts  
export class PageFactory {  
  constructor(  
    private crypto: CryptoService,  
    private vectorStore: VectorStore,  
    private embedding: EmbeddingBackend,  
    private creatorPubKey: PublicKey,  
    private signer: CryptoKey  
  ) {}  
  
  async createPagesFromText(  
    text: string,  
    maxTokens = 2048  
  ): Promise<Page[]> {  
    const chunks = chunkText(text, maxTokens); // your tokenizer  
    const embeddings = await this.embedding.embed(chunks);  
  
    const pages: Page[] = [];  
    let prevPageId: Hash | null = null;  
  
    for (let i = 0; i < chunks.length; i++) {  
      const content = chunks[i];  
      const vector = embeddings[i];  
  
      const embeddingOffset = await this.vectorStore.appendVector(vector);  
      const contentHash = await this.crypto.sha256String(content);  
  
      const vecBytes = vector.buffer.slice(  
        vector.byteOffset,  
        vector.byteOffset + vector.byteLength  
      );  
      const vectorHash = await this.crypto.sha256Bytes(vecBytes);  
  
      const pageId = await this.crypto.sha256String(content);  
      const createdAt = new Date().toISOString();  
  
      const toSign = new TextEncoder().encode(  
        JSON.stringify({ pageId, contentHash, vectorHash, createdAt })  
      );  
  
      const signature = await this.crypto.sign(this.signer, toSign.buffer);  
  
      const page: Page = {  
        pageId,  
        content,  
        embeddingOffset,  
        embeddingDim: this.embedding.dim,  
        contentHash,  
        vectorHash,  
        prevPageId,  
        nextPageId: null,  
        creatorPubKey: this.creatorPubKey,  
        signature,  
        createdAt  
      };  
  
      if (prevPageId && pages.length > 0) {  
        pages[pages.length - 1].nextPageId = pageId;  
      }  
  
      pages.push(page);  
      prevPageId = pageId;  
    }  
  
    return pages;  
  }  
}  
```  
  
## HIPPOCAMPUS ingestion pipeline  
  
Encapsulate the full content → Page → Book → Volume → Shelf pipeline in a service that orchestrates the lower-level stores and vector backend.  
  
```ts  
export interface IngestResult {  
  pages: Page[];  
  books: Book[];  
  volumes: Volume[];  
  shelves: Shelf[];  
}  
  
export class Hippocampus {  
  constructor(  
    private meta MetadataStore,  
    private vectorStore: VectorStore,  
    private embedding: EmbeddingBackend,  
    private vectorBackend: VectorBackend,  
    private crypto: CryptoService  
  ) {}  
  
  async ingestContent(text: string): Promise<IngestResult> {  
    const pages = await this.createPages(text);  
    const protoClusters = await this.formProtoClusters(pages);  
    const books = await this.assembleBooks(protoClusters);  
    const volumes = await this.clusterVolumes(books);  
    const shelves = await this.assignShelves(volumes);  
  
    // persist  
    for (const p of pages) await this.metadata.putPage(p);  
    for (const b of books) await this.metadata.putBook(b);  
    for (const v of volumes) await this.metadata.putVolume(v);  
    for (const s of shelves) await this.metadata.putShelf(s);  
  
    return { pages, books, volumes, shelves };  
  }  
  
  private async createPages(text: string): Promise<Page[]> {  
    // delegate to PageFactory or inline similar logic  
    // (omitted here for brevity)  
    return [];  
  }  
  
  private async formProtoClusters(  
    pages: Page[]  
  ): Promise<Page[][]> {  
    // group pages into temporary clusters via nearest-neighbor  
    // using vectorBackend.topK and similarity thresholds  
    return [pages]; // placeholder  
  }  
  
  private async assembleBooks(  
    clusters: Page[][]  
  ): Promise<Book[]> {  
    // maintain sequential order via prev/next pointers  
    return [];  
  }  
  
  private async clusterVolumes(  
    books: Book[]  
  ): Promise<Volume[]> {  
    // use medoid embeddings in a reduced space (e.g., 128 dim)  
    return [];  
  }  
  
  private async assignShelves(  
    volumes: Volume[]  
  ): Promise<Shelf[]> {  
    // coarse vectors (32–64 dim) for routing prototypes  
    return [];  
  }  
}  
```  
  
## CORTEX query routing  
  
The CORTEX takes a query, embeds it, performs hierarchical routing (Shelf → Volume → Book → Page), and returns ranked pages or snippets.  
  
```ts  
export interface QueryResult {  
  page: Page;  
  score: number;  
  path: {  
    shelfId: Hash;  
    volumeId: Hash;  
    bookId: Hash;  
  };  
}  
  
export class Cortex {  
  constructor(  
    private meta MetadataStore,  
    private vectorStore: VectorStore,  
    private embedding: EmbeddingBackend,  
    private vectorBackend: VectorBackend  
  ) {}  
  
  async query(text: string, k = 10): Promise<QueryResult[]> {  
    const [queryVec] = await this.embedding.embed([text]);  
  
    const candidateShelves = await this.rankShelves(queryVec, 8);  
    const candidateVolumes = await this.rankVolumes(queryVec, candidateShelves, 32);  
    const candidateBooks = await this.rankBooks(queryVec, candidateVolumes, 128);  
    const pages = await this.rankPages(queryVec, candidateBooks, k);  
  
    return pages;  
  }  
  
  private async rankShelves(  
    query: Float32Array,  
    limit: number  
  ): Promise<Shelf[]> {  
    // load shelf routing prototypes, compute cosine similarity, top-k  
    return [];  
  }  
  
  private async rankVolumes(  
    query: Float32Array,  
    shelves: Shelf[],  
    limit: number  
  ): Promise<Volume[]> {  
    return [];  
  }  
  
  private async rankBooks(  
    query: Float32Array,  
    volumes: Volume[],  
    limit: number  
  ): Promise<Book[]> {  
    return [];  
  }  
  
  private async rankPages(  
    query: Float32Array,  
    books: Book[],  
    k: number  
  ): Promise<QueryResult[]> {  
    // fetch candidate pages’ vectors and run top-k similarity  
    return [];  
  }  
}  
```  
  
## Peer routing and entangled exchange  
  
Model peer advertisements and semantic subgraphs as simple DTOs; provide a `PeerRouter` that selects peers and a `GraphExchanger` that merges subgraphs.  
  
```ts  
export interface PeerAdvertisement {  
  peerId: string;  
  shelfPrototypes: {  
    shelfId: Hash;  
    vectorOffset: number;  
    dim: number;  
  }[];  
  volumePrototypes: {  
    volumeId: Hash;  
    vectorOffset: number;  
    dim: number;  
  }[];  
}  
  
export interface SemanticSubgraphPayload {  
  pages: Page[];  
  books: Book[];  
  volumes: Volume[];  
  shelves: Shelf[];  
  edges: Edge[];  
  vectors: {  
    offset: number;  
    dim: number;  
     ArrayBuffer;            // packed Float32s  
  }[];  
  signatures: {  
    entityId: Hash;  
    signature: Signature;  
    creatorPubKey: PublicKey;  
  }[];  
}  
  
export interface PeerTransport {  
  advertise(ad: PeerAdvertisement): Promise<void>;  
  discover(): AsyncIterable<PeerAdvertisement>;  
  send(peerId: string, payload: SemanticSubgraphPayload): Promise<void>;  
  subscribe(  
    handler: (from: string, payload: SemanticSubgraphPayload) => Promise<void>  
  ): void;  
}  
```  
  
Router and exchanger skeletons:  
  
```ts  
export class PeerRouter {  
  constructor(  
    private vectorStore: VectorStore,  
    private vectorBackend: VectorBackend,  
    private transport: PeerTransport  
  ) {}  
  
  async selectPeerForQuery(  
    queryVec: Float32Array,  
    ads: PeerAdvertisement[]  
  ): Promise<PeerAdvertisement | null> {  
    // compute similarity against shelf/volume prototypes and pick highest  
    return null;  
  }  
}  
  
export class GraphExchanger {  
  constructor(  
    private meta MetadataStore,  
    private vectorStore: VectorStore,  
    private crypto: CryptoService  
  ) {}  
  
  async handleIncoming(  
    from: string,  
    payload: SemanticSubgraphPayload  
  ): Promise<void> {  
    // verify all hashes and signatures  
    // optional: recompute embeddings to double-check vectorHash  
    // then merge into local graph and vector store  
  }  
}  
```  
  
## Daydream mode and replay  
  
Implement daydreaming as a background service driven by `requestIdleCallback` or a timer, doing replay, associative walks, and consolidation.  
  
```ts  
type IdleScheduler = (cb: () => void, delayMs?: number) => void;  
  
export class Daydreamer {  
  constructor(  
    private meta MetadataStore,  
    private vectorStore: VectorStore,  
    private vectorBackend: VectorBackend,  
    private schedule: IdleScheduler  
  ) {}  
  
  start(): void {  
    const loop = () => {  
      this.step().finally(() => this.schedule(loop, 1000));  
    };  
    this.schedule(loop, 1000);  
  }  
  
  private async step(): Promise<void> {  
    const book = await this.pickRandomBook();  
    if (!book) return;  
  
    await this.memoryReplay(book);  
    await this.associativeWalk(book);  
    await this.consolidate(book);  
  }  
  
  private async pickRandomBook(): Promise<Book | null> {  
    // implement via random cursor or lightweight index  
    return null;  
  }  
  
  private async memoryReplay(book: Book): Promise<void> {  
    // iterate pages, fetch neighbors via edges, strengthen weights  
  }  
  
  private async associativeWalk(book: Book): Promise<void> {  
    // random walk over neighbors up to medoid  
  }  
  
  private async consolidate(book: Book): Promise<void> {  
    // recompute medoid, possibly split/merge clusters, reassign shelves  
  }  
}  
```  
  
## Hebbian learning over edges  
  
Encapsulate the Hebbian update rule in a small utility or service that operates on `Edge` objects.  
  
```ts  
export interface HebbianParams {  
  decay: number;      // e.g. 0.99  
  increment: number;  // e.g. 0.1  
  minWeight: number;  // prune below  
  maxWeight: number;  // cap strength  
}  
  
export class HebbianUpdater {  
  constructor(  
    private meta MetadataStore,  
    private params: HebbianParams  
  ) {}  
  
  async coActivate(a: Hash, b: Hash): Promise<void> {  
    const now = new Date().toISOString();  
    const edges = await this.metadata.getNeighbors(a);  
    let edge = edges.find(e => e.toPageId === b);  
  
    if (!edge) {  
      edge = {  
        fromPageId: a,  
        toPageId: b,  
        weight: 0,  
        lastUpdatedAt: now  
      };  
    }  
  
    edge.weight = this.params.decay * edge.weight + this.params.increment;  
    edge.weight = Math.min(edge.weight, this.params.maxWeight);  
    if (edge.weight < this.params.minWeight) {  
      edge.weight = 0;  
    }  
    edge.lastUpdatedAt = now;  
  
    await this.metadata.putEdges([edge]);  
  }  
}  
```  
  
## Runtime loop and graceful degradation  
  
Model the node runtime as a cooperative scheduler that dispatches to HIPPOCAMPUS, CORTEX, or Daydreamer based on workload and hardware capability.  
  
```ts  
export interface RuntimeConfig {  
  routingDim: number;  
  replayRate: "low" | "medium" | "high";  
}  
  
export class NodeRuntime {  
  private running = false;  
  
  constructor(  
    private hippocampus: Hippocampus,  
    private cortex: Cortex,  
    private daydreamer: Daydreamer,  
    private contentQueue: AsyncGenerator<string, void, void>,  
    private queryQueue: AsyncGenerator<string, void, void>,  
    private config: RuntimeConfig  
  ) {}  
  
  async start(): Promise<void> {  
    this.running = true;  
    this.daydreamer.start();  
  
    while (this.running) {  
      const { value: content, done: contentDone } =  
        await this.contentQueue.next();  
      if (!contentDone && content) {  
        await this.hippocampus.ingestContent(content);  
        continue;  
      }  
  
      const { value: query, done: queryDone } =  
        await this.queryQueue.next();  
      if (!queryDone && query) {  
        await this.cortex.query(query);  
        continue;  
      }  
  
      // nothing to do; Daydreamer already runs in background  
      await new Promise(r => setTimeout(r, 50));  
    }  
  }  
  
  stop(): void {  
    this.running = false;  
  }  
}  
```  
  
Graceful degradation logic can derive `RuntimeConfig` from detected backend:  
  
```ts  
export function deriveRuntimeConfig(kind: BackendKind): RuntimeConfig {  
  if (kind === "webgpu") {  
    return { routingDim: 128, replayRate: "high" };  
  }  
  if (kind === "webgl") {  
    return { routingDim: 64, replayRate: "medium" };  
  }  
  return { routingDim: 32, replayRate: "low" };  
}  
```  
