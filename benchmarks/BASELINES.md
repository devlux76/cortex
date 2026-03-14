# CORTEX Benchmark Baselines

> **Status:** Baseline measurements recorded on GitHub Actions `ubuntu-latest` runner
> (2 vCPU, 7 GB RAM, no GPU). Re-run `npm run benchmark:all` on representative
> hardware and update the tables below.

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

| Benchmark               | Mean latency (ms) | Throughput (ops/s) |
|-------------------------|------------------:|-----------------:|
| Single short input       |              1.15 |           870.66 |
| Batch 16 medium inputs   |              7.10 |           140.78 |
| Batch 64 short inputs    |             26.32 |            37.99 |

---

## TransformersJs Embedding Throughput

Run: `npm run benchmark:all` (TransformersJsEmbedding suite)

> Values below are from the deterministic dummy proxy backend.
> Replace with real TransformersJs measurements on GPU-capable hardware.

| Batch size | Mean latency (ms) | Throughput (ops/s) |
|-----------:|------------------:|-----------------:|
|          1 |               TBD |              TBD |
|          8 |               TBD |              TBD |
|         32 |               TBD |              TBD |
|        128 |               TBD |              TBD |

---

## Query Latency vs Corpus Size

Run: `npm run benchmark:query-latency`

| Corpus size | Mean query latency (ms) |
|------------:|------------------------:|
|   100 pages |                   20.16 |
|   500 pages |                  369.45 |

Expected: latency grows sub-linearly because hotpath residents are scored
first and most queries are served without scanning the full corpus.

---

## Storage Overhead

Run: `npm run benchmark:storage-overhead`

| Page count | Read latency (ms) | Throughput (ops/s) |
|-----------:|-------------------:|-------------------:|
|         50 |             0.0014 |           732 003  |
|        200 |             0.0015 |           675 479  |

Expected: linear growth (no hidden quadratic allocations).

---

## Hotpath Scaling

Run: `npm run benchmark:hotpath-scaling`

| Graph mass | H(t) capacity | Promotion sweep (ms) |
|-----------:|--------------:|---------------------:|
|      1 000 |           ~22 |                 0.09 |
|      5 000 |           ~55 |                 0.12 |

Invariant: Resident count never exceeds H(t).

---

## How to Update Baselines

1. Run `npm run benchmark:all` on the target hardware.
2. Copy the `mean` column values from the Vitest bench output.
3. Replace the measured cells in this file with the new values.
4. Commit with message `chore: update benchmark baselines — <hardware>`.
