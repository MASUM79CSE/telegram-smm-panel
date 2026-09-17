import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startTestDb, stopTestDb, clearTestDb, getTestClient } from "./setup";
import { refundOrder } from "@/lib/services/admin-orders";
import { issuePartialRefund } from "@/lib/services/refunds";
import { toDecimal128, decimalToNumber } from "@/lib/money";
import type { PrismaClient, OrderStatus } from "@/lib/generated/prisma";

/**
 * DB-backed integration coverage for the two order-refund paths —
 * `lib/services/admin-orders.ts#refundOrder` (full admin-triggered refund)
 * and `lib/services/refunds.ts#issuePartialRefund` (automatic
 * partial-delivery refund, docs/IMPLEMENTATION_PLAN.md Phase 3.2) — see
 * docs/PRODUCTION_READINESS.md's top-priority testing gap and
 * lib/__tests__/integration/orders.integration.test.ts's header comment
 * for the full rationale. Postgres/Prisma edition.
 */
describe("order refund paths (integration)", () => {
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

  async function seedUserWithWallet(balance: string) {
    const user = await db.user.create({
      data: {
        name: "Test User",
        email: `user-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "irrelevant",
        role: "USER",
        status: "ACTIVE",
      },
    });
    const wallet = await db.wallet.create({
      data: { userId: user.id, balance: toDecimal128(balance), currency: "USD" },
    });
    return { user, wallet };
  }

  async function seedService(rate = "10.0000") {
    const category = await db.category.create({
      data: { name: "Category", slug: `cat-${Date.now()}-${Math.random()}` },
    });
    return db.service.create({
      data: {
        categoryId: category.id,
        name: "Test Service",
        rate: toDecimal128(rate),
        minQuantity: 100,
        maxQuantity: 10000,
      },
    });
  }

  async function seedOrder(opts: {
    userId: string;
    serviceId: string;
    quantity: number;
    charge: string;
    status: OrderStatus;
  }) {
    return db.order.create({
      data: {
        userId: opts.userId,
        serviceId: opts.serviceId,
        target: "https://example.com/profile",
        quantity: opts.quantity,
        charge: toDecimal128(opts.charge),
        status: opts.status,
        statusHistory: [{ status: opts.status, note: "seeded", at: new Date().toISOString() }],
      },
    });
  }

  describe("refundOrder", () => {
    it("credits the wallet with the full order charge, marks the order REFUNDED, and records a ledger transaction", async () => {
      const { user, wallet } = await seedUserWithWallet("5.00");
      const service = await seedService();
      const order = await seedOrder({
        userId: user.id,
        serviceId: service.id,
        quantity: 1000,
        charge: "10.00",
        status: "PROCESSING",
      });

      const result = await refundOrder(order.id, "Provider could not fulfill");

      expect(result.status).toBe("REFUNDED");

      const updatedWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(updatedWallet!.balance)).toBeCloseTo(15, 4); // 5 + 10
      expect(updatedWallet!.version).toBe(1);

      const txns = await db.transaction.findMany({ where: { relatedOrderId: order.id } });
      expect(txns).toHaveLength(1);
      expect(txns[0].type).toBe("ORDER_REFUND");
      expect(decimalToNumber(txns[0].amount)).toBeCloseTo(10, 4);
      expect(txns[0].idempotencyKey).toBe(`order-refund:${order.id}`);
    });

    it("rejects refunding an order that is already REFUNDED, and does not double-credit the wallet", async () => {
      const { user, wallet } = await seedUserWithWallet("5.00");
      const service = await seedService();
      const order = await seedOrder({
        userId: user.id,
        serviceId: service.id,
        quantity: 1000,
        charge: "10.00",
        status: "REFUNDED",
      });

      await expect(refundOrder(order.id)).rejects.toMatchObject({ code: "ALREADY_REFUNDED_OR_NOT_FOUND" });

      const unchangedWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(5, 4);
      expect(await db.transaction.count()).toBe(0);
    });

    it("throws ALREADY_REFUNDED_OR_NOT_FOUND for a nonexistent order id", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      await expect(refundOrder(fakeId)).rejects.toMatchObject({ code: "ALREADY_REFUNDED_OR_NOT_FOUND" });
    });

    it("under two concurrent refund attempts on the SAME order, exactly one succeeds and the wallet is credited exactly once (atomic claim guard)", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      const order = await seedOrder({
        userId: user.id,
        serviceId: service.id,
        quantity: 1000,
        charge: "10.00",
        status: "PROCESSING",
      });

      const attempt = () => refundOrder(order.id);
      const results = await Promise.allSettled([attempt(), attempt()]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason?.code).toBe("ALREADY_REFUNDED_OR_NOT_FOUND");

      const finalWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(finalWallet!.balance)).toBeCloseTo(10, 4); // credited exactly once, not twice
      expect(finalWallet!.version).toBe(1);
      expect(await db.transaction.count()).toBe(1);
    });
  });

  describe("issuePartialRefund", () => {
    it("credits the wallet with the proportional undelivered share, marks the order PARTIAL, and records a ledger transaction", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      // $10 total charge for 1000 units => $0.01/unit; 300 undelivered => $3.00 refund
      const order = await seedOrder({
        userId: user.id,
        serviceId: service.id,
        quantity: 1000,
        charge: "10.00",
        status: "IN_PROGRESS",
      });

      const result = await issuePartialRefund(order.id, 300);

      expect(result).not.toBeNull();
      expect(result!.status).toBe("PARTIAL");
      expect(result!.remains).toBe(300);
      expect(result!.partialRefundIssuedAt).not.toBeNull();

      const updatedWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(updatedWallet!.balance)).toBeCloseTo(3, 4);
      expect(updatedWallet!.version).toBe(1);

      const txns = await db.transaction.findMany({ where: { relatedOrderId: order.id } });
      expect(txns).toHaveLength(1);
      expect(txns[0].type).toBe("ORDER_REFUND");
      expect(decimalToNumber(txns[0].amount)).toBeCloseTo(3, 4);
      expect(txns[0].idempotencyKey).toBe(`partial-refund:${order.id}`);
    });

    it("clamps remains to the order's original quantity if the provider reports an out-of-range value", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      const order = await seedOrder({
        userId: user.id,
        serviceId: service.id,
        quantity: 1000,
        charge: "10.00",
        status: "IN_PROGRESS",
      });

      const result = await issuePartialRefund(order.id, 5000); // provider reports more than possible

      expect(result!.remains).toBe(1000); // clamped to quantity
      const updatedWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(updatedWallet!.balance)).toBeCloseTo(10, 4); // full charge refunded, not more
    });

    it("is a safe no-op (idempotent) when called twice for the same order — the second call does not double-refund", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      const order = await seedOrder({
        userId: user.id,
        serviceId: service.id,
        quantity: 1000,
        charge: "10.00",
        status: "IN_PROGRESS",
      });

      const first = await issuePartialRefund(order.id, 300);
      expect(first).not.toBeNull();

      // Second call: order is no longer IN_PROGRESS (now PARTIAL) AND
      // partialRefundIssuedAt is already set — the atomic claim in
      // issuePartialRefund must reject this as already-claimed.
      const second = await issuePartialRefund(order.id, 300);
      expect(second).toBeNull();

      const finalWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(finalWallet!.balance)).toBeCloseTo(3, 4); // refunded exactly once
      expect(finalWallet!.version).toBe(1);
      expect(await db.transaction.count()).toBe(1);
    });

    it("returns null and does not touch the wallet for an order that is not IN_PROGRESS", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      const order = await seedOrder({
        userId: user.id,
        serviceId: service.id,
        quantity: 1000,
        charge: "10.00",
        status: "COMPLETED",
      });

      const result = await issuePartialRefund(order.id, 300);

      expect(result).toBeNull();
      const unchangedWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(0, 4);
      expect(await db.transaction.count()).toBe(0);
    });

    it("under two concurrent partial-refund attempts for the SAME order, exactly one credits the wallet (atomic claim guard)", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      const order = await seedOrder({
        userId: user.id,
        serviceId: service.id,
        quantity: 1000,
        charge: "10.00",
        status: "IN_PROGRESS",
      });

      const attempt = () => issuePartialRefund(order.id, 300);
      const results = await Promise.all([attempt(), attempt()]);

      const nonNullResults = results.filter((r) => r !== null);
      expect(nonNullResults).toHaveLength(1);

      const finalWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(finalWallet!.balance)).toBeCloseTo(3, 4); // refunded exactly once
      expect(finalWallet!.version).toBe(1);
      expect(await db.transaction.count()).toBe(1);
    });
  });
});
