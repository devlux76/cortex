# Architecture Overview

This page describes the high-level architecture of CORTEX and the major subsystems.

## The Three Living Regions

CORTEX models three biological brain regions working in concert:

- **Hippocampus** — Fast associative encoding and incremental prototype construction.
- **Cortex** — Intelligent routing, dialectical retrieval, and coherence.
- **Daydreamer** — Background consolidation and maintenance.

Each region is responsible for a distinct phase of the memory lifecycle. Together they form a pipeline from ingestion through retrieval.

## Core Concepts

### Medoid vs. Centroid vs. Metroid

- **Medoid** — An actual memory node (page) selected as the representative of a cluster.
- **Centroid** — A computed geometric average (never stored as a real node).
- **Metroid** — A transient, structured dialectical search probe (`{ m1, m2, c }`) used at query time.

### How the subsystems interact

1. **Ingestion:** Hippocampus embeds content and creates/update prototypes.
2. **Retrieval:** Cortex constructs Metroids and performs dialectical search for coherent context.
3. **Consolidation:** Daydreamer updates prototypes, prunes edges, and maintains stability.


> For the full algorithmic detail, see **Retrieval & Metroid Algorithm**.
