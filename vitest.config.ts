import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.spec.ts"],
    coverage: {
      provider: "v8",
      enabled: true,
      clean: true,
      include: ["lib/**/*.ts"],
      all: true,
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
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
