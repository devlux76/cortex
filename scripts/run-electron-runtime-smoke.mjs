#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_URL = process.env.CORTEX_HARNESS_URL ?? "http://127.0.0.1:4173";
const SMOKE_TIMEOUT_MS = Number.parseInt(
  process.env.CORTEX_ELECTRON_SMOKE_TIMEOUT_MS ?? "45000",
  10,
);

function createHarnessServer() {
  return spawn("node", [path.join(ROOT_DIR, "scripts/runtime-harness-server.mjs")], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}

function createElectronProcess() {
  const electronBin = path.join(ROOT_DIR, "node_modules/electron/dist/electron");

  return spawn(electronBin, [path.join(ROOT_DIR, "scripts/electron-harness-main.mjs")], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HARNESS_URL,
      CORTEX_ELECTRON_HEADLESS: process.env.CORTEX_ELECTRON_HEADLESS ?? "1",
      CORTEX_ELECTRON_SHOW: process.env.CORTEX_ELECTRON_SHOW ?? "0",
      CORTEX_DISABLE_VULKAN: process.env.CORTEX_DISABLE_VULKAN ?? "1",
      CORTEX_ENABLE_UNSAFE_WEBGPU: process.env.CORTEX_ENABLE_UNSAFE_WEBGPU ?? "0",
      CORTEX_IGNORE_GPU_BLOCKLIST: process.env.CORTEX_IGNORE_GPU_BLOCKLIST ?? "0",
      CORTEX_EXIT_ON_READY: "1",
      CORTEX_READY_TIMEOUT_MS: process.env.CORTEX_READY_TIMEOUT_MS ?? "15000",
    },
  });
}

function collectOutput(child, label) {
  let out = "";

  child.stdout.on("data", (chunk) => {
    out += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    out += chunk.toString();
  });

  child.on("error", (error) => {
    out += `[${label}] spawn-error ${String(error)}\n`;
  });

  return () => out;
}

async function waitForExit(child, timeoutMs) {
  let timeoutId;

  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      if (timeoutId) {
        globalThis.clearTimeout(timeoutId);
      }
      resolve({ code, signal, timedOut: false });
    });
  });

  const timeoutPromise = new Promise((resolve) => {
    timeoutId = globalThis.setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      resolve({ code: null, signal: "SIGKILL", timedOut: true });
    }, timeoutMs);
  });

  return Promise.race([exitPromise, timeoutPromise]);
}

async function main() {
  try {
    await import("electron");
  } catch {
    globalThis.console.error("runtime-electron smoke failed: Electron package is not installed.");
    globalThis.console.error("Install with: npm install -D electron");
    process.exit(1);
    return;
  }

  const harnessServer = createHarnessServer();
  const getHarnessLogs = collectOutput(harnessServer, "harness-server");

  await delay(600);

  const electronChild = createElectronProcess();
  const getElectronLogs = collectOutput(electronChild, "electron");

  const result = await waitForExit(electronChild, SMOKE_TIMEOUT_MS);

  if (!harnessServer.killed) {
    harnessServer.kill("SIGTERM");
  }
  await waitForExit(harnessServer, 5000);

  const electronLogs = getElectronLogs();
  if (result.timedOut) {
    globalThis.console.error("runtime-electron smoke timed out.");
    globalThis.console.error(electronLogs);
    process.exit(1);
    return;
  }

  if (result.code !== 0) {
    globalThis.console.error(
      `runtime-electron smoke failed: exitCode=${String(result.code)} signal=${String(result.signal)}`,
    );
    globalThis.console.error(electronLogs);
    globalThis.console.error(getHarnessLogs());
    process.exit(1);
    return;
  }

  if (!electronLogs.includes("[electron-harness] ready selectedProvider=")) {
    globalThis.console.error("runtime-electron smoke failed: ready marker missing.");
    globalThis.console.error(electronLogs);
    process.exit(1);
    return;
  }

  globalThis.console.log("runtime-electron smoke passed.");
  globalThis.console.log(electronLogs.trim());
}

main().catch((error) => {
  globalThis.console.error("runtime-electron smoke crashed:", error);
  process.exit(1);
});
