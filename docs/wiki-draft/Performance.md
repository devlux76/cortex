# Performance Model & Constraints

This page explains the performance budget model and the key formulas that keep CORTEX sublinear.

## Williams Sublinear Bound

CORTEX uses the Williams 2025 result:

> **S = O(√(t · log t))**

This bound is applied to multiple budgets (hotpath index size, hierarchy fanout, neighbor degrees, maintenance batch sizes) to ensure the system stays efficient as the graph grows.

## Hotpath Capacity

The resident hotpath index is capped to a sublinear growth function, often expressed as:

```
H(t) = ⌈c · √(t · log₂(1 + t))⌉
```

## Budgeting & Fanout Limits

The same sublinear law is used for:
- Hierarchy fanout limits
- Semantic neighbor degree caps
- Daydreamer maintenance batch sizing

> See the code in `core/HotpathPolicy.ts` and `hippocampus/HierarchyBuilder.ts` for the concrete implementations.
