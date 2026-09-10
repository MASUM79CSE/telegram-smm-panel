import mongoose from "mongoose";
import type { HydratedDocument } from "mongoose";

import { Order, type IOrder, type OrderStatus } from "@/models/Order";
import { Wallet } from "@/models/Wallet";
import { Transaction } from "@/models/Transaction";
import { addMoney } from "@/lib/money";
import { AppError } from "@/lib/errors";

/**
 * Shared order-refund logic used by both the admin website
 * (`app/api/admin/orders/[id]/route.ts`) and the Telegram bot's admin inline
 * "Refund" button, so the wallet-crediting transaction exists exactly once.
 */
export async function refundOrder(
  orderId: string,
  note?: string | null
): Promise<HydratedDocument<IOrder>> {
  const mongoSession = await mongoose.startSession();
  let refundedOrder: HydratedDocument<IOrder> | undefined;

  try {
    await mongoSession.withTransaction(async () => {
      // Atomic claim: only one concurrent request can transition into REFUNDED.
      const claim = await Order.updateOne(
        { _id: orderId, status: { $nin: ["REFUNDED"] } },
        {
          $set: { status: "REFUNDED" },
          $push: { statusHistory: { status: "REFUNDED", note: note ?? "Refunded by admin", at: new Date() } },
        }
      ).session(mongoSession);

      if (claim.modifiedCount !== 1) {
        throw new AppError("ALREADY_REFUNDED_OR_NOT_FOUND", "Order already refunded or not found.");
      }

      const order = await Order.findById(orderId).session(mongoSession);
      if (!order) throw new AppError("NOT_FOUND", "Order not found.");

      const wallet = await Wallet.findOne({ userId: order.userId }).session(mongoSession);
      if (!wallet) throw new AppError("WALLET_NOT_FOUND", "User wallet not found.");

      const balanceBefore = wallet.balance;
      const balanceAfter = addMoney(wallet.balance, order.charge);

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
            amount: order.charge,
            balanceBefore,
            balanceAfter,
            description: `Refund for order ${order._id.toString()}`,
            relatedOrderId: order._id,
            idempotencyKey: `order-refund:${order._id.toString()}`,
          },
        ],
        { session: mongoSession }
      );

      refundedOrder = order;
    });
  } finally {
    await mongoSession.endSession();
  }

  return refundedOrder!;
}

/** Non-refund status transitions — no money movement, just a status/history update. */
export async function changeOrderStatus(
  orderId: string,
  status: Exclude<OrderStatus, "REFUNDED">,
  note?: string | null
): Promise<HydratedDocument<IOrder>> {
  const now = new Date();

  // `completedAt` is the anchor for the Phase 3.1 refill-eligibility window
  // (`refillDays` days from first completion) — set it the moment an order
  // first reaches COMPLETED, from whichever path gets it there (today: only
  // this admin transition; once Phase 3.2's status poller can also resolve
  // an order to COMPLETED, it reuses this same function so the anchor stays
  // correct either way). `$set` with `completedAt: now` unconditionally on
  // every transition INTO "COMPLETED" is intentionally simple — an order
  // cannot be un-completed and re-completed in this system's state machine,
  // so there's no double-set risk to guard against.
  const update: Record<string, unknown> = {
    status,
    $push: { statusHistory: { status, note: note ?? null, at: now } },
  };
  if (status === "COMPLETED") {
    update.completedAt = now;
  }

  const order = await Order.findByIdAndUpdate(orderId, update, { returnDocument: "after" });

  if (!order) throw new AppError("NOT_FOUND", "Order not found.");

  return order;
}
