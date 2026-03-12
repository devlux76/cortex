#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const SKIP_ENV_FLAG = process.env.CORTEX_ALLOW_ELECTRON_SKIP === "1";

async function hasElectronInstalled() {
  try {
    await import("electron");
    return true;
  } catch {
    return false;
  }
}

function runPlaywrightElectronTests() {
  const child = spawn(
    "npx",
    ["playwright", "test", "tests/runtime/electron-harness.spec.mjs", "--workers=1"],
    {
      stdio: "inherit",
      shell: true,
      env: process.env,
    },
  );

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

async function main() {
  const installed = await hasElectronInstalled();

  if (!installed) {
    const message = [
      "runtime-electron lane cannot run: Electron executable is not installed.",
      "Install with: npm install -D electron",
      "Or run with CORTEX_ALLOW_ELECTRON_SKIP=1 to soft-skip locally.",
    ].join("\n");

    if (SKIP_ENV_FLAG) {
      globalThis.console.warn(`${message}\nSoft-skipping runtime-electron lane.`);
      process.exit(0);
      return;
    }

    globalThis.console.error(message);
    process.exit(1);
    return;
  }

  runPlaywrightElectronTests();
}

main().catch((error) => {
  globalThis.console.error("runtime-electron runner crashed:", error);
  process.exit(1);
});
