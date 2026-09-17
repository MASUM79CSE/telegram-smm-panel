import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startTestDb, stopTestDb, clearTestDb, getTestClient } from "./setup";
import { toDecimal128 } from "@/lib/money";

import { checkQueueDepth, STALE_PROCESSING_MINUTES, PENDING_BACKLOG_ALERT_THRESHOLD } from "@/lib/services/jobs";
import type { PrismaClient, OrderStatus } from "@/lib/generated/prisma";

/**
 * DB-backed integration coverage for `lib/services/jobs.ts#checkQueueDepth`
 * — closes the "order-processing queue depth" alerting gap flagged as
 * honestly open in `docs/PRODUCTION_READINESS.md` §6 (now implemented,
 * wired into `GET /api/cron/process-orders`, see that route). Postgres/
 * Prisma edition.
 *
 * Uses a real local PostgreSQL database (see ./setup.ts) rather than mocks
 * specifically to exercise the actual `prisma.order.count` queries
 * (status + `updatedAt` comparisons) against real rows/indexes, matching
 * how `lib/__tests__/integration/orders.integration.test.ts` already
 * validates the transactional order-placement path for the same reason.
 * Unlike the old Mongoose version, `@/lib/db` does NOT need to be mocked
 * here: `lib/services/jobs.ts` calls the SAME lazily-constructed Prisma
 * client this file's own `startTestDb()` uses (see setup.ts / lib/db.ts),
 * so `checkQueueDepth()`'s queries naturally run against this suite's real
 * test database — no second, divergent connection to reconcile.
 */
describe("lib/services/jobs — checkQueueDepth (integration)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = await startTestDb();
  }, 60_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  async function seedUserAndService() {
    const user = await db.user.create({
      data: {
        name: "Test User",
        email: `user-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "irrelevant",
        role: "USER",
        status: "ACTIVE",
      },
    });
    const category = await db.category.create({
      data: { name: "Category", slug: `cat-${Date.now()}-${Math.random()}` },
    });
    const service = await db.service.create({
      data: {
        categoryId: category.id,
        name: "Test Service",
        rate: toDecimal128("1.00"),
        minQuantity: 10,
        maxQuantity: 10000,
      },
    });
    return { user, service };
  }

  async function createOrder(
    userId: string,
    serviceId: string,
    overrides: { status: OrderStatus; updatedAtMinutesAgo?: number }
  ) {
    const order = await db.order.create({
      data: {
        userId,
        serviceId,
        target: "https://example.com/profile",
        quantity: 100,
        charge: toDecimal128("1.00"),
        status: overrides.status,
      },
    });

    if (overrides.updatedAtMinutesAgo !== undefined) {
      // Prisma's `@updatedAt` overwrites `updatedAt` on every `.update()`
      // call unless the update is done via a raw query that bypasses it —
      // a raw `UPDATE` is required to backdate it for the test, exactly as
      // production code would need to avoid doing accidentally.
      const backdated = new Date(Date.now() - overrides.updatedAtMinutesAgo * 60 * 1000);
      await db.$executeRawUnsafe(`UPDATE "Order" SET "updatedAt" = $1 WHERE id = $2`, backdated, order.id);
    }

    return order;
  }

  it("reports zero counts and no alert when the queue is empty", async () => {
    const result = await checkQueueDepth();
    expect(result).toEqual({
      staleProcessingCount: 0,
      pendingBacklogCount: 0,
      staleProcessingThresholdMinutes: STALE_PROCESSING_MINUTES,
      pendingBacklogThreshold: PENDING_BACKLOG_ALERT_THRESHOLD,
      alert: false,
    });
  });

  it("does not alert on a PROCESSING order that is still fresh", async () => {
    const { user, service } = await seedUserAndService();
    await createOrder(user.id, service.id, { status: "PROCESSING", updatedAtMinutesAgo: 1 });

    const result = await checkQueueDepth();
    expect(result.staleProcessingCount).toBe(0);
    expect(result.alert).toBe(false);
  });

  it("alerts on a PROCESSING order stuck past the stale threshold", async () => {
    const { user, service } = await seedUserAndService();
    await createOrder(user.id, service.id, {
      status: "PROCESSING",
      updatedAtMinutesAgo: STALE_PROCESSING_MINUTES + 5,
    });

    const result = await checkQueueDepth();
    expect(result.staleProcessingCount).toBe(1);
    expect(result.alert).toBe(true);
  });

  it("does not count IN_PROGRESS/COMPLETED orders as stale PROCESSING regardless of age", async () => {
    const { user, service } = await seedUserAndService();
    await createOrder(user.id, service.id, {
      status: "IN_PROGRESS",
      updatedAtMinutesAgo: STALE_PROCESSING_MINUTES + 30,
    });
    await createOrder(user.id, service.id, {
      status: "COMPLETED",
      updatedAtMinutesAgo: STALE_PROCESSING_MINUTES + 30,
    });

    const result = await checkQueueDepth();
    expect(result.staleProcessingCount).toBe(0);
    expect(result.alert).toBe(false);
  });

  it("does not alert on a PENDING backlog at or below the threshold", async () => {
    const { user, service } = await seedUserAndService();
    for (let i = 0; i < PENDING_BACKLOG_ALERT_THRESHOLD; i++) {
      await createOrder(user.id, service.id, { status: "PENDING" });
    }

    const result = await checkQueueDepth();
    expect(result.pendingBacklogCount).toBe(PENDING_BACKLOG_ALERT_THRESHOLD);
    expect(result.alert).toBe(false);
  });

  it("alerts once the PENDING backlog exceeds the threshold", async () => {
    const { user, service } = await seedUserAndService();
    for (let i = 0; i < PENDING_BACKLOG_ALERT_THRESHOLD + 1; i++) {
      await createOrder(user.id, service.id, { status: "PENDING" });
    }

    const result = await checkQueueDepth();
    expect(result.pendingBacklogCount).toBe(PENDING_BACKLOG_ALERT_THRESHOLD + 1);
    expect(result.alert).toBe(true);
  });
});
