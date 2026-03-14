# Math Appendix

This appendix contains the mathematical background that motivates several of CORTEX’s key design decisions.

## Curse of Dimensionality

In high-dimensional spaces, the volume of a unit ball collapses rapidly. For even dimension `n = 2m`: 

```
V_n = π^m / m!
```

Stirling’s approximation shows this shrinks exponentially with `n`, meaning nearly all the volume is concentrated near the surface.

## Hypersphere Volume and the Hollow Sphere

CORTEX leverages this “hollow sphere” phenomenon: in high dimensions, the interior of a ball is essentially empty, so nearest-neighbor search can focus on the surface shell.

## Williams 2025 Sublinear Bound

CORTEX applies the result:

```
S = O(√(t · log t))
```

to bound space requirements (hotpath capacity, fanout limits, maintenance budgets) in a way that maintains on-device performance.

## Why This Matters

These mathematical observations drive several design decisions in CORTEX:

- Matryoshka dimension protection (to prevent domain drift)
- Sublinear fanout quotas (to avoid explosion in edge counts)
- The Metroid dialectical search pattern (to avoid confirmation bias in high-D retrieval)

> For full details, see the source code and the other wiki pages.
