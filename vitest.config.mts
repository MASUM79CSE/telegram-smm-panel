import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fast unit-test config covering pure/unit-testable logic only (no live
 * MongoDB/Redis/SMTP required) — `lib/**` and similar side-effect-free
 * modules. Runs via `npm run test` / CI on every push.
 *
 * DB-backed integration coverage for the transactional money-moving
 * service functions (`placeOrder`, `approveDeposit`, `refundOrder`,
 * `issuePartialRefund`) now exists separately under
 * `lib/__tests__/integration/*.integration.test.ts`, run via
 * `npm run test:integration` (see vitest.integration.config.mts) — kept
 * as a distinct, opt-in config rather than merged into this one because
 * spinning up a real `mongodb-memory-server` replica set per file adds
 * several seconds per run, which would slow down the fast unit-test loop
 * this config is meant to serve. `npm run test:all` runs both.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "**/integration/**", ".ecc-vendor/**", ".claude/**"],
    setupFiles: ["./vitest.setup.mts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "."),
    },
  },
});
