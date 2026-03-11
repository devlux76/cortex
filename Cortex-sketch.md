CORTEX Architecture Sketch (Integrated with Metroid NN Radius Graph)

Additional Data Model Types

Add the following types to the Data model types section.

export interface MetroidNeighbor {
  neighborPageId: Hash;
  cosineSimilarity: number;   // ≥ threshold (e.g. 0.68)
  distance: number;           // 1 - cosineSimilarity (ready for TSP)
}

export interface MetroidSubgraph {
  nodes: Hash[];
  edges: {
    from: Hash;
    to: Hash;
    distance: number;
  }[];
}

These represent a sparse cosine-radius nearest-neighbor graph stored per page.

Unlike Hebbian edges, which reflect co-activation during use, Metroid edges represent static semantic proximity.

Both graphs coexist and serve different cognitive roles.

⸻

MetadataStore Extensions

Extend the existing MetadataStore interface with the Metroid index methods.

export interface MetadataStore {

  // existing methods unchanged...

  // Metroid NN Radius Index
  putMetroidNeighbors(
    pageId: Hash,
    neighbors: MetroidNeighbor[]
  ): Promise<void>;

  getMetroidNeighbors(
    pageId: Hash,
    maxDegree?: number
  ): Promise<MetroidNeighbor[]>;

  getInducedMetroidSubgraph(
    seedPageIds: Hash[],
    maxHops: number
  ): Promise<MetroidSubgraph>;
}

IndexedDB implementation

Add a new object store:

metroidNeighbors

Key:

pageId

Value:

MetroidNeighbor[] (sorted descending by cosineSimilarity)

Alternatively the data can share the edges store with a flag:

type: "hebbian" | "metroidNN"

Either design works.

⸻

Hippocampus Fast Metroid Neighbor Construction

After persisting a new page during ingestion, build a fast approximate neighbor set.

Inside Hippocampus.ingestContent:

await this.buildFastMetroidNeighbors(
  newPage.pageId,
  newPage.embeddingOffset
);


⸻

Helper: buildFastMetroidNeighbors

Add this method to the Hippocampus class.

private async buildFastMetroidNeighbors(
  pageId: Hash,
  embeddingOffset: number,
  threshold = 0.68,
  maxNeighbors = 40
) {

  const volume = await this.getVolumeForPage(pageId);

  const candidates =
    await this.getCandidatePageIdsInVolumeAndNearby(volume);

  const newVector =
    await this.vectorStore.readVector(embeddingOffset, /*dim*/);

  const candidateVectors =
    await this.vectorStore.readVectors(/*offsets*/);

  const scores =
    await this.vectorBackend.cosineSimilarity(
      newVector,
      candidateVectors
    );

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

  newNeighbors.sort(
    (a, b) => b.cosineSimilarity - a.cosineSimilarity
  );

  newNeighbors.length =
    Math.min(maxNeighbors, newNeighbors.length);

  await this.meta.putMetroidNeighbors(pageId, newNeighbors);

  // reverse updates (maintains bidirectional edges)

  for (const affId of affected) {

    let theirList =
      await this.meta.getMetroidNeighbors(affId) ?? [];

    const score = scores[candidates.indexOf(affId)];

    const newEntry: MetroidNeighbor = {
      neighborPageId: pageId,
      cosineSimilarity: score,
      distance: 1 - score
    };

    const idx =
      theirList.findIndex(n => n.neighborPageId === pageId);

    if (idx >= 0) {
      theirList[idx] = newEntry;
    } else if (score >= threshold) {
      theirList.push(newEntry);
    }

    theirList.sort(
      (a, b) => b.cosineSimilarity - a.cosineSimilarity
    );

    theirList.length =
      Math.min(maxNeighbors, theirList.length);

    await this.meta.putMetroidNeighbors(affId, theirList);
  }

  await this.flagVolumeForMetroidRecalc(volume.volumeId);
}

This keeps ingestion O(1) per page by limiting candidate sets.

⸻

Daydreamer Maintenance

Heavy recalculation is deferred to idle time.

Inside Daydreamer.consolidate(book):

if (await this.meta.needsMetroidRecalc(volume.volumeId)) {

  await this.recalculateFullMetroidNeighborhood(
    volume.volumeId
  );

  await this.meta.clearMetroidRecalcFlag(volume.volumeId);

}


⸻

Full Recalculation Helper

private async recalculateFullMetroidNeighborhood(
  volumeId: Hash
) {

  const allPageIds =
    await /* load pages in volume + nearby shelves */;

  // load all vectors once

  // recompute neighbor sets exactly like
  // buildFastMetroidNeighbors but using
  // the full candidate set

}

This produces the accurate graph occasionally while keeping ingestion fast.

⸻

Query-Time Metroid Jumpstart

The CORTEX query pipeline remains unchanged until the final stage.

After rankPages() returns candidates:

const subgraph =
  await this.meta.getInducedMetroidSubgraph(
    pages.map(p => p.page.pageId),
    2
  );

This builds a small connected component.

Typical size:

10–30 nodes


⸻

Open TSP Path Ordering

Instead of returning unordered top-k results, the system generates a coherent semantic path.

const coherentPath = findOpenTSPPath(subgraph);

Distance values come directly from:

distance = 1 - cosineSimilarity

Which means the graph is already a metric space.

The solver can use:

dummy node trick + greedy 2-opt

to produce a smooth semantic narrative.

⸻

Helper: getInducedMetroidSubgraph

Inside the MetadataStore implementation.

async getInducedMetroidSubgraph(
  seedPageIds: Hash[],
  maxHops: number
): Promise<MetroidSubgraph> {

  // BFS expansion using getMetroidNeighbors

  // gather nodes and edges

}

The resulting graph is tiny and ideal for fast TSP solving.

⸻

Resulting Cognitive Structure

The node now has three complementary memory systems.

System	Role
Hierarchical routing	Fast coarse search
Metroid NN graph	Static semantic geometry
Hebbian graph	Experience-based association

Together they produce something surprisingly brain-like:
	•	hierarchy → cortex
	•	nearest neighbor geometry → semantic field
	•	Hebbian links → episodic association

And the TSP path acts like thought sequencing—turning a cloud of relevant pages into a narrative trajectory.
