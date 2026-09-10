import { Payment, type PaymentMethod } from "@/models/Payment";
import { getSettings } from "@/models/Settings";
import { AppError } from "@/lib/errors";

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

  const settings = await getSettings();

  if (amount < settings.minDeposit || amount > settings.maxDeposit) {
    throw new AppError(
      "AMOUNT_OUT_OF_RANGE",
      `Deposit amount must be between ${settings.minDeposit} and ${settings.maxDeposit}.`
    );
  }

  const existing = await Payment.findOne({ transactionRef });
  if (existing) {
    throw new AppError("DUPLICATE_REFERENCE", "This transaction reference has already been submitted.");
  }

  const payment = await Payment.create({
    userId,
    amount,
    method,
    transactionRef,
    status: "PENDING",
  });

  return payment;
}
