#!/usr/bin/env node

/**
 * sync-github-project.mjs
 *
 * Reads PLAN.md and TODO.md and creates the corresponding GitHub structure:
 *   - Milestones  (one per release phase, sourced from PLAN.md)
 *   - Labels      (priority P0–P3 and layer labels)
 *   - Issues      (one per ### task-group in TODO.md)
 *
 * Re-run safe: existing milestones, labels, and issues with matching titles
 * are detected and skipped. Completed groups (✅ COMPLETE) are created and
 * immediately closed.
 *
 * Usage:
 *   node scripts/sync-github-project.mjs [--dry-run]
 *
 *   --dry-run   Print every action that would be taken; make no API calls.
 *
 * Prerequisites:
 *   gh CLI installed and authenticated (run: gh auth status)
 */

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Milestone definitions — derived from the four phases in PLAN.md
// ---------------------------------------------------------------------------

const MILESTONES = [
  {
    phaseEmoji: "🚨",
    title: "v0.1 — Minimal Viable",
    description:
      "Critical path: enable ingest and retrieval for a single user session. " +
      "Exit criteria: user can call ingestText() and query() end-to-end.",
  },
  {
    phaseEmoji: "🟡",
    title: "v0.5 — Hierarchical + Coherent",
    description:
      "Add hierarchical routing and coherent path ordering. " +
      "Exit criteria: queries return ordered context chains, not just ranked pages.",
  },
  {
    phaseEmoji: "🟢",
    title: "v1.0 — Background Consolidation",
    description:
      "Idle background maintenance keeps memory healthy. " +
      "Exit criteria: system self-maintains over extended use without manual intervention.",
  },
  {
    phaseEmoji: "🔵",
    title: "v1.0 — Polish & Ship",
    description:
      "Improve quality, performance, and developer experience. " +
      "Exit criteria: all tests pass; benchmarks recorded; docs complete; ready for public use.",
  },
];

// ---------------------------------------------------------------------------
// Label definitions
// ---------------------------------------------------------------------------

const PRIORITY_LABELS = [
  { name: "P0: critical", color: "D73A4A", description: "Critical path — blocks all dependent work" },
  { name: "P1: high", color: "E4E669", description: "High priority — targets v0.5" },
  { name: "P2: medium", color: "0075CA", description: "Medium priority — targets v1.0" },
  { name: "P3: low", color: "CFE2F3", description: "Lower priority — polish and release prep" },
];

const LAYER_LABELS = [
  { name: "layer: foundation",   color: "F9D0C4", description: "Core types, model profiles, crypto" },
  { name: "layer: storage",      color: "FEF2C0", description: "OPFS vector store and IndexedDB metadata store" },
  { name: "layer: compute",      color: "C2E0C6", description: "WebGPU / WebGL / WebNN / WASM vector backends" },
  { name: "layer: embeddings",   color: "FBCA04", description: "Embedding providers and resolver" },
  { name: "layer: hippocampus",  color: "5319E7", description: "Ingest orchestration (chunk → embed → persist)" },
  { name: "layer: cortex",       color: "1D76DB", description: "Retrieval orchestration (rank → expand → order)" },
  { name: "layer: daydreamer",   color: "0E8A16", description: "Background consolidation (LTP/LTD, recalc)" },
  { name: "layer: testing",      color: "C5DEF5", description: "Test coverage and integration tests" },
  { name: "layer: ci",           color: "BFD4F2", description: "CI/CD pipeline and build tooling" },
  { name: "layer: documentation",color: "BFDADC", description: "API docs, developer guide, architecture diagrams" },
];

const ALL_LABELS = [...PRIORITY_LABELS, ...LAYER_LABELS];

// ---------------------------------------------------------------------------
// TODO.md parser
// ---------------------------------------------------------------------------

/**
 * @typedef {{ header: string, bodyLines: string[], isComplete: boolean }} IssueGroup
 * @typedef {{ header: string, phaseEmoji: string, groups: IssueGroup[] }} Phase
 */

/**
 * Parse TODO.md into phases and task groups.
 * @param {string} content
 * @returns {Phase[]}
 */
function parseTodoMd(content) {
  const lines = content.split(/\r?\n/);
  /** @type {Phase[]} */
  const phases = [];
  /** @type {Phase | null} */
  let currentPhase = null;
  /** @type {IssueGroup | null} */
  let currentGroup = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const header = line.slice(3).trim();
      const emojiMatch = header.match(/^(\p{Emoji})/u);
      currentPhase = {
        header,
        phaseEmoji: emojiMatch ? emojiMatch[1] : "",
        groups: [],
      };
      phases.push(currentPhase);
      currentGroup = null;
    } else if (line.startsWith("### ") && currentPhase) {
      const header = line.slice(4).trim();
      currentGroup = {
        header,
        bodyLines: [],
        isComplete: header.includes("✅ COMPLETE"),
      };
      currentPhase.groups.push(currentGroup);
    } else if (line === "---") {
      currentGroup = null;
    } else if (currentGroup) {
      currentGroup.bodyLines.push(line);
    }
  }

  return phases;
}

// ---------------------------------------------------------------------------
// Label inference helpers
// ---------------------------------------------------------------------------

const LAYER_KEYWORD_MAP = /** @type {[string, string[]][]} */ ([
  ["layer: hippocampus",  ["hippocampus", "Hippocampus", "Chunker", "Ingest", "PageBuilder", "FastMetroid", "HierarchyBuilder"]],
  ["layer: cortex",       ["cortex/", "Ranking.ts", "Query.ts", "OpenTSPSolver", "QueryResult", "SeedSelection"]],
  ["layer: daydreamer",   ["daydreamer", "Daydreamer", "IdleScheduler", "HebbianUpdater", "FullMetroidRecalc", "PrototypeRecomputer", "ExperienceReplay", "ClusterStability"]],
  ["layer: embeddings",   ["embeddings/", "EmbeddingBackend", "OrtWebgl", "TransformersJs", "ProviderResolver"]],
  ["layer: testing",      ["tests/integration", "tests/benchmarks", "Integration", "Benchmark", "bench.ts"]],
  ["layer: ci",           ["CI", "GitHub Actions", ".github/workflows", "guard-model-derived", "ci.yml"]],
  ["layer: documentation",["docs/", "documentation", "API reference", "architecture diagram"]],
]);

/**
 * Infer layer labels from a group's header and body.
 * @param {string} header
 * @param {string[]} bodyLines
 * @returns {string[]}
 */
function inferLayerLabels(header, bodyLines) {
  const haystack = [header, ...bodyLines].join("\n");
  const found = [];
  for (const [label, keywords] of LAYER_KEYWORD_MAP) {
    if (keywords.some((kw) => haystack.includes(kw))) {
      found.push(label);
    }
  }
  return found;
}

/**
 * Infer priority label from a group's header prefix (P0-X, P1-X …).
 * @param {string} header
 * @returns {string | null}
 */
function inferPriorityLabel(header) {
  const m = header.match(/^P([0-3])-/);
  if (!m) {
    return null;
  }
  const map = { 0: "P0: critical", 1: "P1: high", 2: "P2: medium", 3: "P3: low" };
  return map[m[1]] ?? null;
}

/**
 * Map a phase's emoji to the matching milestone title.
 * @param {string} emoji
 * @returns {string | null}
 */
function phaseEmojiToMilestone(emoji) {
  const m = MILESTONES.find((ms) => ms.phaseEmoji === emoji);
  return m ? m.title : null;
}

// ---------------------------------------------------------------------------
// GitHub API helpers (uses `gh auth token` for auth, native fetch for calls)
// ---------------------------------------------------------------------------

/** @returns {Promise<string>} */
async function getGitHubToken() {
  const { stdout } = await execFileAsync("gh", ["auth", "token"]);
  return stdout.trim();
}

/**
 * @returns {Promise<{ owner: string, repo: string }>}
 */
async function getRepoIdentity() {
  const { stdout } = await execFileAsync("gh", [
    "repo", "view", "--json", "name,owner",
  ]);
  const { name, owner } = JSON.parse(stdout);
  return { owner: owner.login, repo: name };
}

/**
 * Fetch all pages of a GitHub API endpoint (link-header pagination).
 * @param {string} token
 * @param {string} url
 * @returns {Promise<unknown[]>}
 */
async function fetchAllPages(token, url) {
  const results = [];
  let nextUrl = url;

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GET ${nextUrl} → ${res.status}: ${body}`);
    }

    const page = await res.json();
    results.push(...page);

    const link = res.headers.get("link") ?? "";
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    // null signals the end of pagination
    nextUrl = match ? match[1] : null;
  }

  return results;
}

/**
 * Call GitHub REST API with a JSON body.
 * @param {string} token
 * @param {"POST"|"PATCH"|"DELETE"} method
 * @param {string} url
 * @param {object} [body]
 * @returns {Promise<unknown>}
 */
async function githubApi(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

/**
 * Create any milestones from MILESTONES that do not yet exist.
 * Returns a map of milestone title → milestone number.
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<Map<string, number>>}
 */
async function syncMilestones(token, owner, repo) {
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  /** @type {Array<{ title: string, number: number }>} */
  const existing = /** @type {any[]} */ (
    await fetchAllPages(token, `${base}/milestones?state=all&per_page=100`)
  );

  const existingTitles = new Map(existing.map((m) => [m.title, m.number]));
  const milestoneMap = new Map(existingTitles);

  for (const ms of MILESTONES) {
    if (existingTitles.has(ms.title)) {
      globalThis.console.log(`  ⏭  Milestone already exists: "${ms.title}"`);
      continue;
    }

    globalThis.console.log(`  ➕ Creating milestone: "${ms.title}"`);
    if (!DRY_RUN) {
      const created = /** @type {{ number: number }} */ (
        await githubApi(token, "POST", `${base}/milestones`, {
          title: ms.title,
          description: ms.description,
          state: "open",
        })
      );
      milestoneMap.set(ms.title, created.number);
    } else {
      milestoneMap.set(ms.title, -1);
    }
  }

  return milestoneMap;
}

/**
 * Create any labels in ALL_LABELS that do not yet exist.
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 */
async function syncLabels(token, owner, repo) {
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  /** @type {Array<{ name: string }>} */
  const existing = /** @type {any[]} */ (
    await fetchAllPages(token, `${base}/labels?per_page=100`)
  );

  const existingNames = new Set(existing.map((l) => l.name));

  for (const label of ALL_LABELS) {
    if (existingNames.has(label.name)) {
      globalThis.console.log(`  ⏭  Label already exists: "${label.name}"`);
      continue;
    }

    globalThis.console.log(`  ➕ Creating label: "${label.name}"`);
    if (!DRY_RUN) {
      await githubApi(token, "POST", `${base}/labels`, {
        name: label.name,
        color: label.color,
        description: label.description,
      });
    }
  }
}

/**
 * Create GitHub issues for every task group in the parsed phases.
 * Already-existing issues (same title) are skipped. Completed groups are
 * created then immediately closed.
 *
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {Phase[]} phases
 * @param {Map<string, number>} milestoneMap
 */
async function syncIssues(token, owner, repo, phases, milestoneMap) {
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  /** @type {Array<{ title: string, number: number, state: string }>} */
  const existingIssues = /** @type {any[]} */ (
    await fetchAllPages(token, `${base}/issues?state=all&per_page=100`)
  );

  const existingTitles = new Set(existingIssues.map((i) => i.title));

  for (const phase of phases) {
    if (phase.groups.length === 0) {
      continue;
    }

    const milestoneName = phaseEmojiToMilestone(phase.phaseEmoji);
    const milestoneNumber = milestoneName ? milestoneMap.get(milestoneName) : null;

    for (const group of phase.groups) {
      const title = group.header.replace(/\s*✅\s*COMPLETE\s*/g, "").trim();

      if (existingTitles.has(title)) {
        globalThis.console.log(`  ⏭  Issue already exists: "${title}"`);
        continue;
      }

      // Build issue body: preserve the markdown content as-is
      const body = group.bodyLines.join("\n").trim();
      const priorityLabel = inferPriorityLabel(title);
      const layerLabels = inferLayerLabels(title, group.bodyLines);
      const labels = [priorityLabel, ...layerLabels].filter(Boolean);

      globalThis.console.log(`  ➕ Creating issue: "${title}"`);
      if (labels.length > 0) {
        globalThis.console.log(`     Labels: ${labels.join(", ")}`);
      }
      if (milestoneName) {
        globalThis.console.log(`     Milestone: ${milestoneName}`);
      }

      if (!DRY_RUN) {
        /** @type {{ number: number }} */
        const created = /** @type {any} */ (
          await githubApi(token, "POST", `${base}/issues`, {
            title,
            body,
            labels,
            ...(milestoneNumber != null && milestoneNumber !== -1
              ? { milestone: milestoneNumber }
              : {}),
          })
        );

        if (group.isComplete) {
          await githubApi(token, "PATCH", `${base}/issues/${created.number}`, {
            state: "closed",
            state_reason: "completed",
          });
          globalThis.console.log(`     Closed (already complete)`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (DRY_RUN) {
    globalThis.console.log("🔍 Dry-run mode — no changes will be made.\n");
  }

  // Verify gh CLI is available
  try {
    await execFileAsync("gh", ["auth", "status"]);
  } catch {
    globalThis.console.error(
      "❌ gh CLI is not authenticated. Run: gh auth login",
    );
    process.exit(1);
  }

  const token = await getGitHubToken();
  const { owner, repo } = await getRepoIdentity();
  globalThis.console.log(`\nRepository: ${owner}/${repo}\n`);

  // Parse TODO.md
  const todoPath = path.join(ROOT, "TODO.md");
  const todoContent = await readFile(todoPath, "utf8");
  const phases = parseTodoMd(todoContent);

  const totalGroups = phases.reduce((n, p) => n + p.groups.length, 0);
  globalThis.console.log(`Parsed TODO.md: ${phases.length} phases, ${totalGroups} task groups\n`);

  // 1. Milestones
  globalThis.console.log("── Milestones ──────────────────────────────────────────────");
  const milestoneMap = await syncMilestones(token, owner, repo);

  // 2. Labels
  globalThis.console.log("\n── Labels ──────────────────────────────────────────────────");
  await syncLabels(token, owner, repo);

  // 3. Issues
  globalThis.console.log("\n── Issues ──────────────────────────────────────────────────");
  await syncIssues(token, owner, repo, phases, milestoneMap);

  globalThis.console.log(
    DRY_RUN
      ? "\n✅ Dry-run complete. Re-run without --dry-run to apply changes."
      : "\n✅ Sync complete.",
  );
}

main().catch((error) => {
  globalThis.console.error("sync-github-project crashed:", error);
  process.exit(1);
});
