import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startTestDb, stopTestDb, clearTestDb, getTestClient } from "./setup";
import { approveDeposit, rejectDeposit } from "@/lib/services/admin-payments";
import { toDecimal128, decimalToNumber } from "@/lib/money";
import type { PrismaClient } from "@/lib/generated/prisma";

/**
 * DB-backed integration coverage for `lib/services/admin-payments.ts`
 * (`approveDeposit`/`rejectDeposit`) — see
 * docs/PRODUCTION_READINESS.md's top-priority testing gap and
 * lib/__tests__/integration/orders.integration.test.ts's header comment
 * for the full rationale. Postgres/Prisma edition — see ./setup.ts for the
 * harness rationale and required local-database setup.
 */
describe("lib/services/admin-payments (integration)", () => {
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

  async function seedAdmin() {
    return db.user.create({
      data: {
        name: "Admin",
        email: `admin-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "irrelevant",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
  }

  describe("approveDeposit", () => {
    it("credits the wallet by the payment amount, marks the payment COMPLETED, and records a matching ledger transaction", async () => {
      const { user, wallet } = await seedUserWithWallet("10.00");
      const admin = await seedAdmin();
      const payment = await db.payment.create({
        data: {
          userId: user.id,
          amount: toDecimal128("25.50"),
          method: "MANUAL",
          transactionRef: "REF-001",
          status: "PENDING",
        },
      });

      const result = await approveDeposit(payment.id, admin.id);

      expect(result.status).toBe("COMPLETED");
      expect(result.reviewedBy?.toString()).toBe(admin.id);
      expect(result.reviewedAt).not.toBeNull();

      const updatedWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(updatedWallet!.balance)).toBeCloseTo(35.5, 4); // 10 + 25.50
      expect(updatedWallet!.version).toBe(1);

      const txns = await db.transaction.findMany({ where: { relatedPaymentId: payment.id } });
      expect(txns).toHaveLength(1);
      expect(txns[0].type).toBe("DEPOSIT");
      expect(decimalToNumber(txns[0].amount)).toBeCloseTo(25.5, 4);
      expect(txns[0].idempotencyKey).toBe(`payment-approval:${payment.id}`);
    });

    it("rejects approving a payment that is not PENDING (already processed) and does not touch the wallet", async () => {
      const { user, wallet } = await seedUserWithWallet("10.00");
      const admin = await seedAdmin();
      const payment = await db.payment.create({
        data: {
          userId: user.id,
          amount: toDecimal128("25.50"),
          method: "MANUAL",
          transactionRef: "REF-002",
          status: "COMPLETED", // already processed by someone else
          reviewedBy: admin.id,
          reviewedAt: new Date(),
        },
      });

      await expect(approveDeposit(payment.id, admin.id)).rejects.toMatchObject({
        code: "ALREADY_PROCESSED",
      });

      const unchangedWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(10, 4);
      expect(unchangedWallet!.version).toBe(0);
      expect(await db.transaction.count()).toBe(0);
    });

    it("throws NOT_FOUND for a nonexistent payment id", async () => {
      const admin = await seedAdmin();
      const fakeId = "00000000-0000-0000-0000-000000000000";
      await expect(approveDeposit(fakeId, admin.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("under two concurrent approval attempts on the SAME pending payment, exactly one succeeds and the wallet is credited exactly once (atomic claim + optimistic-concurrency guard)", async () => {
      const { user, wallet } = await seedUserWithWallet("0.00");
      const admin = await seedAdmin();
      const payment = await db.payment.create({
        data: {
          userId: user.id,
          amount: toDecimal128("100.00"),
          method: "MANUAL",
          transactionRef: "REF-003",
          status: "PENDING",
        },
      });

      const attempt = () => approveDeposit(payment.id, admin.id);
      const results = await Promise.allSettled([attempt(), attempt()]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason?.code).toBe("ALREADY_PROCESSED");

      const finalWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(finalWallet!.balance)).toBeCloseTo(100, 4); // credited exactly once, not twice
      expect(finalWallet!.version).toBe(1);
      expect(await db.transaction.count()).toBe(1);
    });
  });

  describe("rejectDeposit", () => {
    it("marks the payment REJECTED with a reason and does not move any money", async () => {
      const { user, wallet } = await seedUserWithWallet("10.00");
      const admin = await seedAdmin();
      const payment = await db.payment.create({
        data: {
          userId: user.id,
          amount: toDecimal128("25.50"),
          method: "MANUAL",
          transactionRef: "REF-004",
          status: "PENDING",
        },
      });

      const result = await rejectDeposit(payment.id, admin.id, "Fake transaction reference");

      expect(result.status).toBe("REJECTED");

      const stored = await db.payment.findUnique({ where: { id: payment.id } });
      expect(stored!.status).toBe("REJECTED");
      expect(stored!.rejectionReason).toBe("Fake transaction reference");

      const unchangedWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
      expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(10, 4);
      expect(await db.transaction.count()).toBe(0);
    });

    it("rejects rejecting a payment that is not PENDING", async () => {
      const { user } = await seedUserWithWallet("10.00");
      const admin = await seedAdmin();
      const payment = await db.payment.create({
        data: {
          userId: user.id,
          amount: toDecimal128("25.50"),
          method: "MANUAL",
          transactionRef: "REF-005",
          status: "COMPLETED",
        },
      });

      await expect(rejectDeposit(payment.id, admin.id)).rejects.toMatchObject({
        code: "ALREADY_PROCESSED",
      });
    });
  });
});
