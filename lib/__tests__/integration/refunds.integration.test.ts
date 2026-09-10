import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Decimal128, ObjectId } from "mongodb";
import { startTestDb, stopTestDb, clearTestDb } from "./setup";
import { refundOrder } from "@/lib/services/admin-orders";
import { issuePartialRefund } from "@/lib/services/refunds";
import { User } from "@/models/User";
import { Wallet } from "@/models/Wallet";
import { Category } from "@/models/Category";
import { Service } from "@/models/Service";
import { Order } from "@/models/Order";
import { Transaction } from "@/models/Transaction";
import { decimalToNumber } from "@/lib/money";

/**
 * DB-backed integration coverage for the two order-refund paths —
 * `lib/services/admin-orders.ts#refundOrder` (full admin-triggered refund)
 * and `lib/services/refunds.ts#issuePartialRefund` (automatic
 * partial-delivery refund, docs/IMPLEMENTATION_PLAN.md Phase 3.2) — see
 * docs/PRODUCTION_READINESS.md's top-priority testing gap and
 * lib/__tests__/integration/orders.integration.test.ts's header comment
 * for the full rationale.
 */
describe("order refund paths (integration)", () => {
  beforeAll(async () => {
    await startTestDb();
  }, 60_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  async function seedUserWithWallet(balance: string) {
    const user = await User.create({
      name: "Test User",
      email: `user-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "irrelevant",
      role: "USER",
      status: "ACTIVE",
    });
    const wallet = await Wallet.create({
      userId: user._id,
      balance: Decimal128.fromString(balance),
      currency: "USD",
    });
    return { user, wallet };
  }

  async function seedService(rate = "10.0000") {
    const category = await Category.create({ name: "Category", slug: `cat-${Date.now()}-${Math.random()}` });
    return Service.create({
      categoryId: category._id,
      name: "Test Service",
      rate: Decimal128.fromString(rate),
      minQuantity: 100,
      maxQuantity: 10000,
    });
  }

  async function seedOrder(opts: {
    userId: ObjectId;
    serviceId: ObjectId;
    quantity: number;
    charge: string;
    status: "PENDING" | "PROCESSING" | "IN_PROGRESS" | "COMPLETED" | "PARTIAL" | "CANCELED" | "FAILED" | "REFUNDED";
  }) {
    return Order.create({
      userId: opts.userId,
      serviceId: opts.serviceId,
      target: "https://example.com/profile",
      quantity: opts.quantity,
      charge: Decimal128.fromString(opts.charge),
      status: opts.status,
      statusHistory: [{ status: opts.status, note: "seeded", at: new Date() }],
    });
  }

  describe("refundOrder", () => {
    it("credits the wallet with the full order charge, marks the order REFUNDED, and records a ledger transaction", async () => {
      const { user, wallet } = await seedUserWithWallet("5.00");
      const service = await seedService();
      const order = await seedOrder({ userId: user._id, serviceId: service._id, quantity: 1000, charge: "10.00", status: "PROCESSING" });

      const result = await refundOrder(order._id.toString(), "Provider could not fulfill");

      expect(result.status).toBe("REFUNDED");

      const updatedWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(updatedWallet!.balance)).toBeCloseTo(15, 4); // 5 + 10
      expect(updatedWallet!.version).toBe(1);

      const txns = await Transaction.find({ relatedOrderId: order._id });
      expect(txns).toHaveLength(1);
      expect(txns[0].type).toBe("ORDER_REFUND");
      expect(decimalToNumber(txns[0].amount)).toBeCloseTo(10, 4);
      expect(txns[0].idempotencyKey).toBe(`order-refund:${order._id.toString()}`);
    });

    it("rejects refunding an order that is already REFUNDED, and does not double-credit the wallet", async () => {
      const { user, wallet } = await seedUserWithWallet("5.00");
      const service = await seedService();
      const order = await seedOrder({ userId: user._id, serviceId: service._id, quantity: 1000, charge: "10.00", status: "REFUNDED" });

      await expect(refundOrder(order._id.toString())).rejects.toMatchObject({ code: "ALREADY_REFUNDED_OR_NOT_FOUND" });

      const unchangedWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(5, 4);
      expect(await Transaction.countDocuments()).toBe(0);
    });

    it("throws ALREADY_REFUNDED_OR_NOT_FOUND for a nonexistent order id", async () => {
      const fakeId = "507f1f77bcf86cd799439011";
      await expect(refundOrder(fakeId)).rejects.toMatchObject({ code: "ALREADY_REFUNDED_OR_NOT_FOUND" });
    });

    it("under two concurrent refund attempts on the SAME order, exactly one succeeds and the wallet is credited exactly once (atomic claim guard)", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      const order = await seedOrder({ userId: user._id, serviceId: service._id, quantity: 1000, charge: "10.00", status: "PROCESSING" });

      const attempt = () => refundOrder(order._id.toString());
      const results = await Promise.allSettled([attempt(), attempt()]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason?.code).toBe("ALREADY_REFUNDED_OR_NOT_FOUND");

      const finalWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(finalWallet!.balance)).toBeCloseTo(10, 4); // credited exactly once, not twice
      expect(finalWallet!.version).toBe(1);
      expect(await Transaction.countDocuments()).toBe(1);
    });
  });

  describe("issuePartialRefund", () => {
    it("credits the wallet with the proportional undelivered share, marks the order PARTIAL, and records a ledger transaction", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      // $10 total charge for 1000 units => $0.01/unit; 300 undelivered => $3.00 refund
      const order = await seedOrder({ userId: user._id, serviceId: service._id, quantity: 1000, charge: "10.00", status: "IN_PROGRESS" });

      const result = await issuePartialRefund(order._id.toString(), 300);

      expect(result).not.toBeNull();
      expect(result!.status).toBe("PARTIAL");
      expect(result!.remains).toBe(300);
      expect(result!.partialRefundIssuedAt).not.toBeNull();

      const updatedWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(updatedWallet!.balance)).toBeCloseTo(3, 4);
      expect(updatedWallet!.version).toBe(1);

      const txns = await Transaction.find({ relatedOrderId: order._id });
      expect(txns).toHaveLength(1);
      expect(txns[0].type).toBe("ORDER_REFUND");
      expect(decimalToNumber(txns[0].amount)).toBeCloseTo(3, 4);
      expect(txns[0].idempotencyKey).toBe(`partial-refund:${order._id.toString()}`);
    });

    it("clamps remains to the order's original quantity if the provider reports an out-of-range value", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      const order = await seedOrder({ userId: user._id, serviceId: service._id, quantity: 1000, charge: "10.00", status: "IN_PROGRESS" });

      const result = await issuePartialRefund(order._id.toString(), 5000); // provider reports more than possible

      expect(result!.remains).toBe(1000); // clamped to quantity
      const updatedWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(updatedWallet!.balance)).toBeCloseTo(10, 4); // full charge refunded, not more
    });

    it("is a safe no-op (idempotent) when called twice for the same order — the second call does not double-refund", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      const order = await seedOrder({ userId: user._id, serviceId: service._id, quantity: 1000, charge: "10.00", status: "IN_PROGRESS" });

      const first = await issuePartialRefund(order._id.toString(), 300);
      expect(first).not.toBeNull();

      // Second call: order is no longer IN_PROGRESS (now PARTIAL) AND
      // partialRefundIssuedAt is already set — the atomic claim in
      // issuePartialRefund must reject this as already-claimed.
      const second = await issuePartialRefund(order._id.toString(), 300);
      expect(second).toBeNull();

      const finalWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(finalWallet!.balance)).toBeCloseTo(3, 4); // refunded exactly once
      expect(finalWallet!.version).toBe(1);
      expect(await Transaction.countDocuments()).toBe(1);
    });

    it("returns null and does not touch the wallet for an order that is not IN_PROGRESS", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      const order = await seedOrder({ userId: user._id, serviceId: service._id, quantity: 1000, charge: "10.00", status: "COMPLETED" });

      const result = await issuePartialRefund(order._id.toString(), 300);

      expect(result).toBeNull();
      const unchangedWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(0, 4);
      expect(await Transaction.countDocuments()).toBe(0);
    });

    it("under two concurrent partial-refund attempts for the SAME order, exactly one credits the wallet (atomic claim guard)", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const service = await seedService();
      const order = await seedOrder({ userId: user._id, serviceId: service._id, quantity: 1000, charge: "10.00", status: "IN_PROGRESS" });

      const attempt = () => issuePartialRefund(order._id.toString(), 300);
      const results = await Promise.all([attempt(), attempt()]);

      const nonNullResults = results.filter((r) => r !== null);
      expect(nonNullResults).toHaveLength(1);

      const finalWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(finalWallet!.balance)).toBeCloseTo(3, 4); // refunded exactly once
      expect(finalWallet!.version).toBe(1);
      expect(await Transaction.countDocuments()).toBe(1);
    });
  });
});
