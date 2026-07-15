import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Project-specific rules for code hygiene
  {
    rules: {
      // Warn on console statements (allow console.error)
      "no-console": ["warn", { allow: ["error", "warn"] }],
      // Error on unused variables
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      // Enforce consistent return statements
      "consistent-return": "warn",
      // Downgrade to warn: many legitimate patterns (hydration sync, state reset)
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "ocr/**",
    "font-color/**",
    "scripts/**",
    ".claude/worktrees/**",
    "audit-evidence/full/**",
  ]),
]);

export default eslintConfig;
