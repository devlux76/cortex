# Storage Architecture

This page describes how CORTEX stores vectors and metadata in the browser.

## Vector Storage (OPFS)

- Vectors are stored in an append-only OPFS file for fast writes.
- The OPFS backend is designed to be zero-copy for WebGPU and WebGL consumption.

## Metadata Storage (IndexedDB)

- Metadata (nodes, edges, schema) is stored in IndexedDB.
- IndexedDB is used for fast subgraph retrieval and persistence across sessions.

## Maintenance & Corruption Resistance

Today, CORTEX relies on the browser’s OPFS and IndexedDB durability guarantees, with limited, optional integrity checks (for example, content-hash verification on incoming peer fragments).

Planned: a broader integrity verification and corruption-detection/recovery flow for OPFS/IndexedDB-backed data, including cryptographic integrity validation of stored payloads and automated remediation of partial failures.
