# CORTEX Benchmark Baselines

> **Status:** Baseline measurements pending a hardware CI run.
> The values below are illustrative targets; replace with real output from
> `npm run benchmark:all` on representative hardware.

## Williams Bound H(t) — Sublinear Growth Curve

| Graph mass (t) | H(t) = ceil(0.5 * sqrt(t * log2(1+t))) | H(t)/t ratio |
|---------------:|----------------------------------------:|-------------:|
|          1 000 |                                      ~22 |        0.022 |
|         10 000 |                                      ~99 |        0.010 |
|        100 000 |                                     ~408 |        0.004 |
|      1 000 000 |                                   ~1 576 |        0.002 |

Key invariant: H(t)/t strictly decreases as t grows.

---

## Dummy Embedder Hotpath

Run: `npm run benchmark:dummy`

| Benchmark               | Mean latency (ms) | Throughput |
|-------------------------|------------------:|----------:|
| Single short input       |              TBD  |       TBD |
| Batch 16 medium inputs   |              TBD  |       TBD |
| Batch 64 short inputs    |              TBD  |       TBD |

---

## Query Latency vs Corpus Size

Run: `npm run benchmark:query-latency`

| Corpus size | Mean query latency (ms) |
|------------:|------------------------:|
|     100 pages |                   TBD  |
|     500 pages |                   TBD  |

Expected: latency grows sub-linearly because hotpath residents are scored
first and most queries are served without scanning the full corpus.

---

## Storage Overhead

Run: `npm run benchmark:storage-overhead`

| Page count | Vector store size (bytes) | Bytes per page |
|-----------:|--------------------------:|---------------:|
|         50 |                      TBD  |           TBD  |
|        200 |                      TBD  |           TBD  |

Expected: linear growth (no hidden quadratic allocations).

---

## Hotpath Scaling

Run: `npm run benchmark:hotpath-scaling`

| Graph mass | H(t) capacity | Resident count | Promotion sweep (ms) |
|-----------:|--------------:|---------------:|---------------------:|
|      1 000 |           ~22 |           TBD  |                 TBD  |
|      5 000 |           ~55 |           TBD  |                 TBD  |

Invariant: Resident count never exceeds H(t).

---

## How to Update Baselines

1. Run `npm run benchmark:all` on the target hardware.
2. Copy the `mean` column values from the Vitest bench output.
3. Replace every `TBD` cell in this file with the measured value.
4. Commit with message `chore: update benchmark baselines — <hardware>`.
