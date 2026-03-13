# ERRATA

## Williams Bound - Comprehensive Hotpath Architecture

### TL;DR

Apply the Williams 2025 result S = O(sqrt(t log t)) as a universal sublinear growth law everywhere the system trades space against time: the resident hotpath index, per-tier hierarchy quotas, per-community graph budgets, and Daydreamer maintenance batch sizing. Define t = |V| + |E| (total graph mass). Derive the resident representative capacity H(t) = ceil(c * sqrt(t * log2(1 + t))). Hebbian-derived node salience drives promotion and eviction, but representative selection also enforces hierarchical tier quotas and graph-community coverage quotas so the hotpath is both hot and diverse.

---

### Phase A - Theoretical Foundation

#### A1. Formalize the theorem mapping

- Define t = |V| + |E| (pages + Hebbian edges + Metroid edges).
- Define H(t) = ceil(c * sqrt(t * log2(1 + t))), the resident hotpath capacity.
- State the design principle: every subsystem that can trade space for time must target sublinear growth at this rate.
- List what counts toward resident capacity: promoted pages, tier prototypes, and active Metroid neighbor entries.
- Define the three-zone model:
  - HOT: resident index, capacity H(t)
  - WARM: indexed in IndexedDB but not memory-resident
  - COLD: vector bytes in OPFS, metadata in IndexedDB, no index entry
- Note that all data stays local; zones affect lookup cost, not retention.
- Reference Williams 2025 as the source and state that c is an empirically tuned constant, not a theorem output.

#### A2. Define node salience

The current schema has edge-level Hebbian weights but no node-level score. Define node salience sigma(v) for a page v:

sigma(v) = alpha * H_in(v) + beta * R(v) + gamma * Q(v)

Where:

- H_in(v) = sum of incident Hebbian edge weights
- R(v) = recency score using exponential decay from createdAt or lastUpdatedAt
- Q(v) = query-hit count for the node
- alpha, beta, gamma are tunable weights summing to 1.0

This requires lightweight per-page activity metadata such as queryHitCount and lastQueryAt.

#### A3. Define hierarchical tier quotas

Partition H(t) across the 4-level hierarchy so no single tier monopolizes the hotpath:

- Shelf quota: q_s * H(t), example q_s = 0.10 for routing prototypes
- Volume quota: q_v * H(t), example q_v = 0.20 for cluster prototypes
- Book quota: q_b * H(t), example q_b = 0.20 for book medoids
- Page quota: q_p * H(t), example q_p = 0.50 for individual page representatives

Subject to:

q_s + q_v + q_b + q_p = 1.0

Each quota tier holds the highest-salience representatives of that tier's entities. Shelf, Volume, and Book representatives are selected by medoid statistic within their cluster and then ranked by salience for admission.

#### A4. Define graph-community coverage quotas

Within each tier's budget, allocate slots proportionally across detected communities so one dense topic cannot consume all capacity. Community detection uses the existing Metroid neighbor graph through connected components or lightweight label propagation during Daydreamer idle passes.

For community C_i with n_i pages out of N total:

community_quota(C_i) = max(1, ceil(tier_budget * n_i / N))

This dual constraint, tier plus community, ensures both vertical coverage across hierarchy levels and horizontal coverage across topics.

---

### Phase B - Core Policy Module

#### B1. Create core/HotpathPolicy.ts

This becomes the central source of truth. It should export:

- computeCapacity(graphMass: number): number
- computeSalience(hebbianIn: number, recency: number, queryHits: number, weights?): number
- deriveTierQuotas(capacity: number, quotaRatios?): TierQuotas
- deriveCommunityQuotas(tierBudget: number, communitySizes: number[]): number[]

All numeric constants such as c, alpha, beta, gamma, q_s, q_v, q_b, and q_p should live here as a frozen default policy object, analogous to the existing routing-policy and model-derivation defaults.

#### B2. Add tests for HotpathPolicy

Write tests first for:

- H(t) grows sublinearly
- H(t) is monotonically non-decreasing
- Tier quotas sum to capacity
- Community quotas sum to tier budget and each remain at least 1
- Salience is deterministic for the same inputs

#### B3. Extend core/types.ts

Add:

- PageActivity interface with queryHitCount and lastQueryAt
- HotpathEntry interface with entityId, tier, salience, and optional communityId
- MetadataStore hotpath methods such as putHotpathEntry, getHotpathEntries, evictWeakest, and getResidentCount

#### B4. Extend storage/IndexedDbMetadataStore.ts

Add:

- hotpath_index object store keyed by entityId
- page_activity object store or equivalent page metadata extension
- persistence methods for the new hotpath interfaces
- storage tests covering hotpath persistence and resident counts

---

### Phase C - Salience Engine and Promotion Lifecycle

#### C1. Create core/SalienceEngine.ts

Add helpers such as:

- computeNodeSalience(pageId, metadataStore)
- batchComputeSalience(pageIds, metadataStore)
- shouldPromote(candidateSalience, weakestResidentSalience, capacityRemaining)
- selectEvictionTarget(tier, communityId, metadataStore)

#### C2. Promotion and eviction lifecycle

Bootstrap phase:

- While hotpath size is below H(t), admit the highest-salience node not yet resident.

Steady-state phase:

- When a new or updated node has salience greater than the weakest resident in its tier and community bucket, evict the weakest and promote the candidate.
- Break ties by recency.

Trigger points:

- On ingest: newly ingested pages become candidates
- On query: queryHitCount increases and salience is recomputed
- On Daydreamer pass: after LTP or LTD, recompute salience and run a promotion sweep

#### C3. Add tests for promotion and eviction

- Promotion during bootstrap fills to H(t)
- Promotion in steady state evicts the weakest resident
- Community quotas prevent topic collapse
- Tier quotas prevent one hierarchy level from dominating
- Eviction is deterministic under the same state

---

### Phase D - Hierarchical Quota Integration

#### D1. Upgrade hippocampus/HierarchyBuilder.ts

After building Books, Volumes, and Shelves, compute the medoid or prototype for each and attempt hotpath admission:

- Book medoid -> page-tier quota
- Volume prototypes -> volume-tier quota
- Shelf routing prototypes -> shelf-tier quota

If a tier is full, evict the weakest-salience entry in that tier.

#### D2. Upgrade cortex/Ranking.ts

The ranking cascade should search the resident hotpath first:

- Hot shelves first
- Then hot volumes
- Then hot books
- Then hot pages

Only spill to warm or cold lookup when resident coverage is insufficient. This makes H(t) the primary latency-control mechanism.

#### D3. Apply the bound to per-level fanout

Max children per hierarchy node should also respect a Williams-derived limit:

- Max volumes per shelf: O(sqrt(|volumes| * log |volumes|))
- Max books per volume: O(sqrt(|books_in_volume| * log |books_in_volume|))

When exceeded, trigger a split through HierarchyBuilder or ClusterStability.

---

### Phase E - Graph-Community Quota Integration

#### E1. Add community detection to Daydreamer

Use lightweight label propagation on the Metroid neighbor graph during idle passes. Store community labels in page activity metadata or a dedicated community-label store. Rerun when dirty-volume flags indicate meaningful structural change.

#### E2. Wire community labels into promotion

- If a community has remaining quota, promote freely.
- If a community is at quota, the candidate must beat the weakest resident in that community.
- If the community is unknown, place the node into a temporary pending pool that borrows from the page-tier budget.

#### E3. Add community-aware eviction tests

- Dense communities do not consume all slots
- New communities get at least one slot
- Empty communities release their slots

---

### Phase F - Metroid Maintenance Under the Bound

#### F1. Upgrade hippocampus/FastMetroidInsert.ts

- Derive max neighbors per page from H(t) or a related hotpath policy constant instead of hardcoded K
- If a page is already at max degree, evict the neighbor with the lowest Hebbian edge weight
- After insertion, check whether the new page qualifies for hotpath admission

#### F2. Upgrade daydreamer/FullMetroidRecalc.ts

- Bound dirty-volume recalc batch size by an H(t)-derived maintenance budget
- Process at most O(sqrt(t log t)) pairwise comparisons per idle cycle
- Prioritize dirtiest volumes first
- Recompute salience for affected nodes and run a promotion sweep after recalculation

#### F3. Upgrade daydreamer/HebbianUpdater.ts

- After LTP or LTD, recompute sigma(v) for all nodes whose incident edges changed
- Run a promotion and eviction sweep for changed nodes
- Prune edges whose weight falls below threshold while keeping Metroid degree within bounds

#### F4. Upgrade daydreamer/PrototypeRecomputer.ts

- After recomputing volume or shelf prototypes, recompute salience for affected representative entries
- Run tier-quota promotion or eviction for volume and shelf tiers

---

### Phase G - Retrieval Path Under the Bound

#### G1. Upgrade cortex/Query.ts

Full query flow:

1. Embed query
2. Score against resident shelf prototypes
3. Score against resident volume prototypes within top shelves
4. Score against resident book medoids within top volumes
5. Score against resident pages within top books
6. Expand subgraph via getInducedMetroidSubgraph(seeds, maxHops)
7. Solve coherent path via OpenTSPSolver
8. Return result with provenance

The key constraint is that steps 2 through 5 operate on the resident set of size H(t), not the full corpus. Step 6 may touch warm or cold storage but remains bounded by maxHops and degree limits derived from the same policy.

Add a query cost meter that counts vector operations. If cost exceeds a Williams-derived budget, early-stop and return best-so-far.

#### G2. Apply the bound to subgraph expansion

Replace the fixed <30 node target with a dynamic bound:

- maxSubgraphSize = min(30, floor(sqrt(t * log2(1 + t)) / log2(t)))
- maxHops = ceil(log2(log2(1 + t)))
- perHopBranching = floor(maxSubgraphSize^(1 / maxHops))

These formulas shrink gracefully as the graph grows and keep expansion cost sublinear.

---

### Phase H - Verification and Benchmarks

#### H1. Unit tests per phase

- HotpathPolicy tests for capacity, quotas, and salience
- SalienceEngine tests for promotion, eviction, and determinism
- Hierarchy quota tests for tier budgets, fanout bounds, and spill behavior
- Community quota tests for label propagation, proportional allocation, and minimum guarantees
- Metroid tests for bounded degree and maintenance batch limits
- Query tests for cost metering and subgraph size bounds

#### H2. Scaling benchmarks

Add tests/benchmarks/HotpathScaling.bench.ts with synthetic graphs at 1K, 10K, 100K, and 1M node-plus-edge counts.

Measure:

- resident set size vs H(t)
- query latency vs corpus size
- promotion and eviction throughput

Assert:

- resident count never exceeds H(t)
- query cost scales sublinearly

#### H3. Guard extension

Treat c and the quota ratios as policy-derived, not model-derived. Keep them in core/HotpathPolicy.ts and consider adding a separate guard or lint rule to prevent hotpath constants from being hardcoded elsewhere.

#### H4. CI gate commands

- npm run guard:model-derived
- npm run build
- npm run lint
- npm run test:unit
- npm run benchmark
- npm run test:browser
- npm run test:electron

---

### Relevant Files

- DESIGN.md for theorem mapping, three-zone model, salience, quotas, fanout, and subgraph bounds
- PLAN.md for rescoping Hippocampus, Cortex, and Daydreamer around the hotpath lifecycle
- TODO.md for concrete tasks covering HotpathPolicy, SalienceEngine, community detection, and upgrades to ingest, retrieval, and maintenance
- core/types.ts for PageActivity, HotpathEntry, and MetadataStore hotpath methods
- core/HotpathPolicy.ts for central hotpath policy
- core/SalienceEngine.ts for per-node salience and promotion logic
- storage/IndexedDbMetadataStore.ts for hotpath persistence and resident metadata
- Policy.ts for interaction points with routing policy
- core/ModelDefaults.ts remains unchanged and separate from hotpath policy
- hippocampus/FastMetroidInsert.ts for bounded degree and hotpath admission
- hippocampus/HierarchyBuilder.ts for medoid admission and fanout bounds
- cortex/Query.ts for resident-first retrieval and dynamic query limits
- cortex/Ranking.ts for hot, warm, and cold spill logic
- daydreamer/HebbianUpdater.ts for post-LTP or LTD salience recomputation and promotion sweeps
- daydreamer/FullMetroidRecalc.ts for bounded maintenance batches and salience-aware recalculation
- daydreamer/PrototypeRecomputer.ts for tier-quota promotion after prototype updates
- daydreamer/ClusterStability.ts for community detection and split or merge triggers
- tests/Persistence.test.ts for hotpath persistence and bounded graph behavior
- tests/benchmarks/HotpathScaling.bench.ts for scaling validation

---

### Decisions

- t = |V| + |E| (pages + all edge types)
- H(t) = ceil(c * sqrt(t * log2(1 + t)))
- c is empirically tuned, not theorem-given
- sigma(v) = alpha * H_in(v) + beta * R(v) + gamma * Q(v)
- Default salience weights: alpha = 0.5, beta = 0.3, gamma = 0.2
- Tier quotas: Shelf 10%, Volume 20%, Book 20%, Page 50%
- Community quotas: proportional to community size with a minimum of 1 slot
- Bootstrap rule: fill the hotpath greedily by salience until H(t)
- Steady-state rule: promote only if candidate salience exceeds the weakest resident in the same tier and community bucket
- Preserve the existing 4-level hierarchy, but bound fanout using Williams-derived limits and trigger split or merge through ClusterStability
- Keep model-derived numerics entirely separate from hotpath policy
- Apply the bound wherever space-time tradeoffs exist: resident index size, per-tier fanout, subgraph expansion, Metroid degree, and Daydreamer batch size

---

### Dependency Graph

A1 theorem docs
A2 salience definition
A3 tier quotas
A4 community quotas
  -> B1 HotpathPolicy
  -> B2 HotpathPolicy tests
  -> B3 core types extension
  -> B4 IndexedDB extension
  -> C1 SalienceEngine
  -> C2 promotion lifecycle
  -> C3 promotion tests
  -> D1-D3 hierarchy integration
  -> E1-E3 community integration
  -> F1-F4 Metroid maintenance integration
  -> G1-G2 retrieval integration
  -> H1-H4 verification and benchmarks

D, E, and F can proceed in parallel once the policy and salience foundations are in place. Retrieval depends on hierarchy and community integration. Verification runs continuously.
