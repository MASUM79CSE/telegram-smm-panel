import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Decimal128 } from "mongodb";
import { startTestDb, stopTestDb, clearTestDb } from "./setup";
import { approveDeposit, rejectDeposit } from "@/lib/services/admin-payments";
import { User } from "@/models/User";
import { Wallet } from "@/models/Wallet";
import { Payment } from "@/models/Payment";
import { Transaction } from "@/models/Transaction";
import { decimalToNumber } from "@/lib/money";

/**
 * DB-backed integration coverage for `lib/services/admin-payments.ts`
 * (`approveDeposit`/`rejectDeposit`) — see
 * docs/PRODUCTION_READINESS.md's top-priority testing gap and
 * lib/__tests__/integration/orders.integration.test.ts's header comment
 * for the full rationale.
 */
describe("lib/services/admin-payments (integration)", () => {
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

  async function seedAdmin() {
    return User.create({
      name: "Admin",
      email: `admin-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "irrelevant",
      role: "ADMIN",
      status: "ACTIVE",
    });
  }

  describe("approveDeposit", () => {
    it("credits the wallet by the payment amount, marks the payment COMPLETED, and records a matching ledger transaction", async () => {
      const { user, wallet } = await seedUserWithWallet("10.00");
      const admin = await seedAdmin();
      const payment = await Payment.create({
        userId: user._id,
        amount: Decimal128.fromString("25.50"),
        method: "MANUAL",
        transactionRef: "REF-001",
        status: "PENDING",
      });

      const result = await approveDeposit(payment._id.toString(), admin._id.toString());

      expect(result.status).toBe("COMPLETED");
      expect(result.reviewedBy?.toString()).toBe(admin._id.toString());
      expect(result.reviewedAt).not.toBeNull();

      const updatedWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(updatedWallet!.balance)).toBeCloseTo(35.5, 4); // 10 + 25.50
      expect(updatedWallet!.version).toBe(1);

      const txns = await Transaction.find({ relatedPaymentId: payment._id });
      expect(txns).toHaveLength(1);
      expect(txns[0].type).toBe("DEPOSIT");
      expect(decimalToNumber(txns[0].amount)).toBeCloseTo(25.5, 4);
      expect(txns[0].idempotencyKey).toBe(`payment-approval:${payment._id.toString()}`);
    });

    it("rejects approving a payment that is not PENDING (already processed) and does not touch the wallet", async () => {
      const { user, wallet } = await seedUserWithWallet("10.00");
      const admin = await seedAdmin();
      const payment = await Payment.create({
        userId: user._id,
        amount: Decimal128.fromString("25.50"),
        method: "MANUAL",
        transactionRef: "REF-002",
        status: "COMPLETED", // already processed by someone else
        reviewedBy: admin._id,
        reviewedAt: new Date(),
      });

      await expect(approveDeposit(payment._id.toString(), admin._id.toString())).rejects.toMatchObject({
        code: "ALREADY_PROCESSED",
      });

      const unchangedWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(10, 4);
      expect(unchangedWallet!.version).toBe(0);
      expect(await Transaction.countDocuments()).toBe(0);
    });

    it("throws NOT_FOUND for a nonexistent payment id", async () => {
      const admin = await seedAdmin();
      const fakeId = "507f1f77bcf86cd799439011";
      await expect(approveDeposit(fakeId, admin._id.toString())).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("under two concurrent approval attempts on the SAME pending payment, exactly one succeeds and the wallet is credited exactly once (atomic claim + optimistic-concurrency guard)", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const admin = await seedAdmin();
      const payment = await Payment.create({
        userId: user._id,
        amount: Decimal128.fromString("100.00"),
        method: "MANUAL",
        transactionRef: "REF-003",
        status: "PENDING",
      });

      const attempt = () => approveDeposit(payment._id.toString(), admin._id.toString());
      const results = await Promise.allSettled([attempt(), attempt()]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason?.code).toBe("ALREADY_PROCESSED");

      const finalWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(finalWallet!.balance)).toBeCloseTo(100, 4); // credited exactly once, not twice
      expect(finalWallet!.version).toBe(1);
      expect(await Transaction.countDocuments()).toBe(1);
    });
  });

  describe("rejectDeposit", () => {
    it("marks the payment REJECTED with a reason and does not move any money", async () => {
      const { user, wallet } = await seedUserWithWallet("10.00");
      const admin = await seedAdmin();
      const payment = await Payment.create({
        userId: user._id,
        amount: Decimal128.fromString("25.50"),
        method: "MANUAL",
        transactionRef: "REF-004",
        status: "PENDING",
      });

      const result = await rejectDeposit(payment._id.toString(), admin._id.toString(), "Fake transaction reference");

      expect(result.status).toBe("REJECTED");

      const stored = await Payment.findById(payment._id);
      expect(stored!.status).toBe("REJECTED");
      expect(stored!.rejectionReason).toBe("Fake transaction reference");

      const unchangedWallet = await Wallet.findById(wallet._id);
      expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(10, 4);
      expect(await Transaction.countDocuments()).toBe(0);
    });

    it("rejects rejecting a payment that is not PENDING", async () => {
      const { user } = await seedUserWithWallet("10.00");
      const admin = await seedAdmin();
      const payment = await Payment.create({
        userId: user._id,
        amount: Decimal128.fromString("25.50"),
        method: "MANUAL",
        transactionRef: "REF-005",
        status: "COMPLETED",
      });

      await expect(rejectDeposit(payment._id.toString(), admin._id.toString())).rejects.toMatchObject({
        code: "ALREADY_PROCESSED",
      });
    });
  });
});
