import { prisma } from "@/lib/db";
import { calculateCharge, isGreaterOrEqual, subtractMoney } from "@/lib/money";
import { dispatchOrderToProvider } from "@/lib/fulfillment";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Order } from "@/lib/generated/prisma";

/**
 * Shared order-placement logic used by BOTH the website (`app/api/orders/route.ts`)
 * and the Telegram bot (`lib/telegram/bot.ts`), so the money-handling/transaction
 * code exists exactly once regardless of which surface the user orders from.
 *
 * Postgres/Prisma migration note: this is the single most safety-critical
 * function in the app (see MEMORY.md) — it must never let two concurrent
 * calls both debit the same wallet past zero. The original MongoDB version
 * combined a multi-document transaction with an optimistic-concurrency
 * `Wallet.version` guard (`updateOne({ _id, version }, ...)`, checking
 * `modifiedCount === 1`). This version reproduces the *exact same*
 * combination on Postgres:
 *   - `prisma.$transaction(async (tx) => ...)` — an interactive transaction,
 *     Prisma's equivalent of `mongoSession.withTransaction()`.
 *   - `tx.wallet.updateMany({ where: { id, version }, data: { ...,
 *     version: { increment: 1 } } })` — a conditional UPDATE guarded by the
 *     *same* version value just read, translated 1:1 from the original
 *     Mongoose call. `updateMany` (not `update`) is used deliberately: it
 *     returns a `{ count }` result without throwing when zero rows match,
 *     which is exactly the "did this actually apply" signal needed here —
 *     Prisma's singular `update` would instead throw a generic
 *     `RecordNotFound` error that can't distinguish "wallet doesn't exist"
 *     from "version mismatch, a concurrent order raced us" without an extra
 *     read. If `count !== 1`, another request already changed the wallet's
 *     version since we read it — the entire transaction rolls back
 *     automatically (Postgres transaction semantics), so no partial
 *     state (an order with no matching debit) can ever be left behind.
 */
export async function placeOrder(params: {
  userId: string;
  userStatus: string;
  serviceId: string;
  target: string;
  quantity: number;
}): Promise<Order> {
  const { userId, userStatus, serviceId, target, quantity } = params;

  if (userStatus !== "ACTIVE") {
    throw new AppError("ACCOUNT_NOT_ACTIVE", "Your account is not active.");
  }

  const service = await prisma.service.findFirst({ where: { id: serviceId, active: true } });
  if (!service) {
    throw new AppError("SERVICE_NOT_FOUND", "Service not found or unavailable.");
  }

  if (quantity < service.minQuantity || quantity > service.maxQuantity) {
    throw new AppError(
      "INVALID_QUANTITY",
      `Quantity must be between ${service.minQuantity} and ${service.maxQuantity}.`
    );
  }

  const charge = calculateCharge(service.rate, quantity);

  const createdOrder = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new AppError("WALLET_NOT_FOUND", "Wallet not found.");
    }

    if (!isGreaterOrEqual(wallet.balance, charge)) {
      throw new AppError("INSUFFICIENT_BALANCE", "Insufficient wallet balance.");
    }

    const balanceBefore = wallet.balance;
    const balanceAfter = subtractMoney(wallet.balance, charge);

    const updateResult = await tx.wallet.updateMany({
      where: { id: wallet.id, version: wallet.version },
      data: { balance: balanceAfter, version: { increment: 1 } },
    });

    if (updateResult.count !== 1) {
      throw new AppError("CONCURRENT_MODIFICATION", "Please try again — a concurrent update occurred.");
    }

    const order = await tx.order.create({
      data: {
        userId,
        serviceId: service.id,
        providerId: service.providerId,
        target,
        quantity,
        charge,
        status: "PENDING",
        statusHistory: [{ status: "PENDING", note: "Order created", at: new Date().toISOString() }],
      },
    });

    await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type: "ORDER_PAYMENT",
        status: "COMPLETED",
        amount: charge,
        balanceBefore,
        balanceAfter,
        description: `Order payment for ${service.name}`,
        relatedOrderId: order.id,
      },
    });

    return order;
  });

  dispatchOrderToProvider(createdOrder.id).catch((err) => {
    logger.error({ err, orderId: createdOrder.id }, "Order dispatch error");
  });

  return createdOrder;
}
