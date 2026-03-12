#!/usr/bin/env node

import { app, BrowserWindow } from "electron";
import process from "node:process";

const HARNESS_URL = process.env.HARNESS_URL ?? "http://127.0.0.1:4173";
const HEADLESS_MODE = process.env.CORTEX_ELECTRON_HEADLESS === "1";
const SHOW_WINDOW = !HEADLESS_MODE && process.env.CORTEX_ELECTRON_SHOW === "1";
const EXIT_ON_READY = process.env.CORTEX_EXIT_ON_READY === "1";
const READY_TIMEOUT_MS = Number.parseInt(
  process.env.CORTEX_READY_TIMEOUT_MS ?? "15000",
  10,
);
const OZONE_PLATFORM =
  process.env.CORTEX_OZONE_PLATFORM ??
  (process.env.WAYLAND_DISPLAY ? "wayland" : "x11");
const DISABLE_VULKAN = process.env.CORTEX_DISABLE_VULKAN === "1";
const ENABLE_UNSAFE_WEBGPU = process.env.CORTEX_ENABLE_UNSAFE_WEBGPU === "1";
const IGNORE_GPU_BLOCKLIST = process.env.CORTEX_IGNORE_GPU_BLOCKLIST === "1";

if (HEADLESS_MODE) {
  // Headless mode targets CI/editor sandboxes where hardware DRI may be absent.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("headless");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("use-gl", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}

if (ENABLE_UNSAFE_WEBGPU) {
  app.commandLine.appendSwitch("enable-unsafe-webgpu");
}
if (IGNORE_GPU_BLOCKLIST) {
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
}
if (OZONE_PLATFORM.length > 0) {
  app.commandLine.appendSwitch("ozone-platform", OZONE_PLATFORM);
}
if (DISABLE_VULKAN) {
  app.commandLine.appendSwitch("disable-vulkan");
}

process.on("unhandledRejection", (error) => {
  globalThis.console.error("[electron-harness] unhandledRejection", error);
});

process.on("uncaughtException", (error) => {
  globalThis.console.error("[electron-harness] uncaughtException", error);
});

app.on("gpu-info-update", async () => {
  try {
    const featureStatus = app.getGPUFeatureStatus();
    const gpuInfo = await app.getGPUInfo("basic");
    globalThis.console.log("[electron-harness] gpu-feature-status", JSON.stringify(featureStatus));
    globalThis.console.log("[electron-harness] gpu-info", JSON.stringify(gpuInfo));
  } catch (error) {
    globalThis.console.error("[electron-harness] gpu diagnostics failed", error);
  }
});

function sleep(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function waitForHarnessReady(mainWindow, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const ready = await mainWindow.webContents.executeJavaScript(
        "globalThis.__cortexHarnessReady === true",
      );
      if (ready === true) {
        const report = await mainWindow.webContents.executeJavaScript(
          "globalThis.__cortexHarnessReport ?? null",
        );
        return { ready: true, report };
      }
    } catch {
      // Renderer can briefly reject while booting; keep polling.
    }

    await sleep(100);
  }

  return { ready: false, report: null };
}

async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: SHOW_WINDOW,
    webPreferences: {
      offscreen: HEADLESS_MODE,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("closed", () => {
    globalThis.console.log("[electron-harness] window closed");
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    globalThis.console.error("[electron-harness] render-process-gone", JSON.stringify(details));
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    globalThis.console.error(
      `[electron-harness] did-fail-load code=${code} description=${description} url=${url}`,
    );
  });

  await mainWindow.loadURL(HARNESS_URL);
}

app.whenReady().then(async () => {
  globalThis.console.log(
    `[electron-harness] loading ${HARNESS_URL} headless=${HEADLESS_MODE} ozone=${OZONE_PLATFORM} disableVulkan=${DISABLE_VULKAN} unsafeWebgpu=${ENABLE_UNSAFE_WEBGPU} ignoreGpuBlocklist=${IGNORE_GPU_BLOCKLIST}`,
  );
  await createWindow();

  if (EXIT_ON_READY) {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      globalThis.console.error("[electron-harness] no window created in exit-on-ready mode");
      process.exitCode = 2;
      app.quit();
      return;
    }

    const { ready, report } = await waitForHarnessReady(window, READY_TIMEOUT_MS);
    if (!ready) {
      globalThis.console.error(
        `[electron-harness] probe did not become ready within ${READY_TIMEOUT_MS}ms`,
      );
      process.exitCode = 3;
      app.quit();
      return;
    }

    const selectedProvider = report?.selectedProvider ?? "unknown";
    globalThis.console.log(
      `[electron-harness] ready selectedProvider=${selectedProvider}`,
    );
    app.quit();
    return;
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("child-process-gone", (_event, details) => {
  globalThis.console.error("[electron-harness] child-process-gone", JSON.stringify(details));
});
