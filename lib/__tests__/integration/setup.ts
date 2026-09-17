import { PrismaClient } from "@/lib/generated/prisma";

/**
 * DB-backed integration test harness (Postgres/Prisma edition).
 *
 * This project used to spin up a real, ephemeral `MongoMemoryReplSet` per
 * test file (transactions require a replica set, not a standalone mongod)
 * so the four money-moving service functions could be exercised against
 * actual multi-document transactions/optimistic-concurrency behavior
 * rather than mocks. Now that the data layer is Postgres/Prisma, the
 * equivalent is a real local PostgreSQL server (no in-memory/embedded
 * Postgres equivalent is bundled — `pg-mem` doesn't support enough of real
 * Postgres's transaction/constraint semantics to trust for this purpose,
 * and this sandbox has no Docker daemon available, which rules out
 * testcontainers). See docs/TESTING.md (or MEMORY.md, if that doc doesn't
 * exist yet) for exactly how to provision the local `telegram_panel_test`
 * database this file expects — in short:
 *
 *   sudo apt-get install -y postgresql
 *   sudo service postgresql start
 *   sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
 *   createdb -U postgres -h localhost telegram_panel_test   # or via psql
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/telegram_panel_test?schema=public \
 *     DIRECT_URL=postgresql://postgres:postgres@localhost:5432/telegram_panel_test?schema=public \
 *     npx prisma db push --accept-data-loss
 *
 * `startTestDb()` does NOT create the database or push the schema itself
 * (unlike the old `MongoMemoryReplSet.create()`, which built a disposable
 * database from nothing every run) — provisioning a real Postgres server
 * inside `beforeAll` on every test run is both slow and requires
 * privileges this process may not have in every environment (CI runners,
 * for instance, are expected to provision the service directly). Instead
 * it: (1) asserts `DATABASE_URL`/`DIRECT_URL` are set and point at
 * something with "test" in the database name (a deliberate guardrail — see
 * the check below — so a misconfigured env can never cause this suite to
 * `TRUNCATE` a real/production database), and (2) opens a fresh
 * `PrismaClient` connected to it. Call `npx prisma db push` yourself once
 * per schema change, exactly as you would for local development.
 */

let client: PrismaClient | null = null;

export async function startTestDb(): Promise<PrismaClient> {
  const url = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;

  if (!url || !directUrl) {
    throw new Error(
      "startTestDb(): DATABASE_URL and DIRECT_URL must both be set to a local " +
        "Postgres test database before running the integration suite " +
        "(see this file's header comment for exact setup steps)."
    );
  }

  if (!/test/i.test(url)) {
    throw new Error(
      `startTestDb(): refusing to run against a database whose URL doesn't ` +
        `contain "test" (got: ${url.replace(/:[^:@]*@/, ":***@")}) — this is a ` +
        `guardrail against ever accidentally TRUNCATE-ing a real database. ` +
        `Point DATABASE_URL/DIRECT_URL at a dedicated *_test database.`
    );
  }

  client = new PrismaClient({ datasourceUrl: url });
  await client.$connect();
  return client;
}

export async function stopTestDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

export function getTestClient(): PrismaClient {
  if (!client) {
    throw new Error("getTestClient(): startTestDb() must be called first (e.g. in beforeAll).");
  }
  return client;
}

/**
 * Deletes all rows from every application table, in FK-safe order
 * (children before parents), between tests — the Postgres equivalent of
 * the old `mongoose.connection.db.dropDatabase()`/per-collection
 * `deleteMany({})` reset. `TRUNCATE ... CASCADE` would be simpler but is
 * intentionally avoided: it silently cascades through FK relationships
 * (bypassing `onDelete` semantics review) and doesn't reset in an order
 * a future added-model author has to think about — an explicit ordered
 * list makes every table's dependency on this list visible in one place,
 * and fails loudly (missing-table error) if it drifts from the schema.
 */
export async function clearTestDb(): Promise<void> {
  const db = getTestClient();
  await db.$transaction([
    db.notification.deleteMany(),
    db.ticketMessage.deleteMany(),
    db.supportTicket.deleteMany(),
    db.auditLog.deleteMany(),
    db.apiKey.deleteMany(),
    db.verificationToken.deleteMany(),
    db.payment.deleteMany(),
    db.transaction.deleteMany(),
    db.order.deleteMany(),
    db.favoriteService.deleteMany(),
    db.serviceProvider.deleteMany(),
    db.service.deleteMany(),
    db.category.deleteMany(),
    db.serviceGroup.deleteMany(),
    db.provider.deleteMany(),
    db.wallet.deleteMany(),
    db.telegramBotSession.deleteMany(),
    db.exchangeRateCache.deleteMany(),
    db.settings.deleteMany(),
    db.user.deleteMany(),
  ]);
}
