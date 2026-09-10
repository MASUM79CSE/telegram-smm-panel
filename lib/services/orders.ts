import mongoose from "mongoose";
import type { HydratedDocument } from "mongoose";

import { Service } from "@/models/Service";
import { Order, type IOrder } from "@/models/Order";
import { Wallet } from "@/models/Wallet";
import { Transaction } from "@/models/Transaction";
import { calculateCharge, isGreaterOrEqual, subtractMoney } from "@/lib/money";
import { dispatchOrderToProvider } from "@/lib/fulfillment";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Shared order-placement logic used by BOTH the website (`app/api/orders/route.ts`)
 * and the Telegram bot (`lib/telegram/bot.ts`), so the money-handling/transaction
 * code exists exactly once regardless of which surface the user orders from.
 */
export async function placeOrder(params: {
  userId: string;
  userStatus: string;
  serviceId: string;
  target: string;
  quantity: number;
}): Promise<HydratedDocument<IOrder>> {
  const { userId, userStatus, serviceId, target, quantity } = params;

  if (userStatus !== "ACTIVE") {
    throw new AppError("ACCOUNT_NOT_ACTIVE", "Your account is not active.");
  }

  const service = await Service.findOne({ _id: serviceId, active: true });
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

  const mongoSession = await mongoose.startSession();
  let createdOrder: HydratedDocument<IOrder> | undefined;

  try {
    await mongoSession.withTransaction(async () => {
      const wallet = await Wallet.findOne({ userId }).session(mongoSession);
      if (!wallet) {
        throw new AppError("WALLET_NOT_FOUND", "Wallet not found.");
      }

      if (!isGreaterOrEqual(wallet.balance, charge)) {
        throw new AppError("INSUFFICIENT_BALANCE", "Insufficient wallet balance.");
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = subtractMoney(wallet.balance, charge);

      const updateResult = await Wallet.updateOne(
        { _id: wallet._id, version: wallet.version },
        { $set: { balance: balanceAfter }, $inc: { version: 1 } }
      ).session(mongoSession);

      if (updateResult.modifiedCount !== 1) {
        throw new AppError("CONCURRENT_MODIFICATION", "Please try again — a concurrent update occurred.");
      }

      const [order] = await Order.create(
        [
          {
            userId,
            serviceId: service._id,
            providerId: service.providerId,
            target,
            quantity,
            charge,
            status: "PENDING",
            statusHistory: [{ status: "PENDING", note: "Order created", at: new Date() }],
          },
        ],
        { session: mongoSession }
      );

      await Transaction.create(
        [
          {
            userId,
            walletId: wallet._id,
            type: "ORDER_PAYMENT",
            status: "COMPLETED",
            amount: charge,
            balanceBefore,
            balanceAfter,
            description: `Order payment for ${service.name}`,
            relatedOrderId: order._id,
          },
        ],
        { session: mongoSession }
      );

      createdOrder = order;
    });
  } finally {
    await mongoSession.endSession();
  }

  if (createdOrder) {
    const orderId = createdOrder._id.toString();
    dispatchOrderToProvider(orderId).catch((err) => {
      logger.error({ err, orderId }, "Order dispatch error");
    });
  }

  return createdOrder!;
}
