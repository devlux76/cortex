# CORTEX Product Surfaces

This document defines the UX contract for CORTEX's product surfaces, the
boundary between the headless library and the standalone browser extension,
and the model-mode behavioural contract.

---

## App-vs-Library Scope

### Library surface (headless, integration-first)

The CORTEX library (`hippocampus/`, `cortex/`, `daydreamer/`, `core/`,
`storage/`, `embeddings/`) has **no UI**. It is a pure TypeScript API:

- `ingestText(...)` — encode content into the memory engine.
- `query(...)` — retrieve the most relevant pages for a text query.
- `ExperienceReplay.run(...)` — idle-time Hebbian reinforcement.
- `ClusterStability.run(...)` — volume split/merge maintenance.

Integrators own the rendering, routing, and user interaction layers. CORTEX
provides only the memory substrate.

### Standalone extension surface

The standalone browser extension wraps the library with a minimal UX shell:

- **Passive capture** — pages visited by the user are automatically ingested.
- **Search** — a query bar lets the user search their indexed history.
- **Revisit** — result cards link back to the original URL.

The extension UI is not part of this repository. This document specifies its
behavioural contract so that future implementations are consistent.

### Non-goals

- No cloud sync, server calls, or telemetry of any kind.
- No user accounts, logins, or identity management.
- No shared memory between users (P2P curiosity probes are opt-in and
  contain only public-interest graph fragments, never raw content or PII).
- No content moderation or filtering at the memory layer.

---

## Privacy Boundaries

| Data                            | Stays local?   | Notes                                      |
|---------------------------------|:--------------:|--------------------------------------------|
| Page content                    | Yes            | Stored in OPFS; never leaves the device.   |
| Embeddings                      | Yes            | Stored in OPFS; never leaves the device.   |
| Hotpath index                   | Yes            | IndexedDB; never leaves the device.        |
| Query text                      | Yes            | Never logged or transmitted.               |
| P2P curiosity probe (opt-in)    | Partial        | Public-interest graph slice only; no PII.  |
| Model weights                   | Fetched once   | Cached locally via `@huggingface/transformers`. |

---

## Standalone Search UX Checklist

### Information architecture

- [ ] Search-first: the default view is a query bar, not a feed.
- [ ] Results appear below the query bar; no separate results page.
- [ ] Lightweight metrics shown inline (e.g. pages indexed, hotpath size).

### Result card contract

Each result card must display:

| Field         | Source                           | Required |
|---------------|----------------------------------|:--------:|
| Title         | `Book.meta.title` or URL         | Yes      |
| URL / source  | `Book.meta.sourceUri`            | Yes      |
| Snippet       | `Page.content` (first 160 chars) | Yes      |
| Visit recency | `PageActivity.lastQueryAt`       | No       |
| Relevance     | `QueryResult.scores[i]`          | No       |

### UX states

| State            | Trigger                                    | Expected UI                                  |
|------------------|--------------------------------------------|----------------------------------------------|
| Empty index      | No pages ingested yet                      | "Nothing indexed yet" empty-state message.   |
| No matches       | Query returns 0 results                    | "No results for '...'" with suggestion text. |
| Loading          | Query or ingest in progress                | Spinner or skeleton cards; no flash of empty.|
| Indexing         | Background ingest running                  | Subtle indicator (badge, progress bar).      |
| Error recovery   | Storage or embedding failure               | Inline error with retry action.              |

---

## Model-Mode UX Contract

CORTEX supports two primary model configurations. The UI must communicate
which capabilities are available in each mode.

### Nomic mode (`nomic-embed-text-v1.5`)

- Supports multimodal recall: text and images share a latent embedding space.
- UI copy: _"Recall text and images from your browsing history."_
- Image thumbnails may appear in result cards.
- Image-recall capability indicator: visible (e.g. camera icon).

### Gemma mode (`embeddinggemma-300m`)

- Text-only embedding; no image embedding support.
- UI copy: _"Recall text from your browsing history."_
- No image thumbnails in result cards.
- Image-recall capability indicator: hidden or greyed out with tooltip
  _"Switch to Nomic mode to enable image recall."_

### UI copy rules

1. Always label the active model by its user-facing name (not the model ID).
2. When image recall is unavailable, say so explicitly — do not silently omit
   image results without explanation.
3. Mode switching requires a re-index confirmation if the embedding dimension
   changes (incompatible embeddings cannot be mixed).

---

## Rabbit-Hole Recall Acceptance Checklist

These manual validation scenarios confirm that CORTEX's associative recall
works correctly in the standalone extension.

### Scenario 1 — Vague text recollection

1. Browse 10+ pages on a common topic (e.g. machine learning).
2. Wait for background ingest to complete.
3. Open the query bar and type a loosely related phrase (e.g. "gradient descent
   thing I read about last week").
4. **Expected:** At least one page from the browsed topic appears in the top 5
   results, even though the query does not contain exact keywords from those pages.

### Scenario 2 — Vague visual recollection (Nomic mode only)

1. Enable Nomic mode.
2. Browse 5+ pages that contain distinctive images.
3. Open the query bar and describe an image vaguely (e.g. "that graph with the
   blue bars I saw yesterday").
4. **Expected:** The page containing the described image appears in the top 5
   results.

### Scenario 3 — Model toggle behaviour

1. Index content in Gemma mode.
2. Switch to Nomic mode in settings.
3. **Expected:** A re-index confirmation dialog appears explaining that
   existing embeddings are incompatible with the new model.
4. After confirming, re-index completes and queries return relevant results.

### Scenario 4 — Capability messaging

1. Set Gemma mode.
2. Open the query bar.
3. **Expected:** No camera / image-recall icon is shown (or it is explicitly
   greyed out with the tooltip _"Switch to Nomic mode to enable image recall."_).
