# Consolidation (Daydreamer)

This page covers background consolidation and maintenance mechanisms.

## Daydreamer Responsibilities

- **Long-term potentiation (LTP):** strengthen important connections.
- **Long-term depression (LTD):** decay and prune weak edges.
- **Medoid/centroid recomputation:** keep prototypes coherent as the graph evolves.
- **Experience replay:** rehearse recent data in background when idle.

## Stability & Throttling

The Daydreamer is designed to run opportunistically without blocking foreground query performance. Its work is throttled and batch-sized according to the current memory graph complexity.
