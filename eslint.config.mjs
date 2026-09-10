import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Everything Claude Code (ECC) install — third-party agent/
    // skill/tooling content, not this project's application code. See
    // docs/ECC_SETUP.md.
    ".claude/**",
    ".ecc-vendor/**",
  ]),
]);

export default eslintConfig;
