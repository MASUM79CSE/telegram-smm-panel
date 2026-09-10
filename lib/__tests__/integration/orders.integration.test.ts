import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Types } from "mongoose";
import { Decimal128 } from "mongodb";
import { startTestDb, stopTestDb, clearTestDb } from "./setup";

/**
 * `placeOrder` fires a deliberately-uncaught-by-the-caller, best-effort
 * `dispatchOrderToProvider(orderId).catch(console.error)` immediately
 * after committing the order+wallet-debit transaction (see
 * lib/services/orders.ts) — by design, a dispatch failure must never roll
 * back an already-paid-for order. Fulfillment/dispatch behavior itself
 * (candidate resolution, provider API calls, retry/manual-fulfillment
 * fallback) is a separate concern with its own extensive doc comments in
 * lib/fulfillment.ts and is out of scope for these tests, which are
 * specifically about the money-moving transaction. Mock it out so these
 * tests exercise exactly `placeOrder`'s own transactional logic, without
 * `dispatchOrderToProvider`'s real behavior (which would call
 * `connectDB()` — a second, real-env-var-dependent Mongoose connection
 * this test suite deliberately doesn't set up) running as an uncontrolled
 * side effect in the background.
 */
vi.mock("@/lib/fulfillment", () => ({
  dispatchOrderToProvider: vi.fn().mockResolvedValue(undefined),
}));

import { placeOrder } from "@/lib/services/orders";
import { User } from "@/models/User";
import { Wallet } from "@/models/Wallet";
import { Category } from "@/models/Category";
import { Service } from "@/models/Service";
import { Order } from "@/models/Order";
import { Transaction } from "@/models/Transaction";
import { decimalToNumber } from "@/lib/money";

/**
 * DB-backed integration coverage for `lib/services/orders.ts#placeOrder` —
 * the exact gap flagged as top priority in
 * `docs/PRODUCTION_READINESS.md` ("no DB-backed integration or e2e
 * coverage" for the transactional money-moving service functions).
 *
 * Runs against a real MongoDB replica set via `mongodb-memory-server`
 * (see ./setup.ts) so the actual `mongoose.startSession().withTransaction()`
 * + `Wallet.version` optimistic-concurrency code path executes for real,
 * not a mock — this is deliberately the part that's hardest (and most
 * dangerous to get wrong) to verify by hand, per this project's own
 * MEMORY.md §5 callout.
 */
describe("lib/services/orders — placeOrder (integration)", () => {
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
      email: `user-${new Types.ObjectId().toString()}@example.com`,
      passwordHash: "irrelevant-for-this-test",
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

  async function seedService(overrides: Partial<{ rate: string; minQuantity: number; maxQuantity: number; active: boolean }> = {}) {
    const category = await Category.create({ name: "Category", slug: `cat-${Date.now()}-${Math.random()}` });
    const service = await Service.create({
      categoryId: category._id,
      name: "Test Service",
      rate: Decimal128.fromString(overrides.rate ?? "10.0000"), // $10 per 1000
      minQuantity: overrides.minQuantity ?? 100,
      maxQuantity: overrides.maxQuantity ?? 10000,
      active: overrides.active ?? true,
    });
    return service;
  }

  it("debits the wallet, creates an order, and records a matching ledger transaction", async () => {
    const { user, wallet } = await seedUserWithWallet("50.00");
    const service = await seedService({ rate: "10.0000" }); // $10/1000 units

    const order = await placeOrder({
      userId: user._id.toString(),
      userStatus: "ACTIVE",
      serviceId: service._id.toString(),
      target: "https://example.com/profile",
      quantity: 1000, // exactly $10 charge
    });

    expect(order.status).toBe("PENDING");
    expect(decimalToNumber(order.charge)).toBeCloseTo(10, 4);

    const updatedWallet = await Wallet.findById(wallet._id);
    expect(decimalToNumber(updatedWallet!.balance)).toBeCloseTo(40, 4);
    expect(updatedWallet!.version).toBe(1); // incremented exactly once

    const txns = await Transaction.find({ relatedOrderId: order._id });
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe("ORDER_PAYMENT");
    expect(txns[0].status).toBe("COMPLETED");
    expect(decimalToNumber(txns[0].amount)).toBeCloseTo(10, 4);
    expect(decimalToNumber(txns[0].balanceBefore)).toBeCloseTo(50, 4);
    expect(decimalToNumber(txns[0].balanceAfter)).toBeCloseTo(40, 4);
  });

  it("rejects an order for a SUSPENDED/non-ACTIVE account before touching the wallet", async () => {
    const { user, wallet } = await seedUserWithWallet("50.00");
    const service = await seedService();

    await expect(
      placeOrder({
        userId: user._id.toString(),
        userStatus: "SUSPENDED",
        serviceId: service._id.toString(),
        target: "https://example.com/profile",
        quantity: 1000,
      })
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" });

    const unchangedWallet = await Wallet.findById(wallet._id);
    expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(50, 4);
    expect(unchangedWallet!.version).toBe(0);
    expect(await Order.countDocuments()).toBe(0);
  });

  it("rejects an order for a nonexistent or inactive service", async () => {
    const { user } = await seedUserWithWallet("50.00");
    const service = await seedService({ active: false });

    await expect(
      placeOrder({
        userId: user._id.toString(),
        userStatus: "ACTIVE",
        serviceId: service._id.toString(),
        target: "https://example.com/profile",
        quantity: 1000,
      })
    ).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
  });

  it("rejects a quantity outside the service's min/max bounds without moving money", async () => {
    const { user, wallet } = await seedUserWithWallet("50.00");
    const service = await seedService({ minQuantity: 100, maxQuantity: 5000 });

    await expect(
      placeOrder({
        userId: user._id.toString(),
        userStatus: "ACTIVE",
        serviceId: service._id.toString(),
        target: "https://example.com/profile",
        quantity: 50, // below minQuantity
      })
    ).rejects.toMatchObject({ code: "INVALID_QUANTITY" });

    await expect(
      placeOrder({
        userId: user._id.toString(),
        userStatus: "ACTIVE",
        serviceId: service._id.toString(),
        target: "https://example.com/profile",
        quantity: 10000, // above maxQuantity
      })
    ).rejects.toMatchObject({ code: "INVALID_QUANTITY" });

    const unchangedWallet = await Wallet.findById(wallet._id);
    expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(50, 4);
    expect(await Order.countDocuments()).toBe(0);
  });

  it("rejects an order when the wallet balance is insufficient, leaving the wallet and order collection untouched", async () => {
    const { user, wallet } = await seedUserWithWallet("5.00"); // not enough for a $10 charge
    const service = await seedService({ rate: "10.0000" });

    await expect(
      placeOrder({
        userId: user._id.toString(),
        userStatus: "ACTIVE",
        serviceId: service._id.toString(),
        target: "https://example.com/profile",
        quantity: 1000,
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    const unchangedWallet = await Wallet.findById(wallet._id);
    expect(decimalToNumber(unchangedWallet!.balance)).toBeCloseTo(5, 4);
    expect(unchangedWallet!.version).toBe(0);
    expect(await Order.countDocuments()).toBe(0);
    expect(await Transaction.countDocuments()).toBe(0);
  });

  it("throws WALLET_NOT_FOUND if a user somehow has no wallet document", async () => {
    const user = await User.create({
      name: "No Wallet User",
      email: "nowallet@example.com",
      passwordHash: "irrelevant",
      role: "USER",
      status: "ACTIVE",
    });
    const service = await seedService();

    await expect(
      placeOrder({
        userId: user._id.toString(),
        userStatus: "ACTIVE",
        serviceId: service._id.toString(),
        target: "https://example.com/profile",
        quantity: 1000,
      })
    ).rejects.toMatchObject({ code: "WALLET_NOT_FOUND" });
  });

  it("under concurrent placement racing for the same limited balance, exactly one order succeeds and the wallet is never over-debited or double-counted (optimistic-concurrency guard)", async () => {
    // Wallet has exactly enough for ONE $10 order, but two requests fire
    // "simultaneously" — this is the exact scenario the `Wallet.version`
    // optimistic-concurrency `updateOne` guard in `placeOrder` exists to
    // prevent (a naive read-then-write race would let both succeed and
    // leave the wallet at -$10 or with only one debit recorded twice).
    const { user, wallet } = await seedUserWithWallet("10.00");
    const service = await seedService({ rate: "10.0000" });

    const attempt = () =>
      placeOrder({
        userId: user._id.toString(),
        userStatus: "ACTIVE",
        serviceId: service._id.toString(),
        target: "https://example.com/profile",
        quantity: 1000,
      });

    const results = await Promise.allSettled([attempt(), attempt()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one of the two concurrent attempts must succeed.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser must fail with a recognizable, retryable error code — not
    // a generic crash — either because the wallet update lost the
    // optimistic-concurrency race (CONCURRENT_MODIFICATION) or because it
    // observed the already-decremented balance as insufficient
    // (INSUFFICIENT_BALANCE). Both are correct, safe outcomes; a silent
    // double-debit or an unhandled exception would not be.
    const rejectionCode = (rejected[0] as PromiseRejectedResult).reason?.code;
    expect(["CONCURRENT_MODIFICATION", "INSUFFICIENT_BALANCE"]).toContain(rejectionCode);

    const finalWallet = await Wallet.findById(wallet._id);
    expect(decimalToNumber(finalWallet!.balance)).toBeCloseTo(0, 4); // never negative, never double-spent
    expect(finalWallet!.version).toBe(1); // incremented exactly once total, not twice

    expect(await Order.countDocuments()).toBe(1);
    expect(await Transaction.countDocuments()).toBe(1);
  });
});
