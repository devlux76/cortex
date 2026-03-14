# Ingestion (Hippocampus)

This page describes how CORTEX ingests new observations and integrates them into memory.

## Ingest Path

1. **Chunking/Parsing** — Raw inputs are segmented into pages/blocks.
2. **Embedding** — Each chunk is embedded using a Matryoshka-capable model.
3. **Fast Neighbor Insert** — New vectors are connected into the semantic neighbor graph.
4. **Hierarchical Prototypes** — Pages are organized into Books, Volumes, and Shelves.

## Hierarchy & Promotion

CORTEX manages a hierarchical prototype structure to keep hot (frequently-accessed) concepts in memory while relying on disk-backed storage for the long tail.

> For implementation details, see the code in `hippocampus/` and the `HierachyBuilder` design notes.
