#!/usr/bin/env node

/**
 * guard-hotpath-policy.mjs
 *
 * Scans all TypeScript source files for numeric literals assigned to hotpath
 * policy fields outside the single allowed source file (core/HotpathPolicy.ts).
 *
 * Rationale: The Williams Bound constant (c), salience weights (alpha, beta,
 * gamma), and tier quota ratios must never be hardcoded elsewhere — they must
 * always be read from DEFAULT_HOTPATH_POLICY or a custom HotpathPolicy object.
 * This guard enforces that convention automatically in CI.
 *
 * Usage:
 *   node scripts/guard-hotpath-policy.mjs
 *
 * Exit code 0 = clean. Exit code 1 = violations found.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const TARGET_EXTENSION = ".ts";

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "tests",
]);

/** The only file(s) allowed to define raw numeric hotpath policy constants. */
const ALLOWED_SOURCE_FILES = new Set([
  "core/HotpathPolicy.ts",
  "lib/core/HotpathPolicy.ts",
]);

/**
 * Field names that must not receive hardcoded numeric literals outside the
 * allowed source file.
 *
 * Matches the HotpathPolicy salience weight fields and the policy type names:
 *   - alpha      (Hebbian connectivity weight in SalienceWeights)
 *   - beta       (recency weight in SalienceWeights)
 *   - gamma      (query-hit frequency weight in SalienceWeights)
 *   - salienceWeights / tierQuotaRatios (top-level policy field names)
 *
 * Note: `c` (Williams Bound scaling factor) and the per-tier quota fields
 * (shelf, volume, book, page) are enforced structurally by TypeScript typing
 * through the HotpathPolicy and TierQuotaRatios interfaces rather than by
 * this guard, because those single words appear ubiquitously as domain
 * identifiers throughout the codebase (e.g. volume.bookIds, book.pageIds).
 */
const HOTPATH_FIELD_PATTERN =
  /\b(salienceWeights|tierQuotaRatios|(?<![a-zA-Z_$])alpha(?![a-zA-Z_$])|(?<![a-zA-Z_$])beta(?![a-zA-Z_$])|(?<![a-zA-Z_$])gamma(?![a-zA-Z_$]))\b/;

const ASSIGNMENT_PATTERN = /[:=]/;
const NUMERIC_LITERAL_PATTERN = /(^|[^\w.])-?\d+(?:\.\d+)?([^\w.]|$)/;

async function collectTypeScriptFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path
      .relative(ROOT, absolutePath)
      .replaceAll(path.sep, "/");

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...(await collectTypeScriptFiles(absolutePath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (
      !relativePath.endsWith(TARGET_EXTENSION) ||
      relativePath.endsWith(".d.ts")
    ) {
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

function hasDisallowedHotpathLiteral(line) {
  if (line.includes("hotpath-policy-ok")) {
    return false;
  }

  return (
    HOTPATH_FIELD_PATTERN.test(line) &&
    ASSIGNMENT_PATTERN.test(line) &&
    NUMERIC_LITERAL_PATTERN.test(line)
  );
}

async function main() {
  const tsFiles = await collectTypeScriptFiles(ROOT);
  const violations = [];

  for (const relativePath of tsFiles) {
    if (ALLOWED_SOURCE_FILES.has(relativePath)) {
      continue;
    }

    const content = await readFile(path.join(ROOT, relativePath), "utf8");
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!hasDisallowedHotpathLiteral(line)) {
        continue;
      }

      violations.push({
        file: relativePath,
        line: i + 1,
        text: line.trim(),
      });
    }
  }

  if (violations.length > 0) {
    globalThis.console.error(
      "guard:hotpath-policy failed. Found hardcoded hotpath policy numeric literals:",
    );
    for (const violation of violations) {
      globalThis.console.error(
        `- ${violation.file}:${violation.line} -> ${violation.text}`,
      );
    }
    process.exit(1);
  }

  globalThis.console.log("guard:hotpath-policy passed.");
}

main().catch((error) => {
  globalThis.console.error("guard:hotpath-policy crashed:", error);
  process.exit(1);
});
