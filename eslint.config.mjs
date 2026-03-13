import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "**/*.d.ts"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    // Node 18+ ships native fetch; declare it so ESLint doesn't flag it.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        fetch: "readonly",
      },
    },
  },
);
