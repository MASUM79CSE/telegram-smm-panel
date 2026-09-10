import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Types, type HydratedDocument } from "mongoose";
import { Decimal128 } from "mongodb";
import { startTestDb, stopTestDb, clearTestDb } from "./setup";

import { bulkChangeOrderStatus } from "@/lib/services/admin-bulk";
import { User, type IUser } from "@/models/User";
import { Category } from "@/models/Category";
import { Service, type IService } from "@/models/Service";
import { Order, type OrderStatus } from "@/models/Order";

/**
 * DB-backed integration coverage for `lib/services/admin-bulk.ts`
 * (`bulkChangeOrderStatus`) — see
 * lib/__tests__/integration/admin-payments.integration.test.ts's header
 * comment for the harness rationale, and lib/__tests__/admin-bulk.test.ts
 * for the pure-logic guard this service function relies on.
 */
describe("lib/services/admin-bulk — bulkChangeOrderStatus (integration)", () => {
  beforeAll(async () => {
    await startTestDb();
  }, 60_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  async function seedOrder(status: OrderStatus, userId: Types.ObjectId, serviceId: Types.ObjectId) {
    return Order.create({
      userId,
      serviceId,
      quantity: 100,
      target: "https://example.com/post/1",
      charge: Decimal128.fromString("1.00"),
      status,
      statusHistory: [{ status, note: null, at: new Date() }],
    });
  }

  async function seedFixtures(): Promise<{
    user: HydratedDocument<IUser>;
    service: HydratedDocument<IService>;
  }> {
    const user = await User.create({
      name: "Test User",
      email: `user-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "irrelevant",
      role: "USER",
      status: "ACTIVE",
    });
    const category = await Category.create({
      name: "Instagram",
      slug: `ig-${Date.now()}-${Math.random()}`,
    });
    const service = await Service.create({
      name: "IG Followers",
      categoryId: category._id,
      rate: Decimal128.fromString("1.00"),
      minQuantity: 10,
      maxQuantity: 10000,
    });
    return { user, service };
  }

  it("transitions multiple PENDING orders to CANCELED and appends statusHistory", async () => {
    const { user, service } = await seedFixtures();
    const o1 = await seedOrder("PENDING", user._id, service._id);
    const o2 = await seedOrder("PROCESSING", user._id, service._id);

    const result = await bulkChangeOrderStatus(
      [o1._id.toString(), o2._id.toString()],
      "CANCELED",
      "Bulk-canceled by admin"
    );

    expect(result.succeeded).toEqual(expect.arrayContaining([o1._id.toString(), o2._id.toString()]));
    expect(result.failed).toHaveLength(0);

    const reloaded1 = await Order.findById(o1._id);
    const reloaded2 = await Order.findById(o2._id);
    expect(reloaded1!.status).toBe("CANCELED");
    expect(reloaded2!.status).toBe("CANCELED");
    expect(reloaded1!.statusHistory).toHaveLength(2);
    expect(reloaded1!.statusHistory[1].note).toBe("Bulk-canceled by admin");
  });

  it("reports a per-id failure for an id that doesn't exist, without failing the whole batch", async () => {
    const { user, service } = await seedFixtures();
    const o1 = await seedOrder("PENDING", user._id, service._id);
    const missingId = new Types.ObjectId().toString();

    const result = await bulkChangeOrderStatus([o1._id.toString(), missingId], "FAILED", null);

    expect(result.succeeded).toEqual([o1._id.toString()]);
    expect(result.failed).toEqual([{ id: missingId, error: "Order not found." }]);

    const reloaded1 = await Order.findById(o1._id);
    expect(reloaded1!.status).toBe("FAILED");
  });

  it("throws before touching the database when given a non-bulk-safe status (REFUNDED)", async () => {
    const { user, service } = await seedFixtures();
    const o1 = await seedOrder("PENDING", user._id, service._id);

    await expect(bulkChangeOrderStatus([o1._id.toString()], "REFUNDED", null)).rejects.toThrow(
      /not permitted for bulk/i
    );

    const reloaded1 = await Order.findById(o1._id);
    expect(reloaded1!.status).toBe("PENDING");
  });

  it("throws before touching the database when given a non-bulk-safe status (COMPLETED)", async () => {
    const { user, service } = await seedFixtures();
    const o1 = await seedOrder("PENDING", user._id, service._id);

    await expect(bulkChangeOrderStatus([o1._id.toString()], "COMPLETED", null)).rejects.toThrow(
      /not permitted for bulk/i
    );

    const reloaded1 = await Order.findById(o1._id);
    expect(reloaded1!.status).toBe("PENDING");
  });

  it("reports a generic, sanitized error for a malformed id — never a raw Mongoose CastError message", async () => {
    const { user, service } = await seedFixtures();
    const o1 = await seedOrder("PENDING", user._id, service._id);

    const result = await bulkChangeOrderStatus([o1._id.toString(), "not-a-valid-object-id"], "CANCELED", null);

    expect(result.succeeded).toEqual([o1._id.toString()]);
    expect(result.failed).toEqual([{ id: "not-a-valid-object-id", error: "Failed to update this order." }]);
    // Guard against a regression that re-leaks internal schema/model
    // details (Mongoose's CastError message format) to API clients.
    expect(result.failed[0].error).not.toMatch(/mongoose|cast|schema|path/i);
  });

  it("rejects an empty id list", async () => {
    await expect(bulkChangeOrderStatus([], "CANCELED", null)).rejects.toThrow(/no order ids/i);
  });

  it("caps a single bulk call at 100 ids", async () => {
    const ids = Array.from({ length: 101 }, () => new Types.ObjectId().toString());
    await expect(bulkChangeOrderStatus(ids, "CANCELED", null)).rejects.toThrow(/too many/i);
  });
});
