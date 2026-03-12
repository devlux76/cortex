import { defineConfig } from "@playwright/test";
import process from "node:process";

const HARNESS_URL = process.env.CORTEX_HARNESS_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/runtime",
  testMatch: /.*\.spec\.mjs/,
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  use: {
    baseURL: HARNESS_URL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "node scripts/runtime-harness-server.mjs",
    url: HARNESS_URL,
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
