import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    "generated/**",
    "data/**",
    ".tools/**",
    "artifacts/**",
    "next-env.d.ts",
    "apps/android/android/**",
    "apps/android/node_modules/**",
    "apps/android/dist/**",
    "apps/android/test-results/**",
    "packages/core/node_modules/**",
  ]),
]);
