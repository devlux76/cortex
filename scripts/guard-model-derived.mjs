#!/usr/bin/env bun

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

const ALLOWED_SOURCE_FILES = new Set([
  "core/ModelDefaults.ts",
  "core/BuiltInModelProfiles.ts",
]);

const MODEL_FIELD_PATTERN =
  /\b(embeddingDim(?:ension)?|contextWindowTokens|maxInputTokens|maxChunkTokens|truncationTokens|maxTokens)\b/i;
const ASSIGNMENT_PATTERN = /[:=]/;
const NUMERIC_LITERAL_PATTERN = /(^|[^\w.])-?\d+(?:\.\d+)?([^\w.]|$)/;

async function collectTypeScriptFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.relative(ROOT, absolutePath).replaceAll(path.sep, "/");

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

    if (!relativePath.endsWith(TARGET_EXTENSION) || relativePath.endsWith(".d.ts")) {
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

function hasDisallowedModelLiteral(line) {
  if (line.includes("model-derived-ok")) {
    return false;
  }

  return (
    MODEL_FIELD_PATTERN.test(line) &&
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
      if (!hasDisallowedModelLiteral(line)) {
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
    globalThis.console.error("guard:model-derived failed. Found hardcoded model-related numeric literals:");
    for (const violation of violations) {
      globalThis.console.error(`- ${violation.file}:${violation.line} -> ${violation.text}`);
    }
    process.exit(1);
  }

  globalThis.console.log("guard:model-derived passed.");
}

main().catch((error) => {
  globalThis.console.error("guard:model-derived crashed:", error);
  process.exit(1);
});
