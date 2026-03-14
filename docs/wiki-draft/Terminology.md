# Terminology & Numerics

This page collects key terms, model-derived numeric constants, and policy-derived constants.

## Key Terms

- **Medoid** — an existing memory node selected as a cluster representative.
- **Centroid** — a computed average vector (not necessarily a real node).
- **Metroid** — a transient search construct `{ m1, m2, c }` used during retrieval.
- **Hotpath** — the in-memory resident index of active nodes.

## Model-Derived Numerics

These values are derived from the embedding model profile (not hardcoded):
- Embedding dimensionality
- Matryoshka protected dimension boundary
- Query context length limits

## Policy-Derived Constants

Policy constants (e.g. fanout caps, quota ratios) are defined in the code and kept in sync with the design.

> For the authoritative source of policy constants, see `core/Policy.ts` and `core/HotpathPolicy.ts`.
