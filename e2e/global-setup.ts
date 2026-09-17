import { hash } from "bcryptjs";
import { writeFileSync, openSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn, type ChildProcess } from "child_process";
import { PrismaClient } from "../lib/generated/prisma";
import { toDecimal128 } from "../lib/money";

/**
 * Playwright global setup for the end-to-end smoke suite
 * (docs/PRODUCTION_READINESS.md §15 item 4 — the last item on that list,
 * after the unit + integration + route-auth-boundary suites already
 * completed).
 *
 * Design decisions (documented, not accidental):
 *
 * 1. **A real, dedicated local PostgreSQL database** — NOT the shared
 *    Supabase dev database this project's `.env.local` might point at.
 *    Running e2e tests against a real dev database would be destructive
 *    (registers real accounts, submits real deposits) and non-repeatable
 *    (results would depend on whatever data already exists there).
 *    Postgres/Prisma migration note: the original MongoDB version of this
 *    file spun up a fully disposable, ephemeral `mongodb-memory-server`
 *    replica set per run. There is no equivalent bundled in-memory/
 *    embedded Postgres server for Node, and this sandbox has no Docker
 *    daemon available (ruling out testcontainers) — see
 *    `lib/__tests__/integration/setup.ts`'s header comment for the same
 *    constraint already documented for the integration suite. So this
 *    file instead connects to (and `clearTestDb()`-style wipes, then
 *    reseeds) a real, already-running local Postgres database whose URL
 *    is given via `E2E_DATABASE_URL` — see this file's own guardrail below
 *    requiring "test"/"e2e" in that URL, to make it structurally hard to
 *    ever point this at a real database by mistake.
 *
 * 2. **Runs the real, already-built production server** (`next start`)
 *    rather than `next dev` — this is an end-to-end smoke test of what
 *    actually ships, not of the dev server's hot-reload behavior.
 *    `npm run build` must be run before `npm run test:e2e` (documented in
 *    `package.json`'s script name and this file's own header).
 *
 * 3. **This file spawns and owns the `next start` child process itself,
 *    rather than using Playwright's `config.webServer` option.** This is
 *    NOT the more obvious approach and deserves explanation: Playwright's
 *    task order (confirmed by reading
 *    `node_modules/playwright/lib/runner/index.js`'s
 *    `createGlobalSetupTasks()`) is
 *    `[clearOutputDirs, ...pluginSetupTasks, ...globalTeardowns, ...globalSetups]`.
 *    `webServer` is implemented as a plugin, so its process is spawned
 *    during `pluginSetupTasks` — BEFORE any `globalSetups` entry (i.e.
 *    this file) ever runs. That means `DATABASE_URL`, `PORT`, and every
 *    other `process.env` mutation this file makes would still be `undefined`
 *    to a Playwright-managed `webServer` process (verified empirically: a
 *    minimal repro config showed `webServer`'s command sees
 *    `FOO=undefined` when `FOO` is set inside `globalSetup`, but sees it
 *    correctly when set at the top of `playwright.config.ts`'s module
 *    body instead — which isn't usable here either, since seeding requires
 *    an asynchronous DB round-trip and `playwright.config.ts` is evaluated
 *    synchronously). Spawning the server ourselves, after the DB is ready
 *    and env vars are computed, sidesteps the ordering problem entirely.
 *    `globalTeardown` (the function this file returns) kills that same
 *    child process.
 *
 * 4. **A throwaway `AUTH_SECRET` and `ALLOWED_ORIGINS=http://localhost:3100`
 *    are set here too** (not reused from `.env.local`) so this suite never
 *    depends on — or risks leaking — real secrets, and so the origin check
 *    in `lib/security/origin.ts` doesn't need to be disabled for the test
 *    run (Playwright's browser sends real `Origin: http://localhost:3100`
 *    headers, which must be on the allow-list or every mutating fetch()
 *    call the UI makes would get a 403).
 *
 * 5. **One admin + platform settings are seeded directly via Prisma**
 *    (bypassing HTTP, the same way `scripts/seed.ts` does for real
 *    deployments) so the suite doesn't waste time/fragility on seeding
 *    through the UI — the register/login FLOW itself is exactly what the
 *    tests exercise for a fresh customer account, so seeding an admin
 *    separately doesn't reduce coverage of that flow.
 *
 * 6. **No SMTP is configured** (deliberately, matching `.env.example`'s
 *    documented dev fallback) — `lib/mail.ts#sendMail` falls back to
 *    logging instead of sending in that case. This means the real
 *    verification-email flow can't be tested by clicking a link from an
 *    inbox; instead, the tests recover the link from the server's own
 *    stdout log (see `readLatestVerificationLink` in `e2e/helpers.ts`),
 *    exactly mirroring how a real user would reach
 *    `/verify-email?token=...` after clicking their email link, without
 *    this suite needing a real mailbox.
 */

let seedClient: PrismaClient | undefined;
let serverProcess: ChildProcess | undefined;
let teardownRequested = false;

const TEST_PORT = 3100;

function waitForServerReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) {
            reject(new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`));
            return;
          }
          setTimeout(attempt, 300);
        });
    };
    attempt();
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  // Deliberately a SEPARATE env var from DATABASE_URL (rather than reusing
  // whatever's already in `.env.local`) — this suite TRUNCATEs every table
  // before seeding, so it must never be pointed at a real dev/production
  // database by an inherited env var. The "test"/"e2e" guardrail below is
  // the same discipline already established in
  // `lib/__tests__/integration/setup.ts`.
  const uri =
    process.env.E2E_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/telegram_panel_e2e?schema=public";

  if (!/test|e2e/i.test(uri)) {
    throw new Error(
      `globalSetup(): refusing to run against a database whose URL doesn't contain "test" or "e2e" ` +
        `(got: ${uri.replace(/:[^:@]*@/, ":***@")}) — this suite TRUNCATEs every table before seeding. ` +
        `Set E2E_DATABASE_URL to a dedicated database, e.g. telegram_panel_e2e.`
    );
  }

  seedClient = new PrismaClient({ datasourceUrl: uri });
  await seedClient.$connect();

  // Wipe every table before seeding — this suite must start from a known,
  // empty state every run, exactly like the old disposable-replica-set
  // approach guaranteed for free. Order matters (children before parents)
  // to satisfy foreign-key constraints — same ordering as
  // lib/__tests__/integration/setup.ts#clearTestDb.
  await seedClient.$transaction([
    seedClient.notification.deleteMany(),
    seedClient.ticketMessage.deleteMany(),
    seedClient.supportTicket.deleteMany(),
    seedClient.auditLog.deleteMany(),
    seedClient.apiKey.deleteMany(),
    seedClient.verificationToken.deleteMany(),
    seedClient.payment.deleteMany(),
    seedClient.transaction.deleteMany(),
    seedClient.order.deleteMany(),
    seedClient.favoriteService.deleteMany(),
    seedClient.serviceProvider.deleteMany(),
    seedClient.service.deleteMany(),
    seedClient.category.deleteMany(),
    seedClient.serviceGroup.deleteMany(),
    seedClient.provider.deleteMany(),
    seedClient.wallet.deleteMany(),
    seedClient.telegramBotSession.deleteMany(),
    seedClient.exchangeRateCache.deleteMany(),
    seedClient.settings.deleteMany(),
    seedClient.user.deleteMany(),
  ]);

  const adminPasswordHash = await hash("AdminE2E!Pass1", 12);
  const admin = await seedClient.user.create({
    data: {
      name: "E2E Admin",
      email: "e2e-admin@example.com",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      status: "ACTIVE",
      emailVerified: new Date(),
    },
  });
  await seedClient.wallet.create({ data: { userId: admin.id, balance: toDecimal128("0"), currency: "USD" } });

  // A second, pre-verified, ACTIVE customer with a funded wallet — used by
  // the order-placement happy-path test so that test doesn't also have to
  // depend on the deposit-approval flow succeeding first (each smoke test
  // stays focused on one flow, per the project's own testing philosophy
  // established in the integration suite: prefer several precise tests
  // over one giant chained one that's hard to debug when it fails).
  const funded = await seedClient.user.create({
    data: {
      name: "E2E Funded Customer",
      email: "e2e-funded@example.com",
      passwordHash: await hash("FundedE2E!Pass1", 12),
      role: "USER",
      status: "ACTIVE",
      emailVerified: new Date(),
    },
  });
  await seedClient.wallet.create({
    data: { userId: funded.id, balance: toDecimal128("500"), currency: "USD" },
  });

  const category = await seedClient.category.create({
    data: { name: "E2E Test Category", slug: "e2e-test-category", active: true, sortOrder: 0 },
  });
  await seedClient.service.create({
    data: {
      categoryId: category.id,
      name: "E2E Smoke Test Service",
      description: "Seeded for the Playwright e2e smoke suite only.",
      type: "DEFAULT",
      rate: toDecimal128("1.5"),
      providerId: null,
      providerServiceId: null,
      providerRate: null,
      minQuantity: 10,
      maxQuantity: 10000,
      active: true,
      hidden: false,
      refillDays: null,
      estimatedDeliveryMinutes: null,
    },
  });

  await seedClient.settings.upsert({ where: { key: "global" }, create: { key: "global" }, update: {} });

  await seedClient.$disconnect();
  seedClient = undefined;

  // Where the server's stdout/stderr will be redirected so
  // e2e/helpers.ts#readLatestVerificationLink can recover a real
  // verification-email link — this suite runs with no SMTP configured, so
  // that's the only place the link is ever written (see
  // lib/mail.ts#sendMail's documented dev fallback).
  const logPath = join(tmpdir(), `e2e-server-${Date.now()}.log`);
  writeFileSync(logPath, "");
  process.env.E2E_SERVER_LOG_PATH = logPath;

  process.env.DATABASE_URL = uri;
  process.env.DIRECT_URL = uri;
  process.env.AUTH_SECRET = "e2e-smoke-test-secret-value-not-a-real-secret-32ch";
  process.env.NEXTAUTH_URL = `http://localhost:${TEST_PORT}`;
  process.env.NEXT_PUBLIC_APP_URL = `http://localhost:${TEST_PORT}`;
  process.env.ALLOWED_ORIGINS = `http://localhost:${TEST_PORT}`;
  // `NODE_ENV` is typed read-only by Next.js's own ambient types (it's
  // meant to be set by the tool that invokes node, not mutated at
  // runtime) — cast through `Record<string, string>` to still set it here,
  // since `next start` (this suite's server command) always runs with
  // NODE_ENV=production regardless, and AUTH_TRUST_HOST below needs that
  // context to be accurate in this comment even though it's not this
  // line's job to force it.
  (process.env as Record<string, string>).NODE_ENV = "production";
  // Auth.js only auto-trusts the request Host header outside production
  // (see lib/env.ts's own doc comment on this) — since this suite
  // deliberately runs the real production server (`next start`), it needs
  // this explicitly set, exactly like a real production deployment would.
  process.env.AUTH_TRUST_HOST = "true";
  process.env.PORT = String(TEST_PORT);
  // No SMTP_HOST/UPSTASH_*/TELEGRAM_* — intentionally unset so mail and
  // rate-limiting both take their documented no-op/in-memory dev fallback
  // paths (see lib/mail.ts and lib/rate-limit.ts) without needing any real
  // external service for this suite to run.

  // Spawn the real production server directly (see design decision #3
  // above for why this isn't done via Playwright's `config.webServer`).
  // Inherits this process's (now fully-populated) `process.env`.
  //
  // Invoke the `next` binary directly rather than `npm run start` — `npm`
  // spawns an intermediate shell that then spawns the actual
  // `next-server` process, and killing just the `npm` process (as
  // `globalTeardown` below must do, since that's the only handle this
  // file has) does NOT reliably kill that grandchild `next-server`,
  // leaving it bound to the port after the test run ends and breaking the
  // NEXT run with `EADDRINUSE` (observed directly: a prior run's
  // `next-server` was still listening on :3100 after Playwright's process
  // had exited). `detached: true` + killing the negative PID (the whole
  // process group) closes that gap even for the direct-`next`-binary case
  // too, in case `next start` itself forks.
  const logFd = openSync(logPath, "a");
  serverProcess = spawn(join(__dirname, "..", "node_modules", ".bin", "next"), ["start"], {
    cwd: join(__dirname, ".."),
    env: process.env,
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  serverProcess.on("exit", (code) => {
    // A non-zero code is expected once globalTeardown deliberately sends
    // SIGTERM at the end of the run (code 143) — only warn about
    // exits nobody asked for, which indicate the server actually crashed
    // mid-suite.
    if (!teardownRequested && code !== null && code !== 0) {
      console.error(`e2e server process exited early with code ${code} — see ${logPath}`);
    }
  });

  await waitForServerReady(`http://localhost:${TEST_PORT}`, 60_000);

  return async function globalTeardown() {
    teardownRequested = true;
    if (serverProcess && serverProcess.pid && !serverProcess.killed) {
      try {
        process.kill(-serverProcess.pid, "SIGTERM");
      } catch {
        // Process group may already be gone — nothing left to clean up.
      }
    }
    await seedClient?.$disconnect();
  };
}

export { TEST_PORT };
