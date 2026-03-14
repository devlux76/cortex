# Storage Architecture

This page describes how CORTEX stores vectors and metadata in the browser.

## Vector Storage (OPFS)

- Vectors are stored in an append-only OPFS file for fast writes.
- The OPFS backend is designed to be zero-copy for WebGPU and WebGL consumption.

## Metadata Storage (IndexedDB)

- Metadata (nodes, edges, schema) is stored in IndexedDB.
- IndexedDB is used for fast subgraph retrieval and persistence across sessions.

## Maintenance & Corruption Resistance

CORTEX includes mechanisms to verify cryptographic integrity of stored data and recover from partial failures.
