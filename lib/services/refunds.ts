import mongoose from "mongoose";
import type { HydratedDocument } from "mongoose";

import { Order, type IOrder } from "@/models/Order";
import { Wallet } from "@/models/Wallet";
import { Transaction } from "@/models/Transaction";
import { addMoney, calculateCharge } from "@/lib/money";
import { AppError } from "@/lib/errors";

/**
 * Automatic partial-delivery refund (docs/IMPLEMENTATION_PLAN.md Phase 3.2).
 * Called from `lib/fulfillment.ts#pollOrderStatus` when an upstream
 * provider reports a "Partial" status with a nonzero `remains` count.
 *
 * `refundAmount = (remains / order.quantity) * order.charge` — recomputed
 * from the ORIGINAL order quantity/charge (not the provider's own rate),
 * consistent with how the customer was actually billed. Follows the exact
 * same atomic-transaction + `Wallet.version` optimistic-concurrency pattern
 * as `lib/services/admin-payments.ts#approveDeposit` and
 * `lib/services/admin-orders.ts#refundOrder` — see MEMORY.md §4 for why
 * this pattern must never be improvised differently per call site.
 *
 * Idempotency: guarded by BOTH (a) an atomic claim on
 * `Order.partialRefundIssuedAt: null` (so a retried/duplicate poll for the
 * same order can never double-refund, mirroring `refundOrder`'s
 * atomic-claim-first structure) AND (b) a deterministic
 * `idempotencyKey: partial-refund:<orderId>` on the `Transaction` row
 * itself, as defense in depth consistent with this project's standing
 * idempotency convention (see MEMORY.md §3/§4) — belt and suspenders, since
 * this is real money movement and a status-polling worker could plausibly
 * be invoked concurrently for the same order from two overlapping runs.
 */
export async function issuePartialRefund(
  orderId: string,
  remains: number
): Promise<HydratedDocument<IOrder> | null> {
  const mongoSession = await mongoose.startSession();
  let updatedOrder: HydratedDocument<IOrder> | undefined;

  try {
    await mongoSession.withTransaction(async () => {
      const now = new Date();

      // Atomic claim: only one concurrent poll can win the refund for this order.
      const claim = await Order.updateOne(
        { _id: orderId, status: "IN_PROGRESS", partialRefundIssuedAt: null },
        { $set: { partialRefundIssuedAt: now } }
      ).session(mongoSession);

      if (claim.modifiedCount !== 1) {
        // Already refunded (or no longer IN_PROGRESS) — not an error, just a no-op.
        return;
      }

      const order = await Order.findById(orderId).session(mongoSession);
      if (!order) throw new AppError("NOT_FOUND", "Order not found.");

      const quantity = order.quantity;
      const clampedRemains = Math.max(0, Math.min(remains, quantity));
      if (clampedRemains <= 0) return;

      // Proportional share of the ORIGINAL charge corresponding to the
      // undelivered quantity — reuses the same rate-based math as
      // `lib/money.ts#calculateCharge` by treating (remains/quantity) as an
      // effective "rate per unit quantity" scaled the same way, so this
      // never independently reinvents money-rounding rules.
      const refundAmount = calculateCharge(
        // charge is already a Decimal128 total for `quantity` units at the
        // service's rate-per-1000; the equivalent "rate per 1000 remaining
        // units" that reproduces the same total-charge math for a
        // `clampedRemains`-sized order is: (charge / quantity) * 1000.
        (Number(order.charge.toString()) / quantity) * 1000,
        clampedRemains
      );

      const wallet = await Wallet.findOne({ userId: order.userId }).session(mongoSession);
      if (!wallet) throw new AppError("WALLET_NOT_FOUND", "User wallet not found.");

      const balanceBefore = wallet.balance;
      const balanceAfter = addMoney(wallet.balance, refundAmount);

      const walletUpdate = await Wallet.updateOne(
        { _id: wallet._id, version: wallet.version },
        { $set: { balance: balanceAfter }, $inc: { version: 1 } }
      ).session(mongoSession);

      if (walletUpdate.modifiedCount !== 1) {
        throw new AppError("CONCURRENT_MODIFICATION", "Please try again — a concurrent update occurred.");
      }

      await Transaction.create(
        [
          {
            userId: order.userId,
            walletId: wallet._id,
            type: "ORDER_REFUND",
            status: "COMPLETED",
            amount: refundAmount,
            balanceBefore,
            balanceAfter,
            description: `Partial-delivery refund for order ${order._id.toString()} (${clampedRemains}/${quantity} undelivered)`,
            relatedOrderId: order._id,
            idempotencyKey: `partial-refund:${order._id.toString()}`,
          },
        ],
        { session: mongoSession }
      );

      order.status = "PARTIAL";
      order.remains = clampedRemains;
      order.statusHistory.push({
        status: "PARTIAL",
        note: `Provider reported ${clampedRemains}/${quantity} undelivered — auto-refunded proportionally.`,
        at: now,
      });
      await order.save({ session: mongoSession });

      updatedOrder = order;
    });
  } finally {
    await mongoSession.endSession();
  }

  return updatedOrder ?? null;
}
