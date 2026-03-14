import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.spec.ts"],
    coverage: {
      provider: "v8",
      enabled: true,
      clean: true,
      include: ["lib/**/*.ts"],
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      exclude: [
        // Runtime configuration + platform-specific code that is not testable in this environment
        "lib/CreateVectorBackend.ts",
        "lib/WasmVectorBackend.ts",
        "lib/WebGLVectorBackend.ts",
        "lib/WebGPUVectorBackend.ts",
        "lib/WebNNVectorBackend.ts",
        // Pure type definitions (no executable JS generated)
        "**/*.d.ts",
        "**/types.ts",
        "**/VectorBackend.ts",
        "**/ModelProfile.ts",
        "**/QueryResult.ts",
        "**/WebNNTypes.*",
        // Test and tooling files
        "tests/**",
        "benchmarks/**",
        "scripts/**",
        "docker/**",
        "node_modules/**",
      ],
      thresholds: {
        // Enforce a minimum test coverage baseline. We focus on line/statement/function
        // coverage; branch coverage is tracked but may vary substantially across
        // complex control flows (e.g., optional platform APIs). Adjust this if we
        // decide to enforce strict branch coverage in the future.
        lines: 80,
        functions: 80,
        branches: 0,
        statements: 80,
      },
    },
  },
});
