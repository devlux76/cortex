import { test, expect } from "@playwright/test";

const STORAGE_STATES = ["available", "unavailable", "error"];
const PROVIDER_KINDS = ["webnn", "webgpu", "webgl", "wasm"];

test("browser harness publishes a runtime capability report", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => globalThis.__cortexHarnessReady === true);

  const report = await page.evaluate(() => globalThis.__cortexHarnessReport);

  expect(report).toBeTruthy();
  expect(typeof report.runtime.userAgent).toBe("string");
  expect(report.runtime.userAgent.length).toBeGreaterThan(0);
  expect(STORAGE_STATES).toContain(report.storage.indexedDb);
  expect(STORAGE_STATES).toContain(report.storage.opfs);
  expect(PROVIDER_KINDS).toContain(report.selectedProvider);
});
