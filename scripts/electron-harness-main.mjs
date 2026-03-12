#!/usr/bin/env node

import { app, BrowserWindow } from "electron";
import process from "node:process";

const HARNESS_URL = process.env.HARNESS_URL ?? "http://127.0.0.1:4173";
const SHOW_WINDOW = process.env.CORTEX_ELECTRON_SHOW === "1";
const OZONE_PLATFORM = process.env.CORTEX_OZONE_PLATFORM ?? "x11";
const DISABLE_VULKAN = process.env.CORTEX_DISABLE_VULKAN !== "0";

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("ozone-platform", OZONE_PLATFORM);
if (DISABLE_VULKAN) {
  app.commandLine.appendSwitch("disable-vulkan");
}

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

async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: SHOW_WINDOW,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(HARNESS_URL);
}

app.whenReady().then(async () => {
  globalThis.console.log(`[electron-harness] loading ${HARNESS_URL}`);
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
