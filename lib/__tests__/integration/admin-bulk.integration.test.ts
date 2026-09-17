import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { startTestDb, stopTestDb, clearTestDb, getTestClient } from "./setup";

import { bulkChangeOrderStatus } from "@/lib/services/admin-bulk";
import type { PrismaClient, OrderStatus } from "@/lib/generated/prisma";
import { toDecimal128 } from "@/lib/money";

/**
 * DB-backed integration coverage for `lib/services/admin-bulk.ts`
 * (`bulkChangeOrderStatus`) — see
 * lib/__tests__/integration/admin-payments.integration.test.ts's header
 * comment for the harness rationale, and lib/__tests__/admin-bulk.test.ts
 * for the pure-logic guard this service function relies on. Postgres/
 * Prisma edition.
 */
describe("lib/services/admin-bulk — bulkChangeOrderStatus (integration)", () => {
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

  async function seedOrder(status: OrderStatus, userId: string, serviceId: string) {
    return db.order.create({
      data: {
        userId,
        serviceId,
        quantity: 100,
        target: "https://example.com/post/1",
        charge: toDecimal128("1.00"),
        status,
        statusHistory: [{ status, note: null, at: new Date().toISOString() }],
      },
    });
  }

  async function seedFixtures() {
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
      data: { name: "Instagram", slug: `ig-${Date.now()}-${Math.random()}` },
    });
    const service = await db.service.create({
      data: {
        name: "IG Followers",
        categoryId: category.id,
        rate: toDecimal128("1.00"),
        minQuantity: 10,
        maxQuantity: 10000,
      },
    });
    return { user, service };
  }

  it("transitions multiple PENDING orders to CANCELED and appends statusHistory", async () => {
    const { user, service } = await seedFixtures();
    const o1 = await seedOrder("PENDING", user.id, service.id);
    const o2 = await seedOrder("PROCESSING", user.id, service.id);

    const result = await bulkChangeOrderStatus([o1.id, o2.id], "CANCELED", "Bulk-canceled by admin");

    expect(result.succeeded).toEqual(expect.arrayContaining([o1.id, o2.id]));
    expect(result.failed).toHaveLength(0);

    const reloaded1 = await db.order.findUnique({ where: { id: o1.id } });
    const reloaded2 = await db.order.findUnique({ where: { id: o2.id } });
    expect(reloaded1!.status).toBe("CANCELED");
    expect(reloaded2!.status).toBe("CANCELED");
    const history1 = reloaded1!.statusHistory as Array<{ status: string; note: string | null }>;
    expect(history1).toHaveLength(2);
    expect(history1[1].note).toBe("Bulk-canceled by admin");
  });

  it("reports a per-id failure for an id that doesn't exist, without failing the whole batch", async () => {
    const { user, service } = await seedFixtures();
    const o1 = await seedOrder("PENDING", user.id, service.id);
    const missingId = randomUUID();

    const result = await bulkChangeOrderStatus([o1.id, missingId], "FAILED", null);

    expect(result.succeeded).toEqual([o1.id]);
    expect(result.failed).toEqual([{ id: missingId, error: "Order not found." }]);

    const reloaded1 = await db.order.findUnique({ where: { id: o1.id } });
    expect(reloaded1!.status).toBe("FAILED");
  });

  it("throws before touching the database when given a non-bulk-safe status (REFUNDED)", async () => {
    const { user, service } = await seedFixtures();
    const o1 = await seedOrder("PENDING", user.id, service.id);

    await expect(bulkChangeOrderStatus([o1.id], "REFUNDED", null)).rejects.toThrow(/not permitted for bulk/i);

    const reloaded1 = await db.order.findUnique({ where: { id: o1.id } });
    expect(reloaded1!.status).toBe("PENDING");
  });

  it("throws before touching the database when given a non-bulk-safe status (COMPLETED)", async () => {
    const { user, service } = await seedFixtures();
    const o1 = await seedOrder("PENDING", user.id, service.id);

    await expect(bulkChangeOrderStatus([o1.id], "COMPLETED", null)).rejects.toThrow(/not permitted for bulk/i);

    const reloaded1 = await db.order.findUnique({ where: { id: o1.id } });
    expect(reloaded1!.status).toBe("PENDING");
  });

  it("treats a malformed (non-existent-shaped) id as a plain not-found, not a raw Prisma error", async () => {
    // Unlike the original MongoDB/Mongoose version — where a syntactically
    // invalid ObjectId threw a raw `CastError` before any query ran, which
    // this function had to specifically catch and sanitize — Postgres/
    // Prisma's `Order.id` is a plain `String` column (`@id @default(uuid())`,
    // not a DB-enforced UUID type), so an arbitrary non-UUID string is just
    // a normal, well-typed query argument that simply matches zero rows.
    // There is no separate "malformed vs. merely nonexistent" case left to
    // distinguish; this test exists to pin that the two orders are now
    // reported identically. See lib/services/admin-bulk.ts's own catch
    // branch for the OTHER error path (an unexpected exception) it still
    // guards against.
    const { user, service } = await seedFixtures();
    const o1 = await seedOrder("PENDING", user.id, service.id);

    const result = await bulkChangeOrderStatus([o1.id, "not-a-valid-id-shape"], "CANCELED", null);

    expect(result.succeeded).toEqual([o1.id]);
    expect(result.failed).toEqual([{ id: "not-a-valid-id-shape", error: "Order not found." }]);
    // Guard against a regression that re-leaks internal schema/model
    // details (a raw Prisma validation-error message format) to API
    // clients.
    expect(result.failed[0].error).not.toMatch(/prisma|invalid.*argument|schema|column/i);
  });

  it("rejects an empty id list", async () => {
    await expect(bulkChangeOrderStatus([], "CANCELED", null)).rejects.toThrow(/no order ids/i);
  });

  it("caps a single bulk call at 100 ids", async () => {
    const ids = Array.from({ length: 101 }, () => randomUUID());
    await expect(bulkChangeOrderStatus(ids, "CANCELED", null)).rejects.toThrow(/too many/i);
  });
});
