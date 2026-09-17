import { prisma } from "@/lib/db";
import type { PaymentMethod } from "@/lib/generated/prisma";
import { AppError } from "@/lib/errors";
import { decimalToNumber } from "@/lib/money";

/**
 * Shared deposit-submission logic used by both the website (`app/api/payments/route.ts`)
 * and the Telegram bot's `/deposit` conversation.
 */
export async function submitDeposit(params: {
  userId: string;
  amount: number;
  method: PaymentMethod;
  transactionRef: string;
}) {
  const { userId, amount, method, transactionRef } = params;

  const settings = await prisma.settings.upsert({
    where: { key: "global" },
    create: { key: "global" },
    update: {},
  });

  const min = decimalToNumber(settings.minDeposit);
  const max = decimalToNumber(settings.maxDeposit);

  if (amount < min || amount > max) {
    throw new AppError("AMOUNT_OUT_OF_RANGE", `Deposit amount must be between ${min} and ${max}.`);
  }

  const existing = await prisma.payment.findUnique({ where: { transactionRef } });
  if (existing) {
    throw new AppError("DUPLICATE_REFERENCE", "This transaction reference has already been submitted.");
  }

  const payment = await prisma.payment.create({
    data: {
      userId,
      amount,
      method,
      transactionRef,
      status: "PENDING",
    },
  });

  return payment;
}
