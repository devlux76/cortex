# Retrieval & Metroid Algorithm

This page explains the retrieval pipeline and the Metroid-based dialectical search mechanism.

## Metroid Overview

A **Metroid** is a structured search primitive: it contains a thesis (`m1`), an antithesis (`m2`), and a frozen centroid (`c`).

- `m1` is the medoid closest to the query.
- `m2` is an opposite medoid found via cosine-opposite medoid search.
- `c` is the frozen centroid between `m1` and `m2`.

## Dialectical Search Zones

From the centroid `c`, the system classifies candidates into three zones:

- **Thesis zone:** closer to `m1` than to `c`.
- **Antithesis zone:** closer to `m2` than to `c`.
- **Synthesis zone:** near `c`, balanced between both poles.

## Matryoshka Dimensional Unwinding

CORTEX uses Matryoshka embeddings with protected dimensions (lower dimensions that anchor domain context). The retrieval algorithm progressively frees dimensions to explore antithesis candidates while keeping the centroid frozen.

## Knowledge Gap Detection

When no suitable `m2` can be found within constraints, the system flags a **knowledge gap** and may broadcast a P2P curiosity request.

> See the **Math Appendix** for the geometric intuition behind why this approach is necessary in high-dimensional spaces.
