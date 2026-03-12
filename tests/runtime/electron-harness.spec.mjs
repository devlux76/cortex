import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import path from "node:path";
import process from "node:process";

const PROVIDER_KINDS = ["webnn", "webgpu", "webgl", "wasm"];

test("electron wrapper runs the shared runtime harness", async () => {
  const app = await electron.launch({
    args: [path.resolve("scripts/electron-harness-main.mjs")],
    env: {
      ...process.env,
      HARNESS_URL: process.env.CORTEX_HARNESS_URL ?? "http://127.0.0.1:4173",
    },
  });

  try {
    const window = await app.firstWindow();
    await window.waitForFunction(() => globalThis.__cortexHarnessReady === true);

    const report = await window.evaluate(() => globalThis.__cortexHarnessReport);

    expect(report).toBeTruthy();
    expect(typeof report.runtime.userAgent).toBe("string");
    expect(report.runtime.userAgent.length).toBeGreaterThan(0);
    expect(PROVIDER_KINDS).toContain(report.selectedProvider);
  } finally {
    await app.close();
  }
});
