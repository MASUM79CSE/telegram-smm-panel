import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * DB-backed integration test config — closes the top-priority gap flagged
 * in docs/PRODUCTION_READINESS.md: "no DB-backed integration or e2e
 * coverage" for the transactional order/deposit/refund service functions
 * (`lib/services/orders.ts`, `admin-payments.ts`, `admin-orders.ts`,
 * `refunds.ts`).
 *
 * Spins up a real, ephemeral MongoDB **replica set** per test file via
 * `mongodb-memory-server` (see `lib/__tests__/integration/setup.ts`) —
 * required because the functions under test use real multi-document
 * transactions, which only work on a replica set (exactly like the
 * MongoDB Atlas production target). Kept as a separate Vitest project
 * from the default `vitest.config.mts` because:
 *
 *  1. It needs a materially longer test timeout (replica-set startup +
 *     real transaction commits take real wall-clock time, unlike the
 *     pure-function unit suite).
 *  2. It should not silently slow down the fast, no-external-dependency
 *     unit-test loop developers run constantly during normal work.
 *
 * Run via `npm run test:integration` (or `npm run test:all` for both
 * suites). Requires network access on first run only, to download the
 * `mongodb-memory-server` binary into its local cache
 * (`node_modules/.cache/mongodb-memory-server/`) — already pre-warmed in
 * this environment; a fully offline CI runner should pre-cache it or use
 * the `MONGOMS_DOWNLOAD_MIRROR`/self-hosted binary options documented at
 * https://github.com/typegoose/mongodb-memory-server if network access
 * during CI is restricted.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/__tests__/integration/**/*.integration.test.ts"],
    exclude: ["node_modules", ".next", ".ecc-vendor/**", ".claude/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share one real (in-memory) database connection per
    // file via top-level `beforeAll`/`afterAll` — running files in
    // parallel worker processes is fine (each file gets its OWN replica
    // set instance), but tests WITHIN a file must run sequentially since
    // they share that one connection and rely on `beforeEach` clearing
    // state between them.
    fileParallelism: true,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "."),
    },
  },
});
