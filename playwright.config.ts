import { defineConfig, devices } from "@playwright/test";
import { TEST_PORT } from "./e2e/global-setup";

/**
 * End-to-end smoke test config (docs/PRODUCTION_READINESS.md §15 item 4 —
 * the last item on this project's own testing priority list, after the
 * unit suite, the DB-backed integration suite, and the route-handler
 * auth-boundary suite were already completed).
 *
 * Runs against the REAL, already-built production server (`next start`)
 * on a dedicated port (see `e2e/global-setup.ts`'s `TEST_PORT`) so it
 * never collides with a `next dev` instance a human might also be running
 * on :3000 in this same sandbox. `npm run build` must be run first — see
 * the `test:e2e` script in `package.json`, which runs the build as part of
 * the same command specifically so this isn't a footgun.
 *
 * Deliberately no `config.webServer` here — `e2e/global-setup.ts` spawns
 * and owns the `next start` process itself. See that file's design-decision
 * comment #3 for why: Playwright spawns `webServer` as part of its
 * plugin-setup tasks, which run BEFORE `globalSetup`, so env vars this
 * suite computes at runtime (`MONGODB_URI` from an async in-memory Mongo
 * replica set, the dynamic `E2E_SERVER_LOG_PATH`, etc.) would not exist
 * yet when a Playwright-managed `webServer` process is spawned. Confirmed
 * by direct inspection of the installed Playwright runner and a minimal
 * repro, not assumption.
 *
 * Deliberately single-browser (Chromium only, not the full
 * Chromium+Firefox+WebKit matrix Playwright defaults encourage) — this is
 * a smoke suite proving the critical happy paths work end-to-end at all,
 * not a cross-browser compatibility suite; running 3x the browsers for
 * marginal additional confidence isn't worth 3x the CI time for this
 * project's current scale. Revisit if a real cross-browser bug is ever
 * found in production.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: false, // tests share one seeded DB — see e2e/global-setup.ts
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: [["list"]],
  globalSetup: require.resolve("./e2e/global-setup.ts"),
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
