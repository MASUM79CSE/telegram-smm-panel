import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * DB-backed integration test config — closes the top-priority gap flagged
 * in docs/PRODUCTION_READINESS.md: "no DB-backed integration or e2e
 * coverage" for the transactional order/deposit/refund service functions
 * (`lib/services/orders.ts`, `admin-payments.ts`, `admin-orders.ts`,
 * `refunds.ts`), plus `lib/services/admin-bulk.ts` and `lib/services/jobs.ts`.
 *
 * Runs against a single real, locally-installed PostgreSQL database (see
 * `lib/__tests__/integration/setup.ts` for the full provisioning
 * instructions and safety guardrails — `DATABASE_URL`/`DIRECT_URL` must
 * point at a database with "test" in its name, e.g.
 * `telegram_panel_test`). This replaces the original MongoDB version's
 * per-test-file ephemeral `mongodb-memory-server` replica set: Postgres has
 * no equivalent lightweight embedded/in-memory server bundled with this
 * project, and this sandbox has no Docker daemon available (ruling out
 * testcontainers) — see MEMORY.md for the full rationale.
 *
 * IMPORTANT difference from the old Mongo config: because every test file
 * now shares ONE real database (rather than each getting its own disposable
 * replica-set instance), `fileParallelism` is `false` here — running
 * multiple integration test files concurrently against the same database
 * would let one file's `beforeEach` `clearTestDb()` wipe rows another
 * file's test is still asserting against. Tests remain reasonably fast
 * despite running sequentially since each is a handful of real but small
 * (single-digit-row) Postgres queries, not a multi-second replica-set boot.
 *
 * Run via `npm run test:integration` (or `npm run test:all` for both
 * suites).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/__tests__/integration/**/*.integration.test.ts"],
    exclude: ["node_modules", ".next", ".ecc-vendor/**", ".claude/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // All integration test files share ONE real Postgres database
    // connection/instance (see header comment) — files must run
    // sequentially, not in separate parallel workers, or one file's
    // `clearTestDb()` could wipe rows a concurrently-running file's test
    // is still asserting against.
    fileParallelism: false,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "."),
    },
  },
});
