import { prisma } from "@/lib/db";
import type { Order, OrderStatus, Prisma } from "@/lib/generated/prisma";
import { addMoney } from "@/lib/money";
import { AppError } from "@/lib/errors";

function appendStatusHistory(order: { statusHistory: Prisma.JsonValue }, status: string, note: string | null, at: Date) {
  const existing = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  return [...existing, { status, note, at: at.toISOString() }];
}

/**
 * Shared order-refund logic used by both the admin website
 * (`app/api/admin/orders/[id]/route.ts`) and the Telegram bot's admin inline
 * "Refund" button, so the wallet-crediting transaction exists exactly once.
 */
export async function refundOrder(orderId: string, note?: string | null): Promise<Order> {
  return prisma.$transaction(async (tx) => {
    const existingOrder = await tx.order.findUnique({ where: { id: orderId } });
    // Deliberately the SAME error code as the atomic-claim failure below
    // (rather than a separate NOT_FOUND) — from the caller's perspective
    // "this order doesn't exist" and "this order already got refunded by
    // someone else" are both just "there's nothing left here to refund",
    // and collapsing them into one code/HTTP status (409, see
    // app/api/admin/orders/[id]/route.ts's errorStatusMap) avoids leaking
    // which of the two actually happened.
    if (!existingOrder) {
      throw new AppError("ALREADY_REFUNDED_OR_NOT_FOUND", "Order already refunded or not found.");
    }

    const now = new Date();

    // Atomic claim: only one concurrent request can transition into REFUNDED.
    const claim = await tx.order.updateMany({
      where: { id: orderId, status: { not: "REFUNDED" } },
      data: {
        status: "REFUNDED",
        statusHistory: appendStatusHistory(existingOrder, "REFUNDED", note ?? "Refunded by admin", now),
      },
    });

    if (claim.count !== 1) {
      throw new AppError("ALREADY_REFUNDED_OR_NOT_FOUND", "Order already refunded or not found.");
    }

    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError("NOT_FOUND", "Order not found.");

    const wallet = await tx.wallet.findUnique({ where: { userId: order.userId } });
    if (!wallet) throw new AppError("WALLET_NOT_FOUND", "User wallet not found.");

    const balanceBefore = wallet.balance;
    const balanceAfter = addMoney(wallet.balance, order.charge);

    const walletUpdate = await tx.wallet.updateMany({
      where: { id: wallet.id, version: wallet.version },
      data: { balance: balanceAfter, version: { increment: 1 } },
    });

    if (walletUpdate.count !== 1) {
      throw new AppError("CONCURRENT_MODIFICATION", "Please try again — a concurrent update occurred.");
    }

    await tx.transaction.create({
      data: {
        userId: order.userId,
        walletId: wallet.id,
        type: "ORDER_REFUND",
        status: "COMPLETED",
        amount: order.charge,
        balanceBefore,
        balanceAfter,
        description: `Refund for order ${order.id}`,
        relatedOrderId: order.id,
        idempotencyKey: `order-refund:${order.id}`,
      },
    });

    return order;
  });
}

/** Non-refund status transitions — no money movement, just a status/history update. */
export async function changeOrderStatus(
  orderId: string,
  status: Exclude<OrderStatus, "REFUNDED">,
  note?: string | null
): Promise<Order> {
  const now = new Date();

  const existing = await prisma.order.findUnique({ where: { id: orderId } });
  if (!existing) throw new AppError("NOT_FOUND", "Order not found.");

  // `completedAt` is the anchor for the Phase 3.1 refill-eligibility window
  // (`refillDays` days from first completion) — set it the moment an order
  // first reaches COMPLETED, from whichever path gets it there (today: only
  // this admin transition; once Phase 3.2's status poller can also resolve
  // an order to COMPLETED, it reuses this same function so the anchor stays
  // correct either way). Setting `completedAt: now` unconditionally on every
  // transition INTO "COMPLETED" is intentionally simple — an order cannot be
  // un-completed and re-completed in this system's state machine, so
  // there's no double-set risk to guard against.
  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      status,
      statusHistory: appendStatusHistory(existing, status, note ?? null, now),
      ...(status === "COMPLETED" ? { completedAt: now } : {}),
    },
  });

  return order;
}
