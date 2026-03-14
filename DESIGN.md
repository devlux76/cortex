# CORTEX Design (Landing Page)

This file is intentionally short. The **full architecture specification and design rationale** lives in the **CORTEX GitHub Wiki**, which is the canonical source for detailed design content.

✅ **Wiki (primary design doc):** https://github.com/devlux76/cortex/wiki

---

## How to use this page

- **If you’re writing an issue or PR:** start with the wiki page that best matches your change.
- **If you’re reviewing a design change:** use this page as a table of contents to find the right wiki section quickly.

---

## Quick start (where to read)

| Topic | Wiki page |
|---|---|
| Architecture overview | [Architecture Overview](https://github.com/devlux76/cortex/wiki/Architecture-Overview) |
| Retrieval & Metroid algorithm | [Retrieval & Metroid Algorithm](https://github.com/devlux76/cortex/wiki/Retrieval-&-Metroid-Algorithm) |
| Ingestion (Hippocampus) | [Ingestion (Hippocampus)](https://github.com/devlux76/cortex/wiki/Ingestion-(Hippocampus)) |
| Consolidation (Daydreamer) | [Consolidation (Daydreamer)](https://github.com/devlux76/cortex/wiki/Consolidation-(Daydreamer)) |
| Storage architecture | [Storage Architecture](https://github.com/devlux76/cortex/wiki/Storage-Architecture) |
| Performance model & constraints | [Performance Model & Constraints](https://github.com/devlux76/cortex/wiki/Performance-Model-&-Constraints) |
| Security & trust | [Security & Trust](https://github.com/devlux76/cortex/wiki/Security-&-Trust) |
| Terminology & numerics | [Terminology + Numerics](https://github.com/devlux76/cortex/wiki/Terminology-+-Numerics) |
| Math appendix | [Math Appendix](https://github.com/devlux76/cortex/wiki/Math-Appendix) |

---

## Quick glossary (for fast reference)

- **Medoid:** an actual memory node used as a cluster representative.
- **Centroid:** a computed average vector (not stored as a node).
- **Metroid:** a transient `{ m1, m2, c }` structure used in retrieval.

> Note: Most detailed definitions and rationale are in the wiki pages above.

