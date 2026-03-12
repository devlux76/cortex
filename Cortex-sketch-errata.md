## Execution Note (2026-03-11)

Canonical execution plan: `PROJECT-EXECUTION-PLAN.md`.

Next session highest priority (P0):
1. Perform a full code pass before new feature work.
2. Replace hardcoded model-dependent constants with resolved model metadata values.
3. Keep strict TDD and runtime-lane validation as merge gates.

Errata note:
1. Numeric literals in this addendum are illustrative unless explicitly sourced from model metadata.

Errata / Addendum: Metroid NN Radius Graph (added 11 March 2026 – integrates directly after the existing CORTEX query routing section)
Why this exists
The hierarchical routing already returns strong Metroids (medoids) + top pages. We now add a sparse, cosine-radius nearest-neighbor graph in IndexedDB so Cortex.query() can instantly jumpstart a connected component and hand it to an Open TSP Path solver (dummy-node trick) for a coherent linear ordering instead of a random top-k list.
This keeps ingestion snappy (fast insert + reverse updates on affected nodes) and defers heavy work to Daydreamer.consolidate().
New types (add to Data model types section)
export interface MetroidNeighbor {
  neighborPageId: Hash;
  cosineSimilarity: number;   // ≥ threshold (e.g. 0.68)
  distance: number;           // 1 - cosineSimilarity (ready for TSP)
}

export interface MetroidSubgraph {
  nodes: Hash[];
  edges: { from: Hash; to: Hash; distance: number }[];
}
MetadataStore extension (update the existing interface)
export interface MetadataStore {
  // ... all existing methods unchanged ...

  // 🔥 Metroid NN Radius Index (new object store: "metroidNeighbors")
  putMetroidNeighbors(pageId: Hash, neighbors: MetroidNeighbor[]): Promise;
  getMetroidNeighbors(pageId: Hash, maxDegree?: number): Promise;

  // Helper used by Cortex.query
  getInducedMetroidSubgraph(
    seedPageIds: Hash[],
    maxHops: number
  ): Promise;
}
IndexedDB implementation note: new object store metroidNeighbors (key = pageId, value = MetroidNeighbor[] sorted descending by cosine). Or merge into the existing edges store with a type: 'hebian' | 'metroidNN' flag — either works.
Fast insert (Hippocampus.ingestContent)
Add this call right after persisting the new Page (still inside ingestContent):
// Inside Hippocampus.ingestContent, after the persist loop
await this.buildFastMetroidNeighbors(newPage.pageId, newPage.embeddingOffset);
Helper (add to Hippocampus class):
private async buildFastMetroidNeighbors(
  pageId: Hash,
  embeddingOffset: number,
  threshold = 0.68,
  maxNeighbors = 40
) {
  const volume = await this.getVolumeForPage(pageId); // tiny helper using existing getVolumesByBook
  const candidates = await this.getCandidatePageIdsInVolumeAndNearby(volume);

  const newVector = await this.vectorStore.readVector(embeddingOffset, /*dim*/);
  const candidateVectors = await this.vectorStore.readVectors(/*offsets*/);

  const scores = await this.vectorBackend.cosineSimilarity(newVector, candidateVectors);

  // Build new page’s list
  let newNeighbors: MetroidNeighbor[] = [];
  const affected: Hash[] = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] >= threshold) {
      const neighId = candidates[i];
      if (neighId !== pageId) {
        newNeighbors.push({
          neighborPageId: neighId,
          cosineSimilarity: scores[i],
          distance: 1 - scores[i]
        });
        affected.push(neighId);
      }
    }
  }
  newNeighbors.sort((a, b) => b.cosineSimilarity - a.cosineSimilarity);
  newNeighbors.length = Math.min(maxNeighbors, newNeighbors.length);

  await this.metadata.putMetroidNeighbors(pageId, newNeighbors);

  // Fast reverse updates (exactly like Hebbian putEdges)
  for (const affId of affected) {
    let theirList = await this.metadata.getMetroidNeighbors(affId) ?? [];
    const score = scores[candidates.indexOf(affId)];
    const newEntry: MetroidNeighbor = { neighborPageId: pageId, cosineSimilarity: score, distance: 1 - score };

    const idx = theirList.findIndex(n => n.neighborPageId === pageId);
    if (idx >= 0) theirList[idx] = newEntry;
    else if (score >= threshold) theirList.push(newEntry);

    theirList.sort((a, b) => b.cosineSimilarity - a.cosineSimilarity);
    theirList.length = Math.min(maxNeighbors, theirList.length);

    await this.metadata.putMetroidNeighbors(affId, theirList);
  }

  await this.flagVolumeForMetroidRecalc(volume.volumeId);
}
Background recalculation (Daydreamer)
Inside the existing Daydreamer.consolidate(book) idle loop, add:
if (await this.metadata.needsMetroidRecalc(volume.volumeId)) {
  await this.recalculateFullMetroidNeighborhood(volume.volumeId);
  await this.metadata.clearMetroidRecalcFlag(volume.volumeId);
}
Full recalc helper (runs rarely, only on dirty volumes):
private async recalculateFullMetroidNeighborhood(volumeId: Hash) {
  const allPageIds = await /* get all pages in volume + nearby shelves */;
  // load all vectors once, then for each page rebuild neighbors exactly like buildFast...
  // (same logic, larger candidate set)
}
Query-time jumpstart (Cortex.query)
After the existing ranking pipeline, add:
const subgraph = await this.metadata.getInducedMetroidSubgraph(
  pages.map(p => p.page.pageId),
  2 // maxHops
);

const coherentPath = findOpenTSPPath(subgraph); // dummy-node + greedy 2-opt (can be added later)
Helper: getInducedMetroidSubgraph (in MetadataStore impl)
async getInducedMetroidSubgraph(seedPageIds: Hash[], maxHops: number): Promise {
  // BFS / set expansion using getMetroidNeighbors
  // returns tiny subgraph (< 30 nodes usually)
}
That’s it. Zero breaking changes. Ingestion stays O(1) per page, the Metroid NN graph stays sparse and bidirectional, and Cortex now returns a mathematically coherent path ready for your Open TSP logic.
Paste this entire section at the bottom of Cortex-sketch.md and you’re live.
Want the exact findOpenTSPPath implementation next (with dummy node trick, using your distance field)? Just say the word. Metroids forever. 🚀
