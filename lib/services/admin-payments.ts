import mongoose from "mongoose";
import type { HydratedDocument } from "mongoose";

import { Payment, type IPayment } from "@/models/Payment";
import { Wallet } from "@/models/Wallet";
import { Transaction } from "@/models/Transaction";
import { addMoney, toDecimal128 } from "@/lib/money";
import { AppError } from "@/lib/errors";

/**
 * Shared deposit-approval logic used by both the admin website
 * (`app/api/admin/payments/[id]/approve/route.ts`) and the Telegram bot's
 * admin inline "Approve" button, so the money-crediting transaction exists
 * exactly once.
 */
export async function approveDeposit(
  paymentId: string,
  reviewerId: string
): Promise<HydratedDocument<IPayment>> {
  const mongoSession = await mongoose.startSession();
  let updatedPayment: HydratedDocument<IPayment> | undefined;

  try {
    await mongoSession.withTransaction(async () => {
      const payment = await Payment.findById(paymentId).session(mongoSession);
      if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");

      const reviewedAt = new Date();

      // Atomic claim: only one concurrent request can transition PENDING -> COMPLETED.
      const claim = await Payment.updateOne(
        { _id: paymentId, status: "PENDING" },
        { $set: { status: "COMPLETED", reviewedBy: reviewerId, reviewedAt } }
      ).session(mongoSession);

      if (claim.modifiedCount !== 1) {
        throw new AppError("ALREADY_PROCESSED", "This payment has already been processed.");
      }

      const wallet = await Wallet.findOne({ userId: payment.userId }).session(mongoSession);
      if (!wallet) throw new AppError("WALLET_NOT_FOUND", "User wallet not found.");

      const amount = toDecimal128(payment.amount.toString());
      const balanceBefore = wallet.balance;
      const balanceAfter = addMoney(wallet.balance, amount);

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
            userId: payment.userId,
            walletId: wallet._id,
            type: "DEPOSIT",
            status: "COMPLETED",
            amount,
            balanceBefore,
            balanceAfter,
            description: `Deposit approved: ${payment.transactionRef ?? payment._id.toString()}`,
            relatedPaymentId: payment._id,
            idempotencyKey: `payment-approval:${payment._id.toString()}`,
          },
        ],
        { session: mongoSession }
      );

      // IMPORTANT: `payment` above was fetched BEFORE the `Payment.updateOne`
      // claim ran, so it's a stale in-memory snapshot still showing
      // `status: "PENDING"` — Mongoose documents are not automatically
      // refreshed by a separate `updateOne` call against the same _id.
      // Returning `payment` directly here was a real bug (found via this
      // function's own integration test): callers — the approve API route
      // (which sends `updatedPayment` straight back to the admin UI) and
      // the Telegram bot's inline "Approve" handler — would both display
      // the payment as still PENDING immediately after a successful
      // approval, even though the database was correctly updated
      // underneath. Mutate the in-memory document to match what was just
      // persisted instead of doing a second round-trip read.
      payment.status = "COMPLETED";
      payment.reviewedBy = new mongoose.Types.ObjectId(reviewerId);
      payment.reviewedAt = reviewedAt;

      updatedPayment = payment;
    });
  } finally {
    await mongoSession.endSession();
  }

  return updatedPayment!;
}

export async function rejectDeposit(
  paymentId: string,
  reviewerId: string,
  reason?: string | null
): Promise<HydratedDocument<IPayment>> {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");

  const reviewedAt = new Date();

  const result = await Payment.updateOne(
    { _id: paymentId, status: "PENDING" },
    {
      $set: {
        status: "REJECTED",
        reviewedBy: reviewerId,
        reviewedAt,
        rejectionReason: reason ?? null,
      },
    }
  );

  if (result.modifiedCount === 0) {
    throw new AppError("ALREADY_PROCESSED", "This payment has already been processed.");
  }

  // Same stale-document pitfall as `approveDeposit` above: `payment` was
  // fetched before the `updateOne` claim ran, so it must be mutated
  // in-memory to reflect what was actually just persisted, rather than
  // returned as-is still showing the pre-rejection `PENDING` status.
  payment.status = "REJECTED";
  payment.reviewedBy = new mongoose.Types.ObjectId(reviewerId);
  payment.reviewedAt = reviewedAt;
  payment.rejectionReason = reason ?? null;

  return payment;
}
