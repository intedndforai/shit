import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    // The isolated dev build dir (`NEXT_DIST_DIR=.next-build`) is generated output too.
    ".next-build/**",
    "out/**",
    "build/**",
    "node_modules/**",
    "coverage/**",
    "drizzle/**",
    "next-env.d.ts",
    // Scratch/working files that are not part of the app.
    ".tmp/**",
    ".tmp-*",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;